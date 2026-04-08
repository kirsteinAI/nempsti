// forecast.js
// Reine Rechenlogik für den "Prüfungs-Fahrplan" (Forecast-Feature).
//
// Kein DOM, kein IDB, keine Browser-Globals — dieses Modul ist von Node-Tests
// direkt importierbar und stellt die gesamte Rechenlogik als pure Funktionen
// bereit. Der Renderer (render.js) und die Event-Handler (app.js) konsumieren
// ausschließlich `calculateForecast(appData, today)` und die Konstante
// `ABSCHLUSSKONTROLLEN`.
//
// Kontext:
// - Basis ist die Planungshilfe-Excel aus der GDrive des Users
//   ("Praktische Ausbildung_Kalkulation_Planungshilfe_1_ab 2026.xlsx").
// - Die Excel berechnet rückwärts ("wieviele Patienten brauche ich für
//   Termin X?") bei konstanter Patientenzahl. Dieses Modul übernimmt die
//   Excel-Formel 1:1 als `excelVariant` UND erweitert sie um einen
//   Stufenfunktions-basierten Segment-Forecast, der den in der App gepflegten
//   Aufnahmeplan (`forecastIntakes[]`) berücksichtigt.
// - IST-Stunden stammen aus `appData.sessions` (Summe `duration / 50`, gleich
//   dem Rest der App, siehe render.js:50).

/**
 * Abschlusskontroll-Termine für die Psychotherapie-Ausbildung (PP/KJP).
 * Tag/Monat laut Screenshot der User-Excel. Frühjahr-Termin liegt jeweils am
 * 15.12. des Vorjahres, Herbst-Termin jeweils am 15.05. des gleichen Jahres
 * (Aktencheck-Deadlines, NICHT der mündliche/schriftliche Prüfungstermin).
 *
 * ACHTUNG §2.1: Liste wird erweitert, niemals umsortiert oder geändert.
 * IDs sind stabile Verweise, die in `settings.forecast.abschlusskontrolleId`
 * persistiert werden.
 */
export const ABSCHLUSSKONTROLLEN = Object.freeze([
  Object.freeze({ id: 'fj-2026', label: 'Frühjahr 2026', date: '2025-12-15' }),
  Object.freeze({ id: 'hb-2026', label: 'Herbst 2026',   date: '2026-05-15' }),
  Object.freeze({ id: 'fj-2027', label: 'Frühjahr 2027', date: '2026-12-15' }),
  Object.freeze({ id: 'hb-2027', label: 'Herbst 2027',   date: '2027-05-15' }),
  Object.freeze({ id: 'fj-2028', label: 'Frühjahr 2028', date: '2027-12-15' }),
  Object.freeze({ id: 'hb-2028', label: 'Herbst 2028',   date: '2028-05-15' }),
  Object.freeze({ id: 'fj-2029', label: 'Frühjahr 2029', date: '2028-12-15' }),
  Object.freeze({ id: 'hb-2029', label: 'Herbst 2029',   date: '2029-05-15' }),
  Object.freeze({ id: 'fj-2030', label: 'Frühjahr 2030', date: '2029-12-15' }),
  Object.freeze({ id: 'hb-2030', label: 'Herbst 2030',   date: '2030-05-15' }),
  Object.freeze({ id: 'fj-2031', label: 'Frühjahr 2031', date: '2030-12-15' }),
  Object.freeze({ id: 'hb-2031', label: 'Herbst 2031',   date: '2031-05-15' }),
  Object.freeze({ id: 'fj-2032', label: 'Frühjahr 2032', date: '2031-12-15' }),
  Object.freeze({ id: 'hb-2032', label: 'Herbst 2032',   date: '2032-05-15' }),
]);

/** Lookup-Helper für einen Abschlusskontroll-Termin nach ID. */
export function findAbschlusskontrolle(id) {
  if (!id) return null;
  return ABSCHLUSSKONTROLLEN.find(a => a.id === id) || null;
}

/** 50 Minuten = 1 Therapiestunde (gleiches Konvent wie render.js). */
const MINUTES_PER_THERAPY_HOUR = 50;

/**
 * Summiert alle Sitzungsdauern zu Therapiestunden.
 * Identische Semantik wie render.js:50 `countSessionHours`, aber über alle
 * Patienten und ohne DOM-Zugriff.
 */
export function sumDoneHours(appData) {
  const sessions = Array.isArray(appData && appData.sessions) ? appData.sessions : [];
  return sessions.reduce((sum, s) => {
    const d = typeof s.duration === 'number' && Number.isFinite(s.duration) ? s.duration : 0;
    return sum + d / MINUTES_PER_THERAPY_HOUR;
  }, 0);
}

/**
 * Bestimmt das effektive Startdatum der Praktischen Ausbildung.
 *  1. explizites Override in settings.forecast.startDateOverride, sonst
 *  2. frühestes session.date, sonst
 *  3. `today` (noch keine Sitzungen erfasst).
 */
export function resolveStartDate(appData, today) {
  const override = appData && appData.settings && appData.settings.forecast
    ? appData.settings.forecast.startDateOverride
    : null;
  if (typeof override === 'string' && override) return override;
  const sessions = Array.isArray(appData && appData.sessions) ? appData.sessions : [];
  if (sessions.length === 0) return today;
  let min = null;
  for (const s of sessions) {
    if (typeof s.date === 'string' && (min === null || s.date < min)) min = s.date;
  }
  return min || today;
}

/**
 * Anzahl Kalendertage zwischen zwei ISO-Datumsstrings (YYYY-MM-DD).
 * Positiv wenn `end > start`. UTC-Anker, damit DST-Wechsel nicht reinspielt.
 */
function daysBetween(startIso, endIso) {
  const a = Date.parse(startIso + 'T00:00:00Z');
  const b = Date.parse(endIso + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/** Hilfsfunktion: Date → 'YYYY-MM-DD'. */
function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Berechnet den Forecast für ein gegebenes appData + heutiges Datum.
 *
 * Rückgabe:
 *   ready: false → Forecast kann nicht berechnet werden (kein Termin, Termin
 *                  in der Vergangenheit, etc). `reason` beschreibt warum.
 *   ready: true  → vollständiges Ergebnis-Objekt (siehe Feld-Kommentare).
 *
 * Beide Varianten tragen `today`, `targetHours`, `doneHours` etc. für die
 * Anzeige im UI, sodass der Renderer nur eine Rückgabe konsumieren muss.
 *
 * @param {object} appData — kanonisches v3-appData (nach Migration/Validation)
 * @param {string | Date} [todayInput] — optional, sonst wird new Date() genutzt
 */
export function calculateForecast(appData, todayInput) {
  // -------- 0. Eingaben normalisieren -----------------------------------
  const today =
    typeof todayInput === 'string' ? todayInput :
    todayInput instanceof Date ? toIsoDate(todayInput) :
    toIsoDate(new Date());

  const f = (appData && appData.settings && appData.settings.forecast) || {};
  const targetHours = isFiniteNumber(f.targetHours) && f.targetHours > 0 ? f.targetHours : 600;
  const sickWPY    = isFiniteNumber(f.sickWeeksPerYear)     && f.sickWeeksPerYear     >= 0 ? f.sickWeeksPerYear     : 4;
  const vacWPY     = isFiniteNumber(f.vacationWeeksPerYear) && f.vacationWeeksPerYear >= 0 ? f.vacationWeeksPerYear : 6;
  const dropoutRate =
    isFiniteNumber(f.dropoutRate) && f.dropoutRate >= 0 && f.dropoutRate < 1
      ? f.dropoutRate
      : 0.30;
  const currentPatientCount =
    isFiniteNumber(f.currentPatientCount) && f.currentPatientCount >= 0
      ? Math.floor(f.currentPatientCount)
      : 0;

  const doneHours  = sumDoneHours(appData);
  const startDate  = resolveStartDate(appData, today);
  const remainingHours = Math.max(0, targetHours - doneHours);

  // -------- 1. Termin prüfen ---------------------------------------------
  const abschluss = findAbschlusskontrolle(f.abschlusskontrolleId);
  const baseInfo = {
    today,
    startDate,
    targetHours,
    doneHours,
    remainingHours,
    sickWeeksPerYear: sickWPY,
    vacationWeeksPerYear: vacWPY,
    dropoutRate,
    currentPatientCount,
  };

  if (!abschluss) {
    return { ready: false, reason: 'no-exam-selected', ...baseInfo };
  }
  const examDate = abschluss.date;
  const examLabel = abschluss.label;
  const examId = abschluss.id;

  if (examDate <= today) {
    return { ready: false, reason: 'exam-in-past', examDate, examLabel, examId, ...baseInfo };
  }

  // -------- 2. Excel-variant (1:1 Excel Sheet 1, rückwärts) --------------
  //
  // weeks_raw      = ROUNDDOWN((exam - today) / 7)
  // years          = (exam - today) / 365
  // effective_wks  = weeks_raw − sickWPY·years − vacWPY·years
  // h/week         = (target − done) / effective_wks
  // patients       = ROUNDUP(h/week · (1 + dropout))
  //
  // Wichtig: Die Additiv-Formulierung (× 1.3) ist Excel-Original. Sie ist
  // nicht mathematisch exakt invers zu "pro Patient = 1h/Woche × (1 − 0.30)",
  // aber sie ist das mentale Modell, das der User im Excel gewohnt ist, und
  // die Referenz-Tests unten bestätigen die 1:1-Übereinstimmung.
  const daysToExam = daysBetween(today, examDate);
  const weeksRawExcel = Math.floor(daysToExam / 7);
  const yearsRaw = daysToExam / 365;
  const sickWeeksTotal = sickWPY * yearsRaw;
  const vacWeeksTotal  = vacWPY * yearsRaw;
  const effectiveWeeksTotal = Math.max(0, weeksRawExcel - sickWeeksTotal - vacWeeksTotal);

  let hoursPerWeekRequired;
  let activePatientsRequired;
  if (effectiveWeeksTotal <= 0) {
    hoursPerWeekRequired = Infinity;
    activePatientsRequired = Infinity;
  } else if (remainingHours === 0) {
    hoursPerWeekRequired = 0;
    activePatientsRequired = 0;
  } else {
    hoursPerWeekRequired = remainingHours / effectiveWeeksTotal;
    activePatientsRequired = Math.ceil(hoursPerWeekRequired * (1 + dropoutRate));
  }

  // -------- 3. Segment-Forecast (stufenweiser Aufnahmeplan) --------------
  //
  // Timeline = [today, intake_1, intake_2, …, exam]. Nur Intakes mit
  // `date > today && date < exam` werden berücksichtigt — vergangene Intakes
  // gelten als bereits im `currentPatientCount` eingerechnet (User-Hygiene).
  //
  // Pro Segment: Hours/Week wird konsistent zum Excel-Modell berechnet als
  //   hours_per_week = active / (1 + dropoutRate)
  // also der Kehrwert der Excel-Rückwärts-Formel. Damit ist der Vorwärts-
  // Forecast exakt invers zum Excel-Wert `activePatientsRequired` — keine
  // widersprüchlichen Zahlen im UI.
  const allIntakes = Array.isArray(appData && appData.forecastIntakes) ? appData.forecastIntakes : [];
  const futureIntakes = allIntakes
    .filter(it => typeof it.date === 'string' && it.date > today && it.date < examDate)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));

  const segments = [];
  let segStart = today;
  let activeCount = currentPatientCount;

  for (const intake of futureIntakes) {
    const segEnd = intake.date;
    if (segEnd > segStart) {
      segments.push(buildSegment(segStart, segEnd, activeCount, sickWPY, vacWPY, dropoutRate));
    }
    activeCount += (Number.isInteger(intake.addCount) && intake.addCount > 0) ? intake.addCount : 0;
    segStart = segEnd;
  }
  if (examDate > segStart) {
    segments.push(buildSegment(segStart, examDate, activeCount, sickWPY, vacWPY, dropoutRate));
  }

  const projectedSegmentHours = segments.reduce((sum, s) => sum + s.segmentHours, 0);
  const projectedTotal = doneHours + projectedSegmentHours;
  const delta = projectedTotal - targetHours;
  const onTrack = delta >= 0;

  const peakPatientCount = segments.length > 0
    ? Math.max(currentPatientCount, ...segments.map(s => s.activePatients))
    : currentPatientCount;

  return {
    ready: true,
    today,
    startDate,
    examDate,
    examLabel,
    examId,
    targetHours,
    doneHours,
    remainingHours,
    sickWeeksPerYear: sickWPY,
    vacationWeeksPerYear: vacWPY,
    dropoutRate,
    currentPatientCount,
    peakPatientCount,

    // Timeline-Kennzahlen über den gesamten Zeitraum today → exam:
    daysToExam,
    weeksTotalRaw: weeksRawExcel,
    yearsTotal: yearsRaw,
    effectiveWeeksTotal,

    // Segment-basierter Forecast (neue Logik):
    segments,
    projectedSegmentHours,
    projectedTotal,
    delta,
    onTrack,

    // Excel-1:1-Variante (konstante Patientenzahl, Excel Sheet 1):
    excelVariant: {
      hoursPerWeekRequired,
      activePatientsRequired,
    },
  };
}

/**
 * Ein Segment der Timeline. Grundannahme: innerhalb des Segments ist die
 * Anzahl aktiver Patienten konstant (`activePatients`), und ein aktiver
 * Patient liefert `1 / (1 + dropoutRate)` Stunden pro effektiver Arbeitswoche
 * — siehe Kommentar bei der Excel-Inverse in calculateForecast.
 */
function buildSegment(startDate, endDate, activePatients, sickWPY, vacWPY, dropoutRate) {
  const days = daysBetween(startDate, endDate);
  const weeksRaw = days / 7;
  const years = days / 365;
  const effectiveWeeks = Math.max(0, weeksRaw - sickWPY * years - vacWPY * years);
  const hoursPerWeek = activePatients / (1 + dropoutRate);
  const segmentHours = hoursPerWeek * effectiveWeeks;
  return {
    startDate,
    endDate,
    days,
    weeksRaw,
    effectiveWeeks,
    activePatients,
    hoursPerWeek,
    segmentHours,
  };
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
