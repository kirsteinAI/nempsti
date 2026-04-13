// db.js
// IndexedDB-Wrapper mit der rohen Browser-API (keine Deps). §4.4 Schicht 1.
//
// Kontrakt:
// - Ein Object Store `appState`, Key `'appData'`, Value = das gesamte appData-Objekt
// - `loadAppData()` liefert null bei leerer DB (Erstinstallation oder Browser-Daten gelöscht)
// - `saveAppData()` schreibt synchron-wirkend (promise)
// - `scheduleWrite()` debounced auf 300 ms nach jeder Mutation
// - `durableWrite()` cancelt pending writes und schreibt serialisiert
// - `clearAll()` löscht den Record
//
// ARCHITEKTUR-INVARIANTE (gelernt aus Codex-Reviews v1–v4):
// Alle IDB-Writes laufen durch EINE serialisierte Queue (`_writeQueue`).
// Es gibt keine parallelen saveAppData()-Aufrufe. Jeder Write wartet, bis
// der vorherige abgeschlossen ist. Das eliminiert die gesamte Klasse von
// Race Conditions zwischen debounced writes, retries, flushes und durable
// writes, die zuvor einzeln gepatcht werden mussten.

export const DB_NAME = 'nempsti';
export const DB_VERSION = 1;
export const STORE_NAME = 'appState';
export const KEY = 'appData';

const DEBOUNCE_MS = 300;

let _debounceTimer = null;
let _pendingData = null;
let _lastWriteError = null;
let _writeGeneration = 0;
// Serialisierte Write-Queue: jeder Write wird an diese Promise-Kette
// angehängt. Kein Write startet, bevor der vorherige abgeschlossen ist.
let _writeQueue = Promise.resolve();

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB ist im aktuellen Umgebung nicht verfügbar'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IDB open failed'));
    req.onblocked = () => reject(new Error('IDB open blocked — App ist in einem anderen Tab offen'));
  });
}

export async function loadAppData() {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(KEY);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveAppData(data) {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(data, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IDB transaction aborted'));
    });
    _lastWriteError = null;
  } finally {
    db.close();
  }
}

/**
 * Hängt einen Write an die serialisierte Queue an. Gibt ein Promise zurück,
 * das resolved wenn DIESER Write (nicht ein späterer) abgeschlossen ist.
 * Wenn `generation` angegeben ist, wird der Write übersprungen, falls die
 * aktuelle Generation nicht mehr übereinstimmt (= ein neuerer Write hat ihn
 * invalidiert).
 */
function enqueueWrite(data, { generation } = {}) {
  const op = _writeQueue.then(async () => {
    if (generation !== undefined && generation !== _writeGeneration) {
      // Dieser Write wurde von einem neueren invalidiert — überspringen.
      return;
    }
    await saveAppData(data);
  }).catch(err => {
    _lastWriteError = err;
    throw err;
  });
  // Nächster Write in der Queue wartet auf diesen, auch bei Fehler.
  _writeQueue = op.catch(() => {});
  return op;
}

/**
 * Atomarer direkter Write für destruktive Flows (Import, Restore, Clear).
 * 1. Cancelt alle pending debounced Writes
 * 2. Bumpt die Generation (invalidiert Retries)
 * 3. Wartet, bis die Queue leer ist (alle vorherigen Writes abgeschlossen)
 * 4. Schreibt direkt
 *
 * Durch die serialisierte Queue ist garantiert, dass kein anderer Write
 * zwischen Schritt 3 und 4 reinkommt.
 */
export async function durableWrite(data) {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _pendingData = null;
  _writeGeneration++;
  // Kein generation-Check: durable Writes werden nie übersprungen.
  await enqueueWrite(data);
}

/**
 * Debounced-Write: sammelt Mutationen und schreibt 300 ms nach der letzten.
 * Der letzte Aufruf gewinnt; Eingabe wird per Referenz gehalten (Aufrufer
 * sollte `appData` nach dem Call nicht wieder ersetzen, sondern nur mutieren
 * — das ist durch §15.2 `updateAppData`-Kontrakt garantiert).
 */
export function scheduleWrite(data) {
  _pendingData = data;
  _writeGeneration++;
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    const toWrite = _pendingData;
    const generation = _writeGeneration;
    _pendingData = null;
    enqueueWrite(toWrite, { generation }).catch((err) => {
      console.error('[db] scheduled write failed:', err);
      // §7.1: stiller Retry nach 5s (einmalig), generationsgesichert.
      setTimeout(() => {
        enqueueWrite(toWrite, { generation }).catch((err2) => {
          console.error('[db] retry write failed:', err2);
          if (typeof window !== 'undefined' && window.__nempstiOnWriteError) {
            window.__nempstiOnWriteError(err2);
          }
        });
      }, 5000);
    });
  }, DEBOUNCE_MS);
}

/**
 * Erzwingt sofortige Ausführung eines anstehenden scheduleWrite().
 * Nützlich vor Drive-Sync (damit Drive nicht mit stale-Daten überschrieben wird).
 */
export async function flushPendingWrites() {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
    if (_pendingData) {
      const toWrite = _pendingData;
      _pendingData = null;
      _writeGeneration++;
      await enqueueWrite(toWrite);
    }
  }
  // Codex-v6 fix: Auch auf bereits laufende queued Writes warten, nicht nur
  // auf den Debounce-Timer. Wenn der Timer schon gefeuert hat und ein Write
  // in der Queue läuft, muss flushPendingWrites() darauf warten — sonst kann
  // backupNow() Drive aktualisieren, während IDB noch schreibt.
  await _writeQueue;
}

export async function clearAll() {
  const db = await openDB();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function getLastWriteError() {
  return _lastWriteError;
}
