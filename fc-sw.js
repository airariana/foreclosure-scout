// Nestscoop — Service Worker
// Caches the app shell for offline use and fast loads

const CACHE_NAME = 'nestscoop-v1';
const APP_SHELL = [
  './foreclosure-scout.html',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@300;400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap'
];

// Install — cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL);
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — network first, cache fallback for HTML
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go network for API calls (Gemini, CourtListener, Census, FEMA etc.)
  const isAPICall = [
    'generativelanguage.googleapis.com',
    'courtlistener.com',
    'api.census.gov',
    'hazards.fema.gov',
    'opendata.maryland.gov',
    'resales.usda.gov',
    'api.bls.gov',
    'maps.googleapis.com',
    'allorigins.win',
    'corsproxy.io'
  ].some(host => url.hostname.includes(host));

  if(isAPICall){
    event.respondWith(fetch(event.request));
    return;
  }

  // For app shell — network first, fall back to cache
  if(event.request.mode === 'navigate' || event.request.destination === 'document'){
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Update cache with fresh version
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match('./foreclosure-scout.html'))
    );
    return;
  }

  // For fonts and static assets — cache first
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// Background sync placeholder for future alert notifications
self.addEventListener('sync', event => {
  if(event.tag === 'check-alerts'){
    // Future: push notification when new listings match saved alerts
    console.log('Background sync: check-alerts');
  }
});
