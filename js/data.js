import { CFG, NLCD, TREES } from './config.js';

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  const j = await r.json();
  if (j && j.error) throw new Error(j.error.message || 'Service error');
  return j;
}

function form(params) {
  const b = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) b.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  return { method: 'POST', body: b, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
}

// ---------- Tree species basal area (USFS Forest Atlas mosaic) ----------
let treeCatalog = null; // rasterId -> raster name (e.g. 20 -> 's802')
function treeRasterNames() {
  if (!treeCatalog) {
    treeCatalog = getJSON(CFG.treeSpecies + '/query?where=1%3D1&outFields=objectid,name&returnGeometry=false&f=json')
      .then((j) => Object.fromEntries((j.features || []).map((f) => [f.attributes.objectid, f.attributes.name])));
    treeCatalog.catch(() => (treeCatalog = null));
  }
  return treeCatalog;
}

// points: [[lng, lat], ...] -> [{ white_oak: ba, quaking_aspen: ba, ... }, ...]
export async function treeBasalAreaAt(points) {
  const params = {
    geometry: { points, spatialReference: { wkid: 4326 } },
    geometryType: 'esriGeometryMultipoint',
    returnFirstValueOnly: 'false', // one value per species raster
    interpolation: 'RSP_NearestNeighbor',
    f: 'json',
  };
  const names = await treeRasterNames();
  const byRaster = {};
  for (const [k, t] of Object.entries(TREES)) byRaster[t.raster] = k;
  // only sample the rasters we track (about twice as fast as sampling all 24)
  const lock = Object.entries(names).filter(([, n]) => byRaster[n]).map(([id]) => Number(id));
  if (lock.length) params.mosaicRule = { mosaicMethod: 'esriMosaicLockRaster', lockRasterIds: lock };
  const j = await getJSON(CFG.treeSpecies + '/getSamples', form(params));
  const out = points.map(() => ({}));
  for (const s of j.samples || []) {
    const key = byRaster[names[s.rasterId]];
    if (!key || s.locationId == null || !out[s.locationId]) continue;
    const v = parseFloat(String(s.value));
    if (isFinite(v)) out[s.locationId][key] = Math.max(out[s.locationId][key] || 0, v);
  }
  return out;
}

// Image overlay URL for one species raster over a lat/lng bounds
export function treeOverlayUrl(key, bounds, size) {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const fn = key; // raster function templates are named after the species
  const p = new URLSearchParams({
    bbox: `${sw.lng},${sw.lat},${ne.lng},${ne.lat}`,
    bboxSR: '4326',
    imageSR: '3857',
    size: `${Math.min(size.x, 2000)},${Math.min(size.y, 2000)}`,
    format: 'png32',
    transparent: 'true',
    renderingRule: JSON.stringify({ rasterFunction: fn }),
    f: 'image',
  });
  return CFG.treeSpecies + '/exportImage?' + p.toString();
}

// ---------- Land cover (NLCD) read from WMS image pixels ----------
const NLCD_COLORS = Object.entries(NLCD).map(([code, [, rgb]]) => [Number(code), rgb]);
function nearestClass(r, g, b) {
  let best = 0, bd = Infinity;
  for (const [code, [cr, cg, cb]] of NLCD_COLORS) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bd) { bd = d; best = code; }
  }
  return bd < 1200 ? best : 0;
}

export function nlcdWmsParams() {
  return { layers: CFG.nlcd.layer, format: 'image/png', transparent: true, version: '1.1.1' };
}

// Returns { w, h, classes: Uint8Array (row 0 = north) } for a lat/lng box
export function landCoverGrid(south, west, north, east, w, h) {
  const p = new URLSearchParams({
    service: 'WMS', version: '1.1.1', request: 'GetMap', layers: CFG.nlcd.layer, styles: '',
    srs: 'EPSG:4326', bbox: `${west},${south},${east},${north}`, width: String(w), height: String(h),
    format: 'image/png', transparent: 'true',
  });
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const t = setTimeout(() => reject(new Error('Land cover timed out')), 20000);
    img.onload = () => {
      clearTimeout(t);
      try {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data;
        const classes = new Uint8Array(w * h);
        for (let i = 0, k = 0; i < d.length; i += 4, k++) classes[k] = d[i + 3] < 128 ? 0 : nearestClass(d[i], d[i + 1], d[i + 2]);
        resolve({ w, h, classes });
      } catch (e) {
        reject(new Error('Land cover pixels unreadable'));
      }
    };
    img.onerror = () => { clearTimeout(t); reject(new Error('Land cover failed to load')); };
    img.src = CFG.nlcd.url + '?' + p.toString();
  });
}

// Summarize a block of classes into habitat fractions
export function coverFractions(classes) {
  const n = classes.length || 1;
  const cnt = {};
  for (const c of classes) cnt[c] = (cnt[c] || 0) + 1;
  const f = (code) => (cnt[code] || 0) / n;
  let top = 0, topN = -1;
  for (const [c, k] of Object.entries(cnt)) if (k > topN && Number(c)) { topN = k; top = Number(c); }
  return { decid: f(41), conifer: f(42), mixed: f(43), wetwood: f(90), forest: f(41) + f(42) + f(43) + f(90), dominant: top };
}

// Land-cover fractions in a ~200 m box around one point
export async function coverAt(lat, lng) {
  const dLat = 0.0018, dLng = dLat / Math.cos((lat * Math.PI) / 180);
  const g = await landCoverGrid(lat - dLat, lng - dLng, lat + dLat, lng + dLng, 14, 14);
  return coverFractions(g.classes);
}

// ---------- Vector layers ----------
function bboxParams(b) {
  return {
    geometry: `${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outSR: '4326',
  };
}

export async function publicLandsIn(bounds, zoom) {
  // generalize geometry at lower zooms so the response stays small
  const tolDeg = zoom >= 14 ? 0 : 360 / (256 * 2 ** zoom);
  const params = {
    where: '1=1',
    ...bboxParams(bounds),
    outFields: 'Unit_Nm,Pub_Access,MngTp_Desc,MngNm_Desc,DesTp_Desc,GAP_Sts,GIS_Acres',
    returnGeometry: 'true',
    geometryPrecision: '5',
    resultRecordCount: '1000',
    f: 'geojson',
  };
  if (tolDeg) params.maxAllowableOffset = String(tolDeg);
  const j = await getJSON(CFG.padus + '/query', form(params));
  return j;
}

export async function publicLandsAt(lng, lat) {
  const params = {
    where: '1=1',
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'Unit_Nm,Pub_Access,MngTp_Desc,MngNm_Desc,DesTp_Desc,GAP_Sts,GIS_Acres',
    returnGeometry: 'false',
    f: 'json',
  };
  const j = await getJSON(CFG.padus + '/query', form(params));
  return (j.features || []).map((f) => f.attributes);
}

// ---------- Weather ----------
// locs: [[lat, lng], ...] -> array of daily weather objects
export async function weatherAt(locs) {
  const p = new URLSearchParams({
    latitude: locs.map((l) => l[0].toFixed(3)).join(','),
    longitude: locs.map((l) => l[1].toFixed(3)).join(','),
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    hourly: 'soil_temperature_6cm,soil_moisture_3_to_9cm',
    past_days: '14',
    forecast_days: '7',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    timezone: 'America/Chicago',
  });
  const j = await getJSON(CFG.openMeteo + '?' + p.toString());
  const arr = Array.isArray(j) ? j : [j];
  return arr.map(summarizeWeather);
}

function summarizeWeather(w) {
  const d = w.daily;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  let ti = d.time.indexOf(today);
  if (ti < 0) ti = 14;
  const sum = (a, i0, i1) => a.slice(Math.max(0, i0), Math.max(0, i1)).reduce((s, v) => s + (v || 0), 0);
  const mean = (a, i0, i1) => {
    const s = a.slice(Math.max(0, i0), i1).filter((v) => v != null);
    return s.length ? s.reduce((x, y) => x + y, 0) / s.length : NaN;
  };
  // soil temp: average of the last 24 hourly values up to now
  const h = w.hourly || {};
  // Open-Meteo hourly times are local (America/Chicago), e.g. "2026-11-02T23:00"
  const nowLocal = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T').slice(0, 13);
  let hi = (h.time || []).findIndex((t) => t.slice(0, 13) >= nowLocal);
  if (hi < 0) hi = (h.time || []).length;
  const soilT = mean(h.soil_temperature_6cm || [], hi - 24, hi);
  const soilM = mean(h.soil_moisture_3_to_9cm || [], hi - 24, hi);

  return {
    lat: w.latitude,
    lng: w.longitude,
    rain14: sum(d.precipitation_sum, ti - 14, ti + 1),
    rainLag: sum(d.precipitation_sum, ti - 10, ti - 1), // rain 2–10 days ago: what's fruiting now
    rain3: sum(d.precipitation_sum, ti - 2, ti + 1),
    rainNext7: sum(d.precipitation_sum, ti + 1, ti + 8),
    high7: mean(d.temperature_2m_max, ti - 6, ti + 1),
    low7: mean(d.temperature_2m_min, ti - 6, ti + 1),
    minLow3: Math.min(...d.temperature_2m_min.slice(Math.max(0, ti - 2), ti + 1).filter((v) => v != null)),
    soilT,
    soilM,
    days: d.time.map((t, i) => ({
      date: t,
      hi: d.temperature_2m_max[i],
      lo: d.temperature_2m_min[i],
      rain: d.precipitation_sum[i],
      future: i > ti,
      today: i === ti,
    })),
  };
}

// ---------- iNaturalist ----------
const taxonCache = {};
export async function resolveTaxon(q, rank) {
  const key = q + '|' + rank;
  if (taxonCache[key]) return taxonCache[key];
  const j = await getJSON(`${CFG.inat}/taxa?q=${encodeURIComponent(q)}&rank=${rank}&per_page=5`);
  const hit = (j.results || []).find((t) => t.name.toLowerCase() === q.toLowerCase()) || (j.results || [])[0];
  if (!hit) throw new Error('Taxon not found: ' + q);
  taxonCache[key] = hit.id;
  return hit.id;
}

export async function observationsIn(bounds, taxonIds) {
  const p = new URLSearchParams({
    taxon_id: taxonIds.join(','),
    swlat: bounds.getSouth().toFixed(4),
    swlng: bounds.getWest().toFixed(4),
    nelat: bounds.getNorth().toFixed(4),
    nelng: bounds.getEast().toFixed(4),
    quality_grade: 'research,needs_id',
    per_page: '200',
    order_by: 'observed_on',
    order: 'desc',
    fields: 'id,observed_on,quality_grade,obscured,positional_accuracy,location,taxon.id,taxon.name,taxon.preferred_common_name,taxon.ancestor_ids,photos.url,uri',
  });
  const j = await getJSON(`${CFG.inat}/observations?${p.toString()}`);
  return j.results || [];
}

export async function monthHistogram(taxonIds, bounds) {
  const p = new URLSearchParams({
    taxon_id: taxonIds.join(','),
    swlat: bounds[0][0], swlng: bounds[0][1], nelat: bounds[1][0], nelng: bounds[1][1],
    quality_grade: 'research',
    date_field: 'observed',
    interval: 'month_of_year',
  });
  const j = await getJSON(`${CFG.inat}/observations/histogram?${p.toString()}`);
  return j.results ? j.results.month_of_year : null;
}
