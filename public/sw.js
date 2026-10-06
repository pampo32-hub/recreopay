// RecreoPay PWA Service Worker v8.5 - Soporte Web Push VAPID en Segundo Plano
const CACHE_NAME = 'recreopay-v8.5';
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

// Manejador de Notificaciones Push de Fondo (VAPID) - Activo aun con la app CERRADA
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: '🔔 RecreoPay', body: event.data.text() };
    }
  }

  const title = data.title || '🔔 RecreoPay';
  const options = {
    body: data.body || 'Tienes una nueva notificación de RecreoPay',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    vibrate: [250, 100, 250, 100, 250],
    data: data.data || { url: '/pos.html?tab=sinpe' },
    tag: data.tag || `recreopay-push-${Date.now()}`,
    renotify: true,
    requireInteraction: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Manejador de clics en Notificaciones Push
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = (event.notification.data && event.notification.data.url) || '/pos.html?tab=sinpe';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url && (client.url.includes('pos.html') || client.url.includes('index.html'))) {
          client.navigate(urlToOpen);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
