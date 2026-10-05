// RecreoPay PWA Service Worker v7.0 - Alta Estabilidad
const CACHE_NAME = 'recreopay-v7.0';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/pos.html',
  '/carnet.html',
  '/manifest.json',
  '/css/styles.css',
  '/js/app.js',
  '/js/pos.js',
  '/js/sounds.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Cache prefetch warn:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Purgando versión anterior:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Network-First con fallback a caché para navegación y recursos estáticos
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // APIs y Server-Sent Events (SSE): Directo a red sin caché
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/events')) {
    return;
  }

  // Peticiones no-GET: directo a red
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});
