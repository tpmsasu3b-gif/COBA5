const CACHE_NAME = 'inventaris-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/offline.html'
];

// Install Event - Cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        return self.skipWaiting();
      })
      .catch((err) => {
        console.error('[SW] Cache failed:', err);
      })
  );
});

// Activate Event - Clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        return self.clients.claim();
      })
  );
});

// Fetch Event - Network strategies
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // API calls - Network First, then Cache
  if (url.pathname.includes('/api/') || url.hostname.includes('googleapis')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets - Cache First, then Network
  if (STATIC_ASSETS.includes(url.pathname) || request.destination === 'image') {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Default - Stale While Revalidate
  event.respondWith(staleWhileRevalidate(request));
});

// Cache Strategies
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    return caches.match('/offline.html');
  }
}

async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    
    return new Response(
      JSON.stringify({ error: 'Offline mode - data may be outdated' }),
      { 
        status: 503, 
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

// Background Sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-inventory') {
    event.waitUntil(syncInventoryData());
  }
});

async function syncInventoryData() {
  const db = await openDB('inventory-sync', 1);
  const pendingActions = await db.getAll('pending');
  
  for (const action of pendingActions) {
    try {
      // Attempt to sync with Google Sheets
      await fetch('/api/sync', {
        method: 'POST',
        body: JSON.stringify(action),
        headers: { 'Content-Type': 'application/json' }
      });
      
      // Remove from pending if successful
      await db.delete('pending', action.id);
    } catch (error) {
      console.error('Sync failed for action:', action.id);
    }
  }
}

// Push Notifications (optional)
self.addEventListener('push', (event) => {
  const data = event.data.json();
  
  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: data.tag,
    requireInteraction: true,
    actions: [
      {
        action: 'view',
        title: 'Lihat'
      },
      {
        action: 'dismiss',
        title: 'Tutup'
      }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow('/?action=inventory')
    );
  }
});
