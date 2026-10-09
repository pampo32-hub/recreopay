// SiboPay PWA Service Worker v19.3 - Ultra Fast Startup & Stale-While-Revalidate
const CACHE_NAME = 'sibopay-v19.3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/eliminar-cuenta.html',
  '/pos.html',
  '/pistola.html',
  '/carnet.html',
  '/manifest.json',
  '/css/styles.css?v=19.3',
  '/css/desktop.css?v=2.2',
  '/js/dialogs.js?v=19.3',
  '/js/app.js?v=19.3',
  '/js/pos.js',
  '/js/sounds.js?v=19.3',
  '/js/food-icons.js?v=19.3',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/img/sibopay-emblem.png',
  '/apple-touch-icon.png'
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

// Estrategia Stale-While-Revalidate para apertura instantánea (0ms) en móviles
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // APIs y Server-Sent Events (SSE): Directo a red en tiempo real sin caché
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/events')) {
    return;
  }

  // Peticiones no-GET: directo a red
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Lanzar actualización en segundo plano (revalidate) sin bloquear la pantalla
      const fetchPromise = fetch(event.request)
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
          // Si no hay red y era navegación, retornar index.html en caché
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });

      // Si ya está en la memoria del teléfono, entregar INMEDIATAMENTE (<15ms)
      if (cachedResponse) {
        return cachedResponse;
      }

      // Si es la primera vez que se descarga, esperar la respuesta de red
      return fetchPromise;
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
      data = { title: '🔔 SiboPay', body: event.data.text() };
    }
  }

  const title = data.title || '🔔 SiboPay';
  const options = {
    body: data.body || 'Tienes una nueva notificación de SiboPay',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    vibrate: [250, 100, 250, 100, 250],
    data: data.data || { url: '/pos.html?tab=sinpe' },
    tag: data.tag || `sibopay-push-${Date.now()}`,
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
