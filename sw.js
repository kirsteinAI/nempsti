// sw.js
// Service Worker für den Offline-Betrieb. §4.6.
//
// Strategie:
// - Cache-First für App-Shell (index.html, styles.css, alle JS-Module, Icons, Manifest)
// - Network-First mit Cache-Fallback für GIS (accounts.google.com/gsi/client)
// - Network-Only (niemals cached) für Drive API Calls (www.googleapis.com/drive/v3/*)
// - 14-Tage Stale-Client-Grenze → erzwingt Hard-Reload
//
// CACHE_VERSION muss bei jedem Release manuell inkrementiert werden (§10.1).

const CACHE_VERSION = 'v1.1.5';
const CACHE_NAME = `nempsti-${CACHE_VERSION}`;
const STALE_CLIENT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const ACTIVATED_AT_KEY = 'activatedAt';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './app.js',
  './state.js',
  './db.js',
  './drive.js',
  './migrations.js',
  './validation.js',
  './render.js',
  './forecast.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // Alte Caches aufräumen.
      const keys = await caches.keys();
      await Promise.all(
        keys.filter(k => k.startsWith('nempsti-') && k !== CACHE_NAME).map(k => caches.delete(k))
      );
      // Activated-Timestamp speichern (im Cache, weil SW keinen IDB-Zugriff braucht).
      const cache = await caches.open(CACHE_NAME);
      const response = new Response(String(Date.now()), {
        headers: { 'Content-Type': 'text/plain' },
      });
      await cache.put('__nempsti_' + ACTIVATED_AT_KEY, response);
      await self.clients.claim();
    })()
  );
});

async function isStale() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const resp = await cache.match('__nempsti_' + ACTIVATED_AT_KEY);
    if (!resp) return false;
    const ts = parseInt(await resp.text(), 10);
    if (!Number.isFinite(ts)) return false;
    return Date.now() - ts > STALE_CLIENT_MAX_AGE_MS;
  } catch {
    return false;
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache Drive API calls (§4.6 Network-Only).
  if (url.hostname === 'www.googleapis.com' || url.hostname === 'oauth2.googleapis.com') {
    return; // let the browser handle it normally
  }

  // GIS: Network-First mit Cache-Fallback.
  if (url.hostname === 'accounts.google.com') {
    event.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Cross-origin (anderes als oben): nicht cachen.
  if (url.origin !== self.location.origin) return;

  // Navigation requests: stale-client-guard → Hard-Reload via clients.claim auf neuer Version
  // beim nächsten fetch. Wir antworten mit dem gecachten index.html, damit Offline funktioniert.
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigate(req));
    return;
  }

  // App-Shell assets: Cache-First.
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(resp => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
        }
        return resp;
      });
    })
  );
});

async function handleNavigate(req) {
  // Stale-Client-Check: bei stale → Netzwerk erzwingen.
  const stale = await isStale();
  if (stale) {
    try {
      const fresh = await fetch(req, { cache: 'no-store' });
      if (fresh && fresh.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(() => {});
        return fresh;
      }
    } catch { /* fall through to cache */ }
  }
  // Try the exact navigated URL first (root '/' cached by APP_SHELL './'),
  // then fall back to the explicit index.html entry.
  const cachedExact = await caches.match(req);
  if (cachedExact) return cachedExact;
  const cachedIndex = await caches.match('./index.html');
  if (cachedIndex) return cachedIndex;
  try {
    return await fetch(req);
  } catch {
    return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
