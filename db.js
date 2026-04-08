// db.js
// IndexedDB-Wrapper mit der rohen Browser-API (keine Deps). §4.4 Schicht 1.
//
// Kontrakt:
// - Ein Object Store `appState`, Key `'appData'`, Value = das gesamte appData-Objekt
// - `loadAppData()` liefert null bei leerer DB (Erstinstallation oder Browser-Daten gelöscht)
// - `saveAppData()` schreibt synchron-wirkend (promise)
// - `scheduleWrite()` debounced auf 300 ms nach jeder Mutation
// - `clearAll()` löscht den Record

export const DB_NAME = 'nempsti';
export const DB_VERSION = 1;
export const STORE_NAME = 'appState';
export const KEY = 'appData';

const DEBOUNCE_MS = 300;

let _debounceTimer = null;
let _pendingData = null;
let _lastWriteError = null;

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
 * Debounced-Write: sammelt Mutationen und schreibt 300 ms nach der letzten.
 * Der letzte Aufruf gewinnt; Eingabe wird per Referenz gehalten (Aufrufer
 * sollte `appData` nach dem Call nicht wieder ersetzen, sondern nur mutieren
 * — das ist durch §15.2 `updateAppData`-Kontrakt garantiert).
 */
export function scheduleWrite(data) {
  _pendingData = data;
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    const toWrite = _pendingData;
    _pendingData = null;
    saveAppData(toWrite).catch((err) => {
      _lastWriteError = err;
      console.error('[db] scheduled write failed:', err);
      // §7.1: stiller Retry nach 5s (einmalig)
      setTimeout(() => {
        saveAppData(toWrite).catch((err2) => {
          _lastWriteError = err2;
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
      await saveAppData(toWrite);
    }
  }
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
