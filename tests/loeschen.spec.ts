import { test, expect } from '@playwright/test';
import { gotoApp, createPatient, openPatientDetail } from './helpers';

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test.describe('Löschen mit Bestätigung', () => {

  test('Patient löschen mit Bestätigungsdialog', async ({ page }) => {
    await createPatient(page, 'Lösch-Test Patient');
    await openPatientDetail(page, 'Lösch-Test Patient');

    await page.getByRole('button', { name: 'Löschen' }).click();

    await expect(page.getByRole('heading', { name: 'Bestätigung' })).toBeVisible();
    await expect(page.getByText('Patient und alle zugehörigen Sitzungen wirklich löschen?')).toBeVisible();

    await page.getByRole('button', { name: 'Bestätigen' }).click();

    await expect(page.getByText('Tippe auf + um einen neuen Patienten hinzuzufügen')).toBeVisible();
  });

  test('Abbrechen im Bestätigungsdialog bricht Löschung ab', async ({ page }) => {
    await createPatient(page, 'Nicht-Löschen Patient');
    await openPatientDetail(page, 'Nicht-Löschen Patient');

    await page.getByRole('button', { name: 'Löschen' }).click();
    await page.getByRole('button', { name: 'Abbrechen' }).click();

    await expect(page.getByRole('heading', { name: 'Nicht-Löschen Patient' })).toBeVisible();
  });

  test('Alle Daten löschen mit doppelter Bestätigung', async ({ page }) => {
    await createPatient(page, 'Wird-Gelöscht');

    await page.getByRole('button', { name: 'Daten' }).click();
    await page.getByRole('button', { name: 'Alle Daten löschen' }).click();

    await expect(page.getByText('ACHTUNG: Alle Daten werden unwiderruflich gelöscht!')).toBeVisible();
    await page.getByRole('button', { name: 'Bestätigen' }).click();
    await expect(page.getByText('Alle Daten gelöscht.')).toBeVisible();

    await page.getByRole('button', { name: 'Dashboard' }).click();
    await expect(page.getByText('Tippe auf + um zu starten.')).toBeVisible();
  });
});
