// Offline support: registers the service worker and saves an area (map tiles, habitat grid,
// public lands, weather, trails) so the app keeps working where there's no cell signal.
import { CFG } from './config.js';
import * as D from './data.js';
import { gridTileUrls } from './grid.js';

const AREA_KEY = 'mf.offlineArea';
const MAX_TILES = 1800;

export function registerSW() {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.register('sw.js').catch(() => null);
}

export function savedArea() {
  try { return JSON.parse(localStorage.getItem(AREA_KEY) || 'null'); } catch { return null; }
}

function lng2x(lng, z) { return Math.floor(((lng + 180) / 360) * 2 ** z); }
function lat2y(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

function tileUrls(template, b, zMin, zMax) {
  const out = [];
  for (let z = zMin; z <= zMax; z++) {
    const x0 = lng2x(b.getWest(), z), x1 = lng2x(b.getEast(), z);
    const y0 = lat2y(b.getNorth(), z), y1 = lat2y(b.getSouth(), z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      out.push(template.replace('{z}', z).replace('{x}', x).replace('{y}', y));
      if (out.length > MAX_TILES) return null;
    }
  }
  return out;
}

// Build the list of what to save for the current view. Returns { items, zMax } or throws.
export async function planArea(map, baseKey) {
  const b = map.getBounds();
  const z = Math.max(10, map.getZoom());
  // basemap: OpenStreetMap's tile policy forbids bulk downloads, so offline maps use USGS Topo
  const base = baseKey === 'satellite' ? CFG.basemaps.satellite : CFG.basemaps.topo;
  let tiles = null, zMax = Math.min(16, z + 3);
  for (; zMax >= z; zMax--) {
    tiles = tileUrls(base.url, b, Math.max(8, z - 2), zMax);
    if (tiles) break;
  }
  if (!tiles) throw new Error('This view is too big to save. Zoom in a little and try again.');
  const items = tiles.map((url) => ({ url, cache: 'mf-tiles' }));
  for (const url of await gridTileUrls(b.getSouth(), b.getWest(), b.getNorth(), b.getEast())) items.push({ url: new URL(url, location.href).href, cache: 'mf-data' });
  const c = b.getCenter();
  const api = [
    D.publicLandsRequestUrl(b.pad(0.15), map.getZoom()),
    D.weatherUrl([[c.lat, c.lng]]),
  ];
  if (b.getNorth() - b.getSouth() < 0.4) api.push(D.trailsUrl(b.getSouth(), b.getWest(), b.getNorth(), b.getEast()));
  for (const url of api) items.push({ url, cache: 'mf-api' });
  return { items, zMax, base: base.name };
}

export async function saveArea(map, baseKey, onProgress) {
  const reg = await navigator.serviceWorker?.ready;
  if (!reg || !reg.active) throw new Error('Offline saving needs a browser that supports it (and the page loaded over https).');
  const plan = await planArea(map, baseKey);
  await new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      onProgress && onProgress(e.data);
      if (e.data.finished) resolve();
    };
    reg.active.postMessage({ type: 'cache-area', items: plan.items }, [ch.port2]);
  });
  const b = map.getBounds();
  const area = {
    south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast(), zoom: map.getZoom(),
    landsUrl: plan.items.find((i) => i.url.includes('PADUS'))?.url,
    weatherUrl: plan.items.find((i) => i.url.includes('open-meteo'))?.url,
    trailsUrl: plan.items.find((i) => i.url.includes('overpass'))?.url,
    saved: new Date().toISOString(),
    count: plan.items.length,
  };
  try { localStorage.setItem(AREA_KEY, JSON.stringify(area)); } catch { /* ignore */ }
  return area;
}

// When live requests fail, fall back to the saved area's cached copies (served by the service worker)
export async function offlineFallback(kind) {
  const a = savedArea();
  const url = a && a[kind + 'Url'];
  if (!url) return null;
  const r = await fetch(url).catch(() => null);
  return r && r.ok ? r.json() : null;
}
