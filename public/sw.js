// RecreoPay PWA Service Worker (Auto-purge & Unregister para evitar caché vieja en móviles)
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          console.log('[SW] Purgando caché obsoleta:', key);
          return caches.delete(key);
        })
      );
    }).then(() => self.registration.unregister())
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll())
      .then((clients) => {
        clients.forEach((client) => {
          if (client.url && 'navigate' in client) {
            client.navigate(client.url);
          }
        });
      })
  );
});

// Pass-through directo a la red (sin caché en desarrollo y pruebas)
self.addEventListener('fetch', (event) => {
  // Sin intercepción: el navegador siempre pide al servidor
});
