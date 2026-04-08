// state.js
// Singleton-Store für appData + Mutations-Einstiegspunkt updateAppData.
// §4.3 / §15.2.
//
// Kontrakt: state.js besitzt `appData`. Kein anderes Modul hält eine direkte
// Referenz. Mutationen ausschließlich via `updateAppData(patchFn)`.

import { createEmptyAppData } from './validation.js';
import * as db from './db.js';

let _appData = createEmptyAppData();
let _driveDirty = false;

// Render- und Drive-Hooks werden von app.js zur Laufzeit gesetzt, um
// zirkuläre Imports zu vermeiden und Dependency-Injection zu ermöglichen.
let _renderAll = null;
let _onDriveDirty = null;

export function configureState({ renderAll, onDriveDirty }) {
  if (typeof renderAll === 'function') _renderAll = renderAll;
  if (typeof onDriveDirty === 'function') _onDriveDirty = onDriveDirty;
}

/**
 * Liefert die aktuelle appData-Referenz.
 * Laut §4.3 soll ein `getAppData()` eine "eingefrorene Kopie für Rendering"
 * liefern — wir geben die Live-Referenz zurück, weil structuredClone pro
 * Render-Call zu teuer wäre. Der Kontrakt: Leser dürfen NICHT mutieren.
 * Verletzungen werden durch den Mutations-Kontrakt in §15.2 verhindert.
 */
export function getAppData() {
  return _appData;
}

/**
 * Ersetzt den In-Memory-State atomic. Wird ausschließlich beim initialen Laden
 * (IDB/Drive/Import) verwendet, nach §7.3 Restore-Atomicity-Kontrakt.
 *
 * @param {object} data — bereits validiertes + migriertes appData
 * @param {object} opts
 * @param {boolean} [opts.persist=true] — ob IDB-Write angestoßen wird
 * @param {boolean} [opts.rerender=true] — ob renderAll() aufgerufen wird
 * @param {boolean} [opts.flagDirty=true] — ob Drive-Dirty-Flag gesetzt wird
 */
export function setAppData(data, opts = {}) {
  const { persist = true, rerender = true, flagDirty = true } = opts;
  _appData = data;
  if (rerender && _renderAll) {
    try { _renderAll(); } catch (err) { console.error('[state] renderAll after setAppData failed:', err); }
  }
  if (persist) {
    try { db.scheduleWrite(_appData); } catch (err) { console.error('[state] scheduleWrite failed:', err); }
  }
  if (flagDirty) {
    markDriveDirty();
  }
}

/**
 * Einziger Mutations-Einstiegspunkt. Nach §15.2:
 *   1. patchFn(appData) — in-place mutation
 *   2. renderAll() — re-render UI
 *   3. db.scheduleWrite(appData) — debounced 300ms IDB persist
 *   4. markDriveDirty() — flag for next Drive flush
 *
 * Bei Exception im patchFn wird der Fehler an den Aufrufer propagiert; der
 * Aufrufer (üblicherweise ein Event-Handler) zeigt einen Toast.
 */
export function updateAppData(patchFn) {
  patchFn(_appData);
  if (_renderAll) {
    try { _renderAll(); } catch (err) { console.error('[state] renderAll failed:', err); }
  }
  try { db.scheduleWrite(_appData); } catch (err) { console.error('[state] scheduleWrite failed:', err); }
  markDriveDirty();
}

export function markDriveDirty() {
  _driveDirty = true;
  if (_onDriveDirty) {
    try { _onDriveDirty(); } catch (err) { console.error('[state] onDriveDirty failed:', err); }
  }
}

export function isDriveDirty() {
  return _driveDirty;
}

export function clearDriveDirty() {
  _driveDirty = false;
}
