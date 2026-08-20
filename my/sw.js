/* Scheduling Wizard — the service worker, i.e. how an installed app gets a new version.
 *
 * THE JOB. Once this is on a home screen there is no address bar, no reload button and no way
 * for anyone to "get the latest". Whatever this file decides is what the client runs, possibly
 * for weeks. Two failures matter and they pull in opposite directions:
 *
 *   caching too little   the app will not open without signal
 *   caching too much     the app opens and shows last week's schedule, silently
 *
 * The second is worse here. A schedule that is confidently wrong is more dangerous than one
 * that will not load, so nothing that comes from the API is ever cached — not for a second.
 * Only the shell is: HTML, icons, manifest. The shell can be stale; the shifts cannot.
 *
 * CACHE is rewritten with the build stamp on every deploy. That matters more than it looks:
 * a browser only re-reads a worker whose BYTES have changed, so when this file was a constant
 * 'ccpsa-portal-v1' there was no update mechanism at all — the app was frozen at whatever it
 * installed with, and reinstalling it was the only cure. The stamp is the mechanism.
 *
 * Kept in the repo, not in .portal_repo/ — that directory is gitignored and merely mkdir -p'd,
 * so the file the whole update path depends on was surviving by luck and would have vanished
 * on any clean checkout.
 */
const CACHE = 'ccpsa-portal-260820.1706';

// './' and index.html are the same response; both are listed because a navigation can ask for
// either. icon-192 is what a push notification draws, so it must work offline too.
const ASSETS = ['./', 'index.html', 'manifest.webmanifest',
                'icon-180.png', 'icon-192.png', 'icon-512.png', 'favicon.ico'];

// addAll() is all-or-nothing: one 404 and the install REJECTS, the new worker never activates,
// and the app stays on the old version with no sign anything is wrong. A missing icon must not
// be able to stop an update, so each asset is fetched on its own and failure is survivable.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.all(ASSETS.map(a => c.add(a).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // THE API IS NEVER CACHED. On the test site the API is same-origin (/api), so without this
  // line every GET the app makes — the schedule, requests, swaps, coverage — was answered from
  // a cache-first store that had no expiry and no revalidation. The app would have gone on
  // showing the schedule as it stood the first time it was opened, and a swap accepted on
  // another phone would never have appeared.
  if (url.pathname.startsWith('/api/') || url.pathname === '/api') return;

  if (e.request.mode === 'navigate') {
    // Network first: online, you get what was just deployed. Offline — or when the host is
    // having a moment — the app still opens.
    //
    // A FAILED REQUEST IS NOT ONLY A THROWN ONE. This used to hand back whatever came off the
    // network and cache it, so a 404 became the app: shown to whoever was opening it, and
    // stored as index.html for every future offline start. GitHub Pages serves 404s for a few
    // seconds while a deploy swaps in, which is precisely when an app checking for a new
    // version reloads itself — the update mechanism walking into the one window that breaks it.
    //
    // So: only a good response is cached, and a bad status falls back to the page already held.
    // Yesterday's schedule beats a 404 every time, and the version check will pick up the new
    // build on the next foreground anyway.
    e.respondWith(
      fetch(e.request).then(r => {
        if (r && r.ok) {
          const cp = r.clone();
          caches.open(CACHE).then(c => c.put('index.html', cp));
          return r;
        }
        return caches.match('index.html').then(hit => hit || caches.match('./')).then(hit => hit || r);
      }).catch(() => caches.match('index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Assets: serve from cache so the app opens instantly, and refresh in the background so the
  // next open has the new one. Cache-first with no revalidation meant a changed icon or
  // manifest never arrived.
  e.respondWith(caches.match(e.request).then(hit => {
    const net = fetch(e.request).then(r => {
      if (r && r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return r;
    }).catch(() => hit);
    return hit || net;
  }));
});

// The page asks for this when it wants to know whether it is running the current build.
self.addEventListener('message', e => {
  if (e.data === 'version' && e.source) e.source.postMessage({ build: CACHE });
  if (e.data === 'skipWaiting') self.skipWaiting();
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
