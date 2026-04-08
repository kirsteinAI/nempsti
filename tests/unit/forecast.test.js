// Unit tests for forecast.js
// Run with: node --test tests/unit/forecast.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ABSCHLUSSKONTROLLEN,
  findAbschlusskontrolle,
  sumDoneHours,
  resolveStartDate,
  calculateForecast,
} from '../../forecast.js';
import { createEmptyAppData } from '../../validation.js';

// -------- Hilfs-Fabriken --------
function baseAppData(overrides = {}) {
  const d = createEmptyAppData();
  if (overrides.forecast) {
    d.settings.forecast = { ...d.settings.forecast, ...overrides.forecast };
  }
  if (overrides.sessions) d.sessions = overrides.sessions;
  if (overrides.patients) d.patients = overrides.patients;
  if (overrides.forecastIntakes) d.forecastIntakes = overrides.forecastIntakes;
  return d;
}

function session(date, duration) {
  return {
    id: 'sess' + Math.random().toString(36).slice(2, 10),
    patientId: 'pat00000abc1',
    date,
    type: 'einzel',
    duration,
    note: '',
  };
}

function intake(date, addCount) {
  return { id: 'intk' + Math.random().toString(36).slice(2, 10), date, addCount };
}

// =====================================================================
// ABSCHLUSSKONTROLLEN — statische Liste
// =====================================================================

test('ABSCHLUSSKONTROLLEN: enthält beide Slots pro Jahr 2026–2032, IDs eindeutig', () => {
  assert.equal(ABSCHLUSSKONTROLLEN.length, 14);
  const ids = new Set(ABSCHLUSSKONTROLLEN.map(a => a.id));
  assert.equal(ids.size, 14);
});

test('ABSCHLUSSKONTROLLEN: Daten in ISO-YYYY-MM-DD, aufsteigend sortiert', () => {
  let prev = '';
  for (const a of ABSCHLUSSKONTROLLEN) {
    assert.match(a.date, /^\d{4}-\d{2}-\d{2}$/, `date must be ISO: ${a.date}`);
    assert.ok(a.date > prev, `dates must be ascending; ${a.date} vs ${prev}`);
    prev = a.date;
  }
});

test('ABSCHLUSSKONTROLLEN: Frühjahr/Herbst-Konvention 15.12. / 15.05.', () => {
  for (const a of ABSCHLUSSKONTROLLEN) {
    const mmdd = a.date.slice(5);
    assert.ok(
      mmdd === '12-15' || mmdd === '05-15',
      `unexpected date pattern for ${a.id}: ${a.date}`
    );
    if (a.id.startsWith('fj-')) assert.equal(mmdd, '12-15');
    if (a.id.startsWith('hb-')) assert.equal(mmdd, '05-15');
  }
});

test('findAbschlusskontrolle: Lookup per ID, null für Unbekannte', () => {
  assert.equal(findAbschlusskontrolle('fj-2028').label, 'Frühjahr 2028');
  assert.equal(findAbschlusskontrolle('hb-2032').date, '2032-05-15');
  assert.equal(findAbschlusskontrolle('nope'), null);
  assert.equal(findAbschlusskontrolle(null), null);
  assert.equal(findAbschlusskontrolle(undefined), null);
});

// =====================================================================
// sumDoneHours — Anschluss an bestehende Sessions-Erfassung
// =====================================================================

test('sumDoneHours: Summe aller session.duration / 50', () => {
  const d = baseAppData({
    sessions: [
      session('2026-01-10', 50),  // 1h
      session('2026-01-15', 100), // 2h
      session('2026-02-01', 75),  // 1.5h
    ],
  });
  assert.equal(sumDoneHours(d), 4.5);
});

test('sumDoneHours: 0 wenn keine Sessions', () => {
  assert.equal(sumDoneHours(baseAppData()), 0);
  assert.equal(sumDoneHours({}), 0);
  assert.equal(sumDoneHours(null), 0);
});

test('sumDoneHours: ignoriert kaputte Einträge (duration fehlt)', () => {
  const d = baseAppData({
    sessions: [
      session('2026-01-10', 50),
      { id: 'broken', patientId: 'p', date: '2026-01-11', type: 'einzel' /* keine duration */ },
    ],
  });
  assert.equal(sumDoneHours(d), 1);
});

// =====================================================================
// resolveStartDate
// =====================================================================

test('resolveStartDate: Override hat Priorität', () => {
  const d = baseAppData({
    forecast: { startDateOverride: '2025-11-01' },
    sessions: [session('2026-03-10', 50)],
  });
  assert.equal(resolveStartDate(d, '2026-04-08'), '2025-11-01');
});

test('resolveStartDate: frühestes Session-Datum ohne Override', () => {
  const d = baseAppData({
    sessions: [
      session('2026-03-10', 50),
      session('2026-01-05', 50), // früheste
      session('2026-02-15', 50),
    ],
  });
  assert.equal(resolveStartDate(d, '2026-04-08'), '2026-01-05');
});

test('resolveStartDate: heute wenn keine Sessions und kein Override', () => {
  assert.equal(resolveStartDate(baseAppData(), '2026-04-08'), '2026-04-08');
});

// =====================================================================
// calculateForecast — not-ready Zustände
// =====================================================================

test('calculateForecast: ready=false wenn kein Termin gewählt ist', () => {
  const r = calculateForecast(baseAppData(), '2026-04-08');
  assert.equal(r.ready, false);
  assert.equal(r.reason, 'no-exam-selected');
  // Basisinfos werden trotzdem geliefert für die Anzeige.
  assert.equal(r.today, '2026-04-08');
  assert.equal(r.targetHours, 600);
  assert.equal(r.doneHours, 0);
});

test('calculateForecast: ready=false wenn Termin in Vergangenheit', () => {
  const d = baseAppData({ forecast: { abschlusskontrolleId: 'fj-2026' } });
  // fj-2026 = 2025-12-15; today 2026-04-08 → vergangen
  const r = calculateForecast(d, '2026-04-08');
  assert.equal(r.ready, false);
  assert.equal(r.reason, 'exam-in-past');
  assert.equal(r.examId, 'fj-2026');
});

test('calculateForecast: ready=false auch wenn Termin GENAU heute ist', () => {
  const d = baseAppData({ forecast: { abschlusskontrolleId: 'hb-2026' } });
  // hb-2026 = 2026-05-15
  const r = calculateForecast(d, '2026-05-15');
  assert.equal(r.ready, false);
  assert.equal(r.reason, 'exam-in-past');
});

// =====================================================================
// calculateForecast — Excel-Referenzfall
// =====================================================================
//
// Ziel: die Excel-Werte aus Sheet 1 (Row 13 "Anzahl benötigter Patienten")
// bei `Start = 2026-01-27` und Ziel = 600h, Ausfallwochen 4, Urlaubswochen 6,
// Patientenausfallquote 30 %, 0h bereits geleistet.
//
// Excel-Werte (laut cached XML in der User-Datei, G13..P13):
//   Herbst 2026 (2026-05-15)  → 65
//   Frühjahr 2027 (2026-12-15) → 21
//   Herbst 2027 (2027-05-15)  → 15
//   Frühjahr 2028 (2027-12-15) → 10
//   Herbst 2028 (2028-05-15)  →  9
//   Frühjahr 2029 (2028-12-15) →  7
//   Herbst 2029 (2029-05-15)  →  6
//   Frühjahr 2030 (2029-12-15) →  5
//   Herbst 2030 (2030-05-15)  →  5
//   Frühjahr 2031 (2030-12-15) →  4
//   Herbst 2031 (2031-05-15)  →  4
//   Frühjahr 2032 (2031-12-15) →  4
//   Herbst 2032 (2032-05-15)  →  3

function forecastForExam(examId, today = '2026-01-27') {
  const d = baseAppData({ forecast: { abschlusskontrolleId: examId } });
  return calculateForecast(d, today);
}

test('Excel-Referenz: Herbst 2026 (Start 2026-01-27) → 65 Patienten', () => {
  const r = forecastForExam('hb-2026');
  assert.equal(r.ready, true);
  assert.equal(r.excelVariant.activePatientsRequired, 65);
});

test('Excel-Referenz: Frühjahr 2027 → 21 Patienten', () => {
  assert.equal(forecastForExam('fj-2027').excelVariant.activePatientsRequired, 21);
});

test('Excel-Referenz: Herbst 2027 → 15 Patienten', () => {
  assert.equal(forecastForExam('hb-2027').excelVariant.activePatientsRequired, 15);
});

test('Excel-Referenz: Frühjahr 2028 → 10 Patienten', () => {
  assert.equal(forecastForExam('fj-2028').excelVariant.activePatientsRequired, 10);
});

test('Excel-Referenz: Herbst 2028 → 9 Patienten', () => {
  assert.equal(forecastForExam('hb-2028').excelVariant.activePatientsRequired, 9);
});

test('Excel-Referenz: Frühjahr 2029 → 7 Patienten', () => {
  assert.equal(forecastForExam('fj-2029').excelVariant.activePatientsRequired, 7);
});

test('Excel-Referenz: Herbst 2029 → 6 Patienten', () => {
  assert.equal(forecastForExam('hb-2029').excelVariant.activePatientsRequired, 6);
});

test('Excel-Referenz: Frühjahr 2030 → 5 Patienten', () => {
  assert.equal(forecastForExam('fj-2030').excelVariant.activePatientsRequired, 5);
});

test('Excel-Referenz: Herbst 2030 → 5 Patienten', () => {
  assert.equal(forecastForExam('hb-2030').excelVariant.activePatientsRequired, 5);
});

test('Excel-Referenz: Frühjahr 2031 → 4 Patienten', () => {
  assert.equal(forecastForExam('fj-2031').excelVariant.activePatientsRequired, 4);
});

test('Excel-Referenz: Herbst 2031 → 4 Patienten', () => {
  assert.equal(forecastForExam('hb-2031').excelVariant.activePatientsRequired, 4);
});

test('Excel-Referenz: Frühjahr 2032 → 4 Patienten', () => {
  assert.equal(forecastForExam('fj-2032').excelVariant.activePatientsRequired, 4);
});

test('Excel-Referenz: Herbst 2032 → 3 Patienten', () => {
  assert.equal(forecastForExam('hb-2032').excelVariant.activePatientsRequired, 3);
});

// =====================================================================
// calculateForecast — IST-Stunden werden vom Ziel abgezogen
// =====================================================================

test('bereits geleistete IST-Stunden reduzieren die benötigte Patientenzahl', () => {
  // 300h schon erfasst, Ziel 600h → es fehlen noch 300h. Bei Frühjahr 2028
  // ergibt das die halbe Anzahl Patienten wie im leeren Excel-Referenzfall
  // (10) — grob gerundet auf die Excel-Roundup-Stufe.
  const d = baseAppData({
    forecast: { abschlusskontrolleId: 'fj-2028' },
    sessions: Array.from({ length: 300 }, (_, i) =>
      session(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 50)
    ),
  });
  const r = calculateForecast(d, '2026-01-27');
  assert.equal(r.ready, true);
  assert.equal(r.doneHours, 300);
  assert.equal(r.remainingHours, 300);
  // Halbe Lücke → halbe hours/week → halbe patients (bzw. aufgerundet).
  // Excel mit 300h Restbedarf: hoursPerWeek ≈ 3.79 → ceil(3.79×1.3) = 5
  assert.equal(r.excelVariant.activePatientsRequired, 5);
});

test('IST ≥ Ziel: remainingHours=0, activePatientsRequired=0', () => {
  const d = baseAppData({
    forecast: { abschlusskontrolleId: 'hb-2028' },
    sessions: [session('2026-01-10', 50 * 650)], // 650h (>600 Ziel)
  });
  const r = calculateForecast(d, '2026-01-27');
  assert.equal(r.ready, true);
  assert.equal(r.doneHours, 650);
  assert.equal(r.remainingHours, 0);
  assert.equal(r.excelVariant.hoursPerWeekRequired, 0);
  assert.equal(r.excelVariant.activePatientsRequired, 0);
});

// =====================================================================
// Segment-Forecast — Stufenweise Aufnahme
// =====================================================================

test('Segment-Forecast: ohne Intakes ist projected exakt invers zum Excel-Variant', () => {
  // Mit 0 Intakes und einem konstanten currentPatientCount entsprechend dem
  // Excel-Referenzwert sollte projectedSegmentHours ≈ remainingHours sein
  // (der User hat gerade exakt die benötigte Patientenzahl eingestellt).
  const d = baseAppData({
    forecast: {
      abschlusskontrolleId: 'fj-2028', // Excel-Ref: 10 Patienten nötig
      currentPatientCount: 10,
    },
  });
  const r = calculateForecast(d, '2026-01-27');
  assert.equal(r.ready, true);
  // Bei exakt 10 Patienten deckt der Segment-Forecast die 600h-Lücke ab (±
  // Excel-Rundungseffekt durch das ROUNDUP der Excel-Variante).
  // Wir prüfen, dass der Forecast "on track" ist — also projected ≥ target.
  assert.equal(r.onTrack, true);
  // Und dass projectedSegmentHours ungefähr remainingHours entspricht
  // (nicht unter der 600h-Marke, aber auch nicht absurd darüber).
  assert.ok(
    r.projectedSegmentHours >= r.remainingHours,
    `projected ${r.projectedSegmentHours} must cover remaining ${r.remainingHours}`
  );
  assert.ok(
    r.projectedSegmentHours < r.remainingHours + 60,
    `projected ${r.projectedSegmentHours} should be close to remaining ${r.remainingHours} (+ ceil puffer)`
  );
});

test('Segment-Forecast: Intakes vor today werden ignoriert', () => {
  const d = baseAppData({
    forecast: { abschlusskontrolleId: 'fj-2028', currentPatientCount: 2 },
    forecastIntakes: [
      intake('2026-01-01', 5), // Vergangenheit → ignoriert
      intake('2026-01-27', 5), // exakt heute → ignoriert (Grenzfall: today < date gefordert)
    ],
  });
  const r = calculateForecast(d, '2026-01-27');
  assert.equal(r.ready, true);
  // Es bleibt bei 2 Patienten für das ganze Fenster → genau ein Segment.
  assert.equal(r.segments.length, 1);
  assert.equal(r.segments[0].activePatients, 2);
});

test('Segment-Forecast: baut Stufenfunktion aus Intakes', () => {
  const d = baseAppData({
    forecast: { abschlusskontrolleId: 'fj-2028', currentPatientCount: 2 },
    forecastIntakes: [
      intake('2026-05-01', 2), // → 4
      intake('2026-08-01', 3), // → 7
      intake('2027-01-15', 1), // → 8
    ],
  });
  const r = calculateForecast(d, '2026-01-27');
  assert.equal(r.ready, true);
  // 3 Intakes + 1 Final-Segment = 4 Segmente
  assert.equal(r.segments.length, 4);
  assert.equal(r.segments[0].activePatients, 2);
  assert.equal(r.segments[1].activePatients, 4);
  assert.equal(r.segments[2].activePatients, 7);
  assert.equal(r.segments[3].activePatients, 8);
  // Segment-Grenzen passen.
  assert.equal(r.segments[0].startDate, '2026-01-27');
  assert.equal(r.segments[0].endDate,   '2026-05-01');
  assert.equal(r.segments[3].endDate,   '2027-12-15'); // examDate
  // Peak-Patientenzahl wird korrekt ermittelt.
  assert.equal(r.peakPatientCount, 8);
});

test('Segment-Forecast: Intake nach Prüfungstermin wird ignoriert', () => {
  const d = baseAppData({
    forecast: { abschlusskontrolleId: 'hb-2026', currentPatientCount: 3 },
    forecastIntakes: [
      intake('2026-03-01', 2),   // in-range → wird verwendet
      intake('2026-09-01', 100), // nach exam → ignoriert
    ],
  });
  const r = calculateForecast(d, '2026-01-27');
  assert.equal(r.ready, true);
  // Nur 1 Intake vor exam → 2 Segmente
  assert.equal(r.segments.length, 2);
  assert.equal(r.peakPatientCount, 5);
});

test('Segment-Forecast: zu wenig Patienten → onTrack=false, delta < 0', () => {
  const d = baseAppData({
    forecast: { abschlusskontrolleId: 'hb-2027', currentPatientCount: 2 },
  });
  const r = calculateForecast(d, '2026-01-27');
  assert.equal(r.ready, true);
  assert.equal(r.onTrack, false);
  assert.ok(r.delta < 0, `delta should be negative, got ${r.delta}`);
  // Viel weniger Patienten als benötigt → noch mehr benötigt im Excel-Variant
  // als der Excel-Referenzwert (15 Patienten für Herbst 2027).
  assert.equal(r.excelVariant.activePatientsRequired, 15);
});

// =====================================================================
// calculateForecast — Parameter editierbar
// =====================================================================

test('Parameter-Override: höhere Ausfallquote → mehr Patienten nötig', () => {
  const base = baseAppData({
    forecast: { abschlusskontrolleId: 'fj-2028', dropoutRate: 0.30 },
  });
  const high = baseAppData({
    forecast: { abschlusskontrolleId: 'fj-2028', dropoutRate: 0.50 },
  });
  const rBase = calculateForecast(base, '2026-01-27');
  const rHigh = calculateForecast(high, '2026-01-27');
  assert.ok(
    rHigh.excelVariant.activePatientsRequired > rBase.excelVariant.activePatientsRequired,
    `higher dropout must require more patients: ${rHigh.excelVariant.activePatientsRequired} vs ${rBase.excelVariant.activePatientsRequired}`
  );
});

test('Parameter-Override: targetHours 540 statt 600 → weniger Patienten', () => {
  const base = baseAppData({
    forecast: { abschlusskontrolleId: 'fj-2028', targetHours: 600 },
  });
  const low = baseAppData({
    forecast: { abschlusskontrolleId: 'fj-2028', targetHours: 540 },
  });
  const rBase = calculateForecast(base, '2026-01-27');
  const rLow = calculateForecast(low, '2026-01-27');
  assert.ok(rLow.excelVariant.activePatientsRequired <= rBase.excelVariant.activePatientsRequired);
  assert.equal(rLow.targetHours, 540);
});

test('Parameter-Override: ungültige Werte werden durch Defaults ersetzt', () => {
  const d = baseAppData({
    forecast: {
      abschlusskontrolleId: 'fj-2028',
      targetHours: -5,           // ungültig
      sickWeeksPerYear: NaN,     // ungültig
      dropoutRate: 1.5,          // ungültig (muss < 1 sein)
      currentPatientCount: -3,    // ungültig
    },
  });
  const r = calculateForecast(d, '2026-01-27');
  assert.equal(r.ready, true);
  assert.equal(r.targetHours, 600);
  assert.equal(r.sickWeeksPerYear, 4);
  assert.equal(r.dropoutRate, 0.30);
  assert.equal(r.currentPatientCount, 0);
});
