import { test, expect } from '@playwright/test';
import { gotoApp, createPatient, createSession, openPatientDetail } from './helpers';

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test.describe('Patienten CRUD', () => {

  test('Patient anlegen und im Dashboard sehen', async ({ page }) => {
    await createPatient(page, 'Anna Testperson', 'AT');

    const dashboardList = page.locator('#dashboard-patient-list');
    await expect(dashboardList.getByText('Anna Testperson')).toBeVisible();
    await expect(dashboardList.getByText('(AT)')).toBeVisible();
  });

  test('Behandlungssitzung anlegen und Stundenzähler prüfen', async ({ page }) => {
    await createPatient(page, 'Bernd Beispiel');
    await createSession(page, '2026-03-01');

    const statsGrid = page.locator('#stats-grid');
    await expect(statsGrid.getByText('1.0')).toBeVisible();
  });

  test('Patientendetail zeigt Sitzungen und Supervision', async ({ page }) => {
    await createPatient(page, 'Clara Detail');
    await openPatientDetail(page, 'Clara Detail');

    await expect(page.getByText('Supervisionsverhältnis (1:4)')).toBeVisible();
    await expect(page.getByText('Behandlungssitzungen (0)')).toBeVisible();
    await expect(page.getByText('Supervisionsstunden (0)')).toBeVisible();

    // Sitzung aus Detailansicht anlegen
    await page.getByRole('button', { name: '+ Sitzung' }).click();
    await page.locator('#session-date').fill('2026-02-10');
    await page.getByRole('button', { name: 'Sitzung speichern' }).click();

    await expect(page.getByText('Behandlungssitzungen (1)')).toBeVisible();
    await expect(page.getByText('10.02.2026')).toBeVisible();
  });

  test('Validation: Patient ohne Name wird abgelehnt', async ({ page }) => {
    await page.getByRole('button', { name: '+' }).click();
    await page.getByRole('button', { name: 'Neuer Patient' }).click();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Bitte einen Namen eingeben')).toBeVisible();
  });
});
