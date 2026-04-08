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

test('CURRENT_VERSION is 3', () => {
  assert.equal(CURRENT_VERSION, 3);
});

test('MIGRATIONS array has all steps in order', () => {
  assert.equal(MIGRATIONS.length, 3);
  assert.equal(MIGRATIONS[0].from, 0);
  assert.equal(MIGRATIONS[0].to, 1);
  assert.equal(MIGRATIONS[1].from, 1);
  assert.equal(MIGRATIONS[1].to, 2);
  assert.equal(MIGRATIONS[2].from, 2);
  assert.equal(MIGRATIONS[2].to, 3);
});

test('v0 fixture → CURRENT expected (legacy migration full chain)', () => {
  const input = readJsonFixture('appData-v0.json');
  const expected = readJsonFixture('appData-v3-expected.json');
  const result = runMigrations(input);
  assert.equal(result.ok, true, `migration failed: ${result.error || ''}`);
  assert.deepEqual(result.data, expected);
});

test('v0 with no settings field gets defaults and CURRENT-version fields', () => {
  const input = { patients: [], sessions: [] };
  const result = runMigrations(input);
  assert.equal(result.ok, true);
  assert.equal(result.data.version, CURRENT_VERSION);
  assert.equal(result.data.settings.supervisionRatio, 4);
  assert.equal(result.data.settings.defaultKontingent, 60);
  assert.equal(result.data.settings.lastLocalExportAt, null);
  // v3-Felder
  assert.equal(result.data.settings.forecast.abschlusskontrolleId, null);
  assert.equal(result.data.settings.forecast.targetHours, 600);
  assert.equal(result.data.settings.forecast.sickWeeksPerYear, 4);
  assert.equal(result.data.settings.forecast.vacationWeeksPerYear, 6);
  assert.equal(result.data.settings.forecast.dropoutRate, 0.30);
  assert.equal(result.data.settings.forecast.currentPatientCount, 0);
  assert.equal(result.data.settings.forecast.startDateOverride, null);
  assert.deepEqual(result.data.forecastIntakes, []);
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
  // Forecast-Defaults werden ergänzt, bestehende Settings bleiben.
  assert.equal(result.data.settings.forecast.targetHours, 600);
  assert.deepEqual(result.data.forecastIntakes, []);
});

test('v1 migrates through chain to CURRENT by adding lastLocalExportAt and forecast defaults', () => {
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
  assert.equal(result.data.version, CURRENT_VERSION);
  assert.equal(result.data.settings.lastLocalExportAt, null);
  // Other settings fields untouched.
  assert.equal(result.data.settings.supervisionRatio, 4);
  assert.equal(result.data.settings.defaultKontingent, 60);
  // v3-Felder ergänzt.
  assert.equal(result.data.settings.forecast.targetHours, 600);
  assert.equal(result.data.settings.forecast.dropoutRate, 0.30);
  assert.deepEqual(result.data.forecastIntakes, []);
});

test('v1 → CURRENT preserves DSGVO-Zustimmung und andere Settings', () => {
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
  assert.equal(result.data.settings.forecast.targetHours, 600);
});

test('v1 → CURRENT preserves existing lastLocalExportAt if already set', () => {
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
  assert.equal(result.data.version, CURRENT_VERSION);
  assert.equal(result.data.settings.lastLocalExportAt, iso);
});

test('v2 migrates to v3 by adding forecast defaults and empty forecastIntakes', () => {
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
  assert.equal(result.data.version, 3);
  // Kernfelder unverändert.
  assert.equal(result.data.settings.supervisionRatio, 4);
  assert.equal(result.data.settings.defaultKontingent, 60);
  assert.equal(result.data.settings.lastLocalExportAt, null);
  // Neue Forecast-Defaults.
  assert.deepEqual(result.data.settings.forecast, {
    abschlusskontrolleId: null,
    targetHours: 600,
    sickWeeksPerYear: 4,
    vacationWeeksPerYear: 6,
    dropoutRate: 0.30,
    currentPatientCount: 0,
    startDateOverride: null,
  });
  assert.deepEqual(result.data.forecastIntakes, []);
});

test('v2 → v3 preserves partial pre-existing forecast values', () => {
  // Defensive: wenn ein Fremd-Schreiber bereits ein forecast-Feld setzt,
  // darf die Migration es nicht überschreiben. Ungültige/fehlende Einzelfelder
  // werden auf Defaults zurückgesetzt, valide bleiben erhalten.
  const input = {
    version: 2,
    settings: {
      supervisionRatio: 4,
      defaultKontingent: 60,
      lastLocalExportAt: null,
      forecast: {
        abschlusskontrolleId: 'hb-2028',
        targetHours: 540,
        dropoutRate: 0.25,
        // sickWeeksPerYear/vacationWeeksPerYear/currentPatientCount fehlen
      },
    },
    patients: [],
    sessions: [],
    supervisions: [],
    supervisionGroups: [],
  };
  const result = runMigrations(input);
  assert.equal(result.ok, true);
  assert.equal(result.data.settings.forecast.abschlusskontrolleId, 'hb-2028');
  assert.equal(result.data.settings.forecast.targetHours, 540);
  assert.equal(result.data.settings.forecast.dropoutRate, 0.25);
  assert.equal(result.data.settings.forecast.sickWeeksPerYear, 4);
  assert.equal(result.data.settings.forecast.vacationWeeksPerYear, 6);
  assert.equal(result.data.settings.forecast.currentPatientCount, 0);
});

test('v3 is a no-op', () => {
  const input = {
    version: 3,
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
  assert.equal(migration.data.version, CURRENT_VERSION);
  assert.equal(migration.data.settings.lastLocalExportAt, null);
  assert.equal(migration.data.settings.forecast.targetHours, 600);
  assert.deepEqual(migration.data.forecastIntakes, []);
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
