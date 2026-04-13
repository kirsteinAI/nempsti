// app.js
// Wiring, Event-Handler, Init. §15.4.
//
// Verantwortlich für:
// - Initialisierung (Load aus IDB → Validierung → Migration → setAppData → Render)
// - DSGVO-Erstlauf-Modal, Version-Conflict-Modal
// - Drive-Integration (Auth, Auto-Backup bei visibilitychange)
// - Alle Event-Handler (per data-action-Dispatch, kein inline-onclick)
// - Service-Worker-Registrierung + Update-Check
// - Diagnose-Panel (5-fach-Tap auf Header)

import {
  FORMAT,
  escapeHtml,
  generateId,
  validateAppData,
  validateSessionRecord,
  validateSupervisionRecord,
  validateForecastIntakeRecord,
  createEmptyAppData,
  createDefaultBewilligt,
  computeSessionPhase,
} from './validation.js';
import { ABSCHLUSSKONTROLLEN } from './forecast.js';
import { runMigrations, CURRENT_VERSION } from './migrations.js';
import * as db from './db.js';
import * as state from './state.js';
import * as drive from './drive.js';
import {
  renderAll,
  showTab,
  showPatientListView,
  showPatientDetail,
  showToast,
  showConfirmDialog,
  openModal,
  closeModal,
  renderDataTab,
  getLastRenderErrors,
  getLastRenderDurationMs,
  getCurrentDetailPatientId,
} from './render.js';

// ============ STATE FOR MODALS ============
let _sessionDefaultPatientId = null;
let _lastDriveError = null;
// Codex-v4 fix: Wenn true, unterdrückt updateAppData() den IDB-Write.
// Wird gesetzt, wenn initApp() eine Migration-Failure erkennt und den
// Original-IDB-Payload für einen künftigen Code-Hotfix bewahren will.
// Wird gecleart, sobald ein expliziter Recovery-Pfad (Import, Restore,
// Clear) erfolgreich einen durable Write durchführt.
let _recoveryMode = false;

/** Signalisiert Test-Hooks, dass initApp() abgeschlossen ist. */
function signalReady() {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.__nempstiReady = true;
  }
}

// ============ INIT ============

async function initApp() {
  // 1) Render-Callback in state.js registrieren. Muss VOR wireEventHandlers
  //    passieren, damit ein click, der vor dem ersten setAppData eintrifft,
  //    nicht ins Leere läuft (updateAppData guarded mit `if (_renderAll)`).
  state.configureState({
    renderAll,
    onDriveDirty: () => { /* Phase 1: flush nur bei visibilitychange */ },
  });

  // 2) Event-Handler verdrahten — MUSS vor jedem möglichen frühen Return
  //    stehen, damit die einzige Recovery-Aktion im Version-Conflict-Modal
  //    (data-action="force-reload") tatsächlich bindet. Siehe §10.5 und den
  //    Codex-Review "Future-version data path opens a modal and then
  //    disables the only recovery action".
  wireEventHandlers();

  // 3) IDB laden.
  let loaded = null;
  try {
    loaded = await db.loadAppData();
  } catch (err) {
    console.error('[app] IDB load failed:', err);
    showToast('Lokale Datenbank nicht erreichbar — App läuft mit leerem Zustand.', 'danger');
  }

  // 4) Validate + migrate + set state. Für den Version-Conflict-Fall (§10.5)
  //    öffnen wir das Modal und bleiben stehen — die Handler aus Schritt 2
  //    sind bereits wired, sodass "App neu laden" funktioniert.
  let appData;
  // Tracks whether the IDB payload couldn't be used (validation or migration
  // failure). Suppresses IDB persistence of the empty placeholder so the
  // original payload stays intact for recovery (Drive restore, JSON import,
  // or a future code hotfix).
  let loadFailed = false;
  if (loaded) {
    const validation = validateAppData(loaded);
    if (!validation.ok) {
      console.error('[app] IDB payload invalid:', validation.error);
      showToast('Lokale Daten beschädigt. Bitte über Daten-Tab aus Drive wiederherstellen oder JSON-Import nutzen.', 'danger');
      appData = createEmptyAppData();
      // Gleiche Recovery-Logik wie bei Migration-Failure: IDB nicht
      // überschreiben, Recovery-Modus aktivieren. Der Original-Payload
      // bleibt in IDB für den Fall, dass eine zukünftige Validator-Korrektur
      // ihn wieder akzeptiert.
      loadFailed = true;
      _recoveryMode = true;
      state.setRecoveryMode(true);
    } else {
      const mig = runMigrations(validation.data);
      if (!mig.ok) {
        if (mig.error && mig.error.includes('CURRENT_VERSION')) {
          // §10.5: version > CURRENT_VERSION → kein Laden, Modal zeigen.
          openModal('modal-version-conflict');
          // Leerer Platzhalter-State, damit getAppData() nichts Halbgares
          // zurückliefert. persist=false, damit wir NICHT die gute IDB-Daten
          // überschreiben — sonst wäre der Schaden beim nächsten Update total.
          state.setAppData(createEmptyAppData(), { persist: false, flagDirty: false });
          signalReady();
          return;
        }
        showToast(mig.error, 'danger');
        // Codex-v3 fix: KEIN durableWrite(rollback) — der Rollback ist ein
        // structuredClone des IDB-Inhalts, also identisch mit dem, was schon
        // in IDB steht. Ihn zurückzuschreiben ist ein No-Op, der beim
        // nächsten Reload dieselbe Failure auslöst (Boot-Loop).
        //
        // Stattdessen: KEIN early return. Boot läuft weiter mit leerem
        // Platzhalter-State (persist: false, damit IDB unberührt bleibt).
        // Drive, Service Worker und Event-Handler werden normal initialisiert,
        // sodass der User Drive-Restore oder JSON-Import als Recovery nutzen
        // kann. Bei einem Code-Hotfix der Migration wird der nächste Reload
        // den IDB-Inhalt korrekt migrieren.
        appData = createEmptyAppData();
        loadFailed = true;
        _recoveryMode = true;
        state.setRecoveryMode(true);
      } else {
        appData = mig.data;
      }
    }
  } else {
    appData = createEmptyAppData();
  }

  // 5) State setzen (ohne IDB-Write zurückzuschreiben, es sei denn wir haben
  //    tatsächlich migriert/initialisiert). Bei Migration-Failure bleibt IDB
  //    unangetastet — der Original-Payload soll dort erhalten bleiben, damit
  //    ein Code-Hotfix der Migration beim nächsten Reload greifen kann.
  const shouldPersist = !loadFailed && (!loaded || appData.version !== (loaded && loaded.version));
  state.setAppData(appData, { persist: shouldPersist, flagDirty: false });

  // 6) Setting-Inputs synchronisieren.
  document.getElementById('setting-ratio').value = appData.settings.supervisionRatio;
  document.getElementById('setting-kontingent').value = appData.settings.defaultKontingent;
  syncForecastInputs();

  // 7) DSGVO-Check. Wenn Zustimmung fehlt → Modal anzeigen.
  const dsgvoAccepted = !!appData.settings?.dsgvoAcknowledgedAt;
  if (!dsgvoAccepted) {
    openModal('modal-dsgvo');
  }

  // 8) Sync-Gate initialisieren (§7.3.1). Wenn lokale IDB bedeutungsvolle
  //    Daten enthält, vertrauen wir dem lokalen Stand sofort und erlauben
  //    Sync-OUT direkt — das ist der Normalfall für alle Folge-Sessions.
  //    Wenn lokal leer ist (Fresh Install, Storage Eviction, PWA-Reinstall),
  //    bleibt der Gate auf PENDING, bis ein Drive-Load bewiesen hat, was in
  //    Drive tatsächlich steht. Schützt vor dem Überschreiben existierender
  //    Drive-Backups mit einem leeren Zustand.
  if (hasMeaningfulData(appData)) {
    drive.setSyncGate(drive.SyncGate.ALLOWED);
  } else {
    drive.setSyncGate(drive.SyncGate.PENDING);
  }

  // 9) Drive-Status-Listener VOR initDrive registrieren, damit ein
  //    synchron feuernder Status-Wechsel (Mock-Fall: initDrive ruft
  //    setStatus(READY) synchron auf) vom Listener tatsächlich gesehen wird.
  drive.onDriveStatusChange((event) => {
    renderDataTab();
    // Wenn Drive gerade READY geworden ist UND der Gate noch PENDING ist,
    // starten wir den Auto-Load. Ein vorheriger FAILED wird bei erneutem
    // READY ebenfalls zu einem Retry.
    if (
      event.status === drive.DriveStatus.READY &&
      (drive.getSyncGate() === drive.SyncGate.PENDING || drive.getSyncGate() === drive.SyncGate.FAILED)
    ) {
      performFirstDriveLoad().catch(err => {
        console.error('[app] first drive load failed:', err);
      });
    }
  });

  // 10) Drive-Init im Hintergrund (blockiert nicht das erste Render).
  //     D1 fix: Nur starten, wenn DSGVO bereits akzeptiert ist. Beim ersten
  //     Start (DSGVO noch nicht akzeptiert) wird initDrive() erst in
  //     acceptDsgvo() aufgerufen, sodass kein Request an accounts.google.com
  //     geht, bevor der Nutzer zugestimmt hat (GDPR/TTDSG §25).
  if (dsgvoAccepted) {
    drive.initDrive().catch(err => {
      console.error('[app] drive init failed:', err);
      _lastDriveError = err;
    });
  }

  // 9) Service Worker registrieren.
  registerServiceWorker();

  // 10) visibilitychange → Drive-Sync.
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // 11) URL-Query ?debug=1 → Diagnose-Panel öffnen.
  if (new URLSearchParams(window.location.search).get('debug') === '1') {
    openDiagnose();
  }

  signalReady();
}

// ============ SYNC-GATE HELPERS (§7.3.1) ============

/**
 * Prüft, ob ein appData-Objekt bedeutungsvolle Nutzerdaten enthält. Wird in
 * initApp verwendet, um zu entscheiden, ob der lokale Stand als vertrauens-
 * würdig behandelt wird (→ SyncGate.ALLOWED) oder ob ein Drive-Load abgewartet
 * werden muss (→ SyncGate.PENDING).
 *
 * "Bedeutungsvoll" = mindestens ein Patient, eine Sitzung, eine Supervision
 * oder eine Supervisionsgruppe. Settings allein zählen nicht, weil ein
 * Fresh-Install trivialerweise Settings-Defaults hat, aber keinen fachlichen
 * Inhalt. Die DSGVO-Zustimmung zählt ebenfalls nicht — sie ist Meta-State,
 * kein Fachdaten-Signal.
 */
function hasMeaningfulData(appData) {
  if (!appData) return false;
  const patientCount = Array.isArray(appData.patients) ? appData.patients.length : 0;
  const sessionCount = Array.isArray(appData.sessions) ? appData.sessions.length : 0;
  const supervisionCount = Array.isArray(appData.supervisions) ? appData.supervisions.length : 0;
  const groupCount = Array.isArray(appData.supervisionGroups) ? appData.supervisionGroups.length : 0;
  // Forecast-Intakes zählen ebenfalls als Fachinhalt: ein User, der nur den
  // Aufnahmeplan gepflegt hat (ohne Sessions), würde sonst bei einem Fresh-
  // Install sein eigenes Drive-Backup überschreiben können.
  const intakeCount = Array.isArray(appData.forecastIntakes) ? appData.forecastIntakes.length : 0;
  return patientCount + sessionCount + supervisionCount + groupCount + intakeCount > 0;
}

/**
 * Lädt einmalig den Drive-Backup-Stand in die App und öffnet anschließend
 * den Sync-Gate. Wird automatisch aus dem onDriveStatusChange-Listener
 * aufgerufen, wenn Drive nach der Auth zum ersten Mal READY wird und der
 * Gate noch nicht ALLOWED ist.
 *
 * Garantien:
 * - Vor Aufruf von drive.restore() ist der Gate auf LOADING, sodass ein
 *   paralleler Sync-OUT (z.B. durch eine Race mit visibilitychange) sauber
 *   blockiert wird.
 * - Nach erfolgreichem Load ist der Gate auf ALLOWED und der Dirty-Flag
 *   wird explizit gecleart (local === Drive, nichts mehr zu pushen).
 * - Bei Fehler geht der Gate auf FAILED; der nächste READY-Trigger führt
 *   automatisch einen Retry durch.
 * - Wenn Drive leer ist (kein Backup-File), wird lokal nichts überschrieben
 *   und der Gate geht direkt auf ALLOWED — Drive bestätigt "noch nichts da",
 *   Sync-OUT wird als erstes den lokalen Stand hochladen.
 */
async function performFirstDriveLoad() {
  drive.setSyncGate(drive.SyncGate.LOADING);
  try {
    const remote = await drive.restore();
    if (remote) {
      // Drive hat Daten — validieren, migrieren, lokal übernehmen.
      const validation = validateAppData(remote);
      if (!validation.ok) {
        throw new Error('Drive-Backup ungültig: ' + validation.error);
      }
      const mig = runMigrations(validation.data);
      if (!mig.ok) {
        if (mig.error && mig.error.includes('CURRENT_VERSION')) {
          // §10.5: Drive hat eine neuere Schema-Version → Modal zeigen,
          // Gate bleibt FAILED, Sync-OUT wird niemals das Drive überschreiben.
          drive.setSyncGate(drive.SyncGate.FAILED);
          openModal('modal-version-conflict');
          return;
        }
        throw new Error('Migration des Drive-Backups fehlgeschlagen: ' + mig.error);
      }
      // Codex-v4 fix: Lokale DSGVO-Zustimmung bewahren, falls der Drive-
      // Payload sie nicht enthält (Legacy-Backups vor v2). Ohne dieses Merge
      // würde eine gerade erteilte Zustimmung durch den Restore überschrieben.
      const currentDsgvoAck = state.getAppData().settings?.dsgvoAcknowledgedAt;
      if (!mig.data.settings.dsgvoAcknowledgedAt && currentDsgvoAck) {
        mig.data.settings.dsgvoAcknowledgedAt = currentDsgvoAck;
      }
      // Lokalen Stand durch Drive-Inhalt ersetzen. flagDirty: false, weil
      // local jetzt per Definition == Drive ist. durable: true, damit IDB-
      // Write abgeschlossen ist, bevor wir Erfolg signalisieren (D2 fix).
      await state.setAppData(mig.data, { persist: true, durable: true, flagDirty: false });
      // Dirty-Flag könnte aus einer Mutation VOR dem Drive-Load stammen
      // (z.B. DSGVO-Akzeptanz). Den explizit clearen, weil der neue State
      // aus Drive kommt und damit "synchron" ist.
      state.clearDriveDirty();
      // UI-Settings-Inputs synchronisieren.
      const ratioEl = document.getElementById('setting-ratio');
      const kontingentEl = document.getElementById('setting-kontingent');
      if (ratioEl) ratioEl.value = mig.data.settings.supervisionRatio;
      if (kontingentEl) kontingentEl.value = mig.data.settings.defaultKontingent;
      syncForecastInputs();
      // Wenn der neue State bereits DSGVO-Zustimmung hat, DSGVO-Modal
      // schließen (wurde ggf. vorher geöffnet, bevor der Load kam).
      if (mig.data.settings && mig.data.settings.dsgvoAcknowledgedAt) {
        closeModal('modal-dsgvo');
      }
    }
    // Ob mit Inhalt oder leer: Übereinstimmung erreicht, Sync-OUT erlaubt.
    drive.setSyncGate(drive.SyncGate.ALLOWED);
  } catch (err) {
    drive.setSyncGate(drive.SyncGate.FAILED);
    _lastDriveError = err;
    showToast('Drive-Load fehlgeschlagen: ' + (err?.message || err), 'danger');
    throw err;
  }
}

// ============ DSGVO ============
function acceptDsgvo() {
  state.updateAppData(data => {
    if (!data.settings) data.settings = { supervisionRatio: 4, defaultKontingent: 60 };
    data.settings.dsgvoAcknowledgedAt = new Date().toISOString();
  });
  closeModal('modal-dsgvo');
  showToast('Einverständnis gespeichert.', 'success');

  // M4 fix: Persistent Storage anfragen, damit der Browser IDB nicht unter
  // Speicherdruck evicten kann. PWAs auf dem Homescreen bekommen bevorzugte
  // Behandlung. Kein User-Prompt — der Browser entscheidet still.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  // D1 fix: Drive-Init erst NACH DSGVO-Zustimmung starten, damit kein
  // Request an accounts.google.com geht, bevor der Nutzer eingewilligt hat.
  // Der Sync-Gate-Listener und onDriveStatusChange wurden bereits in initApp()
  // registriert, sodass performFirstDriveLoad() sauber feuert, sobald Drive
  // READY wird.
  drive.initDrive().catch(err => {
    console.error('[app] drive init after DSGVO failed:', err);
    _lastDriveError = err;
  });
}

function leaveDsgvo() {
  // Keine praktikable "App verlassen"-Option im Browser — wir blenden die
  // Hauptinhalte aus und bitten den Nutzer, den Tab zu schließen.
  document.querySelector('.content').style.display = 'none';
  document.querySelector('.tab-nav').style.display = 'none';
  document.getElementById('fab-btn').style.display = 'none';
  const msg = document.createElement('div');
  msg.style.cssText = 'padding:24px;text-align:center;font-size:0.9rem;color:var(--gray-700);';
  msg.textContent = 'Du kannst diesen Tab jetzt schließen.';
  document.body.appendChild(msg);
}

// ============ SERVICE WORKER ============
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    // SW braucht Secure-Context — nur auf HTTPS oder localhost.
    return;
  }
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showToast('Neue Version verfügbar — bitte neu laden.', 'warning');
        }
      });
    });
  }).catch(err => console.error('[app] SW register failed:', err));
}

// ============ VISIBILITY / DRIVE SYNC ============
let _syncInProgress = false; // H2 fix: verhindert doppelte parallele Sync-Aufrufe

async function syncDirtyToDrive() {
  if (_syncInProgress) return;
  if (!state.isDriveDirty()) return;
  // Sync-Gate-Guard (§7.3.1). Blockiert Sync-OUT, solange der Gate nicht
  // ALLOWED ist — verhindert, dass ein noch nicht aus Drive geladener
  // Fresh-Install-State auf Drive geschrieben wird und existierende Backups
  // überschreibt. Der dirty-Flag bleibt gesetzt und wird beim nächsten
  // Trigger erneut versucht, sobald der Gate ALLOWED ist.
  if (drive.getSyncGate() !== drive.SyncGate.ALLOWED) {
    console.info('[app] syncDirtyToDrive: gate is', drive.getSyncGate(), '— skipping');
    return;
  }
  _syncInProgress = true;
  try {
    await db.flushPendingWrites();
    await drive.backupNow(state.getAppData());
    state.clearDriveDirty();
  } catch (err) {
    _lastDriveError = err;
    // Fehler werden beim nächsten visibilitychange automatisch erneut versucht
    // (dirty-Flag bleibt gesetzt).
  } finally {
    _syncInProgress = false;
  }
}

async function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    await syncDirtyToDrive();
  }
}

// ============ PATIENT ACTIONS ============
function openPatientModal(editId) {
  const data = state.getAppData();
  document.getElementById('patient-edit-id').value = editId || '';
  document.getElementById('modal-patient-title').textContent = editId ? 'Patient bearbeiten' : 'Neuer Patient';
  document.getElementById('patient-error').style.display = 'none';

  if (!editId) {
    document.getElementById('patient-name').value = '';
    document.getElementById('patient-kuerzel').value = '';
    document.getElementById('patient-start').value = '';
    // Bewilligt-Defaults
    const bew = createDefaultBewilligt();
    document.getElementById('patient-bew-kzt2').checked = bew.kzt2;
    document.getElementById('patient-bew-lzt').checked = bew.lzt;
    document.getElementById('patient-bew-lzt-max').value = bew.lztMax;
    document.getElementById('patient-bew-lztv').checked = bew.lztV;
    document.getElementById('patient-bew-lztv-max').value = bew.lztVMax;
  } else {
    const p = data.patients.find(pt => pt.id === editId);
    if (p) {
      document.getElementById('patient-name').value = p.name;
      document.getElementById('patient-kuerzel').value = p.kuerzel || '';
      document.getElementById('patient-start').value = p.startDate || '';
      // Bewilligt aus Patient-Daten laden
      const bew = p.bewilligt || createDefaultBewilligt();
      document.getElementById('patient-bew-kzt2').checked = bew.kzt2;
      document.getElementById('patient-bew-lzt').checked = bew.lzt;
      document.getElementById('patient-bew-lzt-max').value = bew.lztMax || 60;
      document.getElementById('patient-bew-lztv').checked = bew.lztV;
      document.getElementById('patient-bew-lztv-max').value = bew.lztVMax || 80;
    }
  }
  openModal('modal-patient');
}

function savePatientClick() {
  try {
    const name = document.getElementById('patient-name').value.trim();
    if (!name) {
      const err = document.getElementById('patient-error');
      err.textContent = 'Bitte einen Namen eingeben.';
      err.style.display = 'block';
      return;
    }
    document.getElementById('patient-error').style.display = 'none';

    const editId = document.getElementById('patient-edit-id').value;
    const lztMax = parseInt(document.getElementById('patient-bew-lzt-max').value, 10);
    const lztVMax = parseInt(document.getElementById('patient-bew-lztv-max').value, 10);

    const bewilligt = {
      kzt1: true,
      kzt2: document.getElementById('patient-bew-kzt2').checked,
      lzt: document.getElementById('patient-bew-lzt').checked,
      lztMax: Number.isFinite(lztMax) && lztMax > 0 ? lztMax : 60,
      lztV: document.getElementById('patient-bew-lztv').checked,
      lztVMax: Number.isFinite(lztVMax) && lztVMax > 0 ? lztVMax : 80,
    };

    // Gesamtkontingent für Abwärtskompatibilität berechnen
    let kontingent = 12; // KZT1
    if (bewilligt.kzt2) kontingent = 24;
    if (bewilligt.lzt) kontingent = bewilligt.lztMax;
    if (bewilligt.lztV) kontingent = bewilligt.lztVMax;

    const patientData = {
      name,
      kuerzel: document.getElementById('patient-kuerzel').value.trim(),
      kontingent,
      bewilligt,
      startDate: document.getElementById('patient-start').value || '',
    };

    state.updateAppData(data => {
      if (editId) {
        const idx = data.patients.findIndex(p => p.id === editId);
        if (idx >= 0) data.patients[idx] = { ...data.patients[idx], ...patientData };
      } else {
        data.patients.push({ id: generateId(), ...patientData });
      }
    });
    closeModal('modal-patient');
    showToast('Patient gespeichert!', 'success');
  } catch (err) {
    const el = document.getElementById('patient-error');
    el.textContent = 'Fehler: ' + (err?.message || err);
    el.style.display = 'block';
  }
}

function deletePatient(id) {
  showConfirmDialog('Patient und alle zugehörigen Sitzungen wirklich löschen?', () => {
    state.updateAppData(data => {
      data.patients = data.patients.filter(p => p.id !== id);
      data.sessions = data.sessions.filter(s => s.patientId !== id);
      data.supervisions.forEach(s => {
        if (s.patientIds) s.patientIds = s.patientIds.filter(pid => pid !== id);
      });
      data.supervisionGroups.forEach(g => {
        if (g.patientIds) g.patientIds = g.patientIds.filter(pid => pid !== id);
      });
    });
    showPatientListView();
  });
}

// ============ SESSION ACTIONS ============
function openSessionModal(patientId) {
  const data = state.getAppData();
  const select = document.getElementById('session-patient-select');
  select.innerHTML = data.patients.map(p =>
    `<option value="${p.id}">${escapeHtml(p.name)}</option>`
  ).join('');

  // Default: currently opened patient detail, else explicit arg, else first.
  const defaultId = patientId || _sessionDefaultPatientId || getCurrentDetailPatientId() || (data.patients[0] && data.patients[0].id);
  if (defaultId) select.value = defaultId;

  document.getElementById('session-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('session-type').value = 'einzel';
  document.getElementById('session-duration').value = 50;
  document.getElementById('session-note').value = '';

  // Phase-Info aktualisieren bei Auswahländerungen
  updateSessionPhaseInfo();
  openModal('modal-session');
}

/**
 * Aktualisiert die Phase-Info-Anzeige im Session-Modal basierend auf
 * dem aktuell ausgewählten Patienten und Sitzungstyp.
 * Setzt auch die Dauer-Defaults passend zum Sitzungstyp.
 */
function updateSessionPhaseInfo() {
  const infoEl = document.getElementById('session-phase-info');
  if (!infoEl) return;

  const patientId = document.getElementById('session-patient-select').value;
  const sessionType = document.getElementById('session-type').value;
  const durationEl = document.getElementById('session-duration');
  const data = state.getAppData();

  // Dauer-Default je nach Typ
  if (sessionType === 'probatorik') durationEl.value = 50;
  else if (sessionType === 'doppel') durationEl.value = 100;
  else if (sessionType === 'einzel' && parseInt(durationEl.value, 10) === 100) durationEl.value = 50;

  if (!patientId) {
    infoEl.style.display = 'none';
    return;
  }

  if (sessionType === 'probatorik') {
    // Prüfen ob Probatorik noch möglich ist
    const nonProba = data.sessions.filter(s => s.patientId === patientId && s.phase !== 'probatorik').length;
    const probaCount = data.sessions.filter(s => s.patientId === patientId && s.phase === 'probatorik').length;

    if (nonProba > 0) {
      infoEl.style.display = 'block';
      infoEl.style.background = 'var(--danger-light, #fde8e8)';
      infoEl.style.color = 'var(--danger)';
      infoEl.textContent = 'Probatorik nicht mehr möglich — es existieren bereits Kontingent-Sitzungen für diesen Patienten.';
      return;
    }
    if (probaCount >= 8) {
      infoEl.style.display = 'block';
      infoEl.style.background = 'var(--danger-light, #fde8e8)';
      infoEl.style.color = 'var(--danger)';
      infoEl.textContent = `Probatorik-Maximum erreicht (${probaCount} von 8).`;
      return;
    }
    infoEl.style.display = 'block';
    infoEl.style.background = 'var(--gray-100)';
    infoEl.style.color = 'var(--gray-700)';
    infoEl.textContent = `→ Probatorik, Sitzung ${probaCount + 1} von 8`;
    return;
  }

  // Einzeltherapie / Doppelsitzung → Phase automatisch berechnen
  const result = computeSessionPhase(patientId, data);
  infoEl.style.display = 'block';

  if (result.error) {
    infoEl.style.background = 'var(--danger-light, #fde8e8)';
    infoEl.style.color = 'var(--danger)';
    infoEl.textContent = result.error;
  } else {
    infoEl.style.background = 'var(--gray-100)';
    infoEl.style.color = 'var(--gray-700)';
    infoEl.textContent = `→ ${result.label}, Sitzung ${result.number} von ${result.max}`;
  }
}

function saveSessionClick() {
  try {
    const patientId = document.getElementById('session-patient-select').value;
    if (!patientId) { showToast('Bitte zuerst einen Patienten anlegen.', 'warning'); return; }

    const data = state.getAppData();
    const sessionType = document.getElementById('session-type').value;

    // Phase automatisch bestimmen
    let phase;
    if (sessionType === 'probatorik') {
      // Probatorik-Sperre: keine Probatorik wenn bereits Kontingent-Sitzungen existieren
      const nonProba = data.sessions.filter(s => s.patientId === patientId && s.phase !== 'probatorik').length;
      if (nonProba > 0) {
        showToast('Probatorik nicht mehr möglich — es existieren bereits Kontingent-Sitzungen.', 'warning');
        return;
      }
      const probaCount = data.sessions.filter(s => s.patientId === patientId && s.phase === 'probatorik').length;
      if (probaCount >= 8) {
        showToast('Probatorik-Maximum erreicht (8 Sitzungen).', 'warning');
        return;
      }
      phase = 'probatorik';
    } else {
      const result = computeSessionPhase(patientId, data);
      if (result.error) {
        // Warnung anzeigen aber Speichern trotzdem erlauben (Nachbewilligung)
        showToast(result.error, 'warning');
        return;
      }
      phase = result.phase;
    }

    // Rohwerte aus dem Formular lesen. Absichtlich KEIN `|| 50`-Fallback mehr
    // auf duration: negative/ungültige Werte würden sonst in den kanonischen
    // State fließen (Codex-Review: "UI save paths persist invalid negative
    // durations into canonical state").
    const newSession = {
      id: generateId(),
      patientId,
      date: document.getElementById('session-date').value,
      type: sessionType,
      phase,
      duration: parseInt(document.getElementById('session-duration').value, 10),
      note: document.getElementById('session-note').value.trim(),
    };

    const check = validateSessionRecord(newSession);
    if (!check.ok) {
      showToast('Ungültige Sitzung: ' + check.error, 'warning');
      return;
    }

    state.updateAppData(data => { data.sessions.push(newSession); });
    closeModal('modal-session');
    showToast('Sitzung gespeichert!', 'success');
  } catch (err) {
    showToast('Fehler: ' + (err?.message || err), 'danger');
  }
}

function deleteSession(sessionId, patientId) {
  showConfirmDialog('Sitzung löschen?', () => {
    state.updateAppData(data => {
      data.sessions = data.sessions.filter(s => s.id !== sessionId);
    });
    if (patientId) showPatientDetail(patientId);
  });
}

// ============ SUPERVISION ACTIONS ============
function openSupervisionModal(patientId) {
  const data = state.getAppData();
  const groupSelect = document.getElementById('supervision-group-select');
  const groups = data.supervisionGroups || [];
  groupSelect.innerHTML = '<option value="">— Manuell auswählen —</option>' +
    groups.map(g => {
      const count = (g.patientIds || []).length;
      return `<option value="${g.id}">${escapeHtml(g.name)} (${count} Pat.)</option>`;
    }).join('');
  document.getElementById('supervision-group-selector-container').style.display = groups.length > 0 ? 'block' : 'none';

  const container = document.getElementById('supervision-patient-checkboxes');
  container.innerHTML = data.patients.map(p =>
    `<label style="display:flex;align-items:center;gap:10px;padding:8px 6px;font-size:0.95rem;cursor:pointer;border-bottom:1px solid #f0f0f0;">
      <input type="checkbox" value="${p.id}" style="width:22px;height:22px;min-width:22px;cursor:pointer;accent-color:#2563eb;">
      <span>${escapeHtml(p.name)}</span>
    </label>`
  ).join('');

  document.getElementById('supervision-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('supervision-type').value = 'gruppe';
  document.getElementById('supervision-duration').value = 50;
  document.getElementById('supervision-supervisor').value = '';
  document.getElementById('supervision-note').value = '';

  if (patientId) {
    // Auto-Gruppenerkennung (§5.4)
    const matchingGroup = groups.find(g => g.patientIds && g.patientIds.includes(patientId));
    if (matchingGroup) {
      groupSelect.value = matchingGroup.id;
      onSupervisionGroupChange();
    } else {
      const cbs = document.querySelectorAll('#supervision-patient-checkboxes input[type=checkbox]');
      cbs.forEach(cb => { if (cb.value === patientId) cb.checked = true; });
    }
  }

  openModal('modal-supervision');
}

function onSupervisionGroupChange() {
  const data = state.getAppData();
  const groupId = document.getElementById('supervision-group-select').value;
  const checkboxes = document.querySelectorAll('#supervision-patient-checkboxes input[type=checkbox]');
  if (!groupId) {
    checkboxes.forEach(cb => { cb.checked = false; });
    document.getElementById('supervision-supervisor').value = '';
    return;
  }
  const group = data.supervisionGroups.find(g => g.id === groupId);
  if (!group) return;
  checkboxes.forEach(cb => {
    cb.checked = !!(group.patientIds && group.patientIds.includes(cb.value));
  });
  if (group.supervisor) {
    document.getElementById('supervision-supervisor').value = group.supervisor;
  }
}

function saveSupervisionClick() {
  try {
    const checkboxes = document.querySelectorAll('#supervision-patient-checkboxes input:checked');
    const patientIds = Array.from(checkboxes).map(cb => cb.value);
    if (patientIds.length === 0) {
      showToast('Bitte mindestens einen Patienten auswählen.', 'warning');
      return;
    }

    // Kein `|| 50`-Fallback mehr — ungültige Werte werden vom shared Validator
    // abgefangen (Codex-Review).
    const newSv = {
      id: generateId(),
      patientIds,
      date: document.getElementById('supervision-date').value,
      type: document.getElementById('supervision-type').value,
      duration: parseInt(document.getElementById('supervision-duration').value, 10),
      supervisor: document.getElementById('supervision-supervisor').value.trim(),
      note: document.getElementById('supervision-note').value.trim(),
    };

    const check = validateSupervisionRecord(newSv);
    if (!check.ok) {
      showToast('Ungültige Supervision: ' + check.error, 'warning');
      return;
    }

    state.updateAppData(data => { data.supervisions.push(newSv); });
    closeModal('modal-supervision');
    showToast('Supervision gespeichert!', 'success');
  } catch (err) {
    showToast('Fehler: ' + (err?.message || err), 'danger');
  }
}

function deleteSupervision(svId, patientId) {
  showConfirmDialog('Supervisionsstunde löschen?', () => {
    state.updateAppData(data => {
      data.supervisions = data.supervisions.filter(s => s.id !== svId);
    });
    if (patientId) showPatientDetail(patientId);
  });
}

function deleteSupervisionGlobal(svId) {
  showConfirmDialog('Supervisionsstunde löschen?', () => {
    state.updateAppData(data => {
      data.supervisions = data.supervisions.filter(s => s.id !== svId);
    });
  });
}

// ============ GROUP ACTIONS ============
function openGroupModal(editId) {
  const data = state.getAppData();
  document.getElementById('group-edit-id').value = editId || '';
  document.getElementById('modal-group-title').textContent = editId ? 'Gruppe bearbeiten' : 'Neue Supervisionsgruppe';
  document.getElementById('group-error').style.display = 'none';

  const existing = editId ? (data.supervisionGroups || []).find(g => g.id === editId) : null;
  document.getElementById('group-name').value = existing ? existing.name : '';
  document.getElementById('group-supervisor').value = existing?.supervisor || '';

  const container = document.getElementById('group-patient-checkboxes');
  container.innerHTML = data.patients.map(p => {
    const checked = existing && existing.patientIds && existing.patientIds.includes(p.id) ? ' checked' : '';
    return `<label style="display:flex;align-items:center;gap:10px;padding:8px 6px;font-size:0.95rem;cursor:pointer;border-bottom:1px solid #f0f0f0;">
      <input type="checkbox" value="${p.id}"${checked} style="width:22px;height:22px;min-width:22px;cursor:pointer;accent-color:#2563eb;">
      <span>${escapeHtml(p.name)}</span>
    </label>`;
  }).join('');

  openModal('modal-group');
}

function saveGroupClick() {
  try {
    const name = document.getElementById('group-name').value.trim();
    if (!name) {
      const err = document.getElementById('group-error');
      err.textContent = 'Bitte einen Gruppennamen eingeben.';
      err.style.display = 'block';
      return;
    }
    document.getElementById('group-error').style.display = 'none';
    const checkboxes = document.querySelectorAll('#group-patient-checkboxes input:checked');
    const patientIds = Array.from(checkboxes).map(cb => cb.value);
    if (patientIds.length === 0) {
      const err = document.getElementById('group-error');
      err.textContent = 'Bitte mindestens einen Patienten auswählen.';
      err.style.display = 'block';
      return;
    }
    const editId = document.getElementById('group-edit-id').value;
    const supervisor = document.getElementById('group-supervisor').value.trim();
    state.updateAppData(data => {
      if (editId) {
        const idx = data.supervisionGroups.findIndex(g => g.id === editId);
        if (idx >= 0) data.supervisionGroups[idx] = { ...data.supervisionGroups[idx], name, supervisor, patientIds };
      } else {
        data.supervisionGroups.push({ id: generateId(), name, supervisor, patientIds });
      }
    });
    closeModal('modal-group');
    showToast('Gruppe gespeichert!', 'success');
  } catch (err) {
    const el = document.getElementById('group-error');
    el.textContent = 'Fehler: ' + (err?.message || err);
    el.style.display = 'block';
  }
}

function deleteGroup(groupId) {
  showConfirmDialog('Supervisionsgruppe löschen?', () => {
    state.updateAppData(data => {
      data.supervisionGroups = data.supervisionGroups.filter(g => g.id !== groupId);
    });
    showToast('Gruppe gelöscht.', 'danger');
  });
}

// ============ SETTINGS ============
function updateSettings() {
  // M7 fix: Werte auf gültigen Bereich clampen — HTML min/max ist client-
  // seitig umgehbar (DevTools, Paste, manche Mobile-Browser).
  const ratio = Math.max(1, Math.min(20, parseInt(document.getElementById('setting-ratio').value, 10) || 4));
  const defaultKontingent = Math.max(1, Math.min(999, parseInt(document.getElementById('setting-kontingent').value, 10) || 60));
  state.updateAppData(data => {
    data.settings.supervisionRatio = ratio;
    data.settings.defaultKontingent = defaultKontingent;
  });
}

// ============ FORECAST ============
// Parameter-Inputs auf dem Forecast-Tab sind statisches HTML (siehe
// index.html "FORECAST TAB"). Nach jedem setAppData (init, Drive-Restore,
// Import) werden die Werte aus appData.settings.forecast in die Inputs
// geschrieben — gleiches Pattern wie setting-ratio/setting-kontingent.
// Die change-Handler persistieren zurück via updateAppData.

function populateExamSelect() {
  const sel = document.getElementById('forecast-exam-select');
  if (!sel) return;
  // HTML-Options statisch, einmalig befüllen (beim Init). Option 0 ist die
  // bereits in index.html definierte Placeholder-Option.
  if (sel.options.length > 1) return; // schon befüllt
  for (const a of ABSCHLUSSKONTROLLEN) {
    const opt = document.createElement('option');
    opt.value = a.id;
    // Label: "Herbst 2027 · 15.05.2027"
    const [y, m, d] = a.date.split('-');
    opt.textContent = `${a.label} · ${d}.${m}.${y}`;
    sel.appendChild(opt);
  }
}

function syncForecastInputs() {
  const data = state.getAppData();
  const f = (data.settings && data.settings.forecast) || {};
  populateExamSelect();
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  };
  set('forecast-exam-select',      f.abschlusskontrolleId || '');
  set('forecast-target-hours',      f.targetHours != null ? f.targetHours : 600);
  set('forecast-current-patients',  f.currentPatientCount != null ? f.currentPatientCount : 0);
  set('forecast-sick-wpy',          f.sickWeeksPerYear != null ? f.sickWeeksPerYear : 4);
  set('forecast-vacation-wpy',      f.vacationWeeksPerYear != null ? f.vacationWeeksPerYear : 6);
  set('forecast-dropout-pct',       Math.round(((f.dropoutRate != null ? f.dropoutRate : 0.30)) * 100));
  set('forecast-start-override',    f.startDateOverride || '');
}

function onForecastParamChange(event) {
  // Gemeinsamer change-Handler für alle Forecast-Parameter-Inputs.
  // Liest den konkreten Input anhand seiner ID und validiert vor Persist.
  const id = event.target.id;
  let patch = null;

  const parseInt0 = (el, fallback) => {
    const v = parseInt(el.value, 10);
    return Number.isFinite(v) ? v : fallback;
  };

  if (id === 'forecast-exam-select') {
    const v = event.target.value;
    patch = f => { f.abschlusskontrolleId = v || null; };
  } else if (id === 'forecast-target-hours') {
    const n = parseInt0(event.target, 600);
    if (n <= 0) { showToast('Zielstunden müssen positiv sein.', 'warning'); syncForecastInputs(); return; }
    patch = f => { f.targetHours = n; };
  } else if (id === 'forecast-current-patients') {
    const n = parseInt0(event.target, 0);
    if (n < 0) { showToast('Anzahl darf nicht negativ sein.', 'warning'); syncForecastInputs(); return; }
    patch = f => { f.currentPatientCount = n; };
  } else if (id === 'forecast-sick-wpy') {
    const n = parseInt0(event.target, 4);
    if (n < 0) { showToast('Wochenanzahl darf nicht negativ sein.', 'warning'); syncForecastInputs(); return; }
    patch = f => { f.sickWeeksPerYear = n; };
  } else if (id === 'forecast-vacation-wpy') {
    const n = parseInt0(event.target, 6);
    if (n < 0) { showToast('Wochenanzahl darf nicht negativ sein.', 'warning'); syncForecastInputs(); return; }
    patch = f => { f.vacationWeeksPerYear = n; };
  } else if (id === 'forecast-dropout-pct') {
    const pct = parseInt0(event.target, 30);
    if (pct < 0 || pct >= 100) {
      showToast('Ausfallquote muss zwischen 0 und 99 % liegen.', 'warning');
      syncForecastInputs();
      return;
    }
    patch = f => { f.dropoutRate = pct / 100; };
  } else if (id === 'forecast-start-override') {
    const v = event.target.value;
    if (v && !FORMAT.DATE_PATTERN.test(v)) { showToast('Ungültiges Datumsformat.', 'warning'); return; }
    patch = f => { f.startDateOverride = v || null; };
  }

  if (!patch) return;
  state.updateAppData(data => {
    if (!data.settings.forecast) {
      data.settings.forecast = {
        abschlusskontrolleId: null, targetHours: 600, sickWeeksPerYear: 4,
        vacationWeeksPerYear: 6, dropoutRate: 0.30, currentPatientCount: 0,
        startDateOverride: null,
      };
    }
    patch(data.settings.forecast);
  });
}

// -------- Intake Modal (Forecast-Aufnahmeplan) --------
function openIntakeModal(editId) {
  const data = state.getAppData();
  document.getElementById('intake-edit-id').value = editId || '';
  document.getElementById('modal-intake-title').textContent = editId ? 'Aufnahme bearbeiten' : 'Neue Aufnahme';
  document.getElementById('intake-error').style.display = 'none';

  if (editId) {
    const existing = (data.forecastIntakes || []).find(it => it.id === editId);
    if (existing) {
      document.getElementById('intake-date').value = existing.date;
      document.getElementById('intake-add-count').value = existing.addCount;
      document.getElementById('intake-note').value = existing.note || '';
    }
  } else {
    // Default: heute + 4 Wochen, 1 Patient, leere Notiz
    const d = new Date();
    d.setDate(d.getDate() + 28);
    document.getElementById('intake-date').value = d.toISOString().split('T')[0];
    document.getElementById('intake-add-count').value = '1';
    document.getElementById('intake-note').value = '';
  }
  openModal('modal-intake');
}

function saveIntakeClick() {
  try {
    const editId = document.getElementById('intake-edit-id').value;
    const date = document.getElementById('intake-date').value;
    const addCount = parseInt(document.getElementById('intake-add-count').value, 10);
    const note = document.getElementById('intake-note').value.trim();

    const record = {
      id: editId || generateId(),
      date,
      addCount,
      note,
    };
    const check = validateForecastIntakeRecord(record);
    if (!check.ok) {
      const err = document.getElementById('intake-error');
      err.textContent = 'Ungültig: ' + check.error;
      err.style.display = 'block';
      return;
    }
    state.updateAppData(data => {
      if (!Array.isArray(data.forecastIntakes)) data.forecastIntakes = [];
      if (editId) {
        const idx = data.forecastIntakes.findIndex(it => it.id === editId);
        if (idx >= 0) data.forecastIntakes[idx] = record;
        else data.forecastIntakes.push(record);
      } else {
        data.forecastIntakes.push(record);
      }
    });
    closeModal('modal-intake');
    showToast('Aufnahme gespeichert.', 'success');
  } catch (err) {
    const el = document.getElementById('intake-error');
    el.textContent = 'Fehler: ' + (err?.message || err);
    el.style.display = 'block';
  }
}

function deleteIntake(id) {
  showConfirmDialog('Aufnahme-Eintrag wirklich löschen?', () => {
    state.updateAppData(data => {
      data.forecastIntakes = (data.forecastIntakes || []).filter(it => it.id !== id);
    });
    showToast('Aufnahme gelöscht.', 'danger');
  });
}

// ============ DATA EXPORT / IMPORT / CLEAR ============
// Setzt den Timestamp des letzten erfolgreichen lokalen Exports.
// Triggert §17.5: der 4-Wochen-Reminder-Banner im Daten-Tab.
function markLocalExportCompleted() {
  state.updateAppData(data => {
    if (!data.settings) data.settings = { supervisionRatio: 4, defaultKontingent: 60 };
    data.settings.lastLocalExportAt = new Date().toISOString();
  });
}

async function exportData() {
  const json = JSON.stringify(state.getAppData(), null, 2);
  const filename = 'patientenstunden-' + new Date().toISOString().split('T')[0] + '.json';

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON-Datei', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      markLocalExportCompleted();
      showToast('Daten gespeichert!', 'success');
      document.getElementById('export-fallback').style.display = 'none';
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }

  let blobPathSucceeded = false;
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    blobPathSucceeded = true;
    showToast('Export gestartet: ' + filename, 'success');
  } catch { /* silent */ }

  if (blobPathSucceeded) {
    markLocalExportCompleted();
  }

  document.getElementById('export-fallback').style.display = 'block';
  document.getElementById('export-textarea').value = json;
}

function copyExportData() {
  const textarea = document.getElementById('export-textarea');
  textarea.select();
  textarea.setSelectionRange(0, 99999);
  const onCopySuccess = () => {
    markLocalExportCompleted();
    showToast('In Zwischenablage kopiert!', 'success');
  };
  try {
    navigator.clipboard.writeText(textarea.value).then(
      onCopySuccess,
      () => {
        try { document.execCommand('copy'); onCopySuccess(); }
        catch { showToast('Bitte manuell kopieren (Strg+C / Cmd+C)', 'warning'); }
      }
    );
  } catch {
    try { document.execCommand('copy'); onCopySuccess(); }
    catch { showToast('Bitte manuell kopieren (Strg+C / Cmd+C)', 'warning'); }
  }
}

function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      const validation = validateAppData(parsed);
      if (!validation.ok) {
        showToast('Ungültige Datei: ' + validation.error, 'danger');
        return;
      }
      const mig = runMigrations(validation.data);
      if (!mig.ok) {
        showToast(mig.error, 'danger');
        return;
      }
      const pendingData = mig.data;
      const pCount = (pendingData.patients || []).length;
      const sCount = (pendingData.sessions || []).length;
      const svCount = (pendingData.supervisions || []).length;

      showConfirmDialog(
        `Import: ${pCount} Patienten, ${sCount} Sitzungen, ${svCount} Supervisionen. Bestehende Daten werden überschrieben. Fortfahren?`,
        async () => {
          // Bestehende DSGVO-Ack bewahren, falls Import sie nicht mitbringt.
          const current = state.getAppData();
          if (!pendingData.settings.dsgvoAcknowledgedAt && current.settings?.dsgvoAcknowledgedAt) {
            pendingData.settings.dsgvoAcknowledgedAt = current.settings.dsgvoAcknowledgedAt;
          }
          try {
            // D2 fix: durable write — Erfolg erst nach IDB-Bestätigung anzeigen.
            await state.setAppData(pendingData, { persist: true, durable: true, flagDirty: true });
          } catch (err) {
            showToast('Import-Speicherung fehlgeschlagen: ' + (err?.message || err), 'danger');
            return;
          }
          // JSON-Import ist eine explizite User-Entscheidung, den lokalen
          // Stand zur neuen Wahrheit zu machen. Gate auf ALLOWED setzen,
          // damit der importierte Stand auf Drive hochgeladen wird (§7.3.1).
          drive.setSyncGate(drive.SyncGate.ALLOWED);
          // Setting-Inputs aktualisieren
          document.getElementById('setting-ratio').value = pendingData.settings.supervisionRatio;
          document.getElementById('setting-kontingent').value = pendingData.settings.defaultKontingent;
          syncForecastInputs();
          showToast('Daten erfolgreich importiert!', 'success');
        }
      );
    } catch (err) {
      showToast('Fehler beim Importieren: ' + (err?.message || err), 'danger');
    } finally {
      // Reset file input so the same file can be picked again
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

function clearAllDataClick() {
  showConfirmDialog('ACHTUNG: Alle Daten werden unwiderruflich gelöscht! Fortfahren?', async () => {
    const prevSettings = state.getAppData().settings;
    const blank = createEmptyAppData();
    blank.settings = { ...blank.settings, dsgvoAcknowledgedAt: prevSettings?.dsgvoAcknowledgedAt };
    try {
      // D2 fix: durable write — Erfolg erst nach IDB-Bestätigung anzeigen.
      await state.setAppData(blank, { persist: true, durable: true, flagDirty: true });
    } catch (err) {
      showToast('Löschen fehlgeschlagen: ' + (err?.message || err), 'danger');
      return;
    }
    // "Alle Daten löschen" ist eine explizite User-Aktion, den leeren Zustand
    // zur neuen Wahrheit zu machen — inklusive Drive. Gate auf ALLOWED setzen,
    // damit der leere Stand auch auf Drive synchronisiert wird (§7.3.1).
    // Ohne diesen Setter würde ein Gate-PENDING-Zustand den Clear lokal wirksam
    // machen, aber Drive unberührt lassen — und ein späterer Drive-Load würde
    // die gelöschten Daten wieder zurückholen.
    drive.setSyncGate(drive.SyncGate.ALLOWED);
    showToast('Alle Daten gelöscht.', 'danger');
  });
}

// ============ DRIVE UI ACTIONS ============
async function driveBackupNowClick() {
  // Sync-Gate-Guard (§7.3.1). Auch der manuelle "Jetzt sichern"-Button muss
  // den Gate respektieren — ein manueller Sync-OUT bei leerem Local würde
  // genau die Überschreibung auslösen, die der Gate verhindern soll.
  const gate = drive.getSyncGate();
  if (gate === drive.SyncGate.PENDING || gate === drive.SyncGate.LOADING) {
    showToast('Drive wird noch geladen — bitte kurz warten.', 'warning');
    return;
  }
  if (gate === drive.SyncGate.FAILED) {
    // H1 fix: Wenn lokal bedeutungsvolle Daten existieren, ist der User-
    // Intent klar: "meine lokalen Daten auf Drive sichern." NICHT den alten
    // Drive-Stand laden (das würde die lokalen Daten überschreiben — genau
    // das Gegenteil von "Jetzt sichern"). Gate direkt auf ALLOWED setzen.
    if (hasMeaningfulData(state.getAppData())) {
      drive.setSyncGate(drive.SyncGate.ALLOWED);
    } else {
      // Lokal leer: Drive-Load versuchen, damit wir nicht einen leeren
      // Stand nach Drive pushen und damit das existierende Backup zerstören.
      try {
        await performFirstDriveLoad();
        if (drive.getSyncGate() !== drive.SyncGate.ALLOWED) {
          return;
        }
      } catch {
        return;
      }
    }
  }
  try {
    await db.flushPendingWrites();
    await drive.backupNow(state.getAppData());
    state.clearDriveDirty();
    showToast('Drive-Backup erfolgreich.', 'success');
  } catch (err) {
    _lastDriveError = err;
    showToast('Drive-Backup fehlgeschlagen: ' + (err?.message || err), 'danger');
  }
}

async function driveRestoreClick() {
  showConfirmDialog('Lokale Daten mit Drive-Backup überschreiben? Bestehende Daten gehen verloren.', async () => {
    try {
      const remote = await drive.restore();
      if (!remote) { showToast('Kein Backup im Drive gefunden.', 'warning'); return; }
      const validation = validateAppData(remote);
      if (!validation.ok) { showToast('Drive-Backup ungültig: ' + validation.error, 'danger'); return; }
      const mig = runMigrations(validation.data);
      if (!mig.ok) { showToast(mig.error, 'danger'); return; }
      // DSGVO-Ack bewahren, falls Drive-Backup sie nicht enthält (Legacy).
      // Gleiches Pattern wie performFirstDriveLoad und handleImportFile.
      const currentAck = state.getAppData().settings?.dsgvoAcknowledgedAt;
      if (!mig.data.settings.dsgvoAcknowledgedAt && currentAck) {
        mig.data.settings.dsgvoAcknowledgedAt = currentAck;
      }
      // D2 fix: durable write — IDB-Bestätigung abwarten vor Erfolgs-Toast.
      await state.setAppData(mig.data, { persist: true, durable: true, flagDirty: false });
      state.clearDriveDirty();
      document.getElementById('setting-ratio').value = mig.data.settings.supervisionRatio;
      document.getElementById('setting-kontingent').value = mig.data.settings.defaultKontingent;
      syncForecastInputs();
      // Explizite User-Aktion "Aus Drive wiederherstellen" ist der klarste
      // mögliche Beweis, dass lokal == Drive ist. Gate auf ALLOWED setzen,
      // falls er vorher nicht schon dort war (§7.3.1).
      drive.setSyncGate(drive.SyncGate.ALLOWED);
      showToast('Aus Drive wiederhergestellt.', 'success');
    } catch (err) {
      _lastDriveError = err;
      showToast('Drive-Restore fehlgeschlagen: ' + (err?.message || err), 'danger');
    }
  });
}

async function driveSignInClick() {
  try {
    await drive.ensureToken({ silent: false });
    showToast('Drive-Anmeldung erfolgreich.', 'success');
  } catch (err) {
    _lastDriveError = err;
    showToast('Drive-Anmeldung fehlgeschlagen: ' + (err?.message || err), 'danger');
  }
}

// ============ DIAGNOSE PANEL ============
let _headerTapCount = 0;
let _headerTapResetTimer = null;

function onHeaderTap() {
  _headerTapCount++;
  if (_headerTapResetTimer) clearTimeout(_headerTapResetTimer);
  _headerTapResetTimer = setTimeout(() => { _headerTapCount = 0; }, 1500);
  if (_headerTapCount >= 5) {
    _headerTapCount = 0;
    openDiagnose();
  }
}

function openDiagnose() {
  const data = state.getAppData();
  const sizeBytes = JSON.stringify(data).length;
  const drv = drive.getDriveStatus();
  const renderErrors = getLastRenderErrors();
  const info = {
    schemaVersion: data.version,
    currentCodeVersion: CURRENT_VERSION,
    swCacheVersion: 'siehe sw.js',
    idbSizeBytes: sizeBytes,
    lastRenderDurationMs: Math.round(getLastRenderDurationMs() * 100) / 100,
    drive: {
      status: drv.status,
      detail: drv.detail,
      lastSyncAt: drv.lastSyncAt,
      lastError: drv.lastError,
    },
    lastWriteError: db.getLastWriteError()?.message || null,
    lastDriveError: _lastDriveError ? String(_lastDriveError?.message || _lastDriveError) : null,
    renderErrorsByTab: renderErrors,
    counts: {
      patients: data.patients.length,
      sessions: data.sessions.length,
      supervisions: data.supervisions.length,
      supervisionGroups: data.supervisionGroups.length,
    },
  };
  const panel = document.getElementById('diagnose-panel');
  const content = document.getElementById('diagnose-content');
  content.innerHTML = `<pre>${escapeHtml(JSON.stringify(info, null, 2))}</pre>`;
  panel.classList.add('active');
  panel.dataset.json = JSON.stringify(info);
}

function closeDiagnose() {
  document.getElementById('diagnose-panel').classList.remove('active');
}

function copyDiagnose() {
  const json = document.getElementById('diagnose-panel').dataset.json || '';
  try {
    navigator.clipboard.writeText(json).then(
      () => showToast('Diagnose kopiert.', 'success'),
      () => showToast('Bitte manuell kopieren.', 'warning')
    );
  } catch {
    showToast('Bitte manuell kopieren.', 'warning');
  }
}

// ============ EVENT WIRING ============
function wireEventHandlers() {
  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  // FAB
  document.getElementById('fab-btn').addEventListener('click', () => openModal('modal-add-choice'));

  // Header 5-fach-Tap
  document.getElementById('app-header').addEventListener('click', onHeaderTap);

  // Modal backdrop + close buttons (data-close="modal-id")
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      // DSGVO Modal ist nicht-dismissable via backdrop.
      if (overlay.id === 'modal-dsgvo' || overlay.id === 'modal-version-conflict') return;
      if (e.target === overlay) closeModal(overlay.id);
    });
  });
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Settings inputs
  document.getElementById('setting-ratio').addEventListener('change', updateSettings);
  document.getElementById('setting-kontingent').addEventListener('change', updateSettings);

  // Forecast parameter inputs — gemeinsamer change-Handler.
  for (const id of [
    'forecast-exam-select',
    'forecast-target-hours',
    'forecast-current-patients',
    'forecast-sick-wpy',
    'forecast-vacation-wpy',
    'forecast-dropout-pct',
    'forecast-start-override',
  ]) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', onForecastParamChange);
  }

  // Session modal: phase-info live updates
  document.getElementById('session-type').addEventListener('change', updateSessionPhaseInfo);
  document.getElementById('session-patient-select').addEventListener('change', updateSessionPhaseInfo);

  // Import file input
  document.getElementById('import-file').addEventListener('change', handleImportFile);

  // Supervision group selector (change handler)
  document.getElementById('supervision-group-select').addEventListener('change', onSupervisionGroupChange);

  // Delegated click handler for all data-action elements
  document.body.addEventListener('click', handleDataActionClick);
}

function handleDataActionClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  const patientIdAttr = target.dataset.patientId;

  switch (action) {
    // Modal openers
    case 'open-patient-modal':
      closeModal('modal-add-choice');
      openPatientModal();
      break;
    case 'open-session-modal':
      closeModal('modal-add-choice');
      openSessionModal();
      break;
    case 'open-supervision-modal':
      closeModal('modal-add-choice');
      openSupervisionModal();
      break;
    case 'open-group-modal':
      openGroupModal();
      break;
    case 'open-intake-modal':
      openIntakeModal();
      break;
    case 'open-intake-modal-from-fab':
      closeModal('modal-add-choice');
      showTab('forecast');
      openIntakeModal();
      break;

    // From patient detail
    case 'open-session-modal-for':
      openSessionModal(id);
      break;
    case 'open-supervision-modal-for':
      openSupervisionModal(id);
      break;

    // Save actions
    case 'save-patient':
      savePatientClick();
      break;
    case 'save-session':
      saveSessionClick();
      break;
    case 'save-supervision':
      saveSupervisionClick();
      break;
    case 'save-group':
      saveGroupClick();
      break;
    case 'save-intake':
      saveIntakeClick();
      break;

    // Edit/delete
    case 'edit-patient':
      openPatientModal(id);
      break;
    case 'delete-patient':
      deletePatient(id);
      break;
    case 'delete-session':
      deleteSession(id, patientIdAttr);
      break;
    case 'delete-supervision':
      deleteSupervision(id, patientIdAttr);
      break;
    case 'delete-supervision-global':
      deleteSupervisionGlobal(id);
      break;
    case 'edit-group':
      openGroupModal(id);
      break;
    case 'delete-group':
      deleteGroup(id);
      break;
    case 'edit-intake':
      openIntakeModal(id);
      break;
    case 'delete-intake':
      deleteIntake(id);
      break;

    // Patient list navigation
    case 'show-patient-list':
      showPatientListView();
      break;
    case 'show-patient-detail':
      showPatientDetail(id);
      break;
    case 'dashboard-open-patient':
      showTab('patients');
      showPatientDetail(id);
      break;

    // Data tab
    case 'export-data':
      exportData();
      break;
    case 'copy-export-data':
      copyExportData();
      break;
    case 'clear-all-data':
      clearAllDataClick();
      break;
    case 'drive-backup-now':
      driveBackupNowClick();
      break;
    case 'drive-restore':
      driveRestoreClick();
      break;
    case 'drive-sign-in':
      driveSignInClick();
      break;

    // DSGVO
    case 'dsgvo-accept':
      acceptDsgvo();
      break;
    case 'dsgvo-leave':
      leaveDsgvo();
      break;

    // Version conflict
    case 'force-reload':
      window.location.reload();
      break;

    // Diagnose
    case 'close-diagnose':
      closeDiagnose();
      break;
    case 'copy-diagnose':
      copyDiagnose();
      break;
  }
}

// ============ BOOT ============
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Expose test hooks ONLY on localhost so E2E can assert init complete,
// trigger flushes and simulate visibilitychange. On production (GitHub Pages)
// these globals do not exist, eliminating the data-exfiltration surface
// described in H2 of the security review.
// Test hooks: only on localhost, and the ready flag is set at the end of
// initApp() (not at module-load time) so tests can reliably wait for init.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window.__nempstiFlush = () => db.flushPendingWrites();
  window.__nempstiSyncToDrive = () => syncDirtyToDrive();
  window.__nempstiGetAppData = () => state.getAppData();
}
