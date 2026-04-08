import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gotoApp } from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Migration Legacy-Single-File-HTML → CURRENT', () => {

  test.beforeEach(async ({ page }) => {
    await gotoApp(page);
  });

  test('Legacy-Export kann über Import-UI geladen und migriert werden', async ({ page }) => {
    const fixturePath = path.join(__dirname, 'fixtures', 'legacy-single-file-export.json');
    expect(fs.existsSync(fixturePath)).toBeTruthy();
    const legacy = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    expect(legacy.version).toBeUndefined(); // truly legacy (no version field)

    await page.getByRole('button', { name: 'Daten' }).click();
    await page.locator('#import-file').setInputFiles(fixturePath);

    // Bestätigungsdialog
    await expect(page.getByText(`Import: ${legacy.patients.length} Patienten`)).toBeVisible();
    await page.getByRole('button', { name: 'Bestätigen' }).click();
    await expect(page.getByText('Daten erfolgreich importiert!')).toBeVisible();

    // Schema-Version nach Import entspricht der aktuellen CURRENT_VERSION
    // (wird beim Bump in migrations.js automatisch mitaktualisiert).
    const version = await page.evaluate(() => (window as any).__nempstiGetAppData().version);
    expect(version).toBe(3);

    // Alle Kern-Entitäten sind erhalten.
    const counts = await page.evaluate(() => {
      const d = (window as any).__nempstiGetAppData();
      return {
        patients: d.patients.length,
        sessions: d.sessions.length,
        supervisions: d.supervisions.length,
        supervisionGroups: d.supervisionGroups.length,
      };
    });
    expect(counts.patients).toBe(legacy.patients.length);
    expect(counts.sessions).toBe(legacy.sessions.length);
    expect(counts.supervisions).toBe(legacy.supervisions.length);
    expect(counts.supervisionGroups).toBe(legacy.supervisionGroups.length);

    // Patientennamen werden im Dashboard sichtbar.
    await page.getByRole('button', { name: 'Dashboard' }).click();
    await expect(page.locator('#dashboard-patient-list').getByText('Anna Anfänger')).toBeVisible();
    await expect(page.locator('#dashboard-patient-list').getByText('Bernd Behandlung')).toBeVisible();

    // Gruppen sind im Gruppen-Tab sichtbar.
    await page.getByRole('button', { name: 'Gruppen' }).click();
    await expect(page.getByText('Dienstags-SV Dr. Müller')).toBeVisible();
  });

  test('Ungültige JSON-Datei wird abgelehnt', async ({ page }) => {
    const tmp = path.join(__dirname, '_invalid-import.json');
    fs.writeFileSync(
      tmp,
      JSON.stringify({ patients: [{ id: 'bad', name: 'X' /* missing kontingent OK */ }], sessions: [{ id: 'bad', patientId: 'bad', date: 'not-a-date', type: 'einzel', duration: 50 }] })
    );
    try {
      await page.getByRole('button', { name: 'Daten' }).click();
      await page.locator('#import-file').setInputFiles(tmp);
      // Toast indicating invalid input (validation error message may vary).
      await expect(page.getByText(/Ungültige Datei:/)).toBeVisible();
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
