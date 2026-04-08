import { test, expect } from '@playwright/test';
import { gotoApp, installDriveMock, dismissDsgvo, createPatient } from './helpers';

// Service Worker-based tests are browser-dependent: only Chromium implements
// SW fully in Playwright. Skip others in this spec where SW is required.
const swOnly = ['firefox', 'webkit'];

test.describe('PWA: Service Worker & Offline & Manifest', () => {

  test.beforeEach(async ({ page }) => {
    await installDriveMock(page);
    // Note: we deliberately do NOT install a persistent IDB-clearing
    // initScript here. Playwright contexts are already isolated per test,
    // so IDB is fresh — and a persistent clear would break tests that
    // `page.reload()` to assert auto-load from IDB.
  });

  test('Manifest-Datei ist erreichbar und enthält PWA-Metadaten', async ({ page }) => {
    const response = await page.request.get('/manifest.webmanifest');
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest.name).toBe('Patientenstunden-Tracker');
    expect(manifest.short_name).toBe('NemPSTi');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    expect(manifest.start_url).toBe('./');
  });

  test('CSP meta tag ist aktiv und verbietet script-src unsafe-inline', async ({ page }) => {
    await page.goto('/');
    const csp = await page.$eval(
      'meta[http-equiv="Content-Security-Policy"]',
      (el) => el.getAttribute('content')
    );
    expect(csp).toBeTruthy();
    expect(csp!).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp!).toMatch(/default-src 'self'/);
    expect(csp!).toMatch(/drive-src|appdata|googleapis\.com|accounts\.google\.com/);
  });

  test('Auto-Load aus IndexedDB ab dem zweiten Start (zentraler Phase-1-DoD)', async ({ page }) => {
    await gotoApp(page);
    await createPatient(page, 'Auto-Load-Test');
    await page.evaluate(() => (window as any).__nempstiFlush());

    // Simulate "second launch": reload without clearing IDB. The helper
    // gotoApp clears IDB via addInitScript, so we use a bare reload here.
    await page.reload();

    // DSGVO was already acked → modal is NOT shown on second launch.
    await expect(page.locator('#modal-dsgvo.active')).toBeHidden();
    // Data is loaded automatically, no interaction required.
    await expect(
      page.locator('#dashboard-patient-list').getByText('Auto-Load-Test')
    ).toBeVisible();
  });

  test('Service Worker registriert und aktiviert App-Shell (Chromium)', async ({ page, browserName }) => {
    test.skip(swOnly.includes(browserName), 'SW registration flaky outside Chromium');
    await page.goto('/');
    await dismissDsgvo(page);

    const swReady = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      return !!(reg && reg.active);
    });
    expect(swReady).toBeTruthy();
  });

  test('Version-Conflict-Modal: force-reload button works (regression: Codex review)', async ({ page }) => {
    // 1) Normalen Start → IDB ist in kanonischem v1-Shape.
    await gotoApp(page);

    // 2) IDB zu v999 korrumpieren — simuliert eine Daten-Datei, die von
    //    einer neueren App-Version geschrieben wurde (§10.5).
    await page.evaluate(() => new Promise<void>((res, rej) => {
      const req = indexedDB.open('nempsti', 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('appState', 'readwrite');
        tx.objectStore('appState').put({
          version: 999,
          settings: { supervisionRatio: 4, defaultKontingent: 60, dsgvoAcknowledgedAt: new Date().toISOString() },
          patients: [],
          sessions: [],
          supervisions: [],
          supervisionGroups: [],
        }, 'appData');
        tx.oncomplete = () => { db.close(); res(); };
        tx.onerror = () => rej(tx.error);
      };
      req.onerror = () => rej(req.error);
    }));

    // 3) Reload → App sollte das Version-Conflict-Modal öffnen.
    await page.reload();
    await page.waitForFunction(() => (window as any).__nempstiReady === true);
    await expect(page.locator('#modal-version-conflict.active')).toBeVisible();

    // 4) KRITISCH: Der "App neu laden"-Button muss funktionieren, auch
    //    obwohl initApp() früh zurückgekehrt ist. Wir beweisen den Klick
    //    indirekt: vor dem Klick setzen wir einen Marker auf window; nach
    //    einem echten Reload ist der Marker verschwunden.
    await page.evaluate(() => { (window as any).__prereloadMarker = true; });
    expect(await page.evaluate(() => (window as any).__prereloadMarker)).toBe(true);

    await page.locator('[data-action="force-reload"]').click();

    await page.waitForFunction(
      () => (window as any).__prereloadMarker === undefined,
      undefined,
      { timeout: 5000 }
    );

    // Nach dem Reload ist die Daten immer noch v999 → Modal ist wieder da.
    await page.waitForFunction(() => (window as any).__nempstiReady === true);
    await expect(page.locator('#modal-version-conflict.active')).toBeVisible();
  });

  test('Offline-Betrieb: App lädt vollständig aus Cache (Chromium)', async ({ page, browserName, context }) => {
    test.skip(swOnly.includes(browserName), 'SW/offline test only reliably works in Chromium');

    await page.goto('/');
    await dismissDsgvo(page);

    // Wait for the SW to take control and pre-cache the app shell.
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      // Wait a tick to let install/activate settle.
      await new Promise(r => setTimeout(r, 200));
      return !!reg.active;
    });

    // Give it a second reload with the controller in place so all subsequent
    // requests flow through the SW.
    await page.reload();
    await dismissDsgvo(page);

    // Go offline and reload again — must still work.
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Patientenstunden-Tracker' })).toBeVisible();

    // Back online so subsequent tests don't linger in offline mode.
    await context.setOffline(false);
  });
});
