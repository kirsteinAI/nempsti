// Unit tests for migrations.js
// Run with: node --test tests/unit/migrations.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations, CURRENT_VERSION, MIGRATIONS } from '../../migrations.js';
import { validateAppData } from '../../validation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

function readJsonFixture(name) {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));
}

test('CURRENT_VERSION is 2', () => {
  assert.equal(CURRENT_VERSION, 2);
});

test('MIGRATIONS array has both steps in order', () => {
  assert.equal(MIGRATIONS.length, 2);
  assert.equal(MIGRATIONS[0].from, 0);
  assert.equal(MIGRATIONS[0].to, 1);
  assert.equal(MIGRATIONS[1].from, 1);
  assert.equal(MIGRATIONS[1].to, 2);
});

test('v0 fixture → CURRENT expected (legacy migration full chain)', () => {
  const input = readJsonFixture('appData-v0.json');
  const expected = readJsonFixture('appData-v2-expected.json');
  const result = runMigrations(input);
  assert.equal(result.ok, true, `migration failed: ${result.error || ''}`);
  assert.deepEqual(result.data, expected);
});

test('v0 with no settings field gets defaults and v2 fields', () => {
  const input = { patients: [], sessions: [] };
  const result = runMigrations(input);
  assert.equal(result.ok, true);
  assert.equal(result.data.version, 2);
  assert.equal(result.data.settings.supervisionRatio, 4);
  assert.equal(result.data.settings.defaultKontingent, 60);
  assert.equal(result.data.settings.lastLocalExportAt, null);
  assert.deepEqual(result.data.supervisions, []);
  assert.deepEqual(result.data.supervisionGroups, []);
});

test('v0 preserves existing settings values', () => {
  const input = {
    settings: { supervisionRatio: 5, defaultKontingent: 24 },
    patients: [],
    sessions: [],
  };
  const result = runMigrations(input);
  assert.equal(result.ok, true);
  assert.equal(result.data.settings.supervisionRatio, 5);
  assert.equal(result.data.settings.defaultKontingent, 24);
  assert.equal(result.data.settings.lastLocalExportAt, null);
});

test('v1 migrates to v2 by adding lastLocalExportAt: null', () => {
  const input = {
    version: 1,
    settings: { supervisionRatio: 4, defaultKontingent: 60 },
    patients: [],
    sessions: [],
    supervisions: [],
    supervisionGroups: [],
  };
  const result = runMigrations(input);
  assert.equal(result.ok, true);
  assert.equal(result.data.version, 2);
  assert.equal(result.data.settings.lastLocalExportAt, null);
  // Other settings fields untouched.
  assert.equal(result.data.settings.supervisionRatio, 4);
  assert.equal(result.data.settings.defaultKontingent, 60);
});

test('v1 → v2 preserves DSGVO-Zustimmung und andere Settings', () => {
  const input = {
    version: 1,
    settings: {
      supervisionRatio: 4,
      defaultKontingent: 60,
      dsgvoAcknowledgedAt: '2026-01-15T10:20:30.000Z',
    },
    patients: [],
    sessions: [],
    supervisions: [],
    supervisionGroups: [],
  };
  const result = runMigrations(input);
  assert.equal(result.ok, true);
  assert.equal(result.data.settings.dsgvoAcknowledgedAt, '2026-01-15T10:20:30.000Z');
  assert.equal(result.data.settings.lastLocalExportAt, null);
});

test('v1 → v2 preserves existing lastLocalExportAt if already set', () => {
  // Verteidigung gegen Fremd-Schreiber (Drive-Import einer v1-Datei, die
  // manuell ein lastLocalExportAt gesetzt hat, bevor die App es selbst kannte).
  const iso = '2026-03-20T12:00:00.000Z';
  const input = {
    version: 1,
    settings: { supervisionRatio: 4, defaultKontingent: 60, lastLocalExportAt: iso },
    patients: [],
    sessions: [],
    supervisions: [],
    supervisionGroups: [],
  };
  const result = runMigrations(input);
  assert.equal(result.ok, true);
  assert.equal(result.data.version, 2);
  assert.equal(result.data.settings.lastLocalExportAt, iso);
});

test('v2 is a no-op', () => {
  const input = {
    version: 2,
    settings: { supervisionRatio: 4, defaultKontingent: 60, lastLocalExportAt: null },
    patients: [],
    sessions: [],
    supervisions: [],
    supervisionGroups: [],
  };
  const result = runMigrations(input);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, input);
});

test('version > CURRENT_VERSION is rejected', () => {
  const input = {
    version: 999,
    settings: { supervisionRatio: 4, defaultKontingent: 60, lastLocalExportAt: null },
    patients: [],
    sessions: [],
    supervisions: [],
    supervisionGroups: [],
  };
  const result = runMigrations(input);
  assert.equal(result.ok, false);
  assert.ok(result.rollback);
  assert.match(result.error, /CURRENT_VERSION/);
});

test('legacy fixture (full shape) migrates + validates', () => {
  const legacy = readJsonFixture('legacy-single-file-export.json');
  const migration = runMigrations(legacy);
  assert.equal(migration.ok, true);
  const validation = validateAppData(migration.data);
  assert.equal(validation.ok, true, `validation failed: ${validation.error || ''}`);
  assert.equal(migration.data.version, 2);
  assert.equal(migration.data.settings.lastLocalExportAt, null);
  assert.equal(migration.data.patients.length, 2);
  assert.equal(migration.data.sessions.length, 3);
  assert.equal(migration.data.supervisions.length, 1);
  assert.equal(migration.data.supervisionGroups.length, 1);
});

test('migration does not mutate the input', () => {
  const input = readJsonFixture('appData-v0.json');
  const snapshot = JSON.parse(JSON.stringify(input));
  runMigrations(input);
  assert.deepEqual(input, snapshot);
});

test('round-trip: v0 → CURRENT → no-op on subsequent migration', () => {
  const v0 = readJsonFixture('appData-v0.json');
  const first = runMigrations(v0);
  assert.equal(first.ok, true);
  const second = runMigrations(first.data);
  assert.equal(second.ok, true);
  assert.deepEqual(second.data, first.data);
});
