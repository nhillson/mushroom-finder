// Service worker: keeps the app and saved areas working without cell signal.
// - App files: cached on install, refreshed in the background.
// - Basemap tiles and habitat grid tiles: cache first.
// - Live data (weather, public lands, sightings, trails): network first, cached copy when offline.
const VERSION = 'v3';
const SHELL = `mf-shell-${VERSION}`;
const TILES = 'mf-tiles';
const DATA = 'mf-data';
const API = 'mf-api';

const SHELL_FILES = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/config.js', 'js/species.js', 'js/landrules.js', 'js/data.js', 'js/score.js', 'js/grid.js', 'js/mine.js', 'js/offline.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png', 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mf-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isTile = (u) => /basemap\.nationalmap\.gov|tile\.openstreetmap\.org/.test(u.host);
const isGrid = (u) => u.origin === self.location.origin && u.pathname.includes('/data/');
const isApi = (u) => /open-meteo\.com|arcgis\.com|inaturalist\.org|overpass-api\.de|mrlc\.gov|geoplatform\.gov/.test(u.host);

async function cacheFirst(cacheName, req) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') c.put(req, res.clone());
  return res;
}

async function networkFirst(cacheName, req) {
  const c = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(cacheName, req) {
  const c = await caches.open(cacheName);
  const hit = await c.match(req, { ignoreSearch: true });
  const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (isTile(u)) return e.respondWith(cacheFirst(TILES, req));
  if (isGrid(u)) {
    // tiles rarely change; meta/model refresh in the background
    if (/\.bin\.gz$/.test(u.pathname)) return e.respondWith(cacheFirst(DATA, req));
    return e.respondWith(networkFirst(DATA, req));
  }
  if (isApi(u)) return e.respondWith(networkFirst(API, req));
  if (u.origin === self.location.origin) return e.respondWith(networkFirst(SHELL, req));
  if (u.host === 'unpkg.com' || /fonts\.(googleapis|gstatic)\.com/.test(u.host)) {
    return e.respondWith(staleWhileRevalidate(SHELL, req));
  }
});

// Pre-cache a list of URLs for an offline area; reports progress to the page.
self.addEventListener('message', async (e) => {
  const msg = e.data || {};
  if (msg.type !== 'cache-area') return;
  const port = e.ports[0];
  let done = 0, failed = 0;
  const queue = msg.items.slice();
  async function worker() {
    while (queue.length) {
      const { url, cache } = queue.shift();
      try {
        const c = await caches.open(cache);
        if (!(await c.match(url))) {
          const tile = isTile(new URL(url));
          const res = await fetch(url, { mode: tile ? 'no-cors' : 'cors' });
          if (!res.ok && res.type !== 'opaque') throw new Error(res.status);
          await c.put(url, res);
        }
      } catch {
        failed++;
      }
      done++;
      if (done % 10 === 0 || !queue.length) port.postMessage({ done, failed, total: msg.items.length });
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  port.postMessage({ done, failed, total: msg.items.length, finished: true });
});
