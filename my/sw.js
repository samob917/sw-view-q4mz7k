/* My Schedule PWA shell.
   Navigations: network-first (a fresh schedule always wins when online),
   falling back to the cached copy so the app still opens with no signal.
   Static assets (icons, manifest): cache-first. */
const CACHE = 'ccpsa-portal-v1';
const ASSETS = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(r => {
        const cp = r.clone();
        caches.open(CACHE).then(c => c.put('index.html', cp));
        return r;
      }).catch(() => caches.match('index.html'))
    );
  } else {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(rr => {
      const cp = rr.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); return rr;
    })));
  }
});
