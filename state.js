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
// Codex-v4: Recovery mode suppresses IDB writes from updateAppData() to
// protect the original IDB payload after a migration failure. Cleared by
// a successful durable write (import/restore/clear).
let _recoveryMode = false;

// Render- und Drive-Hooks werden von app.js zur Laufzeit gesetzt, um
// zirkuläre Imports zu vermeiden und Dependency-Injection zu ermöglichen.
let _renderAll = null;
let _onDriveDirty = null;

export function configureState({ renderAll, onDriveDirty }) {
  if (typeof renderAll === 'function') _renderAll = renderAll;
  if (typeof onDriveDirty === 'function') _onDriveDirty = onDriveDirty;
}

export function setRecoveryMode(on) { _recoveryMode = !!on; }
export function isRecoveryMode() { return _recoveryMode; }

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
 * @param {boolean} [opts.durable=false] — ob IDB-Write direkt (nicht debounced) erfolgt
 *   und das zurückgegebene Promise erst nach erfolgreichem Write resolved.
 *   Verwenden für destruktive Flows (Import, Restore, Clear), damit der Aufrufer
 *   erst nach bestätigter Persistierung Erfolg anzeigt (D2 fix).
 * @param {boolean} [opts.rerender=true] — ob renderAll() aufgerufen wird
 * @param {boolean} [opts.flagDirty=true] — ob Drive-Dirty-Flag gesetzt wird
 * @returns {Promise<void>|undefined} Promise wenn durable=true, sonst undefined
 */
export function setAppData(data, opts = {}) {
  const { persist = true, durable = false, rerender = true, flagDirty = true } = opts;

  // Codex-v2 fix: Bei durable Writes wird IDB ZUERST geschrieben. Erst nach
  // erfolgreichem Write werden in-memory State, UI und Drive-Dirty-Flag
  // aktualisiert. Schlägt der Write fehl, bleibt alles beim Alten — kein
  // Split-Brain zwischen UI/Drive und IDB.
  if (durable && persist) {
    return db.durableWrite(data).then(() => {
      _appData = data;
      // Codex-v4: Ein erfolgreicher durable Write beendet den Recovery-Modus.
      // Der User hat sich explizit für diesen State entschieden (Import/Restore/Clear).
      _recoveryMode = false;
      if (rerender && _renderAll) {
        try { _renderAll(); } catch (err) { console.error('[state] renderAll after durable setAppData failed:', err); }
      }
      if (flagDirty) markDriveDirty();
    });
    // Bei Fehler: _appData, UI und dirty-Flag bleiben unverändert.
    // Der Aufrufer fängt den Fehler und zeigt einen Toast.
  }

  // Nicht-durable Pfad (normale Mutationen): sofortiger State-Swap wie bisher.
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
  // Codex-v4: In recovery mode (migration failure), suppress IDB writes so
  // the original payload stays intact for a future code hotfix. The in-memory
  // state still updates (UI works), but nothing is persisted until a durable
  // write (import/restore/clear) explicitly takes over.
  if (!_recoveryMode) {
    try { db.scheduleWrite(_appData); } catch (err) { console.error('[state] scheduleWrite failed:', err); }
  }
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
