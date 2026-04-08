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

test('CURRENT_VERSION is 1', () => {
  assert.equal(CURRENT_VERSION, 1);
});

test('MIGRATIONS array is not empty and starts at 0→1', () => {
  assert.ok(MIGRATIONS.length >= 1);
  assert.equal(MIGRATIONS[0].from, 0);
  assert.equal(MIGRATIONS[0].to, 1);
});

test('v0 fixture → v1 expected (legacy migration)', () => {
  const input = readJsonFixture('appData-v0.json');
  const expected = readJsonFixture('appData-v1-expected.json');
  const result = runMigrations(input);
  assert.equal(result.ok, true, `migration failed: ${result.error || ''}`);
  assert.deepEqual(result.data, expected);
});

test('v0 with no settings field gets defaults', () => {
  const input = { patients: [], sessions: [] };
  const result = runMigrations(input);
  assert.equal(result.ok, true);
  assert.equal(result.data.version, 1);
  assert.equal(result.data.settings.supervisionRatio, 4);
  assert.equal(result.data.settings.defaultKontingent, 60);
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
});

test('v1 is a no-op', () => {
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
  assert.deepEqual(result.data, input);
});

test('version > CURRENT_VERSION is rejected', () => {
  const input = {
    version: 999,
    settings: { supervisionRatio: 4, defaultKontingent: 60 },
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
  assert.equal(migration.data.version, 1);
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

test('round-trip: v0 → v1 → no-op on subsequent migration', () => {
  const v0 = readJsonFixture('appData-v0.json');
  const first = runMigrations(v0);
  assert.equal(first.ok, true);
  const second = runMigrations(first.data);
  assert.equal(second.ok, true);
  assert.deepEqual(second.data, first.data);
});
