// Caches the app and the hand-tracking model so the interpreter keeps working
// with a poor or missing internet connection after the first visit.

const CACHE = 'auslan-interpreter-v2';
const APP_SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/classifier.js',
  'js/features.js',
  'js/speech.js',
  'js/storage.js',
  'js/tracker.js',
  'js/videoLearning.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];
const CACHEABLE_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Versioned third-party files (MediaPipe library and model): cache first.
  if (CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Our own files: network first so updates show up, cache as fallback.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request)),
    );
  }
});
