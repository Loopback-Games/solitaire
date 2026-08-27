/* Offline play.
 *
 * The manifest already promised this: it declares display: standalone, so the
 * game installs, and until now an installed copy could not open on a plane.
 *
 * Stale-while-revalidate for everything, deliberately. There is no build step
 * here and so no content hashes, which means a versioned cache name would have
 * to be bumped by hand and would eventually strand somebody on a stale build.
 * This way the player always gets the last known good copy at once and the next
 * load has the update.
 */

const CACHE = 'lbg-solitaire';

const SHELL = [
  './',
  'index.html',
  'css/solitaire.css',
  'js/solitaire.js',
  'js/store.js',
  'js/hint.js',
  'js/sfx.js',
  'js/keys.js',
  'manifest.webmanifest',
  'assets/favicon.svg',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/apple-touch-icon.png',
];

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE)
      // One missing file must not cost the whole install, so they go in singly.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

async function fresh(request, key = request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(key);

  const live = fetch(request)
    .then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    })
    .catch(() => null);

  if (hit) return hit;
  return (await live) || new Response('', { status: 504, statusText: 'offline' });
}

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  // The Google Fonts stylesheet is the only cross-origin request the game
  // makes, and every font-family here already falls back to a system face, so
  // it is left to the network and allowed to fail.
  if (ev.request.method !== 'GET' || url.origin !== location.origin) return;

  // ?deal= and ?daily pick a hand; they do not pick a different page. Every
  // navigation is answered from the one shell, or the cache fills with a copy
  // per deal number.
  if (ev.request.mode === 'navigate') { ev.respondWith(fresh(ev.request, './')); return; }
  ev.respondWith(fresh(ev.request));
});
