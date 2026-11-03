import { SPECIES } from './species.js';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

function doy(mmdd, year) {
  const [m, d] = mmdd.split('-').map(Number);
  return Math.round((Date.UTC(year, m - 1, d) - Date.UTC(year, 0, 1)) / 864e5);
}

// Local season curves (from Twin Cities-area iNaturalist records, relative to how many people
// are out looking that week). Set by the app once data/model.json loads.
const LOCAL_SEASON = {};
export function setLocalSeasons(model) {
  for (const [k, e] of Object.entries((model && model.species) || {})) if (e.season) LOCAL_SEASON[k] = e.season;
}
export function hasLocalSeason(key) {
  return !!LOCAL_SEASON[key];
}

export function seasonFactor(sp, date = new Date(), key = null) {
  const curve = key && LOCAL_SEASON[key];
  if (curve) {
    const yday = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / 864e5);
    // the busiest ~half of the season counts as full season
    return clamp(curve[Math.min(52, Math.floor(yday / 7))] / 0.45);
  }
  return ruleSeason(sp, date);
}

function ruleSeason(sp, date) {
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
// recent: { days, km } when someone logged this species nearby lately (iNaturalist)
export function timing(key, w, date = new Date(), recent = null) {
  const sp = SPECIES[key];
  let season = seasonFactor(sp, date, key);
  let temp = tempFit(sp, w.high7);
  let soilNote = null;
  if (sp.soil && isFinite(w.soilT)) {
    const s = sp.soil, t = w.soilT;
    let f = 1;
    if (t < s.min || t > s.max) f = 0.05;
    else if (t < s.idealLow) f = (t - s.min) / (s.idealLow - s.min);
    else if (t > s.idealHigh) f = 1 - (t - s.idealHigh) / (s.max - s.idealHigh);
    if (f < temp) temp = f;
    if (f < 0.5) soilNote = `Soil is ${Math.round(t)}°F; they want about ${s.idealLow}–${s.idealHigh}°F.`;
  }
  const wet = wetness(w);
  let t = season * (0.1 + 0.9 * temp * wet);
  const notes = [];
  if (sp.freezeKill && w.minLow3 < sp.freezeKill) {
    t *= 0.35;
    notes.push(`Hard freeze recently (${Math.round(w.minLow3)}°F) — late-season flushes are likely done.`);
  }
  if (recent && recent.days <= 14) {
    // someone just found it nearby: it's fruiting, whatever the calendar says
    const floor = recent.days <= 7 ? 0.75 : 0.6;
    if (t < floor) t = floor;
    if (season < 0.5) season = 0.5;
    notes.unshift(`Found ${recent.days === 0 ? 'today' : recent.days === 1 ? 'yesterday' : recent.days + ' days ago'} about ${Math.round(recent.km * 0.621)} mi away.`);
  }
  if (season === 0) notes.push('Out of season.');
  else if (season < 0.5) notes.push('Edge of the season.');
  if (soilNote && season > 0) notes.push(soilNote);
  if (wet < 0.4) notes.push('Dry lately — fruiting slows until a soaking rain.');
  if (temp < 0.4 && season > 0) notes.push(w.high7 < sp.temp.idealLow ? 'Colder than ideal.' : 'Warmer than ideal.');
  return { value: clamp(t), season, temp, wet, notes };
}

// Timing for each of the next 7 days, using the forecast. Returns [{date, value}] (today first).
export function outlook(key, w, recent = null) {
  const out = [];
  const ti = w.days.findIndex((d) => d.today);
  if (ti < 0) return out;
  for (let i = ti; i < w.days.length; i++) {
    const day = w.days[i];
    const date = new Date(day.date + 'T12:00:00');
    const dw = i === ti ? w : dayWeather(w, i);
    const r = recent ? { ...recent, days: recent.days + (i - ti) } : null;
    out.push({ date: day.date, value: timing(key, dw, date, r).value });
  }
  return out;
}

// Weather summary as it will look on day i (forecast days have no soil moisture; soil temp is
// approximated by the 5-day mean air temperature).
export function dayWeather(w, i) {
  const d = w.days;
  const sum = (a, b) => d.slice(Math.max(0, a), Math.max(0, b)).reduce((s, x) => s + (x.rain || 0), 0);
  const mean = (a, b, f) => { const s = d.slice(Math.max(0, a), b).map(f).filter((v) => v != null); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : NaN; };
  return {
    rainLag: sum(i - 10, i - 1),
    high7: mean(i - 6, i + 1, (x) => x.hi),
    low7: mean(i - 6, i + 1, (x) => x.lo),
    minLow3: Math.min(...d.slice(Math.max(0, i - 2), i + 1).map((x) => x.lo).filter((v) => v != null)),
    soilT: mean(i - 4, i + 1, (x) => (x.hi != null && x.lo != null ? (x.hi + x.lo) / 2 : null)),
    soilM: NaN,
  };
}

// ---------- habitat from the detailed grid ----------
// g: band values around the place (data/grid). modelSuit: 0..1 from the sightings model, or null.
export function habitatGrid(key, g, modelSuit = null, modelW = 0.5) {
  const sp = SPECIES[key];
  const p = sp.g;
  const lcMap = { decid: 'lc_decid', mixed: 'lc_mixed', wetwood: 'lc_wetwood', conifer: 'lc_conifer', grass: 'lc_grass', pasture: 'lc_pasture', devopen: 'lc_devopen', shrub: 'lc_shrub' };
  let forest = 0;
  for (const [k, w] of Object.entries(sp.lc)) forest += w * (g[lcMap[k]] || 0);
  forest = clamp(forest / 0.75); // full credit once ~3/4 of the area is suitable cover
  let host = 0;
  const hits = [];
  for (const [b, w] of Object.entries(p.hosts)) {
    const ba = g[b] || 0;
    host += w * ba;
    if (ba >= 2) hits.push(b);
  }
  host = clamp(host / p.hostScale);
  // dead wood and recent damage
  let dead = 0;
  const deadHits = [];
  for (const [b, w] of Object.entries(p.dead)) {
    const v = g[b] || 0;
    const n = b.startsWith('dead_') ? clamp(v / 15) : clamp(v);
    dead += w * n;
    if (n > 0.2) deadHits.push(b);
  }
  dead = clamp(dead);
  // terrain
  let tsum = 0;
  const tf = {
    valley: clamp(-(g.valley ?? 0) / 5, -0.5, 1),
    slope: clamp(((g.slope ?? 0) - 3) / 12, -0.3, 1),
    north: g.northness ?? 0,
    south: -(g.northness ?? 0),
  };
  for (const [t, w] of Object.entries(p.terrain)) tsum += w * tf[t];
  const terrain = clamp(1 + 0.3 * tsum, 0.6, 1.4);
  let rule = clamp(forest * (p.floor + (1 - p.floor) * host) * terrain + 0.35 * dead * forest);
  const value = modelSuit == null || !modelW ? rule : clamp((1 - modelW) * rule + modelW * modelSuit);
  return { value, rule, model: modelSuit, forest, host, dead, terrain, hits, deadHits };
}

// Habitat from land cover (how much suitable forest) and host-tree density
// cover: { decid, mixed, wetwood, conifer } fractions; trees: { white_oak: ba, ... }
export function habitat(key, { cover, trees }) {
  const sp = SPECIES[key];
  let forest = 0.3; // unknown cover: assume some
  if (cover) {
    forest = 0;
    for (const [k, w] of Object.entries(sp.lc)) forest += w * (cover[k] || 0);
    forest = clamp(forest / 0.45); // saturates once ~45% of the area is good forest
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

// Overall: geometric mean of habitat and timing, gated by access.
// (Multiplying raw factors made everything look poor.)
export function combine(h, t, access) {
  return Math.sqrt(Math.max(0, h) * Math.max(0, t)) * access;
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
