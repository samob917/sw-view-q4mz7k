/* My Schedule PWA shell.
   Navigations: network-first (a fresh schedule always wins when online),
   falling back to the cached copy so the app still opens with no signal.
   Static assets (icons, manifest): cache-first. */
const CACHE = 'ccpsa-portal-260818.1705';
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


/* ---------- push ----------
   Coverage requests reach a phone here. The payload carries a URL so tapping the notification
   opens the app on the right screen rather than wherever it was left. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'CCPSA', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'CCPSA schedule', {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: d.tag || 'ccpsa',
    data: { url: d.url || '/my/' },
    renotify: !!d.tag,
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/my/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    // Focus the app if it is already open rather than piling up tabs.
    for (const c of list) { if (c.url.includes('/my/') && 'focus' in c) return c.focus(); }
    return clients.openWindow(url);
  }));
});
