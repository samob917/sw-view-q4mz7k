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
const CACHE = 'ccpsa-portal-260823.1924';
// The name every notification leads with. One constant, because it is the first thing anyone
// reads and it must not drift between the two places a notification can be shown.
const APP_NAME = 'Scheduling Wizard';

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

  const common = { icon: 'icon-192.png', badge: 'icon-192.png',
                   tag: d.tag || 'ccpsa', data: { url: d.url || '/my/' } };

  // A QUESTION THAT HAS BEEN ANSWERED SHOULD LEAVE THE PHONE. Ten people are asked to cover a
  // shift and one says yes; the other nine are left holding a live-looking request that will
  // only tell them they were too late. `close` takes it back — the notification with this tag
  // is dismissed rather than replaced with another card to ignore.
  if (d.close) {
    e.waitUntil(self.registration.getNotifications({ tag: d.tag }).then(list => {
      list.forEach(n => n.close());
      // A push has to end in something visible — that is the deal browsers enforce for
      // userVisibleOnly subscriptions. When there was nothing left to take back (already
      // dismissed, or a platform that will not list its own notifications) this handler
      // showed nothing at all, and the browser is entitled to post its own "this site was
      // updated in the background" card in its place. One honest line beats that.
      if (list.length) return;
      return self.registration.showNotification(APP_NAME, {
        ...common, body: [d.title, d.body || 'That request is closed.'].filter(Boolean).join('\n'),
        renotify: false, silent: true });
    }));
    return;
  }

  /* THE TITLE IS THE APP NAME. THE BODY LEADS WITH THE EVENT. SETTLED — DO NOT RE-DERIVE.
     Sam has asked for this repeatedly and it has been changed back twice by reasoning about what
     a renderer "should" do. It reads:

         Scheduling Wizard
         Someone accepted coverage
         Boe accepted Littleton Night on Oct 5 — waiting on an admin.

     We do not and cannot send the "from Scheduling Wizard" attribution line — the renderer adds
     it under the body for anything from a web origin, and the Notification API has no way to
     suppress it. Leading with the event in the TITLE is what makes that line read as a trailing
     "…from Scheduling Wizard" after the message, which is the thing being complained about.
     Putting the name first is the only lever we have, and it is the one the client wants.

     The argument for the other way round was that an installed iOS app draws its own name in the
     header, so the title repeats it. That is a cosmetic repetition on one platform. It is not
     worth overriding an explicit, repeated instruction, and it is not what is being read. */
  e.waitUntil(self.registration.showNotification(APP_NAME, {
    ...common,
    body: [d.title, d.body].filter(Boolean).join('\n'),
    renotify: !!d.tag,
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/my/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    // Focus the app if it is already open rather than piling up tabs — but focusing alone left
    // whoever tapped on whatever screen they had been reading, which is not where the thing
    // they tapped about is. The already-open app is told where to go.
    for (const c of list) {
      if ('focus' in c) {
        if (c.postMessage) c.postMessage({ type: 'navigate', url });
        return c.focus();
      }
    }
    return clients.openWindow(url);
  }));
});
