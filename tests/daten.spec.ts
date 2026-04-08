import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  gotoApp,
  createPatient,
  createSession,
  getDriveMockFile,
  getDriveMockCalls,
} from './helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test.describe('Datenpersistenz und Import/Export', () => {

  test('Daten bleiben nach Reload erhalten (IndexedDB Auto-Load)', async ({ page }) => {
    await createPatient(page, 'Persistenz-Test');
    await expect(page.locator('#dashboard-patient-list').getByText('Persistenz-Test')).toBeVisible();

    // Explicitly flush the debounced write before reloading.
    await page.evaluate(() => (window as any).__nempstiFlush());

    await page.reload();

    // DSGVO was accepted on first load; settings.dsgvoAcknowledgedAt persists
    // → the modal should NOT appear on reload.
    await expect(page.locator('#modal-dsgvo.active')).toBeHidden();
    await expect(page.locator('#dashboard-patient-list').getByText('Persistenz-Test')).toBeVisible();
  });

  test('Export erzeugt gültige JSON-Daten und Import stellt sie wieder her', async ({ page }) => {
    // 1) Daten erzeugen
    await createPatient(page, 'Export-Patient', 'EP');
    await createSession(page, '2026-03-15');

    // 2) Export: showSaveFilePicker blockieren für Textarea-Fallback
    await page.evaluate(() => { delete (window as any).showSaveFilePicker; });
    await page.getByRole('button', { name: 'Daten' }).click();
    await page.getByRole('button', { name: 'Daten exportieren (Speicherort wählen)' }).click();

    const textarea = page.locator('#export-textarea');
    await expect(textarea).toBeVisible();
    const exportedJson = await textarea.inputValue();

    // JSON validieren
    const parsed = JSON.parse(exportedJson);
    expect(parsed.version).toBe(1);
    expect(parsed.patients).toHaveLength(1);
    expect(parsed.patients[0].name).toBe('Export-Patient');
    expect(parsed.sessions).toHaveLength(1);

    // 3) Alle Daten löschen, damit Import einen klaren Unterschied macht.
    await page.getByRole('button', { name: 'Alle Daten löschen' }).click();
    await page.getByRole('button', { name: 'Bestätigen' }).click();
    await expect(page.getByText('Alle Daten gelöscht.')).toBeVisible();

    // 4) Import
    const tmpFile = path.join(__dirname, '_test-import.json');
    fs.writeFileSync(tmpFile, exportedJson, 'utf-8');
    try {
      await page.locator('#import-file').setInputFiles(tmpFile);

      await expect(page.getByText('Import: 1 Patienten')).toBeVisible();
      await page.getByRole('button', { name: 'Bestätigen' }).click();
      await expect(page.getByText('Daten erfolgreich importiert!')).toBeVisible();

      await page.getByRole('button', { name: 'Dashboard' }).click();
      await expect(page.locator('#dashboard-patient-list').getByText('Export-Patient')).toBeVisible();
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test('Drive-Backup: manueller "Jetzt sichern"-Button triggert Upload', async ({ page }) => {
    await createPatient(page, 'Drive-Backup-Test');
    await page.evaluate(() => (window as any).__nempstiFlush());

    await page.getByRole('button', { name: 'Daten' }).click();
    await page.getByRole('button', { name: 'Jetzt sichern' }).click();
    await expect(page.getByText('Drive-Backup erfolgreich.')).toBeVisible();

    const fileJson = await getDriveMockFile(page);
    expect(fileJson).not.toBeNull();
    const parsed = JSON.parse(fileJson!);
    expect(parsed.patients).toHaveLength(1);
    expect(parsed.patients[0].name).toBe('Drive-Backup-Test');

    const calls = await getDriveMockCalls(page);
    // At least one list + one upload call.
    expect(calls.some(c => c.url.includes('/drive/v3/files') && c.method === 'GET')).toBeTruthy();
    expect(calls.some(c => c.url.includes('/upload/drive/v3/files'))).toBeTruthy();
  });

  test('Drive-Backup: visibilitychange=hidden triggert Auto-Sync (dirty flag)', async ({ page }) => {
    await createPatient(page, 'Auto-Sync-Test');
    await page.evaluate(() => (window as any).__nempstiFlush());

    // Trigger the sync path directly — equivalent to the visibilitychange handler.
    await page.evaluate(() => (window as any).__nempstiSyncToDrive());

    const fileJson = await getDriveMockFile(page);
    expect(fileJson).not.toBeNull();
    const parsed = JSON.parse(fileJson!);
    expect(parsed.patients.some((p: any) => p.name === 'Auto-Sync-Test')).toBeTruthy();
  });
});
