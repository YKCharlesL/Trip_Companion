/* Trip Companion service worker. VERSION and FILES are filled in by the Trip Builder on export.
 * Every file of the trip (documents, maps, fonts) is stored on the phone at the first visit,
 * so the app works with no signal afterwards. A re-export changes VERSION; the next online
 * visit downloads the new version in the background and the page reloads itself. */
const VERSION = 'a469954f8956';
const CACHE = 'trip-' + VERSION;
const FILES = [
 "./",
 "app.css",
 "app.js",
 "docs/660cde38e0ae.jpg",
 "docs/9f2685781a46.jpg",
 "docs/cb81fd3a72fd.jpg",
 "docs/ea9d4f936470.jpg",
 "docs/fbf89d0696d5.jpg",
 "docs/s-passport-dad.jpg",
 "docs/s-passport-mum.jpg",
 "docs/s-vivaviagem.png",
 "fonts/OFL.txt",
 "fonts/atkinson-400-latin-ext.woff2",
 "fonts/atkinson-400-latin.woff2",
 "fonts/atkinson-700-latin-ext.woff2",
 "fonts/atkinson-700-latin.woff2",
 "icons/apple-touch-icon.png",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "icons/icon-maskable-512.png",
 "index.html",
 "livemap.js",
 "manifest.webmanifest",
 "map/area.pmtiles",
 "map/basemaps.js",
 "map/glyphs/Noto Sans Italic/0-255.pbf",
 "map/glyphs/Noto Sans Italic/1024-1279.pbf",
 "map/glyphs/Noto Sans Italic/256-511.pbf",
 "map/glyphs/Noto Sans Italic/512-767.pbf",
 "map/glyphs/Noto Sans Italic/768-1023.pbf",
 "map/glyphs/Noto Sans Italic/8192-8447.pbf",
 "map/glyphs/Noto Sans Medium/0-255.pbf",
 "map/glyphs/Noto Sans Medium/1024-1279.pbf",
 "map/glyphs/Noto Sans Medium/256-511.pbf",
 "map/glyphs/Noto Sans Medium/512-767.pbf",
 "map/glyphs/Noto Sans Medium/768-1023.pbf",
 "map/glyphs/Noto Sans Medium/8192-8447.pbf",
 "map/glyphs/Noto Sans Regular/0-255.pbf",
 "map/glyphs/Noto Sans Regular/1024-1279.pbf",
 "map/glyphs/Noto Sans Regular/256-511.pbf",
 "map/glyphs/Noto Sans Regular/512-767.pbf",
 "map/glyphs/Noto Sans Regular/768-1023.pbf",
 "map/glyphs/Noto Sans Regular/8192-8447.pbf",
 "map/maplibre-gl.css",
 "map/maplibre-gl.js",
 "map/pmtiles.js",
 "map/sprites/dark.json",
 "map/sprites/dark.png",
 "map/sprites/dark@2x.json",
 "map/sprites/dark@2x.png",
 "map/sprites/light.json",
 "map/sprites/light.png",
 "map/sprites/light@2x.json",
 "map/sprites/light@2x.png",
 "maps/day-2026-11-04.jpg",
 "maps/day-2026-11-05.jpg",
 "maps/day-2026-11-06.jpg",
 "maps/day-2026-11-07.jpg",
 "maps/day-2026-11-08.jpg",
 "maps/overview.jpg",
 "render.js",
 "trip.js"
];

async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach((c) => c.postMessage(msg));
}

async function fetchWithRetry(url, tries) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (res.ok) return res;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw new Error('Could not download ' + url);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    let done = 0;
    const queue = FILES.slice();
    async function worker() {
      while (queue.length) {
        const url = queue.shift();
        if (!(await cache.match(url))) await cache.put(url, await fetchWithRetry(url, 3));
        done++;
        if (done % 3 === 0 || done === FILES.length) broadcast({ type: 'progress', done, total: FILES.length });
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('trip-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
    broadcast({ type: 'cached', version: VERSION });
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google Maps links etc. go straight to the network
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') {
      const page = (await cache.match('./')) || (await cache.match('index.html'));
      if (page) return page;
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (e) {
      return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '';
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      if ('focus' in c) {
        await c.focus();
        if (target) c.postMessage({ type: 'navigate', hash: target });
        return;
      }
    }
    return self.clients.openWindow('./' + target);
  })());
});
