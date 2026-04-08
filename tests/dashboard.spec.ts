import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers';

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test.describe('Dashboard & Navigation', () => {

  test('App lädt und zeigt Header + alle Tabs', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Patientenstunden-Tracker' })).toBeVisible();
    for (const tab of ['Dashboard', 'Patienten', 'Supervision', 'Gruppen', 'Daten']) {
      await expect(page.getByRole('button', { name: tab })).toBeVisible();
    }
  });

  test('Dashboard zeigt Statistik-Karten im Ausgangszustand', async ({ page }) => {
    await expect(page.getByText('Patienten-Übersicht')).toBeVisible();
    await expect(page.getByText('Behandlungsstd.')).toBeVisible();
    await expect(page.getByText('Supervisionsstd.')).toBeVisible();
    await expect(page.getByText('Tippe auf + um zu starten.')).toBeVisible();
  });

  test('FAB-Button öffnet Hinzufügen-Modal', async ({ page }) => {
    await page.getByRole('button', { name: '+' }).click();
    await expect(page.getByRole('heading', { name: 'Hinzufügen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Neuer Patient' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Neue Behandlungssitzung' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Neue Supervisionsstunde' })).toBeVisible();
  });

  test('Tab-Navigation funktioniert', async ({ page }) => {
    await page.getByRole('button', { name: 'Patienten' }).click();
    await expect(page.getByText('Tippe auf + um einen neuen Patienten hinzuzufügen')).toBeVisible();

    await page.getByRole('button', { name: 'Gruppen' }).click();
    await expect(page.getByText('Supervisionsgruppen', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Daten' }).click();
    await expect(page.getByText('Daten exportieren', { exact: true })).toBeVisible();
    await expect(page.getByText('Daten importieren', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alle Daten löschen' })).toBeVisible();

    await page.getByRole('button', { name: 'Dashboard' }).click();
    await expect(page.getByText('Patienten-Übersicht')).toBeVisible();
  });
});
