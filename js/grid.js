// Reads the precomputed habitat grid (data/grid, built by pipeline/build.py on GitHub Actions).
// Each tile is 256x256 cells, band-major uint8, gzip. Values are decoded with the per-band scale.

let metaP = null;
const tiles = new Map(); // "ty_tx" -> Promise<Uint8Array|null>

export function gridMeta() {
  if (!metaP) {
    metaP = fetch('data/grid/meta.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return metaP;
}

async function gunzip(buf) {
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function loadTile(m, ty, tx) {
  const key = ty + '_' + tx;
  if (!tiles.has(key)) {
    tiles.set(key, fetch(`data/grid/${key}.bin.gz?v=${m.version || m.built}`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? gunzip(b) : null))
      .catch(() => null));
  }
  return tiles.get(key);
}

function decode(m, name, v) {
  const s = m.scales[name];
  return (v - (s.offset || 0)) / s.scale;
}

export function inGrid(m, lat, lng) {
  return m && lat > m.south && lat < m.north && lng > m.west && lng < m.east;
}

// Average every band over a lat/lng box (or a single cell when the box is tiny).
// Returns { band: value, ... } or null outside the grid / when tiles are missing.
export async function gridBox(south, west, north, east) {
  const m = await gridMeta();
  if (!m) return null;
  const r0 = Math.max(0, Math.floor((m.north - north) / m.dlat));
  const r1 = Math.min(m.rows - 1, Math.floor((m.north - south) / m.dlat));
  const c0 = Math.max(0, Math.floor((west - m.west) / m.dlng));
  const c1 = Math.min(m.cols - 1, Math.floor((east - m.west) / m.dlng));
  if (r0 > r1 || c0 > c1) return null;
  // subsample big boxes so a scan cell never reads more than ~400 cells
  const step = Math.max(1, Math.floor(Math.sqrt(((r1 - r0 + 1) * (c1 - c0 + 1)) / 400)));
  const nb = m.bands.length;
  const T = m.tile;
  const sums = new Float64Array(nb);
  let n = 0;
  const needed = new Set();
  for (let r = r0; r <= r1; r += step) for (let c = c0; c <= c1; c += step) needed.add(Math.floor(r / T) + '_' + Math.floor(c / T));
  const loaded = {};
  await Promise.all([...needed].map(async (k) => {
    const [ty, tx] = k.split('_').map(Number);
    loaded[k] = await loadTile(m, ty, tx);
  }));
  for (let r = r0; r <= r1; r += step) {
    for (let c = c0; c <= c1; c += step) {
      const ty = Math.floor(r / T), tx = Math.floor(c / T);
      const t = loaded[ty + '_' + tx];
      if (!t) continue;
      const off = (r - ty * T) * T + (c - tx * T);
      for (let b = 0; b < nb; b++) sums[b] += t[b * T * T + off];
      n++;
    }
  }
  if (!n) return null;
  const out = {};
  m.bands.forEach((name, b) => (out[name] = decode(m, name, sums[b] / n)));
  return out;
}

// Values around a point (~400 m box), for "this spot"
export function gridAt(lat, lng) {
  const dLat = 0.0018, dLng = dLat / Math.cos((lat * Math.PI) / 180);
  return gridBox(lat - dLat, lng - dLng, lat + dLat, lng + dLng);
}

// Every tile URL covering a box (used to save an area for offline use)
export async function gridTileUrls(south, west, north, east) {
  const m = await gridMeta();
  if (!m) return [];
  const T = m.tile;
  const r0 = Math.max(0, Math.floor((m.north - north) / m.dlat / T));
  const r1 = Math.min(Math.ceil(m.rows / T) - 1, Math.floor((m.north - south) / m.dlat / T));
  const c0 = Math.max(0, Math.floor((west - m.west) / m.dlng / T));
  const c1 = Math.min(Math.ceil(m.cols / T) - 1, Math.floor((east - m.west) / m.dlng / T));
  const urls = ['data/grid/meta.json', 'data/model.json'];
  for (let ty = r0; ty <= r1; ty++) for (let tx = c0; tx <= c1; tx++) urls.push(`data/grid/${ty}_${tx}.bin.gz?v=${m.version || m.built}`);
  return urls;
}

// ---------- sightings model (data/model.json) ----------
let modelP = null;
export function loadModel() {
  if (!modelP) modelP = fetch('data/model.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return modelP;
}

// How much to trust a species' sightings model: 0 below AUC 0.55, up to 0.5 at AUC 0.85+
export function modelWeight(model, key) {
  const md = model && model.species && model.species[key] && model.species[key].model;
  if (!md || md.auc == null || md.auc < 0.6) return 0;
  return Math.max(0, Math.min(0.5, (md.auc - 0.55) / 0.6));
}

// Habitat suitability from the sightings model: the share of places people look for fungi
// that score lower than this one (0..1). null when there's no model for this species.
export function modelSuitability(model, key, g) {
  const sp = model && model.species && model.species[key];
  const md = sp && sp.model;
  if (!md || !g || md.auc == null || md.auc < 0.6) return null;
  let z = md.intercept;
  model.features.forEach((f, i) => {
    const v = g[f];
    if (v == null) return;
    z += md.coef[i] * ((v - md.mean[i]) / md.sd[i]);
  });
  const q = md.bg_q; // 0,5,...,100th percentiles
  if (z <= q[0]) return 0;
  if (z >= q[q.length - 1]) return 1;
  for (let i = 1; i < q.length; i++) {
    if (z <= q[i]) return ((i - 1) + (z - q[i - 1]) / Math.max(1e-9, q[i] - q[i - 1])) / (q.length - 1);
  }
  return 1;
}
