// Unit tests for validation.js
// Run with: node --test tests/unit/validation.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMAT,
  escapeHtml,
  generateId,
  validateAppData,
  validateSessionRecord,
  validateSupervisionRecord,
  createEmptyAppData,
} from '../../validation.js';

// Base canonical v1 shape. Override fields per test. Necessary because the
// validator strictly requires all top-level fields on versioned payloads
// (post-review fix: "Shared validation still accepts v1 payloads that crash
// the renderer").
function baseV1(overrides = {}) {
  return {
    version: 1,
    settings: { supervisionRatio: 4, defaultKontingent: 60 },
    patients: [],
    sessions: [],
    supervisions: [],
    supervisionGroups: [],
    ...overrides,
  };
}

test('escapeHtml escapes all dangerous characters', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'),
    '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHtml('"><svg onload=alert(1)>'),
    '&quot;&gt;&lt;svg onload=alert(1)&gt;');
  assert.equal(escapeHtml("O'Brien"), 'O&#39;Brien');
  assert.equal(escapeHtml('A & B'), 'A &amp; B');
});

test('escapeHtml is idempotent for safe strings', () => {
  assert.equal(escapeHtml('Max Mustermann'), 'Max Mustermann');
  assert.equal(escapeHtml('Ätherisch'), 'Ätherisch');
  assert.equal(escapeHtml('日本語'), '日本語');
});

test('escapeHtml handles null/undefined/numbers', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

test('generateId yields only [a-z0-9] and passes FORMAT.ID_PATTERN', () => {
  for (let i = 0; i < 100; i++) {
    const id = generateId();
    assert.match(id, /^[a-z0-9]+$/);
    assert.ok(FORMAT.ID_PATTERN.test(id), `id "${id}" must match ID_PATTERN`);
  }
});

test('generateId produces unique IDs over 1000 calls', () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) set.add(generateId());
  // Allow a handful of collisions due to same-ms randomness, but should be ≥990 unique.
  assert.ok(set.size >= 990, `expected ≥990 unique ids, got ${set.size}`);
});

test('validateAppData accepts empty canonical shape', () => {
  const result = validateAppData(createEmptyAppData());
  assert.equal(result.ok, true);
  assert.equal(result.data.version, 3);
  assert.equal(result.data.settings.lastLocalExportAt, null);
  assert.equal(result.data.settings.forecast.targetHours, 600);
  assert.deepEqual(result.data.forecastIntakes, []);
});

test('validateAppData: v1 payloads are still accepted (backwards-compat via migration)', () => {
  // v1 payloads don't carry lastLocalExportAt; the validator must still accept
  // them because the migration system is the one that upgrades them. This
  // guards the "validator before migration" load path from bouncing legacy
  // data.
  const v1 = {
    version: 1,
    settings: { supervisionRatio: 4, defaultKontingent: 60 },
    patients: [],
    sessions: [],
    supervisions: [],
    supervisionGroups: [],
  };
  const result = validateAppData(v1);
  assert.equal(result.ok, true);
});

test('validateAppData: settings.lastLocalExportAt accepts null and ISO string, rejects other types', () => {
  const base = createEmptyAppData();
  // null passes (default)
  assert.equal(validateAppData({ ...base, settings: { ...base.settings, lastLocalExportAt: null } }).ok, true);
  // ISO string passes
  assert.equal(validateAppData({ ...base, settings: { ...base.settings, lastLocalExportAt: '2026-04-08T12:00:00.000Z' } }).ok, true);
  // Number is rejected
  const bad = validateAppData({ ...base, settings: { ...base.settings, lastLocalExportAt: 12345 } });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /lastLocalExportAt/);
});

test('validateAppData accepts canonical fixture from §3', () => {
  const fixture = {
    version: 1,
    settings: { supervisionRatio: 4, defaultKontingent: 60 },
    patients: [
      { id: 'm3k7l2p9aq4xz', name: 'Max Mustermann', kuerzel: 'MM', kontingent: 60, startDate: '2026-01-15' },
    ],
    sessions: [
      { id: 'm3k7l9x1bt8kw', patientId: 'm3k7l2p9aq4xz', date: '2026-04-08', type: 'einzel', duration: 50, note: '' },
    ],
    supervisions: [
      { id: 'm3k7mab2cu7nr', patientIds: ['m3k7l2p9aq4xz'], date: '2026-04-07', type: 'gruppe', duration: 50, supervisor: 'Dr. Müller', note: '' },
    ],
    supervisionGroups: [
      { id: 'm3k7mcd4dv6os', name: 'Dienstags-SV Dr. Müller', supervisor: 'Dr. Müller', patientIds: ['m3k7l2p9aq4xz'] },
    ],
  };
  const result = validateAppData(fixture);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.patients, fixture.patients);
});

test('validateAppData rejects non-objects', () => {
  assert.equal(validateAppData(null).ok, false);
  assert.equal(validateAppData([]).ok, false);
  assert.equal(validateAppData('string').ok, false);
  assert.equal(validateAppData(42).ok, false);
});

test('validateAppData rejects session with bad enum type', () => {
  const bad = baseV1({
    patients: [{ id: 'abc123', name: 'X', kontingent: 60 }],
    sessions: [{ id: 'def456', patientId: 'abc123', date: '2026-01-01', type: 'invalid', duration: 50 }],
  });
  const r = validateAppData(bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /sessions\[0\]\.type/);
});

test('validateAppData rejects session with non-ISO date', () => {
  const bad = baseV1({
    patients: [{ id: 'abc123', name: 'X', kontingent: 60 }],
    sessions: [{ id: 'def456', patientId: 'abc123', date: '08.04.2026', type: 'einzel', duration: 50 }],
  });
  const r = validateAppData(bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /sessions\[0\]\.date/);
});

test('validateAppData rejects session with non-positive duration', () => {
  const bad = baseV1({
    patients: [{ id: 'abc123', name: 'X', kontingent: 60 }],
    sessions: [{ id: 'def456', patientId: 'abc123', date: '2026-01-01', type: 'einzel', duration: 0 }],
  });
  const r = validateAppData(bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /sessions\[0\]\.duration/);
});

test('validateAppData rejects patient with missing name', () => {
  const bad = baseV1({
    patients: [{ id: 'abc123', kontingent: 60 }],
  });
  const r = validateAppData(bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /patients\[0\]\.name/);
});

test('validateAppData allows empty supervision.patientIds (orphan) at the store level', () => {
  // Note: validateSupervisionRecord (per-record validator for saves) rejects
  // empty patientIds, but validateAppData (load-path validator) must still
  // accept them, because §3 explicitly allows orphaned supervisions in IDB
  // after cascading deletes.
  const good = baseV1({
    supervisions: [{ id: 'orphan1abc', patientIds: [], date: '2026-01-01', type: 'einzel', duration: 50 }],
  });
  const r = validateAppData(good);
  assert.equal(r.ok, true);
});

test('validateAppData strips unknown top-level fields', () => {
  const withExtra = baseV1({ unknownField: 'ignored' });
  const r = validateAppData(withExtra);
  assert.equal(r.ok, true);
  assert.equal('unknownField' in r.data, false);
});

test('validateAppData rejects bad ID pattern', () => {
  const bad = baseV1({
    patients: [{ id: 'UPPERCASE', name: 'X', kontingent: 60 }],
  });
  const r = validateAppData(bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /patients\[0\]\.id/);
});

test('validateAppData enforces max string length', () => {
  const longName = 'A'.repeat(501);
  const bad = baseV1({
    patients: [{ id: 'abc123', name: longName, kontingent: 60 }],
  });
  const r = validateAppData(bad);
  assert.equal(r.ok, false);
});

// ───── Strict v1 shape (regression from Codex review) ─────

test('validateAppData: v1 payload missing settings is rejected', () => {
  const bad = {
    version: 1,
    patients: [],
    sessions: [],
    supervisions: [],
    supervisionGroups: [],
  };
  const r = validateAppData(bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /settings/);
});

test('validateAppData: v1 payload with settings but missing supervisionRatio is rejected', () => {
  const bad = {
    version: 1,
    settings: { defaultKontingent: 60 },
    patients: [],
    sessions: [],
    supervisions: [],
    supervisionGroups: [],
  };
  const r = validateAppData(bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /settings\.supervisionRatio/);
});

test('validateAppData: v1 payload missing patients array is rejected', () => {
  const bad = {
    version: 1,
    settings: { supervisionRatio: 4, defaultKontingent: 60 },
    sessions: [],
    supervisions: [],
    supervisionGroups: [],
  };
  const r = validateAppData(bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /patients/);
});

test('validateAppData: v1 payload missing sessions is rejected', () => {
  const bad = {
    version: 1,
    settings: { supervisionRatio: 4, defaultKontingent: 60 },
    patients: [],
    supervisions: [],
    supervisionGroups: [],
  };
  const r = validateAppData(bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /sessions/);
});

test('validateAppData: v1 payload missing supervisions is rejected', () => {
  const bad = {
    version: 1,
    settings: { supervisionRatio: 4, defaultKontingent: 60 },
    patients: [],
    sessions: [],
    supervisionGroups: [],
  };
  const r = validateAppData(bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /supervisions/);
});

test('validateAppData: v1 payload missing supervisionGroups is rejected', () => {
  const bad = {
    version: 1,
    settings: { supervisionRatio: 4, defaultKontingent: 60 },
    patients: [],
    sessions: [],
    supervisions: [],
  };
  const r = validateAppData(bad);
  assert.equal(r.ok, false);
  assert.match(r.error, /supervisionGroups/);
});

test('validateAppData: legacy (no version) without settings still accepted (migration fills defaults)', () => {
  const legacy = {
    patients: [{ id: 'legacy01abc', name: 'Legacy', kontingent: 60 }],
    sessions: [],
  };
  const r = validateAppData(legacy);
  assert.equal(r.ok, true);
});

// ───── validateSessionRecord + validateSupervisionRecord ─────

test('validateSessionRecord accepts a well-formed record', () => {
  const ok = validateSessionRecord({
    id: 'm3k7l9x1bt8kw',
    patientId: 'm3k7l2p9aq4xz',
    date: '2026-04-08',
    type: 'einzel',
    duration: 50,
    note: '',
  });
  assert.equal(ok.ok, true);
});

test('validateSessionRecord rejects negative duration (regression: Codex review)', () => {
  const bad = validateSessionRecord({
    id: 'm3k7l9x1bt8kw',
    patientId: 'm3k7l2p9aq4xz',
    date: '2026-04-08',
    type: 'einzel',
    duration: -10,
    note: '',
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /duration/);
});

test('validateSessionRecord rejects zero duration', () => {
  const bad = validateSessionRecord({
    id: 'm3k7l9x1bt8kw',
    patientId: 'm3k7l2p9aq4xz',
    date: '2026-04-08',
    type: 'einzel',
    duration: 0,
    note: '',
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /duration/);
});

test('validateSessionRecord rejects NaN duration (empty-input case)', () => {
  const bad = validateSessionRecord({
    id: 'm3k7l9x1bt8kw',
    patientId: 'm3k7l2p9aq4xz',
    date: '2026-04-08',
    type: 'einzel',
    duration: NaN,
    note: '',
  });
  assert.equal(bad.ok, false);
});

test('validateSessionRecord rejects bad date format', () => {
  const bad = validateSessionRecord({
    id: 'm3k7l9x1bt8kw',
    patientId: 'm3k7l2p9aq4xz',
    date: 'not-a-date',
    type: 'einzel',
    duration: 50,
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /date/);
});

test('validateSessionRecord rejects empty date (browser returning empty string)', () => {
  const bad = validateSessionRecord({
    id: 'm3k7l9x1bt8kw',
    patientId: 'm3k7l2p9aq4xz',
    date: '',
    type: 'einzel',
    duration: 50,
  });
  assert.equal(bad.ok, false);
});

test('validateSessionRecord rejects bad enum type', () => {
  const bad = validateSessionRecord({
    id: 'm3k7l9x1bt8kw',
    patientId: 'm3k7l2p9aq4xz',
    date: '2026-04-08',
    type: 'gartenparty',
    duration: 50,
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /type/);
});

test('validateSupervisionRecord accepts a well-formed record', () => {
  const ok = validateSupervisionRecord({
    id: 'm3k7mab2cu7nr',
    patientIds: ['m3k7l2p9aq4xz'],
    date: '2026-04-07',
    type: 'gruppe',
    duration: 50,
    supervisor: 'Dr. Müller',
    note: '',
  });
  assert.equal(ok.ok, true);
});

test('validateSupervisionRecord rejects negative duration', () => {
  const bad = validateSupervisionRecord({
    id: 'm3k7mab2cu7nr',
    patientIds: ['m3k7l2p9aq4xz'],
    date: '2026-04-07',
    type: 'gruppe',
    duration: -50,
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /duration/);
});

test('validateSupervisionRecord rejects empty patientIds array', () => {
  const bad = validateSupervisionRecord({
    id: 'm3k7mab2cu7nr',
    patientIds: [],
    date: '2026-04-07',
    type: 'gruppe',
    duration: 50,
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /patientIds/);
});
