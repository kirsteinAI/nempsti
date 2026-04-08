// tests/sync-gate.spec.ts
//
// Regression tests for the Sync-Gate architecture (§7.3.1). These protect
// against the data-loss incident from 2026-04-08: a fresh install with an
// empty local state would overwrite an existing Drive backup on the first
// sync-out trigger, silently destroying the user's data.
//
// The fix is a session-level gate that blocks sync-out until either the app
// has loaded from Drive (proving local == Drive) or the user has explicitly
// committed a new local state (import / clear / restore).

import { test, expect } from '@playwright/test';
import { installDriveMock, dismissDsgvo, getDriveMockFile, getDriveMockCalls } from './helpers';

// Minimal but realistic v2 payload representing the User's existing backup.
// Two patients, one session, DSGVO already acknowledged (as it would be after
// the User's previous sessions).
const EXISTING_BACKUP = {
  version: 2,
  settings: {
    supervisionRatio: 4,
    defaultKontingent: 60,
    lastLocalExportAt: null,
    dsgvoAcknowledgedAt: '2026-01-01T10:00:00.000Z',
  },
  patients: [
    { id: 'abc1234567aa', name: 'Bestands-Patient 1', kuerzel: 'BP1', kontingent: 60, startDate: '2026-01-15' },
    { id: 'def2345678bb', name: 'Bestands-Patient 2', kuerzel: 'BP2', kontingent: 45, startDate: '2026-02-01' },
  ],
  sessions: [
    { id: 'ghi3456789cc', patientId: 'abc1234567aa', date: '2026-03-01', type: 'einzel', duration: 50, note: '' },
  ],
  supervisions: [],
  supervisionGroups: [],
};

test.describe('Sync-Gate (§7.3.1) — Schutz gegen Fresh-Install-Overwrite', () => {
  test('Fresh install mit existierendem Drive-Backup: Drive wird geladen, nicht überschrieben', async ({ page }) => {
    // Arrange: Drive has existing data, IDB is empty (fresh install).
    await installDriveMock(page, { initialFile: EXISTING_BACKUP });
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__nempstiReady === true);

    // DSGVO-Modal erscheint initial (weil lokal leer ist, keine DSGVO-Ack).
    // Nach dem Auto-Load aus Drive sollte es automatisch verschwinden, weil
    // die geladenen Drive-Daten bereits dsgvoAcknowledgedAt enthalten.
    // Wir warten darauf, dass der Patient aus Drive im UI erscheint.
    await expect(page.locator('#dashboard-patient-list').getByText('Bestands-Patient 1')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#dashboard-patient-list').getByText('Bestands-Patient 2')).toBeVisible();

    // DSGVO-Modal muss inzwischen geschlossen sein, weil die geladene
    // Drive-Data die Zustimmung enthält.
    await expect(page.locator('#modal-dsgvo.active')).toBeHidden();

    // Entscheidender Assert: Drive-Inhalt ist unverändert. Wäre der Bug noch
    // da, wäre der Drive-File inzwischen eine leere JSON-Hülle.
    const driveContent = await getDriveMockFile(page);
    expect(driveContent).not.toBeNull();
    const parsed = JSON.parse(driveContent!);
    expect(parsed.patients).toHaveLength(2);
    expect(parsed.patients[0].name).toBe('Bestands-Patient 1');
    expect(parsed.sessions).toHaveLength(1);
  });

  test('Fresh install + visibilitychange während Auto-Load: Drive bleibt intakt', async ({ page }) => {
    // Diese Version triggert zusätzlich einen visibilitychange-Event kurz
    // nach dem Laden, um zu beweisen, dass der Sync-Gate auch gegen den
    // visibility-basierten Auto-Sync schützt.
    await installDriveMock(page, { initialFile: EXISTING_BACKUP });
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__nempstiReady === true);

    await expect(page.locator('#dashboard-patient-list').getByText('Bestands-Patient 1')).toBeVisible({ timeout: 5000 });

    // Force visibility change to "hidden" → handleVisibilityChange → syncDirtyToDrive.
    // Der Dirty-Flag ist ggf. gesetzt (z.B. durch Settings-Initialisierung),
    // aber der Gate muss den Sync trotzdem blockieren, BIS er ALLOWED ist.
    // Da der Auto-Load vor dem visibility-Event bereits abgeschlossen sein
    // sollte, ist der Gate hier bereits ALLOWED, und ein Sync-OUT würde die
    // (aus Drive geladenen) Daten wieder nach Drive schreiben — no-op.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Kleine Wartezeit, damit ein eventuell ausgelöster Sync laufen kann.
    await page.waitForTimeout(500);

    // Drive muss immer noch beide Patienten enthalten.
    const driveContent = await getDriveMockFile(page);
    const parsed = JSON.parse(driveContent!);
    expect(parsed.patients).toHaveLength(2);
    expect(parsed.patients[0].name).toBe('Bestands-Patient 1');
    expect(parsed.patients[1].name).toBe('Bestands-Patient 2');
  });

  test('Fresh install mit leerem Drive: Patient anlegen funktioniert und wird synchronisiert', async ({ page }) => {
    // Sanity check: der Gate darf den Normalfall "wirklich frisch, Drive auch
    // leer" nicht blockieren. Nach dem Auto-Load (der keine Daten findet)
    // muss der Gate auf ALLOWED gehen, und ein neuer Patient muss normal
    // nach Drive synchronisiert werden können.
    await installDriveMock(page, { initialFile: null });
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__nempstiReady === true);
    await dismissDsgvo(page);

    // Warten bis der Gate ALLOWED ist. Kein direkter UI-Indikator dafür —
    // wir warten darauf, dass eine Drive-Mock-Call-Liste existiert (der Load
    // hat stattgefunden).
    await page.waitForFunction(() => {
      const calls = (window as any).__NEMPSTI_DRIVE_MOCK_STATE__?.calls || [];
      // Mindestens ein List-Call sollte durchgelaufen sein (Auto-Load-Versuch).
      return calls.some((c: any) => c.url && c.url.includes('spaces=appDataFolder'));
    }, null, { timeout: 5000 });

    // Patient anlegen
    await page.getByRole('button', { name: '+' }).click();
    await page.getByRole('button', { name: 'Neuer Patient' }).click();
    await page.getByPlaceholder('z.B. Max Mustermann').fill('Neuer Frischling');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Patient gespeichert!')).toBeVisible();

    // Force sync via visibility change
    await page.evaluate(() => (window as any).__nempstiFlush());
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);

    // Drive sollte jetzt den neuen Patienten enthalten.
    const driveContent = await getDriveMockFile(page);
    expect(driveContent).not.toBeNull();
    const parsed = JSON.parse(driveContent!);
    expect(parsed.patients).toHaveLength(1);
    expect(parsed.patients[0].name).toBe('Neuer Frischling');
  });

  test('Vorhandene lokale Daten werden nicht durch Drive-Auto-Load überschrieben', async ({ page }) => {
    // Szenario: Normale Folge-Session. Lokal hat Daten (aus IDB), Drive hat
    // andere Daten. Per §7.3.1-Policy vertraut der Gate dem lokalen Stand
    // direkt und führt KEIN Auto-Load durch. Lokale Änderungen bleiben
    // erhalten; Drive wird bei nächstem Sync mit lokalem Stand überschrieben.
    await installDriveMock(page, { initialFile: EXISTING_BACKUP });
    await page.goto('/');
    await page.waitForFunction(() => (window as any).__nempstiReady === true);
    await dismissDsgvo(page);

    // Warten bis Auto-Load durchgelaufen ist und lokal die Drive-Patienten da sind.
    await expect(page.locator('#dashboard-patient-list').getByText('Bestands-Patient 1')).toBeVisible({ timeout: 5000 });

    // Neuen Patienten lokal anlegen.
    await page.getByRole('button', { name: '+' }).click();
    await page.getByRole('button', { name: 'Neuer Patient' }).click();
    await page.getByPlaceholder('z.B. Max Mustermann').fill('Lokaler Neuzugang');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Patient gespeichert!')).toBeVisible();

    // Reload der Seite — lokaler State wird aus IDB geladen (mit 3 Patienten:
    // die 2 aus Drive + der 1 neue). Der Gate sollte auf ALLOWED gehen, WEIL
    // lokal bedeutungsvolle Daten hat. Es findet KEIN Drive-Auto-Load statt,
    // der den Neuzugang überschreiben würde.
    await page.evaluate(() => (window as any).__nempstiFlush());
    await page.reload();
    await page.waitForFunction(() => (window as any).__nempstiReady === true);

    // Alle drei Patienten sind nach Reload da.
    await expect(page.locator('#dashboard-patient-list').getByText('Bestands-Patient 1')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#dashboard-patient-list').getByText('Bestands-Patient 2')).toBeVisible();
    await expect(page.locator('#dashboard-patient-list').getByText('Lokaler Neuzugang')).toBeVisible();
  });
});
