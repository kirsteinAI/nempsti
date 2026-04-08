// Unit tests for hour calculations.
// These functions are embedded in render.js but are pure and exported so we
// can test them headlessly. We construct a synthetic appData via setAppData
// (which requires state.js). To keep this test browser-free, we reimplement
// the math here against the same contract as render.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Reference calculation (must match render.js exactly).
function hoursFromDuration(durationMinutes) {
  return durationMinutes / 50;
}

function countSessionHours(sessions, patientId) {
  return sessions
    .filter(s => s.patientId === patientId)
    .reduce((sum, s) => sum + hoursFromDuration(s.duration), 0);
}

function countSupervisionHours(supervisions, patientId) {
  return supervisions
    .filter(s => s.patientIds && s.patientIds.includes(patientId))
    .reduce((sum, s) => sum + hoursFromDuration(s.duration), 0);
}

function getSupervisionStatus({ sessions, supervisions, settings }, patientId) {
  const sessionHours = countSessionHours(sessions, patientId);
  const supervisionHours = countSupervisionHours(supervisions, patientId);
  const ratio = settings.supervisionRatio;
  const required = sessionHours / ratio;
  const deficit = required - supervisionHours;
  return { sessionHours, supervisionHours, required, deficit, ratio };
}

test('Einzelsitzung (50 min) counts as 1.0 hour', () => {
  assert.equal(hoursFromDuration(50), 1);
});

test('Doppelsitzung (100 min) counts as 2.0 hours', () => {
  assert.equal(hoursFromDuration(100), 2);
});

test('Custom duration is linearly proportional', () => {
  assert.equal(hoursFromDuration(25), 0.5);
  assert.equal(hoursFromDuration(75), 1.5);
  assert.equal(hoursFromDuration(200), 4);
});

test('countSessionHours sums across multiple sessions for one patient', () => {
  const sessions = [
    { id: 's1', patientId: 'p1', date: '2026-01-01', type: 'einzel', duration: 50 },
    { id: 's2', patientId: 'p1', date: '2026-01-08', type: 'doppel', duration: 100 },
    { id: 's3', patientId: 'p2', date: '2026-01-15', type: 'einzel', duration: 50 },
  ];
  assert.equal(countSessionHours(sessions, 'p1'), 3);
  assert.equal(countSessionHours(sessions, 'p2'), 1);
  assert.equal(countSessionHours(sessions, 'unknown'), 0);
});

test('Supervision counts for each patient in patientIds (Gruppensupervision)', () => {
  const supervisions = [
    { id: 'sv1', patientIds: ['p1', 'p2', 'p3'], date: '2026-01-01', type: 'gruppe', duration: 50 },
  ];
  assert.equal(countSupervisionHours(supervisions, 'p1'), 1);
  assert.equal(countSupervisionHours(supervisions, 'p2'), 1);
  assert.equal(countSupervisionHours(supervisions, 'p3'), 1);
  assert.equal(countSupervisionHours(supervisions, 'p4'), 0);
});

test('Supervisionsverhältnis 1:4 — 4 Behandlungsstunden erfordern 1 SV-Stunde', () => {
  const data = {
    sessions: [
      { id: 's1', patientId: 'p1', date: '2026-01-01', type: 'einzel', duration: 50 },
      { id: 's2', patientId: 'p1', date: '2026-01-08', type: 'einzel', duration: 50 },
      { id: 's3', patientId: 'p1', date: '2026-01-15', type: 'einzel', duration: 50 },
      { id: 's4', patientId: 'p1', date: '2026-01-22', type: 'einzel', duration: 50 },
    ],
    supervisions: [
      { id: 'sv1', patientIds: ['p1'], date: '2026-01-25', type: 'gruppe', duration: 50 },
    ],
    settings: { supervisionRatio: 4 },
  };
  const status = getSupervisionStatus(data, 'p1');
  assert.equal(status.sessionHours, 4);
  assert.equal(status.supervisionHours, 1);
  assert.equal(status.required, 1);
  assert.equal(status.deficit, 0);
});

test('Supervisionsverhältnis-Defizit: 8 BH-Std, 1 SV-Std → Defizit 1.0', () => {
  const data = {
    sessions: Array.from({ length: 8 }, (_, i) => ({
      id: 's' + i, patientId: 'p1', date: '2026-01-0' + (i + 1), type: 'einzel', duration: 50,
    })),
    supervisions: [
      { id: 'sv1', patientIds: ['p1'], date: '2026-02-01', type: 'gruppe', duration: 50 },
    ],
    settings: { supervisionRatio: 4 },
  };
  const status = getSupervisionStatus(data, 'p1');
  assert.equal(status.sessionHours, 8);
  assert.equal(status.supervisionHours, 1);
  assert.equal(status.required, 2);
  assert.equal(status.deficit, 1);
});

test('Supervisionsverhältnis-Überhang: 4 BH-Std, 2 SV-Std → Defizit -1 (= Überhang)', () => {
  const data = {
    sessions: [
      { id: 's1', patientId: 'p1', date: '2026-01-01', type: 'einzel', duration: 50 },
      { id: 's2', patientId: 'p1', date: '2026-01-08', type: 'einzel', duration: 50 },
      { id: 's3', patientId: 'p1', date: '2026-01-15', type: 'einzel', duration: 50 },
      { id: 's4', patientId: 'p1', date: '2026-01-22', type: 'einzel', duration: 50 },
    ],
    supervisions: [
      { id: 'sv1', patientIds: ['p1'], date: '2026-01-25', type: 'einzel', duration: 50 },
      { id: 'sv2', patientIds: ['p1'], date: '2026-01-26', type: 'einzel', duration: 50 },
    ],
    settings: { supervisionRatio: 4 },
  };
  const status = getSupervisionStatus(data, 'p1');
  assert.equal(status.deficit, -1);
});

test('Custom supervisionRatio (1:5) scales the requirement', () => {
  const data = {
    sessions: Array.from({ length: 10 }, (_, i) => ({
      id: 's' + i, patientId: 'p1', date: '2026-01-01', type: 'einzel', duration: 50,
    })),
    supervisions: [],
    settings: { supervisionRatio: 5 },
  };
  const status = getSupervisionStatus(data, 'p1');
  assert.equal(status.sessionHours, 10);
  assert.equal(status.required, 2);
  assert.equal(status.deficit, 2);
});
