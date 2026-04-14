// validation.js
// Format-Konstanten, Validierung, HTML-Escaping, ID-Generierung.
// Reines ES-Modul ohne Browser-API-Abhängigkeiten → direkt in Node-Unit-Tests importierbar.

export const FORMAT = Object.freeze({
  ID_PATTERN: /^[a-z0-9]{6,24}$/,
  DATE_PATTERN: /^\d{4}-\d{2}-\d{2}$/,
  MAX_STRING_LENGTH: 500,
  SESSION_TYPES: Object.freeze(['einzel', 'doppel', 'probatorik']),
  SESSION_PHASES: Object.freeze(['probatorik', 'kzt1', 'kzt2', 'lzt', 'lzt_v']),
  SUPERVISION_TYPES: Object.freeze(['einzel', 'gruppe']),
});

/**
 * Base-36-alphanumerische ID. 13–14 Zeichen, sicher für Interpolation
 * in onclick-Handler-Strings (nur [a-z0-9]).
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

/**
 * HTML-Escape für alle nutzergenerierten Strings, die per innerHTML in
 * den DOM eingefügt werden. PFLICHT laut §6.1.
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isString(v, { maxLength = FORMAT.MAX_STRING_LENGTH } = {}) {
  return typeof v === 'string' && v.length <= maxLength;
}

function isNonEmptyString(v, opts) {
  return isString(v, opts) && v.length > 0;
}

function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function isNonNegativeNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function isIdString(v) {
  return typeof v === 'string' && FORMAT.ID_PATTERN.test(v);
}

function isDateString(v) {
  if (typeof v !== 'string' || !FORMAT.DATE_PATTERN.test(v)) return false;
  // Grobe Plausibilität für Bereichsgrenzen.
  const [y, m, d] = v.split('-').map(Number);
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2999)) return false;
  // M4 fix: Exakte Kalenderprüfung via Round-Trip — lehnt unmögliche Tage
  // wie 2026-02-30 oder 2026-04-31 ab. UTC-Anker verhindert DST-Drift.
  try {
    return new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
  } catch {
    return false;
  }
}

function fail(path, reason) {
  return { ok: false, error: `${path}: ${reason}` };
}

/**
 * Validiert eine geladene appData-Struktur (aus IDB, Drive oder JSON-Import).
 *
 * Regeln laut §6.2. Bei Fehler wird der erste Fehler mit Pfad zurückgegeben
 * und der aktuelle In-Memory-State darf NICHT überschrieben werden.
 *
 * @param {unknown} obj
 * @returns {{ok: true, data: object} | {ok: false, error: string}}
 */
export function validateAppData(obj) {
  if (!isPlainObject(obj)) return fail('root', 'not an object');

  // version: optional (fehlt bei Legacy v0) oder positive Ganzzahl
  if (obj.version !== undefined) {
    if (typeof obj.version !== 'number' || !Number.isInteger(obj.version) || obj.version < 0) {
      return fail('version', 'must be a non-negative integer or absent');
    }
  }

  // Strikte v1-Shape: sobald version vorhanden ist (also NICHT Legacy v0),
  // müssen die kanonischen Top-Level-Felder vorhanden sein. Andernfalls würde
  // der Renderer später auf `data.settings.supervisionRatio` zugreifen und
  // crashen (Codex-Review: "Shared validation still accepts v1 payloads that
  // crash the renderer"). Legacy-Payloads ohne `version` bleiben bewusst
  // lenient, weil die Migration §10 die fehlenden Defaults einfüllt.
  const isVersioned = typeof obj.version === 'number';
  if (isVersioned) {
    if (!isPlainObject(obj.settings)) return fail('settings', 'required for versioned payloads');
    if (!isPositiveNumber(obj.settings.supervisionRatio)) {
      return fail('settings.supervisionRatio', 'required positive number for versioned payloads');
    }
    if (!isPositiveNumber(obj.settings.defaultKontingent)) {
      return fail('settings.defaultKontingent', 'required positive number for versioned payloads');
    }
    if (!Array.isArray(obj.patients)) return fail('patients', 'required array for versioned payloads');
    if (!Array.isArray(obj.sessions)) return fail('sessions', 'required array for versioned payloads');
    if (!Array.isArray(obj.supervisions)) return fail('supervisions', 'required array for versioned payloads');
    if (!Array.isArray(obj.supervisionGroups)) return fail('supervisionGroups', 'required array for versioned payloads');
    // forecastIntakes ist erst ab v3 Pflicht — v1/v2-Payloads müssen es nicht haben,
    // damit der "Validator VOR Migration"-Load-Path (app.js) v1/v2-Daten nicht
    // wegen eines Feldes bounced, das die Migration gerade erst einfügen würde.
    if (obj.version >= 3) {
      if (!Array.isArray(obj.forecastIntakes)) return fail('forecastIntakes', 'required array for v3 payloads');
    }
  }

  // settings: optional. Wenn vorhanden, Objekt mit validen Keys.
  if (obj.settings !== undefined) {
    if (!isPlainObject(obj.settings)) return fail('settings', 'not an object');
    const s = obj.settings;
    if (s.supervisionRatio !== undefined && !isPositiveNumber(s.supervisionRatio)) {
      return fail('settings.supervisionRatio', 'must be a positive number');
    }
    if (s.defaultKontingent !== undefined && !isPositiveNumber(s.defaultKontingent)) {
      return fail('settings.defaultKontingent', 'must be a positive number');
    }
    if (s.dsgvoAcknowledgedAt !== undefined && !isString(s.dsgvoAcknowledgedAt)) {
      return fail('settings.dsgvoAcknowledgedAt', 'must be a string');
    }
    if (s.lastLocalExportAt !== undefined && s.lastLocalExportAt !== null && !isString(s.lastLocalExportAt)) {
      return fail('settings.lastLocalExportAt', 'must be an ISO timestamp string or null');
    }
    if (s.forecast !== undefined) {
      if (!isPlainObject(s.forecast)) return fail('settings.forecast', 'not an object');
      const f = s.forecast;
      if (f.abschlusskontrolleId !== undefined && f.abschlusskontrolleId !== null && !isString(f.abschlusskontrolleId)) {
        return fail('settings.forecast.abschlusskontrolleId', 'must be a string or null');
      }
      if (f.targetHours !== undefined && !isPositiveNumber(f.targetHours)) {
        return fail('settings.forecast.targetHours', 'must be a positive number');
      }
      if (f.sickWeeksPerYear !== undefined && !isNonNegativeNumber(f.sickWeeksPerYear)) {
        return fail('settings.forecast.sickWeeksPerYear', 'must be a non-negative number');
      }
      if (f.vacationWeeksPerYear !== undefined && !isNonNegativeNumber(f.vacationWeeksPerYear)) {
        return fail('settings.forecast.vacationWeeksPerYear', 'must be a non-negative number');
      }
      if (f.dropoutRate !== undefined) {
        if (!isNonNegativeNumber(f.dropoutRate) || f.dropoutRate >= 1) {
          return fail('settings.forecast.dropoutRate', 'must be a number in [0, 1)');
        }
      }
      if (f.currentPatientCount !== undefined) {
        if (!isNonNegativeNumber(f.currentPatientCount) || !Number.isInteger(f.currentPatientCount)) {
          return fail('settings.forecast.currentPatientCount', 'must be a non-negative integer');
        }
      }
      if (f.startDateOverride !== undefined && f.startDateOverride !== null && !isDateString(f.startDateOverride)) {
        return fail('settings.forecast.startDateOverride', 'must match YYYY-MM-DD or be null');
      }
    }
  }

  // forecastIntakes
  if (obj.forecastIntakes !== undefined) {
    if (!Array.isArray(obj.forecastIntakes)) return fail('forecastIntakes', 'not an array');
    for (let i = 0; i < obj.forecastIntakes.length; i++) {
      const it = obj.forecastIntakes[i];
      const path = `forecastIntakes[${i}]`;
      if (!isPlainObject(it)) return fail(path, 'not an object');
      if (!isIdString(it.id)) return fail(`${path}.id`, 'invalid id pattern');
      if (!isDateString(it.date)) return fail(`${path}.date`, 'must match YYYY-MM-DD');
      if (typeof it.addCount !== 'number' || !Number.isInteger(it.addCount) || it.addCount <= 0) {
        return fail(`${path}.addCount`, 'must be a positive integer');
      }
      if (it.note !== undefined && it.note !== null && !isString(it.note)) {
        return fail(`${path}.note`, 'must be string ≤500 chars');
      }
    }
  }

  // patients
  if (obj.patients !== undefined) {
    if (!Array.isArray(obj.patients)) return fail('patients', 'not an array');
    for (let i = 0; i < obj.patients.length; i++) {
      const p = obj.patients[i];
      const path = `patients[${i}]`;
      if (!isPlainObject(p)) return fail(path, 'not an object');
      if (!isIdString(p.id)) return fail(`${path}.id`, 'invalid id pattern');
      if (!isNonEmptyString(p.name)) return fail(`${path}.name`, 'must be non-empty string ≤500 chars');
      if (p.kuerzel !== undefined && p.kuerzel !== null && !isString(p.kuerzel)) {
        return fail(`${path}.kuerzel`, 'must be string ≤500 chars');
      }
      // kontingent: positiv laut Plan, aber Legacy-Imports mit 0 vorhanden.
      // Wir erlauben 0 und negative → clampen erst beim Rendern (§Grenzwerte-Test).
      if (p.kontingent !== undefined && (typeof p.kontingent !== 'number' || !Number.isFinite(p.kontingent))) {
        return fail(`${path}.kontingent`, 'must be a finite number');
      }
      if (p.startDate !== undefined && p.startDate !== null && p.startDate !== '' && !isDateString(p.startDate)) {
        return fail(`${path}.startDate`, 'must match YYYY-MM-DD');
      }
      // bewilligt: required for v4+ payloads, optional for v3 (migration adds it)
      if (p.bewilligt !== undefined) {
        if (!isPlainObject(p.bewilligt)) return fail(`${path}.bewilligt`, 'must be an object');
        const b = p.bewilligt;
        if (typeof b.kzt1 !== 'boolean') return fail(`${path}.bewilligt.kzt1`, 'must be a boolean');
        if (typeof b.kzt2 !== 'boolean') return fail(`${path}.bewilligt.kzt2`, 'must be a boolean');
        if (typeof b.lzt !== 'boolean') return fail(`${path}.bewilligt.lzt`, 'must be a boolean');
        if (!isPositiveNumber(b.lztMax) && b.lztMax !== 0) return fail(`${path}.bewilligt.lztMax`, 'must be a non-negative number');
        if (typeof b.lztV !== 'boolean') return fail(`${path}.bewilligt.lztV`, 'must be a boolean');
        if (!isPositiveNumber(b.lztVMax) && b.lztVMax !== 0) return fail(`${path}.bewilligt.lztVMax`, 'must be a non-negative number');
      } else if (isVersioned && obj.version >= 4) {
        return fail(`${path}.bewilligt`, 'required for v4 payloads');
      }
    }
  }

  // sessions
  if (obj.sessions !== undefined) {
    if (!Array.isArray(obj.sessions)) return fail('sessions', 'not an array');
    for (let i = 0; i < obj.sessions.length; i++) {
      const s = obj.sessions[i];
      const path = `sessions[${i}]`;
      if (!isPlainObject(s)) return fail(path, 'not an object');
      if (!isIdString(s.id)) return fail(`${path}.id`, 'invalid id pattern');
      if (!isString(s.patientId)) return fail(`${path}.patientId`, 'must be a string');
      if (!isDateString(s.date)) return fail(`${path}.date`, 'must match YYYY-MM-DD');
      if (!FORMAT.SESSION_TYPES.includes(s.type)) {
        return fail(`${path}.type`, `invalid enum value — expected one of ${FORMAT.SESSION_TYPES.join('|')}`);
      }
      // phase: required for v4+ payloads, optional for v3 (migration adds it)
      if (s.phase !== undefined) {
        if (!FORMAT.SESSION_PHASES.includes(s.phase)) {
          return fail(`${path}.phase`, `invalid enum value — expected one of ${FORMAT.SESSION_PHASES.join('|')}`);
        }
      } else if (isVersioned && obj.version >= 4) {
        return fail(`${path}.phase`, 'required for v4 payloads');
      }
      if (!isPositiveNumber(s.duration)) return fail(`${path}.duration`, 'must be a positive number');
      if (s.note !== undefined && s.note !== null && !isString(s.note)) {
        return fail(`${path}.note`, 'must be string ≤500 chars');
      }
    }
  }

  // supervisions
  if (obj.supervisions !== undefined) {
    if (!Array.isArray(obj.supervisions)) return fail('supervisions', 'not an array');
    for (let i = 0; i < obj.supervisions.length; i++) {
      const s = obj.supervisions[i];
      const path = `supervisions[${i}]`;
      if (!isPlainObject(s)) return fail(path, 'not an object');
      if (!isIdString(s.id)) return fail(`${path}.id`, 'invalid id pattern');
      if (!Array.isArray(s.patientIds)) return fail(`${path}.patientIds`, 'must be an array');
      for (let j = 0; j < s.patientIds.length; j++) {
        if (typeof s.patientIds[j] !== 'string') {
          return fail(`${path}.patientIds[${j}]`, 'must be a string');
        }
      }
      if (!isDateString(s.date)) return fail(`${path}.date`, 'must match YYYY-MM-DD');
      if (!FORMAT.SUPERVISION_TYPES.includes(s.type)) {
        return fail(`${path}.type`, `invalid enum value — expected one of ${FORMAT.SUPERVISION_TYPES.join('|')}`);
      }
      if (!isPositiveNumber(s.duration)) return fail(`${path}.duration`, 'must be a positive number');
      if (s.supervisor !== undefined && s.supervisor !== null && !isString(s.supervisor)) {
        return fail(`${path}.supervisor`, 'must be string ≤500 chars');
      }
      if (s.note !== undefined && s.note !== null && !isString(s.note)) {
        return fail(`${path}.note`, 'must be string ≤500 chars');
      }
    }
  }

  // supervisionGroups
  if (obj.supervisionGroups !== undefined) {
    if (!Array.isArray(obj.supervisionGroups)) return fail('supervisionGroups', 'not an array');
    for (let i = 0; i < obj.supervisionGroups.length; i++) {
      const g = obj.supervisionGroups[i];
      const path = `supervisionGroups[${i}]`;
      if (!isPlainObject(g)) return fail(path, 'not an object');
      if (!isIdString(g.id)) return fail(`${path}.id`, 'invalid id pattern');
      if (!isNonEmptyString(g.name)) return fail(`${path}.name`, 'must be non-empty string ≤500 chars');
      if (g.supervisor !== undefined && g.supervisor !== null && !isString(g.supervisor)) {
        return fail(`${path}.supervisor`, 'must be string ≤500 chars');
      }
      if (!Array.isArray(g.patientIds)) return fail(`${path}.patientIds`, 'must be an array');
      for (let j = 0; j < g.patientIds.length; j++) {
        if (typeof g.patientIds[j] !== 'string') {
          return fail(`${path}.patientIds[${j}]`, 'must be a string');
        }
      }
    }
  }

  // Whitelist: unbekannte Top-Level-Felder werden verworfen.
  const allowed = new Set(['version', 'settings', 'patients', 'sessions', 'supervisions', 'supervisionGroups', 'forecastIntakes']);
  const cleaned = {};
  for (const k of allowed) {
    if (obj[k] !== undefined) cleaned[k] = obj[k];
  }

  return { ok: true, data: cleaned };
}

/**
 * Validiert einen einzelnen Session-Record, BEVOR er via updateAppData in den
 * State geschrieben wird. Damit verhindern wir, dass Form-Eingaben wie
 * `duration=-10` oder ein nicht-ISO-Datum den kanonischen State kontaminieren
 * (Codex-Review: "UI save paths persist invalid negative durations into
 * canonical state").
 *
 * Die Regeln sind eine strikte Untermenge der sessions[]-Regeln aus §6.2.
 *
 * @param {unknown} s
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function validateSessionRecord(s) {
  if (!isPlainObject(s)) return { ok: false, error: 'not an object' };
  if (!isIdString(s.id)) return { ok: false, error: 'id: invalid base-36 pattern' };
  if (!isNonEmptyString(s.patientId)) return { ok: false, error: 'patientId: required' };
  if (!isDateString(s.date)) return { ok: false, error: 'date: must match YYYY-MM-DD' };
  if (!FORMAT.SESSION_TYPES.includes(s.type)) {
    return { ok: false, error: `type: must be one of ${FORMAT.SESSION_TYPES.join('|')}` };
  }
  if (!FORMAT.SESSION_PHASES.includes(s.phase)) {
    return { ok: false, error: `phase: must be one of ${FORMAT.SESSION_PHASES.join('|')}` };
  }
  if (!isPositiveNumber(s.duration)) {
    return { ok: false, error: 'duration: must be a positive number in minutes' };
  }
  if (s.note !== undefined && s.note !== null && !isString(s.note)) {
    return { ok: false, error: 'note: must be a string ≤500 chars' };
  }
  return { ok: true };
}

/**
 * Validiert einen einzelnen Supervisions-Record vor dem Persistieren.
 * Strikte Untermenge der supervisions[]-Regeln aus §6.2.
 */
export function validateSupervisionRecord(s) {
  if (!isPlainObject(s)) return { ok: false, error: 'not an object' };
  if (!isIdString(s.id)) return { ok: false, error: 'id: invalid base-36 pattern' };
  if (!Array.isArray(s.patientIds) || s.patientIds.length === 0) {
    return { ok: false, error: 'patientIds: must be a non-empty array' };
  }
  for (let i = 0; i < s.patientIds.length; i++) {
    if (typeof s.patientIds[i] !== 'string' || s.patientIds[i].length === 0) {
      return { ok: false, error: `patientIds[${i}]: must be a non-empty string` };
    }
  }
  if (!isDateString(s.date)) return { ok: false, error: 'date: must match YYYY-MM-DD' };
  if (!FORMAT.SUPERVISION_TYPES.includes(s.type)) {
    return { ok: false, error: `type: must be one of ${FORMAT.SUPERVISION_TYPES.join('|')}` };
  }
  if (!isPositiveNumber(s.duration)) {
    return { ok: false, error: 'duration: must be a positive number in minutes' };
  }
  if (s.supervisor !== undefined && s.supervisor !== null && !isString(s.supervisor)) {
    return { ok: false, error: 'supervisor: must be a string ≤500 chars' };
  }
  if (s.note !== undefined && s.note !== null && !isString(s.note)) {
    return { ok: false, error: 'note: must be a string ≤500 chars' };
  }
  return { ok: true };
}

/**
 * Validiert einen einzelnen Forecast-Intake-Record vor dem Persistieren.
 * Strikte Untermenge der forecastIntakes[]-Regeln.
 */
export function validateForecastIntakeRecord(it) {
  if (!isPlainObject(it)) return { ok: false, error: 'not an object' };
  if (!isIdString(it.id)) return { ok: false, error: 'id: invalid base-36 pattern' };
  if (!isDateString(it.date)) return { ok: false, error: 'date: must match YYYY-MM-DD' };
  if (typeof it.addCount !== 'number' || !Number.isInteger(it.addCount) || it.addCount <= 0) {
    return { ok: false, error: 'addCount: must be a positive integer' };
  }
  if (it.note !== undefined && it.note !== null && !isString(it.note)) {
    return { ok: false, error: 'note: must be a string ≤500 chars' };
  }
  return { ok: true };
}

/**
 * Erzeugt das Default-bewilligt-Objekt für neue Patienten.
 * KZT 1 ist immer bewilligt (Grundversorgung).
 */
export function createDefaultBewilligt() {
  return {
    kzt1: false,
    kzt2: false,
    lzt: false,
    lztMax: 60,
    lztV: false,
    lztVMax: 80,
  };
}

/**
 * Berechnet die automatische Phase für eine neue Nicht-Probatorik-Sitzung.
 *
 * Logik: Zählt alle bisherigen Nicht-Probatorik-Sitzungen des Patienten (= n).
 * Die neue Sitzung wird Sitzung n+1. Phase ergibt sich aus der Sitzungsnummer
 * und den bewilligten Phasen des Patienten.
 *
 * @param {string} patientId
 * @param {object} data — appData
 * @returns {{ phase: string, number: number, max: number, label: string } | { error: string }}
 */
export function computeSessionPhase(patientId, data) {
  const patient = data.patients.find(p => p.id === patientId);
  if (!patient) return { error: 'Patient nicht gefunden' };

  const bew = patient.bewilligt || createDefaultBewilligt();
  // Laufender Therapiestunden-Zähler (1 pro 50 Min.). Die neue Sitzung
  // bekommt das Phase-Label der Phase, in der ihre ERSTE Stunde liegt.
  const therapyHours = data.sessions
    .filter(s => s.patientId === patientId && s.phase !== 'probatorik')
    .reduce((sum, s) => sum + s.duration / 50, 0);
  const startHour = therapyHours + 1; // 1-basierte Position der ersten neuen Stunde

  // Keine Phase bewilligt → keine Kontingent-Sitzungen möglich
  if (!bew.kzt1 && !bew.lzt) {
    return { error: 'Keine Therapiephase bewilligt. Bitte zuerst im Patienten-Dialog eine Phase freigeben.' };
  }

  // Phasengrenzen sequentiell aufbauen (alles in Therapiestunden)
  let boundary = 0;

  if (bew.kzt1) {
    const kzt1End = boundary + 12;
    if (startHour <= kzt1End) {
      return { phase: 'kzt1', number: Math.ceil(startHour - boundary), max: 12, label: 'KZT 1' };
    }
    boundary = kzt1End;

    if (bew.kzt2) {
      const kzt2End = boundary + 12;
      if (startHour <= kzt2End) {
        return { phase: 'kzt2', number: Math.ceil(startHour - boundary), max: 12, label: 'KZT 2' };
      }
      boundary = kzt2End;
    }
  }

  if (bew.lzt) {
    const lztMax = bew.lztMax || 60;
    if (startHour <= lztMax) {
      return { phase: 'lzt', number: Math.ceil(startHour), max: lztMax, label: 'LZT' };
    }
    boundary = lztMax;

    if (bew.lztV) {
      const lztVMax = bew.lztVMax || 80;
      if (startHour <= lztVMax) {
        return { phase: 'lzt_v', number: Math.ceil(startHour), max: lztVMax, label: 'LZT-Verlängerung' };
      }
      boundary = lztVMax;
    }
  }

  return { error: `Kontingent erschöpft (Stunde ${Math.ceil(startHour)}, max. ${boundary || 0} bewilligt)` };
}

/**
 * Berechnet die Phase-Statistiken für einen Patienten.
 * Gibt pro Phase die aktuelle Anzahl und das Maximum zurück.
 */
export function getPhaseStats(patientId, data) {
  const patient = data.patients.find(p => p.id === patientId);
  if (!patient) return null;

  const bew = patient.bewilligt || createDefaultBewilligt();
  const sessions = data.sessions.filter(s => s.patientId === patientId);
  // Zählung in THERAPIESTUNDEN (duration / 50), NICHT in Sitzungen.
  // Eine Doppelsitzung (100 min) zählt als 2 Stunden, eine Sitzung à 200 min
  // als 4 Stunden. Die Phasengrenzen (12, 24, 60, 80) sind in Stunden definiert.
  const probaHours = sessions
    .filter(s => s.phase === 'probatorik')
    .reduce((sum, s) => sum + s.duration / 50, 0);
  const therapyHours = sessions
    .filter(s => s.phase !== 'probatorik')
    .reduce((sum, s) => sum + s.duration / 50, 0);

  // Alle fünf Phasen IMMER mit Eintrag zurückgeben. `bewilligt`-Flag
  // signalisiert dem Renderer, ob Balken oder "nicht bewilligt" gezeigt wird.
  // Probatorik ist als Grundversorgung immer "verfügbar" (braucht keine Bewilligung).
  const stats = {
    probatorik: { count: probaHours, max: 8, bewilligt: true },
    kzt1: { count: 0, max: 12, bewilligt: !!bew.kzt1 },
    kzt2: { count: 0, max: 12, bewilligt: !!bew.kzt2 },
    lzt: { count: 0, max: 0, bewilligt: !!bew.lzt },
    lzt_v: { count: 0, max: 0, bewilligt: !!bew.lztV },
  };

  let remaining = therapyHours;

  if (bew.kzt1) {
    stats.kzt1.count = Math.min(remaining, 12);
    remaining = Math.max(0, remaining - 12);

    if (bew.kzt2) {
      stats.kzt2.count = Math.min(remaining, 12);
      remaining = Math.max(0, remaining - 12);
    }
  }

  if (bew.lzt) {
    const kztTotal = (bew.kzt1 ? 12 : 0) + (bew.kzt2 ? 12 : 0);
    const lztSlots = Math.max(0, (bew.lztMax || 60) - kztTotal);
    stats.lzt.max = lztSlots;
    stats.lzt.count = Math.min(remaining, lztSlots);
    remaining = Math.max(0, remaining - lztSlots);

    if (bew.lztV) {
      const lztVSlots = Math.max(0, (bew.lztVMax || 80) - (bew.lztMax || 60));
      stats.lzt_v.max = lztVSlots;
      stats.lzt_v.count = Math.min(remaining, lztVSlots);
    }
  }

  return stats;
}

// Standard-Empty-State für frische Installationen.
export function createEmptyAppData() {
  return {
    version: 4,
    settings: {
      supervisionRatio: 4,
      defaultKontingent: 60,
      lastLocalExportAt: null,
      forecast: {
        abschlusskontrolleId: null,
        targetHours: 600,
        sickWeeksPerYear: 4,
        vacationWeeksPerYear: 6,
        dropoutRate: 0.30,
        currentPatientCount: 0,
        startDateOverride: null,
      },
    },
    patients: [],
    sessions: [],
    supervisions: [],
    supervisionGroups: [],
    forecastIntakes: [],
  };
}
