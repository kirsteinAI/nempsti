// drive.js
// Google Drive integration via GIS (Google Identity Services) + fetch.
// §4.5 / §7.2 / §7.6.
//
// Keine gapi.client-Dependency — alle Drive-API-Aufrufe gehen über fetch().
// Nur GIS wird als externes Script vom Google-CDN geladen (einzige Runtime-Dep).
//
// Test-Hook: Wenn window.__NEMPSTI_DRIVE_MOCK__ gesetzt ist, werden alle
// Netzwerk-Aufrufe durch die Mock-Implementierung ersetzt. Tests dürfen
// NIEMALS echte Google-Accounts verwenden (§14 Regel 17).

// Browser-OAuth-Client-ID ist per Google-Design kein Geheimnis (§4.5).
// Muss beim Deploy auf GitHub Pages durch eine echte Client-ID ersetzt werden.
export const GOOGLE_CLIENT_ID = '561083578357-vd41cb1mis1pc8il422d71rtma1g34fn.apps.googleusercontent.com';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const BACKUP_FILENAME = 'nempsti-data.json';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

/**
 * Status-Enum für den Backup-Indikator (§4.5, §7.2, §7.6).
 */
export const DriveStatus = Object.freeze({
  UNCONFIGURED: 'unconfigured',   // Client-ID nicht gesetzt
  INITIALIZING: 'initializing',   // GIS wird geladen
  UNAUTHORIZED: 'unauthorized',   // Consent nötig oder Token abgelaufen
  READY: 'ready',                 // Token vorhanden, Sync kann starten
  ERROR: 'error',                 // Letzter Sync/Auth-Call fehlgeschlagen
  SYNCING: 'syncing',             // Sync läuft
  OFFLINE: 'offline',             // Netzwerkfehler, Sync wird beim nächsten Trigger versucht
});

let _status = DriveStatus.UNCONFIGURED;
let _statusDetail = '';
let _accessToken = null;
let _tokenExpiresAt = 0;
let _tokenClient = null;
let _gisReady = false;
let _backupFileId = null;
let _lastSuccessfulSyncAt = null;
let _lastSyncError = null;
let _statusListeners = new Set();

function setStatus(status, detail = '') {
  _status = status;
  _statusDetail = detail;
  for (const cb of _statusListeners) {
    try { cb({ status, detail }); } catch (err) { console.error('[drive] listener failed:', err); }
  }
}

export function getDriveStatus() {
  return { status: _status, detail: _statusDetail, lastSyncAt: _lastSuccessfulSyncAt, lastError: _lastSyncError };
}

export function onDriveStatusChange(cb) {
  _statusListeners.add(cb);
  return () => _statusListeners.delete(cb);
}

function isMocked() {
  return typeof window !== 'undefined' && !!window.__NEMPSTI_DRIVE_MOCK__;
}

function getMock() {
  return window.__NEMPSTI_DRIVE_MOCK__;
}

function isConfigured() {
  return GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('REPLACE_WITH_');
}

/** Lädt GIS als externes Script, falls noch nicht vorhanden. */
function loadGISScript() {
  return new Promise((resolve, reject) => {
    if (_gisReady || (window.google && window.google.accounts && window.google.accounts.oauth2)) {
      _gisReady = true;
      resolve();
      return;
    }
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => { _gisReady = true; resolve(); });
      existing.addEventListener('error', () => reject(new Error('GIS script failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => { _gisReady = true; resolve(); };
    script.onerror = () => reject(new Error('GIS script failed to load'));
    document.head.appendChild(script);
  });
}

/**
 * Initialisiert die Drive-Integration. Muss einmal beim App-Start aufgerufen
 * werden (nach dem initialen Render, damit der UI-Thread nicht blockiert).
 * Gibt synchron zurück, der eigentliche GIS-Load läuft im Hintergrund.
 */
export async function initDrive() {
  if (isMocked()) {
    setStatus(DriveStatus.READY);
    const mock = getMock();
    if (mock.initialFileExists) {
      _backupFileId = 'mock-file-id';
    }
    return;
  }
  if (!isConfigured()) {
    setStatus(DriveStatus.UNCONFIGURED, 'GOOGLE_CLIENT_ID nicht gesetzt — Drive-Backup deaktiviert');
    return;
  }
  setStatus(DriveStatus.INITIALIZING);
  try {
    await loadGISScript();
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: () => {}, // wird pro request überschrieben
    });
    setStatus(DriveStatus.UNAUTHORIZED);
  } catch (err) {
    _lastSyncError = err;
    setStatus(DriveStatus.ERROR, String(err?.message || err));
  }
}

/**
 * Fordert ein Access-Token an. Mit `silent: true` wird `prompt: ''` verwendet
 * (stilles Re-Auth). Mit `silent: false` ggf. Consent-Popup.
 */
export function ensureToken({ silent = true } = {}) {
  if (isMocked()) {
    _accessToken = 'mock-token';
    _tokenExpiresAt = Date.now() + 3600_000;
    return Promise.resolve(_accessToken);
  }
  if (!_tokenClient) return Promise.reject(new Error('Drive nicht initialisiert'));
  if (_accessToken && _tokenExpiresAt > Date.now() + 60_000) {
    return Promise.resolve(_accessToken);
  }
  return new Promise((resolve, reject) => {
    _tokenClient.callback = (resp) => {
      if (resp && resp.access_token) {
        _accessToken = resp.access_token;
        _tokenExpiresAt = Date.now() + ((resp.expires_in || 3600) * 1000);
        setStatus(DriveStatus.READY);
        resolve(_accessToken);
      } else {
        setStatus(DriveStatus.UNAUTHORIZED, resp?.error || 'Token-Request fehlgeschlagen');
        reject(new Error(resp?.error || 'Token-Request fehlgeschlagen'));
      }
    };
    try {
      _tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' });
    } catch (err) {
      reject(err);
    }
  });
}

async function driveFetch(url, options = {}) {
  if (isMocked()) return getMock().fetch(url, options);
  const token = await ensureToken({ silent: true });
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  return fetch(url, { ...options, headers });
}

async function findBackupFile() {
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${BACKUP_FILENAME}'`)}&fields=files(id,name,modifiedTime)`;
  const resp = await driveFetch(url);
  if (!resp.ok) throw await httpError(resp, 'List failed');
  const json = await resp.json();
  const first = (json.files || [])[0];
  return first ? first.id : null;
}

async function httpError(resp, prefix) {
  let body = '';
  try { body = await resp.text(); } catch {}
  const err = new Error(`${prefix}: HTTP ${resp.status} ${resp.statusText} ${body.slice(0, 200)}`);
  err.status = resp.status;
  return err;
}

function buildMultipartBody(metadata, jsonPayload) {
  const boundary = 'nempsti-' + Math.random().toString(36).slice(2);
  const delim = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;
  const body =
    delim +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delim +
    'Content-Type: application/json\r\n\r\n' +
    jsonPayload +
    closeDelim;
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

/**
 * Uploaded appData als JSON nach Drive appDataFolder. Erstellt oder
 * überschreibt `nempsti-data.json`.
 *
 * @param {object} appData
 * @returns {Promise<void>}
 */
export async function backupNow(appData) {
  if (isMocked() === false && !isConfigured()) {
    // Backup stillschweigend überspringen, wenn Drive nicht konfiguriert ist.
    return;
  }
  setStatus(DriveStatus.SYNCING);
  try {
    if (!_backupFileId) {
      _backupFileId = await findBackupFile();
    }
    const jsonPayload = JSON.stringify(appData);
    const metadata = _backupFileId
      ? { name: BACKUP_FILENAME }
      : { name: BACKUP_FILENAME, parents: ['appDataFolder'] };
    const { body, contentType } = buildMultipartBody(metadata, jsonPayload);

    const url = _backupFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(_backupFileId)}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
    const method = _backupFileId ? 'PATCH' : 'POST';

    const resp = await driveFetch(url, { method, headers: { 'Content-Type': contentType }, body });
    if (!resp.ok) {
      const err = await httpError(resp, 'Upload failed');
      return handleSyncError(err);
    }
    const json = await resp.json();
    if (json.id) _backupFileId = json.id;
    _lastSuccessfulSyncAt = new Date().toISOString();
    _lastSyncError = null;
    setStatus(DriveStatus.READY);
  } catch (err) {
    return handleSyncError(err);
  }
}

function handleSyncError(err) {
  _lastSyncError = { message: String(err.message || err), status: err.status || null, at: new Date().toISOString() };
  // §7.2 Policy-Skizze — eigentliche Retry-Logik wird beim nächsten Trigger
  // automatisch über den Dirty-Flag ausgelöst.
  if (err.status === 401) {
    setStatus(DriveStatus.UNAUTHORIZED, 'Token abgelaufen — neu anmelden');
  } else if (err.status === 403) {
    setStatus(DriveStatus.ERROR, 'Quota/Rate — beim nächsten Start erneut versuchen');
  } else if (err.status && err.status >= 500) {
    setStatus(DriveStatus.ERROR, 'Server-Fehler — beim nächsten Start erneut versuchen');
  } else {
    setStatus(DriveStatus.OFFLINE, String(err.message || err));
  }
  throw err;
}

/**
 * Lädt Backup aus Drive herunter und gibt das rohe JSON-Objekt zurück.
 * Validierung + Migration erfolgen in app.js nach §7.3 Restore-Atomicity-Kontrakt.
 *
 * @returns {Promise<object|null>} null, wenn kein Backup existiert
 */
export async function restore() {
  if (!isMocked() && !isConfigured()) return null;
  setStatus(DriveStatus.SYNCING);
  try {
    if (!_backupFileId) {
      _backupFileId = await findBackupFile();
    }
    if (!_backupFileId) {
      setStatus(DriveStatus.READY);
      return null;
    }
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(_backupFileId)}?alt=media`;
    const resp = await driveFetch(url);
    if (!resp.ok) throw await httpError(resp, 'Download failed');
    const text = await resp.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error('Drive-Backup korrupt — JSON-Parse fehlgeschlagen');
    }
    setStatus(DriveStatus.READY);
    return parsed;
  } catch (err) {
    return handleSyncError(err);
  }
}

/**
 * Prüft, ob im appDataFolder bereits ein Backup existiert (ohne Download).
 */
export async function backupExists() {
  if (!isMocked() && !isConfigured()) return false;
  try {
    if (!_backupFileId) _backupFileId = await findBackupFile();
    return _backupFileId !== null;
  } catch {
    return false;
  }
}
