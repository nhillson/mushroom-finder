import { CFG, NLCD, TREES, OVERLAYS, REGIONS, ACTIVE, region, regionAt } from './config.js';
import { SPECIES, GRID_TREES, useRegion } from './species.js';
import { classifyLand, accessFactor, huntingWarning, STATUS_STYLE } from './landrules.js';
import * as D from './data.js';
import { timing, habitat, habitatGrid, combine, label, scoreColor, featuresAt, outlook, setLocalSeasons, seasonFactor, hasLocalSeason } from './score.js';
import { gridMeta, gridAt, gridBox, inGrid, loadModel, modelSuitability, modelWeight } from './grid.js';
import * as Mine from './mine.js';
import { registerSW, saveArea, savedArea, offlineFallback } from './offline.js';

const L = window.L;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------- persisted settings (light convenience only) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('mf.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mf.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

// ---------- region (Minnesota or Southern California) ----------
// Chosen by ?region= in the link, else where the map was last left, else Minnesota.
const params = new URLSearchParams(location.search);
const savedView = store.get('view', null);
const urlRegion = REGIONS[params.get('region')] ? params.get('region') : null;
ACTIVE.region = urlRegion || (savedView && regionAt(savedView.c[0], savedView.c[1])) || store.get('region', 'mn');
if (!REGIONS[ACTIVE.region]) ACTIVE.region = 'mn';
useRegion(ACTIVE.region);
const speciesKey = () => (ACTIVE.region === 'mn' ? 'species' : 'species.' + ACTIVE.region);
function loadSpeciesSel() {
  const sel = new Set(store.get(speciesKey(), Object.keys(SPECIES)).filter((k) => SPECIES[k]));
  return sel.size ? sel : new Set(Object.keys(SPECIES));
}
const nowIn = (tz) => new Date().toLocaleDateString('en-CA', { timeZone: tz });

const state = {
  species: loadSpeciesSel(),
  mode: store.get('mode', 'look'),
  lands: null, // last PAD-US FeatureCollection for view
  landsBounds: null,
  weatherCache: new Map(),
  scan: null,
  recent: {}, // species -> { days, km }
  model: null,
  grid: null,
};

registerSW();

// ---------- map ----------
const startView = urlRegion || !savedView ? { c: region().center, z: region().zoom } : savedView;
const map = L.map('map', { zoomControl: false, minZoom: 4 }).setView(startView.c, startView.z);
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ imperial: true, metric: false, position: 'bottomright' }).addTo(map);

const bases = {};
for (const [k, b] of Object.entries(CFG.basemaps)) {
  bases[k] = L.tileLayer(b.url, { attribution: b.attribution, maxNativeZoom: b.maxNativeZoom, maxZoom: 18 });
  $('#lyrBase').insertAdjacentHTML('beforeend', `<option value="${k}">${b.name}</option>`);
}
let baseKey = store.get('base', 'topo');
if (!bases[baseKey]) baseKey = 'topo';
bases[baseKey].addTo(map);
$('#lyrBase').value = baseKey;
$('#lyrBase').onchange = (e) => {
  map.removeLayer(bases[baseKey]);
  baseKey = e.target.value;
  bases[baseKey].addTo(map).bringToBack();
  store.set('base', baseKey);
};

map.createPane('forest').style.zIndex = 350;
map.createPane('lands').style.zIndex = 400;
map.createPane('scan').style.zIndex = 420;
map.createPane('trails').style.zIndex = 430;
map.createPane('trails').style.pointerEvents = 'none';
map.createPane('parking').style.zIndex = 440;
// canvas renderers: thousands of lines/markers stay fast (DOM markers were crashing phones)
const trailRenderer = L.canvas({ pane: 'trails', padding: 0.3 });
const parkRenderer = L.canvas({ pane: 'parking', padding: 0.3, tolerance: 6 });

const landLayer = L.geoJSON(null, { pane: 'lands', style: landStyle, interactive: false }).addTo(map);
const scanLayer = L.layerGroup().addTo(map);
const obsLayer = L.layerGroup().addTo(map);
const trailLayer = L.layerGroup().addTo(map);
const mineLayer = L.layerGroup().addTo(map);
let forestOverlay = null;
let spotMarker = null;

function firstCoord(g) {
  let c = g && g.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return c || [null, null];
}
function landStyle(f) {
  const [lng0, lat0] = firstCoord(f.geometry);
  const st = classifyLand(f.properties, lat0, lng0).status;
  const c = STATUS_STYLE[st].color;
  return { color: c, weight: 1.5, fillColor: c, fillOpacity: st === 'closed' ? 0.12 : 0.16, dashArray: st === 'check' ? '4 3' : null };
}

// ---------- toasts ----------
let toastT;
function toast(msg, ms = 3200) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; $('.layout').appendChild(t); }
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.hidden = true), ms);
}

// ---------- species chips, "in season" filter, mode ----------
function inSeasonSet() {
  const now = new Date();
  return new Set(Object.keys(SPECIES).filter((k) => seasonFactor(SPECIES[k], now, k) >= 0.35 || (state.recent[k] && state.recent[k].days <= 14)));
}
function sameSet(a, b) { return a.size === b.size && [...a].every((x) => b.has(x)); }
function renderChips() {
  const ins = inSeasonSet();
  const inOn = ins.size > 0 && sameSet(ins, state.species);
  const total = Object.keys(SPECIES).length;
  $('#speciesBtn').innerHTML = `<span class="pick-ico">🍄</span>${inOn ? `In season (${state.species.size})` : state.species.size === total ? 'All mushrooms' : state.species.size === 1 ? SPECIES[[...state.species][0]].name : `${state.species.size} of ${total} mushrooms`} <span class="caret">▾</span>`;
  $('#speciesChips').innerHTML = `<button class="chip special" data-k="__season" aria-pressed="${inOn}" title="Select only what's in season now">In season</button>` +
    `<button class="chip special" data-k="__all" aria-pressed="${state.species.size === Object.keys(SPECIES).length}">All</button>` +
    Object.entries(SPECIES)
      .map(([k, s]) => `<button class="chip" data-k="${k}" style="--c:${s.color}" aria-pressed="${state.species.has(k)}"><span class="dot"></span>${s.name}${ins.has(k) ? '' : ' <span class="off">· off-season</span>'}</button>`)
      .join('');
}
function speciesChanged() {
  store.set(speciesKey(), [...state.species]);
  renderChips();
  refreshConditions();
  refreshObservations();
  renderLegend();
  if (state.scan) redrawScan();
  if (state.lastSpot) showSpot(state.lastSpot.lat, state.lastSpot.lng, false);
}
$('#speciesChips').onclick = (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  const k = b.dataset.k;
  if (k === '__season') {
    const ins = inSeasonSet();
    if (!ins.size) return toast('Nothing is in season right now.');
    state.species = ins;
  } else if (k === '__all') {
    state.species = new Set(Object.keys(SPECIES));
  } else if (state.species.has(k) && state.species.size > 1) state.species.delete(k);
  else state.species.add(k);
  speciesChanged();
};
renderChips();
function toggleSpeciesPop(open) {
  const pop = $('#speciesPop');
  const show = open ?? pop.hidden;
  pop.hidden = !show;
  $('#speciesBtn').setAttribute('aria-expanded', String(show));
}
$('#speciesBtn').onclick = (e) => { e.stopPropagation(); toggleSpeciesPop(); };
$('#speciesDone').onclick = () => toggleSpeciesPop(false);
// stays open while picking; closes only from the dropdown button or Done

function renderMode() {
  document.querySelectorAll('#modeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
}
renderMode();
$('#modeSeg').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.mode = b.dataset.mode;
  store.set('mode', state.mode);
  renderMode();
  if (state.scan) redrawScan();
  if (state.lastSpot) showSpot(state.lastSpot.lat, state.lastSpot.lng, false);
};

// ---------- data per region: habitat grid and sightings model ----------
function loadRegionData() {
  const r = ACTIVE.region;
  state.grid = null;
  state.model = null;
  setLocalSeasons(null);
  gridMeta().then((m) => { if (ACTIVE.region === r) state.grid = m; });
  loadModel().then((m) => {
    if (ACTIVE.region !== r) return;
    state.model = m;
    if (m) {
      setLocalSeasons(m);
      renderChips();
      refreshConditions();
    }
  });
}
loadRegionData();

function renderRegionText() {
  const R = region();
  $('#clubLine').innerHTML = `The <a href="${R.club.url}" target="_blank" rel="noopener">${esc(R.club.name)}</a> runs forays and ID sessions.`;
  $('#rulesChecked').textContent = `Rules last checked ${R.rulesChecked}.`;
  $('#spRegion').textContent = R.name;
  $('#lyrRegion').value = R.id;
}

// Switch the whole app to another region: its mushrooms, seasons, data and rules.
function switchRegion(r) {
  if (r === ACTIVE.region || !REGIONS[r]) return;
  ACTIVE.region = r;
  store.set('region', r);
  useRegion(r);
  state.species = loadSpeciesSel();
  state.lands = null;
  state.landsBounds = null;
  state.recent = {};
  recentKey = '';
  state.scan = null;
  scanLayer.clearLayers();
  $('#scanInfo').hidden = true;
  try { history.replaceState(null, '', '?region=' + r); } catch { /* ignore */ }
  loadRegionData();
  renderRegionText();
  renderChips();
  renderLegend();
  toast(`Now showing ${region().name}.`);
}

// ---------- weather ----------
async function weatherNear(lat, lng) {
  const key = lat.toFixed(1) + ',' + lng.toFixed(1);
  if (state.weatherCache.has(key)) return state.weatherCache.get(key);
  const p = D.weatherAt([[lat, lng]]).then((a) => a[0]).catch(async (e) => {
    const off = await offlineFallback('weather');
    if (off) { const s = D.summarizeWeatherJSON(off); s.offline = true; return s; }
    throw e;
  });
  state.weatherCache.set(key, p);
  p.catch(() => state.weatherCache.delete(key));
  return p;
}

function outlookStrip(k, w) {
  const o = outlook(k, w, state.recent[k]);
  if (o.length < 2) return '';
  const best = o.slice(1).reduce((a, b) => (b.value > a.value ? b : a), o[1]);
  const cells = o.map((d, i) => {
    const dt = new Date(d.date + 'T12:00:00');
    return `<span class="od" title="${DAY[dt.getDay()]}: ${label(d.value)}" style="background:${scoreColor(d.value)}">${i === 0 ? 'now' : DAY[dt.getDay()][0]}</span>`;
  }).join('');
  const hint = best.value > o[0].value + 0.12
    ? `Better ${DAY[new Date(best.date + 'T12:00:00').getDay()]} (${label(best.value)})`
    : o[0].value >= 0.45 && o.slice(1, 4).every((d) => d.value < o[0].value - 0.12) ? 'Go soon — fading' : '';
  return `<div class="outlook">${cells}${hint ? `<span class="o-hint">${hint}</span>` : ''}</div>`;
}

function timingRows(w) {
  const rows = [...state.species].map((k) => ({ k, t: timing(k, w, new Date(), state.recent[k]) })).sort((a, b) => b.t.value - a.t.value);
  return rows.map(({ k, t }) => {
    const s = SPECIES[k];
    return `<div class="sp-row" style="--c:${s.color}">
      <div class="sp-name"><span class="dot"></span>${s.name}${hasLocalSeason(k) ? '' : ' <span class="muted" title="Too few local records; using a general season window">*</span>'}</div>
      <span class="pill ${label(t.value)}">${label(t.value)}</span>
      <div class="bar"><i style="width:${Math.round(t.value * 100)}%"></i></div>
      ${outlookStrip(k, w)}
      ${t.notes.length ? `<div class="sp-notes">${esc(t.notes.join(' '))}</div>` : ''}
    </div>`;
  }).join('');
}

function weatherBlock(w) {
  // chart: the last two weeks plus the forecast
  const ti = w.days.findIndex((d) => d.today);
  const days = ti >= 0 ? w.days.slice(Math.max(0, ti - 14)) : w.days;
  const long = region().rain.to > 14;
  const max = Math.max(0.5, ...days.map((d) => d.rain || 0));
  const bars = days.map((d) => `<i class="${d.future ? 'future' : ''} ${d.today ? 'today' : ''}" style="height:${Math.max(2, ((d.rain || 0) / max) * 100)}%" title="${d.date}: ${(d.rain || 0).toFixed(2)} in"></i>`).join('');
  return `${w.offline ? '<p class="banner">Offline: showing the weather saved with your offline area.</p>' : ''}
    <div class="wx-row">
      <div class="wx"><b>${(long ? w.rain30 : w.rain14).toFixed(2)}″</b><span>rain, last ${long ? 30 : 14} days</span></div>
      <div class="wx"><b>${Math.round(w.high7)}° / ${Math.round(w.low7)}°</b><span>avg high / low, 7 days</span></div>
      <div class="wx"><b>${isFinite(w.soilT) ? Math.round(w.soilT) + '°' : '—'}</b><span>soil temp (2″)</span></div>
    </div>
    <div class="rainbars" aria-label="Daily rain, past 14 days and next 7">${bars}</div>
    <div class="rainaxis"><span>2 weeks ago</span><span class="today-lbl" style="left:${((days.findIndex((d) => d.today) + 0.5) / days.length) * 100}%">today</span><span>next 7 days: ${w.rainNext7.toFixed(2)}″</span></div>`;
}

function huntBanner() {
  const h = huntingWarning({ hunt: true, state: region().state });
  if (!h || h.level !== 'high') return '';
  return `<p class="banner hunt">🟠 ${esc(h.text)} <a href="${h.link}" target="_blank" rel="noopener">Seasons</a></p>`;
}

let condSeq = 0;
async function refreshConditions() {
  const c = map.getCenter();
  const seq = ++condSeq;
  try {
    const w = await weatherNear(c.lat, c.lng);
    if (seq !== condSeq) return;
    $('#condWhere').textContent = `Map center · ${c.lat.toFixed(2)}, ${c.lng.toFixed(2)}`;
    $('#condBody').innerHTML = huntBanner() + weatherBlock(w) + timingRows(w) +
      `<p class="muted" style="margin:8px 0 0">Strip = next 7 days from the forecast.${state.model ? ' Seasons come from local iNaturalist records' : ''}${Object.keys(SPECIES).some((k) => state.species.has(k) && !hasLocalSeason(k)) ? ' (* = general season window, too few local records).' : '.'}</p>`;
  } catch (e) {
    $('#condBody').innerHTML = `<div class="err">Couldn't load weather (${esc(e.message)}).</div>`;
  }
}

// ---------- recent sightings nearby (live "it's up" signal) ----------
let recentKey = '';
const taxonIds = {}; // "region:key" -> [iNat taxon ids]
async function speciesTaxa() {
  const out = {};
  for (const k of Object.keys(SPECIES)) {
    const id = ACTIVE.region + ':' + k;
    if (!taxonIds[id]) taxonIds[id] = await Promise.all(SPECIES[k].inatTaxa.map((t) => D.resolveTaxon(t.q, t.rank)));
    out[k] = taxonIds[id];
  }
  return out;
}
async function refreshRecent() {
  const c = map.getCenter();
  const key = c.lat.toFixed(1) + ',' + c.lng.toFixed(1);
  if (key === recentKey) return;
  recentKey = key;
  const r = ACTIVE.region;
  try {
    const ids = await speciesTaxa();
    const obs = await D.recentNear(c.lat, c.lng, 60, Object.values(ids).flat(), 14);
    if (ACTIVE.region !== r) return;
    const today = new Date(nowIn(region().tz) + 'T12:00:00');
    const rec = {};
    for (const o of obs) {
      const k = Object.keys(ids).find((kk) => ids[kk].some((id) => o.taxa.includes(id)));
      if (!k || !o.observed_on) continue;
      const days = Math.max(0, Math.round((today - new Date(o.observed_on + 'T12:00:00')) / 864e5));
      const km = haversine(c.lat, c.lng, o.lat, o.lng);
      if (!rec[k] || days < rec[k].days || (days === rec[k].days && km < rec[k].km)) rec[k] = { days, km };
    }
    state.recent = rec;
    renderChips();
    refreshConditions();
    if (state.scan) redrawScan();
  } catch (e) {
    /* the live signal is a bonus; skip quietly */
  }
}
function haversine(a1, o1, a2, o2) {
  const r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const x = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

// ---------- public lands ----------
let landSeq = 0;
async function loadLands(b) {
  try {
    return await D.publicLandsIn(b, map.getZoom());
  } catch (e) {
    const off = await offlineFallback('lands');
    if (off) return off;
    throw e;
  }
}
async function refreshLands() {
  if (map.getZoom() < 9) {
    landLayer.clearLayers();
    return;
  }
  if (!$('#lyrLand').checked) landLayer.clearLayers();
  const b = map.getBounds().pad(0.15);
  const seq = ++landSeq;
  try {
    const fc = await loadLands(b);
    if (seq !== landSeq) return;
    state.lands = fc;
    state.landsBounds = b;
    if ($('#lyrLand').checked) landLayer.clearLayers().addData(fc);
    if (map.getZoom() >= 14) refreshTrails(); // parking markers depend on the public land
    if (fc.properties && fc.properties.exceededTransferLimit) toast('Lots of land parcels here — zoom in for complete coverage.');
  } catch (e) {
    toast('Public lands layer failed to load: ' + e.message, 5000);
  }
}

// ---------- overlays (land cover, tree density) ----------
for (const o of OVERLAYS) $('#lyrForest').insertAdjacentHTML('beforeend', `<option value="${o.id}">${o.name}</option>`);
$('#lyrForest').value = store.get('overlay', '');
let nlcdLayer = null;
function refreshForest() {
  const id = $('#lyrForest').value;
  if (id !== 'nlcd' && nlcdLayer) { map.removeLayer(nlcdLayer); nlcdLayer = null; }
  if (forestOverlay) { map.removeLayer(forestOverlay); forestOverlay = null; }
  if (!id) return;
  if (id === 'nlcd') {
    if (!nlcdLayer) nlcdLayer = L.tileLayer.wms(CFG.nlcd.url, { ...D.nlcdWmsParams(), pane: 'forest', opacity: 0.55, attribution: 'NLCD 2021 (MRLC)' }).addTo(map);
    return;
  }
  const b = map.getBounds();
  forestOverlay = L.imageOverlay(D.treeOverlayUrl(id, b, map.getSize()), b, { pane: 'forest', opacity: 0.7, interactive: false }).addTo(map);
  forestOverlay.on('error', () => toast('Tree density layer failed to load.'));
}
$('#lyrForest').onchange = () => { store.set('overlay', $('#lyrForest').value); refreshForest(); renderLegend(); };

// ---------- trails & parking (OpenStreetMap) ----------
const trailCache = new Map();
let trailSeq = 0;
async function refreshTrails() {
  trailLayer.clearLayers();
  if (!$('#lyrTrails').checked || map.getZoom() < 13) return;
  const b = map.getBounds().pad(0.2);
  const r = (v) => Math.round(v * 50) / 50; // snap to ~2 km so panning reuses results
  const s = r(b.getSouth()) - 0.02, w = r(b.getWest()) - 0.02, n = r(b.getNorth()) + 0.02, e = r(b.getEast()) + 0.02;
  const key = [s, w, n, e].map((v) => v.toFixed(2)).join(',');
  const seq = ++trailSeq;
  try {
    if (!trailCache.has(key)) trailCache.set(key, D.trailsFromTiles(s, w, n, e).then((t) => t || { trails: [], parking: [] }).catch(async (err) => {
      trailCache.delete(key);
      const off = await offlineFallback('trails');
      if (off) return D.parseTrails(off);
      throw err;
    }));
    const { trails, parking } = await trailCache.get(key);
    if (seq !== trailSeq) return;
    const view = map.getBounds().pad(0.3);
    for (const t of trails) {
      if (!t.coords.some((c) => view.contains(c))) continue;
      L.polyline(t.coords, { renderer: trailRenderer, color: '#6b4226', weight: t.kind === 'track' ? 2.2 : 1.8, opacity: 0.85, dashArray: t.kind === 'track' ? null : '5 4', interactive: false }).addTo(trailLayer);
    }
    // parking: only up close, nearest first, capped, and merged when lots sit next to each other
    if (map.getZoom() >= 14) {
      const c = map.getCenter();
      // only lots on or right next to (~120 m) open public land: these are the ones that serve a park or forest
      const lands = state.lands;
      const nearPublic = (p) => {
        if (!lands) return false;
        const dLat = 0.0011, dLng = 0.0015;
        for (const [a, o] of [[0, 0], [dLat, 0], [-dLat, 0], [0, dLng], [0, -dLng]]) {
          const hits = featuresAt([p.lng + o, p.lat + a], lands);
          if (hits.some((h) => classifyLand(h.properties, p.lat, p.lng).status !== 'closed')) return true;
        }
        return false;
      };
      const inView = parking.filter((p) => view.contains([p.lat, p.lng]) && nearPublic(p))
        .sort((a, b2) => ((a.lat - c.lat) ** 2 + (a.lng - c.lng) ** 2) - ((b2.lat - c.lat) ** 2 + (b2.lng - c.lng) ** 2));
      const shown = [];
      for (const p of inView) {
        if (shown.some((q) => Math.abs(q.lat - p.lat) < 0.0005 && Math.abs(q.lng - p.lng) < 0.0007)) continue;
        shown.push(p);
        if (shown.length >= 80) break;
      }
      for (const p of shown) {
        L.circleMarker([p.lat, p.lng], { renderer: parkRenderer, radius: 6, color: '#fff', weight: 2, fillColor: '#1f6fb2', fillOpacity: 1 })
          .bindPopup(`<b>${esc(p.name || 'Parking')}</b>${p.fee === 'yes' ? '<br>Fee or permit may be required' : ''}<br><a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}" target="_blank" rel="noopener">Directions</a>`)
          .addTo(trailLayer);
      }
    }
  } catch (e) {
    /* Overpass can be busy; skip quietly */
  }
}

// ---------- iNaturalist sightings ----------
let obsSeq = 0;
async function refreshObservations() {
  obsLayer.clearLayers();
  if (!$('#lyrInat').checked || map.getZoom() < 8) return;
  const seq = ++obsSeq;
  try {
    const want = [...state.species];
    const ids = await speciesTaxa();
    const all = want.flatMap((k) => ids[k]);
    const obs = await D.observationsIn(map.getBounds(), all);
    if (seq !== obsSeq) return;
    for (const o of obs) {
      if (!o.location) continue;
      const [lat, lng] = o.location.split(',').map(Number);
      const anc = [...(o.taxon?.ancestor_ids || []), o.taxon?.id];
      const k = want.find((kk) => ids[kk].some((id) => anc.includes(id)));
      if (!k) continue;
      const s = SPECIES[k];
      const m = L.circleMarker([lat, lng], {
        radius: o.obscured ? 5 : 6, color: '#fff', weight: 1.5, fillColor: s.color, fillOpacity: o.obscured ? 0.45 : 0.95,
      });
      const photo = o.photos?.[0]?.url?.replace('square', 'small');
      m.bindPopup(`<div class="obs-pop">${photo ? `<img src="${esc(photo)}" alt="">` : ''}
        <b>${esc(o.taxon?.preferred_common_name || o.taxon?.name)}</b><br>
        <i>${esc(o.taxon?.name)}</i><br>
        ${esc(o.observed_on || 'date unknown')} · ${o.quality_grade === 'research' ? 'research grade' : 'needs ID'}
        ${o.obscured ? '<br><span class="muted">Location blurred by observer (can be off by many miles)</span>' : ''}
        <br><a href="${esc(o.uri)}" target="_blank" rel="noopener">View on iNaturalist</a></div>`);
      m.on('click', (ev) => L.DomEvent.stopPropagation(ev));
      obsLayer.addLayer(m);
    }
  } catch (e) {
    if (navigator.onLine) toast('Couldn\'t load iNaturalist sightings: ' + e.message, 5000);
  }
}

// ---------- land helpers ----------
const RANK = { closed: 0, look: 1, check: 2, permit: 3, harvest: 4 };
function bestLand(attrsList, lat, lng) {
  if (!attrsList || !attrsList.length) return { cls: classifyLand(null), props: null };
  // most restrictive wins (e.g. county land inside a state forest boundary)
  let best = null;
  for (const p of attrsList) {
    const c = classifyLand(p, lat, lng);
    if (!best || RANK[c.status] < RANK[best.cls.status]) best = { cls: c, props: p };
  }
  return best;
}
async function landAt(lat, lng) {
  try {
    return bestLand(await D.publicLandsAt(lng, lat), lat, lng);
  } catch (e) {
    // offline: look it up in the lands we already have
    const fc = state.lands || (await offlineFallback('lands'));
    if (!fc) throw e;
    return bestLand(featuresAt([lng, lat], fc).map((f) => f.properties), lat, lng);
  }
}

// ---------- habitat for a place (grid if available, live services otherwise) ----------
async function placeHabitat(lat, lng) {
  const m = state.grid || (await gridMeta());
  if (m && inGrid(m, lat, lng)) {
    const g = await gridAt(lat, lng);
    if (g) return { g };
  }
  const [coverR, treesR] = await Promise.allSettled([D.coverAt(lat, lng), D.treeBasalAreaAt([[lng, lat]])]);
  return { cover: coverR.status === 'fulfilled' ? coverR.value : null, trees: treesR.status === 'fulfilled' ? treesR.value[0] : null };
}
function habitatFor(k, ctx) {
  if (ctx.g) return habitatGrid(k, ctx.g, modelSuitability(state.model, k, ctx.g), modelWeight(state.model, k));
  return habitat(k, ctx);
}

const pct = (v) => Math.round(v * 100) + '%';
function forestHtmlGrid(g) {
  const forest = (g.lc_decid || 0) + (g.lc_mixed || 0) + (g.lc_conifer || 0) + (g.lc_wetwood || 0);
  const open = (g.lc_grass || 0) + (g.lc_pasture || 0) + (g.lc_devopen || 0) + (g.lc_shrub || 0);
  const trees = Object.keys(GRID_TREES).filter((b) => (g[b] || 0) >= 1.5).sort((a, b) => g[b] - g[a]);
  const dead = [];
  if ((g.dead_hw || 0) >= 1) dead.push(`standing dead hardwoods ~${g.dead_hw.toFixed(0)} ft²/ac`);
  if ((g.dead_elmash || 0) >= 0.5) dead.push('dead elm or ash');
  const dmg = [];
  if ((g.dmg_elmash || 0) > 0.05) dmg.push('elm or ash die-off');
  if ((g.dmg_oak || 0) > 0.05) dmg.push('oak damage (e.g. oak wilt)');
  if ((g.dmg_aspen || 0) > 0.05) dmg.push('aspen damage');
  if ((g.dmg_storm || 0) > 0.05) dmg.push('storm or weather damage');
  if ((g.burn || 0) > 0.05) dmg.push('a recent fire');
  const terr = [];
  if ((g.valley ?? 0) < -3) terr.push('bottomland / floodplain');
  else if ((g.valley ?? 0) > 4) terr.push('ridge or upland');
  if ((g.slope ?? 0) > 10) terr.push(`steep (${Math.round(g.slope)}°)`);
  else if ((g.slope ?? 0) > 4) terr.push(`sloped (${Math.round(g.slope)}°)`);
  if ((g.slope ?? 0) > 4 && (g.northness ?? 0) > 0.5) terr.push('north-facing');
  if ((g.slope ?? 0) > 4 && (g.northness ?? 0) < -0.5) terr.push('south-facing');
  return `<dl class="kv">
      <dt>Forest nearby</dt><dd>${pct(forest)} of the surrounding ~400 m${forest > 0.05 ? ` (deciduous ${pct(g.lc_decid || 0)}, mixed ${pct(g.lc_mixed || 0)}, wooded wetland ${pct(g.lc_wetwood || 0)}, evergreen ${pct(g.lc_conifer || 0)})` : ''}</dd>
      ${open > 0.05 ? `<dt>Open ground</dt><dd>${pct(open)} grass, pasture or park lawn</dd>` : ''}
      <dt>Trees</dt><dd>${trees.length ? trees.slice(0, 6).map((b) => `${GRID_TREES[b]} ${g[b].toFixed(0)}`).join(', ') + ' <span class="muted">(ft²/ac)</span>' : 'Few trees mapped here'}${(g.bigoak || 0) >= 2 ? '. Includes big old oaks.' : ''}</dd>
      ${dead.length ? `<dt>Dead wood</dt><dd>${dead.join(', ')}</dd>` : ''}
      ${dmg.length ? `<dt>Recent</dt><dd>${dmg.join(', ')} reported nearby</dd>` : ''}
      ${terr.length ? `<dt>Terrain</dt><dd>${terr.join(', ')}</dd>` : ''}
    </dl>`;
}
function forestHtmlLive(cover, trees) {
  const treeList = trees ? Object.entries(trees).filter(([, v]) => isFinite(v) && v >= 0.5).sort((a, b) => b[1] - a[1]) : [];
  return `<dl class="kv">
      <dt>Land cover</dt><dd>${cover ? esc(NLCD[cover.dominant]?.[0] || 'Unknown') : '<span class="err">unavailable</span>'}</dd>
      ${cover ? `<dt>Forest nearby</dt><dd>${pct(cover.forest)} of the surrounding ~400 m</dd>` : ''}
      <dt>Host trees</dt><dd>${treeList.length ? treeList.map(([f, v]) => `${TREES[f].name} (${v.toFixed(1)} ft²/ac)`).join(', ') : trees ? 'None of the tracked species mapped here' : '<span class="err">unavailable</span>'}</dd>
    </dl>
    <p class="muted" style="margin:6px 0 0">Detailed habitat data isn't available here, so this uses general national maps (less precise).</p>`;
}

// ---------- spot details ----------
async function showSpot(lat, lng, pan = true) {
  state.lastSpot = { lat, lng };
  if (spotMarker) spotMarker.setLatLng([lat, lng]);
  else spotMarker = L.marker([lat, lng], { keyboard: false }).addTo(map);
  const el = $('#spot');
  el.hidden = false;
  el.innerHTML = `<div class="card-head"><h2>This spot</h2><span class="muted">${lat.toFixed(4)}, ${lng.toFixed(4)}</span></div><div class="skeleton">Checking forest, land and weather…</div>`;
  openPanel();
  panel.scrollTop = 0;
  if (pan && window.innerWidth <= 760) map.panTo([lat, lng]);

  const [habR, landR, wR] = await Promise.allSettled([placeHabitat(lat, lng), landAt(lat, lng), weatherNear(lat, lng)]);
  if (!state.lastSpot || state.lastSpot.lat !== lat || state.lastSpot.lng !== lng) return;

  const ctx = habR.status === 'fulfilled' ? habR.value : {};
  const land = landR.status === 'fulfilled' ? landR.value : null;
  const w = wR.status === 'fulfilled' ? wR.value : null;
  const saved = Mine.spotNear(lat, lng);

  const st = land ? STATUS_STYLE[land.cls.status] : null;
  const hunt = land ? huntingWarning(land.cls) : null;
  const landHtml = land
    ? `<div class="land"><span class="sw" style="background:${st.color}"></span><div>
        <b>${esc(land.props?.Unit_Nm || land.cls.label)}</b>
        <span class="muted">${esc(land.cls.label)}${land.props?.MngNm_Desc ? ' · ' + esc(land.props.MngNm_Desc) : ''}</span>
        <p><strong>${esc(st.label)}.</strong> ${esc(land.cls.note)} ${land.cls.link ? `<a href="${land.cls.link}" target="_blank" rel="noopener">Rules</a>` : ''}</p>
      </div></div>
      ${hunt ? `<p class="banner hunt">🟠 ${esc(hunt.text)} <a href="${hunt.link}" target="_blank" rel="noopener">Seasons</a></p>` : ''}`
    : `<div class="err">Couldn't check land ownership here.</div>`;

  const forestHtml = ctx.g ? forestHtmlGrid(ctx.g) : forestHtmlLive(ctx.cover, ctx.trees);

  const acc = land ? accessFactor(land.cls.status, state.mode) : 0;
  const spRows = [...state.species].map((k) => {
    const h = habitatFor(k, ctx);
    const t = w ? timing(k, w, new Date(), state.recent[k]) : { value: 0.5, notes: ['Weather unavailable.'] };
    return { k, h, t, overall: combine(h.value, t.value, acc) };
  }).sort((a, b) => b.overall - a.overall);
  const spHtml = spRows.map(({ k, h, t, overall }) => {
    const s = SPECIES[k];
    const hostNames = (h.hits || []).map((b) => GRID_TREES[b]?.split(' (')[0].toLowerCase()).filter(Boolean);
    return `<details class="sp-detail" style="--c:${s.color}">
      <summary><span class="sp-name"><span class="dot"></span>${s.name}</span><span class="pill ${label(overall)}">${label(overall)}</span></summary>
      <dl class="kv">
        <dt>Habitat</dt><dd>${label(h.value)} (${Math.round(h.value * 100)})${hostNames.length ? ` — hosts here: ${hostNames.join(', ')}` : ''}</dd>
        ${h.model != null ? `<dt>Sightings</dt><dd>Looks more like where it's been found than ${pct(h.model)} of places people search</dd>` : ''}
        <dt>Timing</dt><dd>${label(t.value)} (${Math.round(t.value * 100)})</dd>
        <dt>Access</dt><dd>${acc === 1 ? 'OK' : acc >= 0.8 ? 'Permit area' : acc > 0 ? 'Rules vary' : state.mode === 'harvest' ? 'No picking' : 'No access'}</dd>
      </dl>
      ${w ? outlookStrip(k, w) : ''}
      ${t.notes?.length ? `<p class="muted">${esc(t.notes.join(' '))}</p>` : ''}
      <p><b>Hosts:</b> ${esc(s.hosts)}</p>
      <p><b>Season:</b> ${esc(s.season)}</p>
      <p class="caution">${esc(s.caution)}</p>
    </details>`;
  }).join('');

  const mineHtml = saved ? `<div class="mine-box">
      <b>★ ${esc(saved.name)}</b>${saved.note ? `<p>${esc(saved.note)}</p>` : ''}
      ${saved.finds.length ? `<ul class="finds">${saved.finds.map((f, i) => `<li>${esc(f.date)} — ${esc(SPECIES[f.k]?.name || f.k)}${f.qty ? ` (${esc(f.qty)})` : ''}${f.note ? `: ${esc(f.note)}` : ''} <button class="link" data-del-find="${i}" aria-label="Delete this find">×</button></li>`).join('')}</ul>` : '<p class="muted">No finds logged here yet.</p>'}
    </div>` : '';

  el.innerHTML = `<div class="card-head"><h2>This spot</h2><span class="muted">${lat.toFixed(4)}, ${lng.toFixed(4)}</span></div>
    ${mineHtml}
    ${landHtml}
    <h3>Forest</h3>${forestHtml}
    <h3>Chances ${state.mode === 'harvest' ? 'to harvest' : 'to find'}</h3>${spHtml}
    <div class="actions">
      <a class="btn primary" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener">Directions</a>
      <button class="btn" id="spotSave">${saved ? 'Edit spot' : '★ Save spot'}</button>
      <button class="btn" id="spotLog">Log a find</button>
      ${saved ? '<button class="btn" id="spotDelete">Delete spot</button>' : ''}
      <button class="btn" id="spotClose">Close</button>
    </div>`;
  $('#spotClose').onclick = () => {
    el.hidden = true;
    state.lastSpot = null;
    if (spotMarker) { map.removeLayer(spotMarker); spotMarker = null; }
  };
  $('#spotSave').onclick = () => openMineDialog('save', lat, lng, saved, land);
  $('#spotLog').onclick = () => openMineDialog('find', lat, lng, saved, land);
  if (saved) {
    $('#spotDelete').onclick = () => {
      if (!confirm(`Delete "${saved.name}" and its logged finds from this device?`)) return;
      Mine.deleteSpot(saved.id);
      renderMine();
      showSpot(lat, lng, false);
    };
    el.querySelectorAll('[data-del-find]').forEach((b) => (b.onclick = () => {
      Mine.deleteFind(saved.id, +b.dataset.delFind);
      renderMine();
      showSpot(lat, lng, false);
    }));
  }
}

map.on('click', (e) => showSpot(e.latlng.lat, e.latlng.lng));

// ---------- saved spots & finds ----------
const STAR = L.divIcon({ className: 'star', html: '★', iconSize: [24, 24] });
function renderMine() {
  mineLayer.clearLayers();
  const spots = Mine.allSpots();
  for (const s of spots) {
    L.marker([s.lat, s.lng], { icon: STAR, title: s.name, keyboard: false })
      .on('click', (ev) => { L.DomEvent.stopPropagation(ev); showSpot(s.lat, s.lng, false); })
      .addTo(mineLayer);
  }
  const el = $('#mineCard');
  const finds = spots.flatMap((s) => s.finds.map((f) => ({ ...f, spot: s })));
  finds.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  el.innerHTML = `<div class="card-head"><h2>My spots</h2><span class="muted">${spots.length} saved · ${finds.length} finds</span></div>
    ${spots.length ? `<ul class="mine-list">${spots.map((s) => `<li><a href="#" data-id="${s.id}">★ ${esc(s.name)}</a> <span class="muted">${s.finds.length ? `${s.finds.length} find${s.finds.length > 1 ? 's' : ''}, last ${esc(s.finds[0].date)}` : 'no finds yet'}</span></li>`).join('')}</ul>`
    : '<p class="muted">Tap a spot on the map, then "Save spot". Saved spots and finds stay on this device only.</p>'}
    <div class="actions">
      ${spots.length ? '<button class="btn" id="mineExport">Export</button>' : ''}
      <label class="btn">Import<input type="file" id="mineImport" accept=".geojson,.json,application/geo+json" hidden></label>
    </div>`;
  el.querySelectorAll('a[data-id]').forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    const s = spots.find((x) => x.id === a.dataset.id);
    map.flyTo([s.lat, s.lng], Math.max(map.getZoom(), 14));
    showSpot(s.lat, s.lng, false);
  }));
  const ex = $('#mineExport');
  if (ex) ex.onclick = () => Mine.exportGeoJSON(Object.fromEntries(Object.entries(SPECIES).map(([k, s]) => [k, s.name])));
  $('#mineImport').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const n = Mine.importGeoJSON(await f.text());
      toast(`Imported ${n} spot${n === 1 ? '' : 's'}.`);
      renderMine();
    } catch {
      toast('That file isn\'t a spots export.');
    }
  };
}

function openMineDialog(kind, lat, lng, saved, land) {
  const dlg = $('#mineDlg');
  const today = nowIn(region().tz);
  const opts = Object.entries(SPECIES).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
  const defaultName = saved?.name || land?.props?.Unit_Nm || '';
  dlg.innerHTML = `<form id="mineForm">
    <h2>${kind === 'save' ? (saved ? 'Edit spot' : 'Save this spot') : 'Log a find'}</h2>
    ${kind === 'find' && !saved ? `<label>Spot name<input name="name" value="${esc(defaultName)}" placeholder="e.g. Oak ridge by the creek" required></label>` : ''}
    ${kind === 'save' ? `<label>Name<input name="name" value="${esc(defaultName)}" placeholder="e.g. Oak ridge by the creek" required></label>
      <label>Notes<textarea name="note" rows="3" placeholder="Parking, which trees, what to look for">${esc(saved?.note || '')}</textarea></label>` : ''}
    ${kind === 'find' ? `<label>Mushroom<select name="k">${opts}</select></label>
      <label>Date<input type="date" name="date" value="${today}" required></label>
      <label>How much (optional)<input name="qty" placeholder="e.g. 2 lb, a few, just looked"></label>
      <label>Notes (optional)<textarea name="note" rows="2" placeholder="Host tree, condition, ID notes"></textarea></label>` : ''}
    <p class="muted">Saved on this device only.</p>
    <div class="actions"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="mineCancel">Cancel</button></div>
  </form>`;
  if (kind === 'find') {
    const sel = dlg.querySelector('select[name=k]');
    const first = [...state.species][0];
    if (first) sel.value = first;
  }
  dlg.querySelector('#mineCancel').onclick = () => dlg.close();
  dlg.querySelector('form').onsubmit = (ev) => {
    ev.preventDefault();
    dlg.close();
    const fd = new FormData(ev.target);
    let spot = saved;
    if (kind === 'save' || !spot) {
      spot = Mine.saveSpot({ lat, lng, name: fd.get('name'), note: kind === 'save' ? fd.get('note') : '' });
      if (!spot) return toast('Couldn\'t save — this browser is blocking storage.');
    }
    if (kind === 'find') Mine.logFind(spot.id, { k: fd.get('k'), date: fd.get('date'), qty: fd.get('qty'), note: fd.get('note') });
    toast(kind === 'find' ? 'Find logged.' : 'Spot saved.');
    renderMine();
    showSpot(lat, lng, false);
  };
  dlg.showModal();
}

// ---------- scan the view ----------
async function scanView() {
  if (map.getZoom() < 9) { toast('Zoom in a bit to scan (to about county size).'); return; }
  const btn = $('#scanBtn');
  btn.disabled = true;
  btn.querySelector('span:last-child').textContent = 'Scanning…';
  try {
    const b = map.getBounds();
    const m = state.grid || (await gridMeta());
    const useGrid = m && inGrid(m, b.getSouth(), b.getWest()) && inGrid(m, b.getNorth(), b.getEast());
    const n = window.innerWidth <= 760 ? (useGrid ? 14 : 9) : (useGrid ? 20 : 12);
    const rows = Math.max(6, Math.round(n * (b.getNorth() - b.getSouth()) / ((b.getEast() - b.getWest()) * Math.cos((b.getCenter().lat * Math.PI) / 180))));
    const dx = (b.getEast() - b.getWest()) / n;
    const dy = (b.getNorth() - b.getSouth()) / rows;
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < n; c++) {
      const lng = b.getWest() + (c + 0.5) * dx;
      const lat = b.getSouth() + (r + 0.5) * dy;
      cells.push({ lat, lng, sw: [lat - dy / 2, lng - dx / 2], ne: [lat + dy / 2, lng + dx / 2] });
    }

    // weather on a 3x3 grid, nearest one per cell
    const wlocs = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      wlocs.push([b.getSouth() + ((i + 0.5) * (b.getNorth() - b.getSouth())) / 3, b.getWest() + ((j + 0.5) * (b.getEast() - b.getWest())) / 3]);

    const needLands = !state.lands || !state.landsBounds || !state.landsBounds.contains(b);
    let habitats;
    const habP = useGrid
      ? Promise.all(cells.map((c) => gridBox(c.sw[0], c.sw[1], c.ne[0], c.ne[1]).then((g) => (g ? { g } : {}))))
      : (async () => {
        const sub = 10;
        const pts = cells.map((c) => [c.lng, c.lat]);
        const [lc, trees] = await Promise.all([D.landCoverGrid(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), n * sub, rows * sub), D.treeBasalAreaAt(pts)]);
        return cells.map((c, i) => {
          const row = Math.floor(i / n), col = i % n;
          const block = [];
          const top = (rows - 1 - row) * sub;
          for (let y = 0; y < sub; y++) for (let x = 0; x < sub; x++) block.push(lc.classes[(top + y) * lc.w + col * sub + x]);
          return { cover: D.coverFractions(block), trees: trees[i] };
        });
      })();
    const wxP = D.weatherAt(wlocs).catch(async () => {
      const w = await weatherNear(b.getCenter().lat, b.getCenter().lng);
      return wlocs.map(() => w);
    });
    const [hab, wx, lands] = await Promise.all([habP, wxP, needLands ? loadLands(b.pad(0.15)) : Promise.resolve(state.lands)]);
    habitats = hab;
    if (needLands) { state.lands = lands; state.landsBounds = b.pad(0.15); if ($('#lyrLand').checked) landLayer.clearLayers().addData(lands); }

    cells.forEach((c, i) => {
      c.ctx = habitats[i] || {};
      let bi = 0, bd = Infinity;
      wlocs.forEach((wl, j) => { const d = (wl[0] - c.lat) ** 2 + (wl[1] - c.lng) ** 2; if (d < bd) { bd = d; bi = j; } });
      c.w = wx[bi];
      // check a 3x3 set of points so small parks inside a cell still count; keep the most usable
      c.lands = [];
      for (let a = -1; a <= 1; a++) for (let bb = -1; bb <= 1; bb++) {
        const la = c.lat + (a * dy) / 3, ln = c.lng + (bb * dx) / 3;
        const hits = featuresAt([ln, la], lands);
        c.lands.push({ land: bestLand(hits.map((h) => h.properties), la, ln), pt: [la, ln] });
      }
    });
    state.scan = { cells, at: new Date(), grid: useGrid };
    redrawScan();
  } catch (e) {
    toast('Scan failed: ' + e.message, 6000);
  } finally {
    btn.disabled = false;
    btn.querySelector('span:last-child').textContent = 'Scan this view';
  }
}
$('#scanBtn').onclick = scanView;

function redrawScan() {
  scanLayer.clearLayers();
  if (!state.scan) return;
  const top = [];
  for (const c of state.scan.cells) {
    // the most usable land in this cell for the current mode
    let pick = c.lands[0];
    for (const l of c.lands) {
      const a = accessFactor(l.land.cls.status, state.mode), b = accessFactor(pick.land.cls.status, state.mode);
      if (a > b || (a === b && RANK[l.land.cls.status] > RANK[pick.land.cls.status])) pick = l;
    }
    c.land = pick.land;
    c.pt = pick.pt;
    let best = 0, bestK = null;
    for (const k of state.species) {
      const v = combine(habitatFor(k, c.ctx).value, timing(k, c.w, new Date(), state.recent[k]).value, accessFactor(c.land.cls.status, state.mode));
      if (v > best) { best = v; bestK = k; }
    }
    c.score = best;
    c.bestK = bestK;
    if (best < 0.04) continue;
    const r = L.rectangle([c.sw, c.ne], { pane: 'scan', stroke: false, fillColor: scoreColor(best), fillOpacity: 0.35 + best * 0.4 });
    r.on('click', (ev) => { L.DomEvent.stopPropagation(ev); showSpot(...(c.pt || [c.lat, c.lng])); });
    scanLayer.addLayer(r);
    top.push(c);
  }
  top.sort((a, b) => b.score - a.score);
  const el = $('#scanInfo');
  el.hidden = false;
  // one entry per area: keep only the best-scoring cell for each park, forest or WMA
  const seen = new Set();
  const best = [];
  for (const c of top) {
    const area = c.land.props?.Unit_Nm || c.land.cls.label;
    if (seen.has(area)) continue;
    seen.add(area);
    best.push(c);
    if (best.length === 5) break;
  }
  el.innerHTML = `<div class="card-head"><h2>Scan results</h2><button class="btn" id="scanClear">Clear</button></div>
    ${best.length ? `<p class="muted">Best cells in view (${state.mode === 'harvest' ? 'where picking is allowed' : 'on open public land'}). Tap one for details.</p>
    <ol class="kv" style="display:block;padding-left:18px">${best.map((c, i) => `<li><a href="#" data-i="${i}">${esc(c.land.props?.Unit_Nm || c.land.cls.label)}</a> — ${label(c.score)} for ${SPECIES[c.bestK].name.toLowerCase()}</li>`).join('')}</ol>`
    : `<p>Nothing scores above "poor" here right now. Try another area, Look mode, or a different mushroom.</p>`}`;
  el.querySelectorAll('a[data-i]').forEach((a) => (a.onclick = (e) => {
    e.preventDefault();
    const c = best[+a.dataset.i];
    const [la, ln] = c.pt || [c.lat, c.lng];
    map.flyTo([la, ln], Math.max(map.getZoom(), 13));
    showSpot(la, ln, false);
  }));
  $('#scanClear').onclick = () => { state.scan = null; scanLayer.clearLayers(); el.hidden = true; };
}

// ---------- locate ----------
$('#locateBtn').onclick = () => {
  if (!navigator.geolocation) return toast('Location isn\'t available in this browser.');
  toast('Finding you…');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const { latitude: lat, longitude: lng } = p.coords;
      map.flyTo([lat, lng], 13);
      showSpot(lat, lng, false);
    },
    () => toast('Couldn\'t get your location. Check location permission for this site.'),
    { enableHighAccuracy: true, timeout: 12000 }
  );
};

// ---------- layers popover & offline ----------
$('#layersBtn').onclick = () => { $('#layersPop').hidden = !$('#layersPop').hidden; };
$('#lyrLand').onchange = refreshLands;
$('#lyrInat').onchange = refreshObservations;
$('#lyrTrails').checked = store.get('trails', true);
$('#lyrTrails').onchange = () => { store.set('trails', $('#lyrTrails').checked); refreshTrails(); };
map.on('click', () => { $('#layersPop').hidden = true; });

function renderOffline() {
  const a = savedArea();
  $('#offlineInfo').textContent = a
    ? `Saved ${new Date(a.saved).toLocaleDateString()} (${a.count} files). Saving again replaces the area.`
    : 'Saves map tiles, habitat data, public land, trails and weather for this view.';
}
renderOffline();
$('#offlineBtn').onclick = async () => {
  const btn = $('#offlineBtn');
  btn.disabled = true;
  try {
    await saveArea(map, baseKey, (p) => { btn.textContent = `Saving… ${p.done}/${p.total}`; });
    toast('Area saved for offline use.');
  } catch (e) {
    toast(e.message, 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save this area for offline';
    renderOffline();
  }
};
window.addEventListener('offline', () => toast('You\'re offline. Saved areas still work.', 5000));

// ---------- legend ----------
function renderLegend() {
  const fo = OVERLAYS.find((o) => o.id === $('#lyrForest').value && o.color);
  $('#legend').innerHTML = `<h3>Legend</h3>
    <div class="ramp"></div><div class="ramp-l"><span>Poor</span><span>Fair</span><span>Good</span><span>Prime</span></div>
    ${Object.values(STATUS_STYLE).map((s) => `<div class="lg-item"><span class="sw" style="--c:${s.color}"></span>${s.label}</div>`).join('')}
    <div class="lg-item"><span class="trail-sw"></span>Trail (zoom in)</div>
    <div class="lg-item"><span class="pk-dot"></span>Trailhead parking (zoom in)</div>
    <div class="lg-item"><span class="star lg">★</span>My saved spot</div>
    ${[...state.species].map((k) => `<div class="lg-item"><span class="dot" style="--c:${SPECIES[k].color}"></span>${SPECIES[k].name} sighting</div>`).join('')}
    ${fo ? `<div class="lg-item"><span class="sw" style="--c:${fo.color}"></span>${fo.name}</div>` : ''}
    <p class="muted" style="margin:8px 0 0">Tap anywhere on the map to check that spot. Rules last checked ${region().rulesChecked}.</p>`;
}
renderLegend();
for (const R of Object.values(REGIONS)) $('#lyrRegion').insertAdjacentHTML('beforeend', `<option value="${R.id}">${esc(R.name)}</option>`);
$('#lyrRegion').onchange = (e) => {
  const R = REGIONS[e.target.value];
  switchRegion(R.id);
  map.setView(R.center, R.zoom);
};
renderRegionText();

// ---------- panel (phone bottom sheet) ----------
const panel = $('#panel');
function setPanel(cls) {
  panel.classList.remove('expanded', 'collapsed');
  document.body.classList.remove('panel-expanded', 'panel-collapsed');
  if (cls) { panel.classList.add(cls); document.body.classList.add('panel-' + cls); }
}
function openPanel() { if (panel.classList.contains('collapsed')) setPanel(null); }
$('#panelGrab').onclick = () => {
  if (panel.classList.contains('expanded')) setPanel('collapsed');
  else if (panel.classList.contains('collapsed')) setPanel(null);
  else setPanel('expanded');
};

// ---------- dialogs ----------
$('#aboutBtn').onclick = () => $('#aboutDlg').showModal();
if (!store.get('introSeen', false)) {
  $('#introDlg').showModal();
  $('#introDlg').addEventListener('close', () => store.set('introSeen', true));
}

// ---------- map movement ----------
let moveT;
map.on('moveend', () => {
  clearTimeout(moveT);
  moveT = setTimeout(() => {
    const c = map.getCenter();
    const r = regionAt(c.lat, c.lng);
    if (r && r !== ACTIVE.region) switchRegion(r);
    store.set('view', { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() });
    refreshConditions();
    refreshLands();
    refreshForest();
    refreshObservations();
    refreshTrails();
    refreshRecent();
  }, 350);
});

renderMine();
refreshConditions();
refreshLands();
refreshForest();
refreshObservations();
refreshTrails();
refreshRecent();
