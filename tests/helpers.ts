import { expect, Page } from '@playwright/test';

/** Root of the new PWA. */
export const APP_PATH = '/';

/**
 * Load the app with a clean IndexedDB + SW state. Installs the Drive mock
 * before the first script runs so `drive.js` never touches real Google
 * infrastructure (§14 Regel 17).
 */
export async function gotoApp(page: Page, opts: { mockDrive?: boolean } = {}) {
  const { mockDrive = true } = opts;

  if (mockDrive) {
    await installDriveMock(page);
  }

  // Playwright gives every test a fresh BrowserContext → IndexedDB is
  // automatically empty at the start of each test. No explicit deletion
  // needed, and adding a persistent initScript that clears IDB would
  // break tests that `page.reload()` to verify auto-load.

  await page.goto(APP_PATH);
  // Wait for init to complete.
  await page.waitForFunction(() => (window as any).__nempstiReady === true);
  // Wait for the DSGVO modal (shown on first run, blocking interaction).
  await dismissDsgvo(page);
  await expect(page.getByRole('heading', { name: 'Patientenstunden-Tracker' })).toBeVisible();
}

/** First-run DSGVO modal: accept immediately. */
export async function dismissDsgvo(page: Page) {
  const modal = page.locator('#modal-dsgvo.active');
  if (await modal.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Verstanden und einverstanden' }).click();
    await expect(modal).toBeHidden();
  }
}

/**
 * Installs a pure in-memory Drive mock. The drive.js module routes ALL network
 * calls through window.__NEMPSTI_DRIVE_MOCK__ when this hook is present.
 */
export async function installDriveMock(
  page: Page,
  opts: { initialFile?: object | null; failNext?: number } = {}
) {
  const { initialFile = null } = opts;
  await page.addInitScript((init) => {
    const state: any = {
      file: init ? JSON.stringify(init) : null,
      calls: [] as Array<{ method: string; url: string }>,
      failNext: 0,
    };
    (window as any).__NEMPSTI_DRIVE_MOCK_STATE__ = state;
    (window as any).__NEMPSTI_DRIVE_MOCK__ = {
      initialFileExists: state.file !== null,
      async fetch(url: string, options: RequestInit = {}) {
        state.calls.push({ method: (options.method as string) || 'GET', url });
        if (state.failNext > 0) {
          state.failNext -= 1;
          return new Response(JSON.stringify({ error: 'mock failure' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const u = new URL(url);
        // List
        if (u.pathname === '/drive/v3/files' && u.searchParams.get('spaces') === 'appDataFolder') {
          const files = state.file !== null ? [{ id: 'mock-file-id', name: 'nempsti-data.json' }] : [];
          return new Response(JSON.stringify({ files }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        // Download
        if (u.pathname.startsWith('/drive/v3/files/') && u.searchParams.get('alt') === 'media') {
          if (state.file === null) return new Response('not found', { status: 404 });
          return new Response(state.file, { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        // Upload (multipart) — POST or PATCH
        if (u.pathname === '/upload/drive/v3/files' || u.pathname.startsWith('/upload/drive/v3/files/')) {
          // Extract the JSON payload from the multipart body (second part).
          const bodyText = typeof options.body === 'string' ? options.body : '';
          // Very loose parsing — our drive.js writes the payload between two
          // 'Content-Type:' headers and the closing boundary.
          const parts = bodyText.split(/Content-Type: application\/json\r\n\r\n/);
          if (parts.length >= 3) {
            state.file = parts[2].split(/\r\n--nempsti-/)[0];
          } else if (parts.length >= 2) {
            state.file = parts[parts.length - 1].split(/\r\n--nempsti-/)[0];
          }
          return new Response(JSON.stringify({ id: 'mock-file-id' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'unknown mock endpoint' }), { status: 404 });
      },
    };
  }, initialFile);
}

/** Create a patient via the UI and wait for the success toast. */
export async function createPatient(page: Page, name: string, kuerzel?: string) {
  await page.getByRole('button', { name: '+' }).click();
  await page.getByRole('button', { name: 'Neuer Patient' }).click();
  await page.getByPlaceholder('z.B. Max Mustermann').fill(name);
  if (kuerzel) await page.getByPlaceholder('z.B. MM').fill(kuerzel);
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByText('Patient gespeichert!')).toBeVisible();
}

/** Create a treatment session for the currently selected (or only) patient. */
export async function createSession(page: Page, date: string) {
  await page.getByRole('button', { name: '+' }).click();
  await page.getByRole('button', { name: 'Neue Behandlungssitzung' }).click();
  await page.locator('#session-date').fill(date);
  await page.getByRole('button', { name: 'Sitzung speichern' }).click();
  await expect(page.getByText('Sitzung gespeichert!')).toBeVisible();
}

/** Navigate to patient detail view by name (from any tab). */
export async function openPatientDetail(page: Page, name: string) {
  await page.getByRole('button', { name: 'Patienten' }).click();
  await page.locator('#patients-list').getByText(name).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

/** Inspect the number of Drive API calls made via the mock. */
export async function getDriveMockCalls(page: Page): Promise<Array<{ method: string; url: string }>> {
  return await page.evaluate(() => (window as any).__NEMPSTI_DRIVE_MOCK_STATE__?.calls || []);
}

/** Read the current mock "file" content (what Drive has stored). */
export async function getDriveMockFile(page: Page): Promise<string | null> {
  return await page.evaluate(() => (window as any).__NEMPSTI_DRIVE_MOCK_STATE__?.file ?? null);
}
