import { test, expect } from '@playwright/test';
import { gotoApp, createPatient, openPatientDetail } from './helpers';

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test.describe('Grenzwerte bei Eingaben', () => {

  test('Sehr langer Patientenname wird akzeptiert und angezeigt', async ({ page }) => {
    const longName = 'A'.repeat(200);
    await createPatient(page, longName);

    const dashboardList = page.locator('#dashboard-patient-list');
    await expect(dashboardList.getByText(longName)).toBeVisible();
  });

  test('Sonderzeichen im Patientennamen werden korrekt angezeigt (kein XSS)', async ({ page }) => {
    const xssName = '<script>alert("xss")</script>Müller-O\'Brien & Söhne "Test"';
    await createPatient(page, xssName);

    const dashboardList = page.locator('#dashboard-patient-list');
    await expect(dashboardList.getByText(xssName)).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Patientenstunden-Tracker' })).toBeVisible();
  });

  test('Umlaute und Unicode im Patientennamen', async ({ page }) => {
    await createPatient(page, 'Ätherisch Über-Örtliche Straße 日本語');

    const dashboardList = page.locator('#dashboard-patient-list');
    await expect(dashboardList.getByText('Ätherisch Über-Örtliche Straße 日本語')).toBeVisible();
  });

  test('Kontingent mit extremen Werten', async ({ page }) => {
    await page.getByRole('button', { name: '+' }).click();
    await page.getByRole('button', { name: 'Neuer Patient' }).click();
    await page.getByPlaceholder('z.B. Max Mustermann').fill('Extrem-Patient');
    await page.locator('#patient-kontingent').fill('9999');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Patient gespeichert!')).toBeVisible();

    await openPatientDetail(page, 'Extrem-Patient');
    await expect(page.getByText('von 9999 Stunden')).toBeVisible();
  });

  test('Kontingent 0 und negative Werte', async ({ page }) => {
    await page.getByRole('button', { name: '+' }).click();
    await page.getByRole('button', { name: 'Neuer Patient' }).click();
    await page.getByPlaceholder('z.B. Max Mustermann').fill('Null-Kontingent');
    await page.locator('#patient-kontingent').fill('0');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Patient gespeichert!')).toBeVisible();
  });

  test('Doppelsitzung (100 Min.) zählt als 2 Stunden', async ({ page }) => {
    await createPatient(page, 'Doppel-Test');

    await page.getByRole('button', { name: '+' }).click();
    await page.getByRole('button', { name: 'Neue Behandlungssitzung' }).click();
    await page.locator('#session-date').fill('2026-04-01');
    await page.locator('#session-type').selectOption('doppel');
    await page.locator('#session-duration').fill('100');
    await page.getByRole('button', { name: 'Sitzung speichern' }).click();

    const statsGrid = page.locator('#stats-grid');
    await expect(statsGrid.getByText('2.0')).toBeVisible();
  });

  // ───── §6.1 XSS-Batterie (Pflicht laut Plan) ─────
  const xssPayloads = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '"><svg onload=alert(1)>',
    'javascript:alert(1)',
    '\'); alert(1);//',
    '<iframe src="javascript:alert(1)"></iframe>',
  ];

  for (const [index, payload] of xssPayloads.entries()) {
    test(`XSS-Schutz: Patientenname payload #${index + 1}`, async ({ page }) => {
      // Install a page-level error listener that fails the test if alert() fires.
      const dialogs: string[] = [];
      page.on('dialog', async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.dismiss();
      });

      await createPatient(page, payload);

      // The raw payload must appear as visible text (= HTML-escaped, not executed).
      const dashboardList = page.locator('#dashboard-patient-list');
      await expect(dashboardList.getByText(payload)).toBeVisible();

      // No dialog should have been triggered.
      expect(dialogs, 'XSS payload must not trigger any alert/dialog').toHaveLength(0);
    });
  }

  test('XSS-Schutz: Notiz-Feld in Sitzung', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });

    await createPatient(page, 'XSS-Notiz');
    await openPatientDetail(page, 'XSS-Notiz');
    await page.getByRole('button', { name: '+ Sitzung' }).click();
    await page.locator('#session-date').fill('2026-03-01');
    const noteXss = '<img src=x onerror=alert("note-xss")>';
    await page.locator('#session-note').fill(noteXss);
    await page.getByRole('button', { name: 'Sitzung speichern' }).click();

    await expect(page.getByText(noteXss)).toBeVisible();
    expect(dialogs).toHaveLength(0);
  });

  // ───── Numeric input boundaries (regression: Codex review) ─────
  // UI save paths must never persist invalid durations into canonical state.
  // `min="1"` on the HTML input is decoration, not a trust boundary.

  test('Session save: negative Dauer wird abgelehnt (nichts persistiert)', async ({ page }) => {
    await createPatient(page, 'Negative-Dauer-Test');

    await page.getByRole('button', { name: '+' }).click();
    await page.getByRole('button', { name: 'Neue Behandlungssitzung' }).click();
    await page.locator('#session-date').fill('2026-04-01');
    // Browser may enforce min via the spinner, but we can fill arbitrary text
    // or use evaluate to bypass the DOM validity check.
    await page.locator('#session-duration').evaluate((el: HTMLInputElement) => { el.value = '-10'; });
    await page.getByRole('button', { name: 'Sitzung speichern' }).click();

    await expect(page.getByText(/Ungültige Sitzung:/)).toBeVisible();

    // Nothing persisted: state has zero sessions.
    const sessionCount = await page.evaluate(() => (window as any).__nempstiGetAppData().sessions.length);
    expect(sessionCount).toBe(0);

    // Modal is still open so the user can correct the value.
    await expect(page.locator('#modal-session.active')).toBeVisible();
  });

  test('Session save: Dauer 0 wird abgelehnt', async ({ page }) => {
    await createPatient(page, 'Null-Dauer-Test');
    await page.getByRole('button', { name: '+' }).click();
    await page.getByRole('button', { name: 'Neue Behandlungssitzung' }).click();
    await page.locator('#session-date').fill('2026-04-01');
    await page.locator('#session-duration').evaluate((el: HTMLInputElement) => { el.value = '0'; });
    await page.getByRole('button', { name: 'Sitzung speichern' }).click();

    await expect(page.getByText(/Ungültige Sitzung:/)).toBeVisible();
    const sessionCount = await page.evaluate(() => (window as any).__nempstiGetAppData().sessions.length);
    expect(sessionCount).toBe(0);
  });

  test('Session save: leere Dauer wird abgelehnt', async ({ page }) => {
    await createPatient(page, 'Leere-Dauer-Test');
    await page.getByRole('button', { name: '+' }).click();
    await page.getByRole('button', { name: 'Neue Behandlungssitzung' }).click();
    await page.locator('#session-date').fill('2026-04-01');
    await page.locator('#session-duration').evaluate((el: HTMLInputElement) => { el.value = ''; });
    await page.getByRole('button', { name: 'Sitzung speichern' }).click();

    await expect(page.getByText(/Ungültige Sitzung:/)).toBeVisible();
    const sessionCount = await page.evaluate(() => (window as any).__nempstiGetAppData().sessions.length);
    expect(sessionCount).toBe(0);
  });

  test('Supervision save: negative Dauer wird abgelehnt', async ({ page }) => {
    await createPatient(page, 'Neg-Sup-Test');
    await openPatientDetail(page, 'Neg-Sup-Test');
    await page.getByRole('button', { name: '+ Supervision' }).click();
    await page.locator('#supervision-date').fill('2026-04-01');
    await page.locator('#supervision-duration').evaluate((el: HTMLInputElement) => { el.value = '-5'; });
    await page.getByRole('button', { name: 'Supervision speichern' }).click();

    await expect(page.getByText(/Ungültige Supervision:/)).toBeVisible();
    const svCount = await page.evaluate(() => (window as any).__nempstiGetAppData().supervisions.length);
    expect(svCount).toBe(0);
  });

  test('Session save: leeres Datum wird abgelehnt (Safari-Fall ohne native Date-UI)', async ({ page }) => {
    await createPatient(page, 'Leer-Datum-Test');
    await page.getByRole('button', { name: '+' }).click();
    await page.getByRole('button', { name: 'Neue Behandlungssitzung' }).click();
    // openSessionModal() seeds today's date by default — explicitly blank it
    // to mimic the Safari case where <input type="date"> passes through the
    // raw empty string without browser-level enforcement.
    await page.locator('#session-date').evaluate((el: HTMLInputElement) => { el.value = ''; });
    await page.locator('#session-duration').evaluate((el: HTMLInputElement) => { el.value = '50'; });
    await page.getByRole('button', { name: 'Sitzung speichern' }).click();

    await expect(page.getByText(/Ungültige Sitzung:/)).toBeVisible();
    const sessionCount = await page.evaluate(() => (window as any).__nempstiGetAppData().sessions.length);
    expect(sessionCount).toBe(0);
  });

  test('XSS-Schutz: Supervisor-Feld in Supervisionsstunde', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });

    await createPatient(page, 'XSS-Sup');
    await openPatientDetail(page, 'XSS-Sup');
    await page.getByRole('button', { name: '+ Supervision' }).click();
    await page.locator('#supervision-date').fill('2026-03-01');
    const svXss = '"><svg onload=alert(1)>';
    await page.locator('#supervision-supervisor').fill(svXss);
    await page.getByRole('button', { name: 'Supervision speichern' }).click();

    await page.locator('.tab-btn[data-tab="supervision"]').click();
    await expect(page.locator('#supervision-overview').getByText(svXss)).toBeVisible();
    expect(dialogs).toHaveLength(0);
  });
});
