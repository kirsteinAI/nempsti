import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3123',
    trace: 'on-first-retry',
  },
  projects: [
    // Desktop browsers
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    // Mobile devices
    {
      name: 'pixel8a',
      // Playwright does not have a 'Pixel 8a' device preset yet — the
      // Pixel 7 viewport is close enough (412×915 CSS px, DPR 2.625)
      // that we reuse it and explicitly override the UA string.
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 412, height: 915 },
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      },
    },
    {
      name: 'ipad-gen7',
      use: { ...devices['iPad (gen 7)'] },
    },
    {
      name: 'iphone15',
      use: { ...devices['iPhone 15'] },
    },
  ],
  webServer: {
    command: 'npx serve -l 3123 --no-clipboard',
    port: 3123,
    reuseExistingServer: !process.env.CI,
  },
});
