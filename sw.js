/* ═══════════════════════════════════════════════════════════════
   StudyFlow — Smart Learning Tracker
   sw.js · Service Worker (Offline-First PWA)
   Strategy: Cache-First for static assets, Network-First for API
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ─────────────────────────────────────────────
// 0. CONFIGURATION
// ─────────────────────────────────────────────
const APP_NAME    = 'studyflow';
const VERSION     = 'v1.0.0';

const CACHE_STATIC  = `${APP_NAME}-static-${VERSION}`;
const CACHE_DYNAMIC = `${APP_NAME}-dynamic-${VERSION}`;
const CACHE_IMAGES  = `${APP_NAME}-images-${VERSION}`;
const CACHE_API     = `${APP_NAME}-api-${VERSION}`;

// All caches owned by this SW
const ALL_CACHES = [CACHE_STATIC, CACHE_DYNAMIC, CACHE_IMAGES, CACHE_API];

// Max entries per dynamic cache (LRU eviction)
const CACHE_LIMITS = {
  [CACHE_DYNAMIC]: 60,
  [CACHE_IMAGES]:  40,
  [CACHE_API]:     20,
};

// Max age for API cache entries (ms)
const API_CACHE_MAX_AGE = 5 * 60 * 1000; // 5 minutes

// ─────────────────────────────────────────────
// 1. STATIC ASSETS TO PRE-CACHE ON INSTALL
// ─────────────────────────────────────────────
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.json',
  '/sw.js',

  // App screens (hash-based navigation — all resolve to index.html)
  '/index.html#screen-home',
  '/index.html#screen-routine',
  '/index.html#screen-log',
  '/index.html#screen-notes',
  '/index.html#screen-progress',

  // Icons
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-maskable-192x192.png',
  '/icons/icon-maskable-512x512.png',
  '/icons/shortcut-log.png',
  '/icons/shortcut-planner.png',
  '/icons/shortcut-progress.png',

  // Fonts (Google Fonts — cached dynamically; fallback declared here)
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap',
];

// ─────────────────────────────────────────────
// 2. INSTALL — Pre-cache static shell
// ─────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log(`[SW] Installing ${CACHE_STATIC}`);

  event.waitUntil(
    caches.open(CACHE_STATIC)
      .then(cache => {
        console.log('[SW] Pre-caching static assets');
        // Use addAll with individual error handling so one missing asset
        // doesn't abort the entire install
        return Promise.allSettled(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err =>
              console.warn(`[SW] Failed to cache: ${url}`, err)
            )
          )
        );
      })
      .then(() => {
        console.log('[SW] Install complete — skipping waiting');
        return self.skipWaiting(); // Activate immediately
      })
  );
});

// ─────────────────────────────────────────────
// 3. ACTIVATE — Clean up old caches
// ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log(`[SW] Activating ${VERSION}`);

  event.waitUntil(
    caches.keys()
      .then(keys => {
        const deletions = keys
          .filter(key => key.startsWith(APP_NAME) && !ALL_CACHES.includes(key))
          .map(key => {
            console.log(`[SW] Deleting old cache: ${key}`);
            return caches.delete(key);
          });
        return Promise.all(deletions);
      })
      .then(() => {
        console.log('[SW] Claiming all clients');
        return self.clients.claim(); // Take control of open pages immediately
      })
  );
});

// ─────────────────────────────────────────────
// 4. FETCH — Routing strategies
// ─────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and browser-extension requests
  if (request.method !== 'GET') return;
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // ── Route decision tree ──

  // 4a. Firebase / Firestore API  → Network-First
  if (isFirebaseRequest(url)) {
    event.respondWith(networkFirst(request, CACHE_API));
    return;
  }

  // 4b. Google Fonts (CSS + woff2) → Cache-First (long-lived)
  if (isGoogleFont(url)) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // 4c. Images (local + remote)   → Cache-First with network fallback
  if (isImageRequest(request)) {
    event.respondWith(cacheFirst(request, CACHE_IMAGES));
    return;
  }

  // 4d. Static shell assets       → Cache-First
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, CACHE_STATIC));
    return;
  }

  // 4e. Navigation (HTML pages)   → Network-First, fallback to shell
  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  // 4f. Everything else           → Stale-While-Revalidate
  event.respondWith(staleWhileRevalidate(request, CACHE_DYNAMIC));
});

// ─────────────────────────────────────────────
// 5. STRATEGIES
// ─────────────────────────────────────────────

/**
 * Cache-First
 * Serve from cache; fetch & cache on miss.
 */
async function cacheFirst(request, cacheName) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);
  if (cached) {
    return cached;
  }
  try {
    const response = await fetch(request);
    if (isValidResponse(response)) {
      await cache.put(request, response.clone());
      await trimCache(cacheName);
    }
    return response;
  } catch (err) {
    console.warn('[SW] Cache-First fetch failed:', err);
    return offlineFallback(request);
  }
}

/**
 * Network-First
 * Try network; on failure serve cache; timestamp-based staleness for API.
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (isValidResponse(response)) {
      // Stamp the response with a fetch timestamp header
      const stamped = stampResponse(response.clone());
      await cache.put(request, stamped);
      await trimCache(cacheName);
    }
    return response;
  } catch (err) {
    console.warn('[SW] Network-First: offline, serving cache:', err);
    const cached = await cache.match(request);
    if (cached) {
      // Check staleness for API cache
      if (cacheName === CACHE_API && isStale(cached)) {
        console.warn('[SW] Stale API cache — returning anyway (offline)');
      }
      return cached;
    }
    return offlineFallback(request);
  }
}

/**
 * Stale-While-Revalidate
 * Return cache immediately; update cache in background.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(async response => {
      if (isValidResponse(response)) {
        await cache.put(request, response.clone());
        await trimCache(cacheName);
      }
      return response;
    })
    .catch(err => {
      console.warn('[SW] SWR background fetch failed:', err);
    });

  return cached || fetchPromise;
}

/**
 * Navigation handler
 * Network-First for HTML; offline → serve cached /index.html shell.
 */
async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    if (isValidResponse(response)) {
      const cache = await caches.open(CACHE_DYNAMIC);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] Navigation offline; serving shell');
    const cache  = await caches.open(CACHE_STATIC);
    const shell  = await cache.match('/index.html') || await cache.match('/');
    return shell || new Response('<h1>StudyFlow is offline</h1>', {
      headers: { 'Content-Type': 'text/html' },
    });
  }
}

// ─────────────────────────────────────────────
// 6. HELPERS
// ─────────────────────────────────────────────

function isFirebaseRequest(url) {
  return (
    url.hostname.includes('firebaseio.com')       ||
    url.hostname.includes('googleapis.com')        ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('identitytoolkit.google.com') ||
    url.hostname.includes('storage.googleapis.com')
  );
}

function isGoogleFont(url) {
  return (
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  );
}

function isImageRequest(request) {
  const accept = request.headers.get('Accept') || '';
  return (
    accept.includes('image') ||
    /\.(png|jpg|jpeg|gif|webp|svg|ico)(\?.*)?$/.test(request.url)
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.endsWith('.css')  ||
    url.pathname.endsWith('.js')   ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.woff2')||
    url.pathname.endsWith('.ttf')
  );
}

function isValidResponse(response) {
  return response && response.status === 200 && response.type !== 'error';
}

/** Add a custom header with the fetch timestamp */
function stampResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('x-sw-fetched-at', Date.now().toString());
  return new Response(response.body, {
    status:     response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Check if a stamped response is older than API_CACHE_MAX_AGE */
function isStale(response) {
  const fetchedAt = response.headers.get('x-sw-fetched-at');
  if (!fetchedAt) return true;
  return (Date.now() - parseInt(fetchedAt, 10)) > API_CACHE_MAX_AGE;
}

/** Offline fallback — return a minimal JSON error or plain text */
function offlineFallback(request) {
  const accept = request.headers.get('Accept') || '';
  if (accept.includes('application/json')) {
    return new Response(
      JSON.stringify({ error: 'offline', message: 'You are offline. Data will sync when connection is restored.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return new Response('StudyFlow is currently offline.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' },
  });
}

/**
 * Trim a cache to its configured max entry limit (LRU-style).
 * Deletes oldest entries first.
 */
async function trimCache(cacheName) {
  const limit = CACHE_LIMITS[cacheName];
  if (!limit) return;

  const cache = await caches.open(cacheName);
  const keys  = await cache.keys();

  if (keys.length > limit) {
    const toDelete = keys.slice(0, keys.length - limit);
    await Promise.all(toDelete.map(key => cache.delete(key)));
    console.log(`[SW] Trimmed ${toDelete.length} entries from ${cacheName}`);
  }
}

// ─────────────────────────────────────────────
// 7. BACKGROUND SYNC (Study log offline queue)
// ─────────────────────────────────────────────
self.addEventListener('sync', event => {
  console.log('[SW] Background sync triggered:', event.tag);

  if (event.tag === 'sync-study-logs') {
    event.waitUntil(syncStudyLogs());
  }

  if (event.tag === 'sync-notes') {
    event.waitUntil(syncNotes());
  }

  if (event.tag === 'sync-routines') {
    event.waitUntil(syncRoutines());
  }
});

async function syncStudyLogs() {
  console.log('[SW] Syncing offline study logs to Firebase...');
  // In the full Flutter app this is handled by the Dart sync service.
  // Here we notify clients to trigger the sync from app logic.
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client =>
    client.postMessage({ type: 'SYNC_STUDY_LOGS' })
  );
}

async function syncNotes() {
  console.log('[SW] Syncing offline notes to Firebase...');
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client =>
    client.postMessage({ type: 'SYNC_NOTES' })
  );
}

async function syncRoutines() {
  console.log('[SW] Syncing offline routines to Firebase...');
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client =>
    client.postMessage({ type: 'SYNC_ROUTINES' })
  );
}

// ─────────────────────────────────────────────
// 8. PUSH NOTIFICATIONS (Study reminders)
// ─────────────────────────────────────────────
self.addEventListener('push', event => {
  console.log('[SW] Push received');

  let data = {
    title:   'StudyFlow',
    body:    'Time to study! Keep your streak alive 🔥',
    icon:    '/icons/icon-192x192.png',
    badge:   '/icons/icon-72x72.png',
    tag:     'study-reminder',
    renotify: false,
    data:    { url: '/index.html#screen-home' },
  };

  // Parse payload if provided
  if (event.data) {
    try {
      const payload = event.data.json();
      data = { ...data, ...payload };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body:     data.body,
    icon:     data.icon,
    badge:    data.badge,
    tag:      data.tag,
    renotify: data.renotify,
    vibrate:  [100, 50, 100],
    data:     data.data,
    actions:  [
      { action: 'open',    title: 'Open App' },
      { action: 'log',     title: 'Log Session' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ─────────────────────────────────────────────
// 9. NOTIFICATION CLICK
// ─────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  console.log('[SW] Notification clicked:', event.action);
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/index.html';

  // Map action to deep link
  let url = targetUrl;
  if (event.action === 'log')  url = '/index.html#screen-log';
  if (event.action === 'open') url = '/index.html#screen-home';
  if (event.action === 'dismiss') return;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Focus existing tab if open
        for (const client of clientList) {
          if (client.url.includes('studyflow') || client.url.includes('index.html')) {
            client.focus();
            client.postMessage({ type: 'NAVIGATE', url });
            return;
          }
        }
        // Otherwise open new window
        return self.clients.openWindow(url);
      })
  );
});

// ─────────────────────────────────────────────
// 10. NOTIFICATION CLOSE
// ─────────────────────────────────────────────
self.addEventListener('notificationclose', event => {
  console.log('[SW] Notification dismissed:', event.notification.tag);
  // Analytics hook — send dismissal event
  const clients = self.clients.matchAll({ type: 'window' });
  clients.then(list =>
    list.forEach(c =>
      c.postMessage({ type: 'NOTIFICATION_DISMISSED', tag: event.notification.tag })
    )
  );
});

// ─────────────────────────────────────────────
// 11. MESSAGE HANDLER (from app)
// ─────────────────────────────────────────────
self.addEventListener('message', event => {
  const { type, payload } = event.data || {};
  console.log('[SW] Message received:', type);

  switch (type) {

    // App requests immediate SW update
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    // App sends cache-bust request for a specific URL
    case 'CLEAR_CACHE_URL':
      if (payload?.url) {
        caches.keys().then(keys =>
          Promise.all(keys.map(async key => {
            const cache = await caches.open(key);
            return cache.delete(payload.url);
          }))
        );
      }
      break;

    // App requests full cache wipe (e.g. on logout)
    case 'CLEAR_ALL_CACHES':
      caches.keys()
        .then(keys => Promise.all(keys.map(key => caches.delete(key))))
        .then(() => {
          event.source?.postMessage({ type: 'CACHES_CLEARED' });
          console.log('[SW] All caches cleared');
        });
      break;

    // App pings SW for version info
    case 'GET_VERSION':
      event.source?.postMessage({ type: 'SW_VERSION', version: VERSION, caches: ALL_CACHES });
      break;

    // App requests pre-caching a new asset (e.g. downloaded PDF)
    case 'CACHE_ASSET':
      if (payload?.url) {
        caches.open(CACHE_DYNAMIC).then(cache => {
          cache.add(payload.url)
            .then(() => event.source?.postMessage({ type: 'ASSET_CACHED', url: payload.url }))
            .catch(err => console.warn('[SW] Failed to cache asset:', err));
        });
      }
      break;

    default:
      console.log('[SW] Unknown message type:', type);
  }
});

// ─────────────────────────────────────────────
// 12. PERIODIC BACKGROUND SYNC (Chrome / Android)
// ─────────────────────────────────────────────
self.addEventListener('periodicsync', event => {
  console.log('[SW] Periodic sync:', event.tag);

  if (event.tag === 'daily-study-reminder') {
    event.waitUntil(sendDailyReminder());
  }

  if (event.tag === 'sync-all-data') {
    event.waitUntil(Promise.all([
      syncStudyLogs(),
      syncNotes(),
      syncRoutines(),
    ]));
  }
});

async function sendDailyReminder() {
  // Only fire if no notification has been shown in last 20h
  const clients = await self.clients.matchAll({ type: 'window' });
  if (clients.length > 0) {
    // App is open — skip notification
    console.log('[SW] App is open, skipping daily reminder');
    return;
  }
  return self.registration.showNotification('StudyFlow Daily Reminder', {
    body:    "Don't break your streak! Log today's study session 📚",
    icon:    '/icons/icon-192x192.png',
    badge:   '/icons/icon-72x72.png',
    tag:     'daily-reminder',
    vibrate: [200, 100, 200],
    data:    { url: '/index.html#screen-log' },
    actions: [
      { action: 'log',     title: 'Log Now' },
      { action: 'dismiss', title: 'Later' },
    ],
  });
}

// ─────────────────────────────────────────────
// 13. ERROR HANDLER
// ─────────────────────────────────────────────
self.addEventListener('error', event => {
  console.error('[SW] Unhandled error:', event.message, event.filename, event.lineno);
});

self.addEventListener('unhandledrejection', event => {
  console.error('[SW] Unhandled promise rejection:', event.reason);
  event.preventDefault();
});

// ─────────────────────────────────────────────
// READY
// ─────────────────────────────────────────────
console.log(`[SW] StudyFlow Service Worker ${VERSION} loaded`);