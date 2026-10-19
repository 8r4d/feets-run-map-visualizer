// The service worker that lets feets be installed as an app and open without
// a connection. It keeps a copy of the page and its scripts, and nothing else:
// - the page (index.html): from the network first, so a new upload shows at
//   once; the copy only when offline
// - scripts and styles: from the copy once fetched. Their links carry ?v=N
//   (see index.html), so a new version is a new URL and is fetched; older
//   versions of the same file are then dropped. Leaflet, from its CDN, too:
//   its URL has its version in it
// - other files of ours (icons, help pages): network first, copy offline
// - api.php, map tiles and anything else from another site: left alone, so
//   your tracks and account are never kept here (offline, the page says it
//   can't reach the server, as it does now)
// Changing this file makes browsers install the new one on their next visit.
const CACHE = 'feets-1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Keeps a response, dropping other versions (?v=) of the same file.
async function keep(request, response) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  for (const old of await cache.keys()) {
    const o = new URL(old.url);
    if (o.pathname === url.pathname && o.search !== url.search) await cache.delete(old);
  }
  await cache.put(request, response);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.origin === 'https://cdn.jsdelivr.net' && url.pathname.startsWith('/npm/leaflet@')) {
    event.respondWith(fromCopy(event, request));
    return;
  }
  if (url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return;
  if (/\.php$/.test(url.pathname)) return;  // api.php: always the network

  if (request.mode === 'navigate') {
    // The page itself, with any ?view= or ?invite= in the URL: kept as the
    // one copy of the page, which is the same whatever the query string.
    event.respondWith(fromNetwork(event, request, new Request(scope.href)));
  } else if (url.searchParams.has('v')) {
    event.respondWith(fromCopy(event, request));
  } else {
    event.respondWith(fromNetwork(event, request, request));
  }
});

// The copy if there is one, else the network (and keep that).
async function fromCopy(event, request) {
  const copy = await caches.match(request);
  if (copy) return copy;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') event.waitUntil(keep(request, response.clone()));
  return response;
}

// The network (keeping a copy, under `key`), else the copy when offline.
async function fromNetwork(event, request, key) {
  try {
    const response = await fetch(request);
    if (response.ok) event.waitUntil(keep(key, response.clone()));
    return response;
  } catch (err) {
    const copy = await caches.match(key);
    if (copy) return copy;
    throw err;
  }
}
