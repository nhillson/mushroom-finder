import { SPECIES } from './species.js';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

function doy(mmdd, year) {
  const [m, d] = mmdd.split('-').map(Number);
  return Math.round((Date.UTC(year, m - 1, d) - Date.UTC(year, 0, 1)) / 864e5);
}

export function seasonFactor(sp, date = new Date()) {
  const y = date.getFullYear();
  const t = doy(`${date.getMonth() + 1}-${date.getDate()}`, y);
  let best = 0;
  for (const s of sp.seasons) {
    const a = doy(s.start, y), b = doy(s.full, y), c = doy(s.fade, y), e = doy(s.end, y);
    let f = 0;
    if (t >= b && t <= c) f = 1;
    else if (t >= a && t < b) f = b === a ? 1 : (t - a) / (b - a);
    else if (t > c && t <= e) f = e === c ? 1 : 1 - (t - c) / (e - c);
    best = Math.max(best, f * s.peak);
  }
  return best;
}

export function tempFit(sp, high7) {
  if (!isFinite(high7)) return 0.5;
  const { minHigh, idealLow, idealHigh, maxHigh } = sp.temp;
  if (high7 < minHigh) return 0.08;
  if (high7 < idealLow) return 0.08 + 0.92 * (high7 - minHigh) / (idealLow - minHigh);
  if (high7 <= idealHigh) return 1;
  if (high7 < maxHigh) return 1 - 0.8 * (high7 - idealHigh) / (maxHigh - idealHigh);
  return 0.2;
}

export function wetness(w) {
  const rainPart = clamp(w.rainLag / 0.9);
  const soilPart = isFinite(w.soilM) ? clamp((w.soilM - 0.12) / 0.2) : rainPart;
  return clamp(0.15 + 0.85 * (0.6 * rainPart + 0.4 * soilPart));
}

// Timing: is this a good week for this mushroom here?
export function timing(key, w, date = new Date()) {
  const sp = SPECIES[key];
  const season = seasonFactor(sp, date);
  const temp = tempFit(sp, w.high7);
  const wet = wetness(w);
  let t = season * (0.1 + 0.9 * temp * wet);
  const notes = [];
  if (sp.freezeKill && w.minLow3 < sp.freezeKill) {
    t *= 0.35;
    notes.push(`Hard freeze recently (${Math.round(w.minLow3)}°F) — late-season flushes are likely done.`);
  }
  if (season === 0) notes.push('Out of season.');
  else if (season < 0.5) notes.push('Edge of the season.');
  if (wet < 0.4) notes.push('Dry lately — fruiting slows until a soaking rain.');
  if (temp < 0.4 && season > 0) notes.push(w.high7 < sp.temp.idealLow ? 'Colder than ideal.' : 'Warmer than ideal.');
  return { value: clamp(t), season, temp, wet, notes };
}

// Habitat from land cover (how much suitable forest) and host-tree density
// cover: { decid, mixed, wetwood, conifer } fractions; trees: { white_oak: ba, ... }
export function habitat(key, { cover, trees }) {
  const sp = SPECIES[key];
  let forest = 0.3; // unknown cover: assume some
  if (cover) {
    forest = 0;
    for (const [k, w] of Object.entries(sp.lc)) forest += w * (cover[k] || 0);
    forest = clamp(forest / 0.6); // saturates once ~60% of the area is good forest
  }
  let host = 0;
  const treeHits = [];
  if (trees) {
    for (const [k, w] of Object.entries(sp.hostTrees)) {
      const ba = trees[k];
      if (isFinite(ba) && ba > 0) {
        host += w * ba;
        if (ba >= 1) treeHits.push(k);
      }
    }
  }
  host = clamp(host / sp.hostScale);
  const h = forest * (sp.hostFloor + (1 - sp.hostFloor) * host);
  return { value: clamp(h), forest, host, treeHits };
}

export function label(v) {
  if (v >= 0.65) return 'Prime';
  if (v >= 0.45) return 'Good';
  if (v >= 0.25) return 'Fair';
  return 'Poor';
}

// Color ramp for score 0..1 (cream -> amber -> deep brown-red)
export function scoreColor(v) {
  const stops = [
    [0, [245, 238, 220]],
    [0.25, [240, 200, 120]],
    [0.5, [226, 140, 50]],
    [0.75, [184, 76, 30]],
    [1, [120, 30, 20]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const t = (v - a) / (b - a);
      const c = ca.map((x, j) => Math.round(x + (cb[j] - x) * t));
      return `rgb(${c.join(',')})`;
    }
  }
  return 'rgb(120,30,20)';
}

// ---------- Point in polygon for GeoJSON ----------
function inRing(pt, ring) {
  let inside = false;
  const [x, y] = pt;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inPoly(pt, rings) {
  if (!rings.length || !inRing(pt, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(pt, rings[k])) return false;
  return true;
}
export function featuresAt(pt, fc) {
  const hits = [];
  for (const f of fc.features || []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon' && inPoly(pt, g.coordinates)) hits.push(f);
    else if (g.type === 'MultiPolygon' && g.coordinates.some((p) => inPoly(pt, p))) hits.push(f);
  }
  return hits;
}
