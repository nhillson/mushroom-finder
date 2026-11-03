import { CFG, NLCD, TREES, OVERLAYS } from './config.js';
import { SPECIES } from './species.js';
import { classifyLand, accessFactor, STATUS_STYLE, RULES_CHECKED } from './landrules.js';
import * as D from './data.js';
import { timing, habitat, combine, label, scoreColor, featuresAt } from './score.js';

const L = window.L;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- persisted settings (light convenience only) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('mf.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mf.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

const state = {
  species: new Set(store.get('species', Object.keys(SPECIES))),
  mode: store.get('mode', 'look'),
  lands: null, // last PAD-US FeatureCollection for view
  landsBounds: null,
  weatherCache: new Map(),
  scan: null,
};

// ---------- map ----------
const map = L.map('map', { zoomControl: false, maxBounds: [[40, -100], [50, -86]], minZoom: 6 })
  .setView(store.get('view', null)?.c || CFG.center, store.get('view', null)?.z || CFG.zoom);
L.control.zoom({ position: 'topright' }).addTo(map);
L.control.scale({ imperial: true, metric: false, position: 'bottomright' }).addTo(map);

const bases = {};
for (const [k, b] of Object.entries(CFG.basemaps)) {
  bases[k] = L.tileLayer(b.url, { attribution: b.attribution, maxNativeZoom: b.maxNativeZoom, maxZoom: 18 });
  $('#lyrBase').insertAdjacentHTML('beforeend', `<option value="${k}">${b.name}</option>`);
}
let baseKey = store.get('base', 'topo');
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

const landLayer = L.geoJSON(null, { pane: 'lands', style: landStyle, interactive: false }).addTo(map);
const scanLayer = L.layerGroup().addTo(map);
const obsLayer = L.layerGroup().addTo(map);
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

// ---------- UI: species chips & mode ----------
function renderChips() {
  $('#speciesChips').innerHTML = Object.entries(SPECIES)
    .map(([k, s]) => `<button class="chip" data-k="${k}" style="--c:${s.color}" aria-pressed="${state.species.has(k)}"><span class="dot"></span>${s.name}</button>`)
    .join('');
}
renderChips();
$('#speciesChips').onclick = (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  const k = b.dataset.k;
  if (state.species.has(k) && state.species.size > 1) state.species.delete(k);
  else state.species.add(k);
  store.set('species', [...state.species]);
  renderChips();
  refreshConditions();
  refreshObservations();
  if (state.scan) redrawScan();
  if (state.lastSpot) showSpot(state.lastSpot.lat, state.lastSpot.lng, false);
};
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

// ---------- weather ----------
async function weatherNear(lat, lng) {
  const key = lat.toFixed(1) + ',' + lng.toFixed(1);
  if (state.weatherCache.has(key)) return state.weatherCache.get(key);
  const p = D.weatherAt([[lat, lng]]).then((a) => a[0]);
  state.weatherCache.set(key, p);
  p.catch(() => state.weatherCache.delete(key));
  return p;
}

function timingRows(w) {
  return [...state.species].map((k) => {
    const s = SPECIES[k];
    const t = timing(k, w);
    return `<div class="sp-row" style="--c:${s.color}">
      <div class="sp-name"><span class="dot"></span>${s.name}</div>
      <span class="pill ${label(t.value)}">${label(t.value)}</span>
      <div class="bar"><i style="width:${Math.round(t.value * 100)}%"></i></div>
      ${t.notes.length ? `<div class="sp-notes">${esc(t.notes.join(' '))}</div>` : ''}
    </div>`;
  }).join('');
}

function weatherBlock(w) {
  const days = w.days;
  const max = Math.max(0.5, ...days.map((d) => d.rain || 0));
  const bars = days.map((d) => `<i class="${d.future ? 'future' : ''} ${d.today ? 'today' : ''}" style="height:${Math.max(2, ((d.rain || 0) / max) * 100)}%" title="${d.date}: ${(d.rain || 0).toFixed(2)} in"></i>`).join('');
  return `<div class="wx-row">
      <div class="wx"><b>${w.rain14.toFixed(2)}″</b><span>rain, last 14 days</span></div>
      <div class="wx"><b>${Math.round(w.high7)}° / ${Math.round(w.low7)}°</b><span>avg high / low, 7 days</span></div>
      <div class="wx"><b>${isFinite(w.soilT) ? Math.round(w.soilT) + '°' : '—'}</b><span>soil temp (2″)</span></div>
    </div>
    <div class="rainbars" aria-label="Daily rain, past 14 days and next 7">${bars}</div>
    <div class="rainaxis"><span>2 weeks ago</span><span class="today-lbl" style="left:${((days.findIndex((d) => d.today) + 0.5) / days.length) * 100}%">today</span><span>next 7 days: ${w.rainNext7.toFixed(2)}″</span></div>`;
}

let condSeq = 0;
async function refreshConditions() {
  const c = map.getCenter();
  const seq = ++condSeq;
  try {
    const w = await weatherNear(c.lat, c.lng);
    if (seq !== condSeq) return;
    $('#condWhere').textContent = `Map center · ${c.lat.toFixed(2)}, ${c.lng.toFixed(2)}`;
    $('#condBody').innerHTML = weatherBlock(w) + timingRows(w);
  } catch (e) {
    $('#condBody').innerHTML = `<div class="err">Couldn't load weather (${esc(e.message)}).</div>`;
  }
}

// ---------- public lands & stands ----------
let landSeq = 0;
async function refreshLands() {
  if (!$('#lyrLand').checked || map.getZoom() < 9) {
    landLayer.clearLayers();
    return;
  }
  const b = map.getBounds().pad(0.15);
  const seq = ++landSeq;
  try {
    const fc = await D.publicLandsIn(b, map.getZoom());
    if (seq !== landSeq) return;
    state.lands = fc;
    state.landsBounds = b;
    landLayer.clearLayers().addData(fc);
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

// ---------- iNaturalist ----------
let obsSeq = 0;
async function refreshObservations() {
  obsLayer.clearLayers();
  if (!$('#lyrInat').checked || map.getZoom() < 8) return;
  const seq = ++obsSeq;
  try {
    const want = [...state.species];
    const ids = {};
    for (const k of want) ids[k] = await Promise.all(SPECIES[k].inatTaxa.map((t) => D.resolveTaxon(t.q, t.rank)));
    const all = Object.values(ids).flat();
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
    toast('Couldn\'t load iNaturalist sightings: ' + e.message, 5000);
  }
}

// ---------- spot details ----------
const RANK = { closed: 0, look: 1, check: 2, harvest: 3 };
function bestLand(attrsList, lat, lng) {
  if (!attrsList || !attrsList.length) return { cls: classifyLand(null), props: null };
  const rank = RANK;
  // most restrictive wins (e.g. county land inside a state forest boundary)
  let best = null;
  for (const p of attrsList) {
    const c = classifyLand(p, lat, lng);
    if (!best || rank[c.status] < rank[best.cls.status]) best = { cls: c, props: p };
  }
  return best;
}

async function showSpot(lat, lng, pan = true) {
  state.lastSpot = { lat, lng };
  if (spotMarker) spotMarker.setLatLng([lat, lng]);
  else spotMarker = L.marker([lat, lng], { keyboard: false }).addTo(map);
  const el = $('#spot');
  el.hidden = false;
  el.innerHTML = `<div class="card-head"><h2>This spot</h2><span class="muted">${lat.toFixed(4)}, ${lng.toFixed(4)}</span></div><div class="skeleton">Checking forest, land and weather…</div>`;
  openPanel();
  if (pan && window.innerWidth <= 760) map.panTo([lat, lng]);

  const [coverR, treesR, landR, wR] = await Promise.allSettled([
    D.coverAt(lat, lng),
    D.treeBasalAreaAt([[lng, lat]]),
    D.publicLandsAt(lng, lat),
    weatherNear(lat, lng),
  ]);
  if (!state.lastSpot || state.lastSpot.lat !== lat || state.lastSpot.lng !== lng) return;

  const cover = coverR.status === 'fulfilled' ? coverR.value : null;
  const trees = treesR.status === 'fulfilled' ? treesR.value[0] : null;
  const land = landR.status === 'fulfilled' ? bestLand(landR.value, lat, lng) : null;
  const w = wR.status === 'fulfilled' ? wR.value : null;

  const st = land ? STATUS_STYLE[land.cls.status] : null;
  const landHtml = land
    ? `<div class="land"><span class="sw" style="background:${st.color}"></span><div>
        <b>${esc(land.props?.Unit_Nm || land.cls.label)}</b>
        <span class="muted">${esc(land.cls.label)}${land.props?.MngNm_Desc ? ' · ' + esc(land.props.MngNm_Desc) : ''}</span>
        <p><strong>${esc(st.label)}.</strong> ${esc(land.cls.note)} ${land.cls.link ? `<a href="${land.cls.link}" target="_blank" rel="noopener">Rules</a>` : ''}</p>
      </div></div>`
    : `<div class="err">Couldn't check land ownership here.</div>`;

  const treeList = trees ? Object.entries(trees).filter(([, v]) => isFinite(v) && v >= 0.5).sort((a, b) => b[1] - a[1]) : [];
  const pct = (v) => Math.round(v * 100) + '%';
  const forestHtml = `<dl class="kv">
      <dt>Land cover</dt><dd>${cover ? esc(NLCD[cover.dominant]?.[0] || 'Unknown') : '<span class="err">unavailable</span>'}</dd>
      ${cover ? `<dt>Forest nearby</dt><dd>${pct(cover.forest)} of the surrounding ~400 m${cover.forest > 0 ? ` (deciduous ${pct(cover.decid)}, mixed ${pct(cover.mixed)}, wooded wetland ${pct(cover.wetwood)}, evergreen ${pct(cover.conifer)})` : ''}</dd>` : ''}
      <dt>Host trees</dt><dd>${treeList.length ? treeList.map(([f, v]) => `${TREES[f].name} (${v.toFixed(1)} ft²/ac)`).join(', ') : trees ? 'None of the tracked species mapped here' : '<span class="err">unavailable</span>'}</dd>
    </dl>
    <p class="muted" style="margin:6px 0 0">Tree numbers are averages over 250 m cells, so even good oak woods show single digits. Red and bur oak aren't in the tree maps.</p>`;

  const acc = land ? accessFactor(land.cls.status, state.mode) : 0;
  const spHtml = [...state.species].map((k) => {
    const s = SPECIES[k];
    const h = habitat(k, { cover, trees });
    const t = w ? timing(k, w) : { value: 0.5, notes: ['Weather unavailable.'] };
    const overall = combine(h.value, t.value, acc);
    return `<details class="sp-detail" style="--c:${s.color}">
      <summary><span class="sp-name"><span class="dot"></span>${s.name}</span><span class="pill ${label(overall)}">${label(overall)}</span></summary>
      <dl class="kv">
        <dt>Habitat</dt><dd>${label(h.value)} (${Math.round(h.value * 100)})</dd>
        <dt>Timing</dt><dd>${label(t.value)} (${Math.round(t.value * 100)})</dd>
        <dt>Access</dt><dd>${acc === 1 ? 'OK' : acc > 0 ? 'Rules vary' : state.mode === 'harvest' ? 'No picking' : 'No access'}</dd>
      </dl>
      ${t.notes?.length ? `<p class="muted">${esc(t.notes.join(' '))}</p>` : ''}
      <p><b>Hosts:</b> ${esc(s.hosts)}</p>
      <p><b>Season:</b> ${esc(s.season)}</p>
      <p class="caution">${esc(s.caution)}</p>
    </details>`;
  }).join('');

  el.innerHTML = `<div class="card-head"><h2>This spot</h2><span class="muted">${lat.toFixed(4)}, ${lng.toFixed(4)}</span></div>
    ${landHtml}
    <h3>Forest</h3>${forestHtml}
    <h3>Chances ${state.mode === 'harvest' ? 'to harvest' : 'to find'}</h3>${spHtml}
    <div class="actions">
      <a class="btn primary" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" rel="noopener">Directions</a>
      <button class="btn" id="spotClose">Close</button>
    </div>`;
  $('#spotClose').onclick = () => {
    el.hidden = true;
    state.lastSpot = null;
    if (spotMarker) { map.removeLayer(spotMarker); spotMarker = null; }
  };
}

map.on('click', (e) => showSpot(e.latlng.lat, e.latlng.lng));

// ---------- scan the view ----------
async function scanView() {
  if (map.getZoom() < 9) { toast('Zoom in a bit to scan (to about county size).'); return; }
  const btn = $('#scanBtn');
  btn.disabled = true;
  btn.querySelector('span:last-child').textContent = 'Scanning…';
  try {
    const b = map.getBounds();
    const n = window.innerWidth <= 760 ? 9 : 12;
    const rows = Math.max(6, Math.round(n * (b.getNorth() - b.getSouth()) / ((b.getEast() - b.getWest()) * Math.cos((b.getCenter().lat * Math.PI) / 180))));
    const dx = (b.getEast() - b.getWest()) / n;
    const dy = (b.getNorth() - b.getSouth()) / rows;
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < n; c++) {
      const lng = b.getWest() + (c + 0.5) * dx;
      const lat = b.getSouth() + (r + 0.5) * dy;
      cells.push({ lat, lng, sw: [lat - dy / 2, lng - dx / 2], ne: [lat + dy / 2, lng + dx / 2] });
    }
    const pts = cells.map((c) => [c.lng, c.lat]);

    // weather on a 3x3 grid, nearest one per cell
    const wlocs = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      wlocs.push([b.getSouth() + ((i + 0.5) * (b.getNorth() - b.getSouth())) / 3, b.getWest() + ((j + 0.5) * (b.getEast() - b.getWest())) / 3]);

    const needLands = !state.lands || !state.landsBounds || !state.landsBounds.contains(b);
    const sub = 10; // land-cover pixels sampled per cell side
    const [lc, trees, wx, lands] = await Promise.all([
      D.landCoverGrid(b.getSouth(), b.getWest(), b.getNorth(), b.getEast(), n * sub, rows * sub),
      D.treeBasalAreaAt(pts),
      D.weatherAt(wlocs),
      needLands ? D.publicLandsIn(b.pad(0.15), map.getZoom()) : Promise.resolve(state.lands),
    ]);
    if (needLands) { state.lands = lands; state.landsBounds = b.pad(0.15); if ($('#lyrLand').checked) landLayer.clearLayers().addData(lands); }

    cells.forEach((c, i) => {
      const row = Math.floor(i / n), col = i % n;
      const block = [];
      const top = (rows - 1 - row) * sub; // image row 0 is north; cell row 0 is south
      for (let y = 0; y < sub; y++) for (let x = 0; x < sub; x++) block.push(lc.classes[(top + y) * lc.w + col * sub + x]);
      c.cover = D.coverFractions(block);
      c.trees = trees[i];
      let bi = 0, bd = Infinity;
      wlocs.forEach((wl, j) => { const d = (wl[0] - c.lat) ** 2 + (wl[1] - c.lng) ** 2; if (d < bd) { bd = d; bi = j; } });
      c.w = wx[bi];
      // check a 3x3 set of points so small parks inside a cell still count; keep the most usable
      c.land = null;
      for (let a = -1; a <= 1; a++) for (let bb = -1; bb <= 1; bb++) {
        const la = c.lat + (a * dy) / 3, ln = c.lng + (bb * dx) / 3;
        const hits = featuresAt([ln, la], lands);
        const l = bestLand(hits.map((h) => h.properties), la, ln);
        if (!c.land || accessFactor(l.cls.status, state.mode) > accessFactor(c.land.cls.status, state.mode) ||
            (accessFactor(l.cls.status, state.mode) === accessFactor(c.land.cls.status, state.mode) && RANK[l.cls.status] > RANK[c.land.cls.status])) {
          c.land = l;
          c.pt = [la, ln]; // the point inside the cell that's on the best land
        }
      }
    });
    state.scan = { cells, at: new Date() };
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
  let top = [];
  for (const c of state.scan.cells) {
    let best = 0, bestK = null;
    for (const k of state.species) {
      const v = combine(habitat(k, c).value, timing(k, c.w).value, accessFactor(c.land.cls.status, state.mode));
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
  const best = top.slice(0, 5);
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

// ---------- layers popover ----------
$('#layersBtn').onclick = () => { $('#layersPop').hidden = !$('#layersPop').hidden; };
$('#lyrLand').onchange = refreshLands;
$('#lyrInat').onchange = refreshObservations;
map.on('click', () => { $('#layersPop').hidden = true; });

// ---------- legend ----------
function renderLegend() {
  const fo = OVERLAYS.find((o) => o.id === $('#lyrForest').value && o.color);
  $('#legend').innerHTML = `<h3>Legend</h3>
    <div class="ramp"></div><div class="ramp-l"><span>Poor</span><span>Fair</span><span>Good</span><span>Prime</span></div>
    ${Object.values(STATUS_STYLE).map((s) => `<div class="lg-item"><span class="sw" style="--c:${s.color}"></span>${s.label}</div>`).join('')}
    ${[...state.species].map((k) => `<div class="lg-item"><span class="dot" style="--c:${SPECIES[k].color}"></span>${SPECIES[k].name} sighting</div>`).join('')}
    ${fo ? `<div class="lg-item"><span class="sw" style="--c:${fo.color}"></span>${fo.name}</div>` : ''}
    <p class="muted" style="margin:8px 0 0">Tap anywhere on the map to check that spot. Rules last checked ${RULES_CHECKED}.</p>`;
}
renderLegend();
$('#rulesChecked').textContent = `Rules last checked ${RULES_CHECKED}.`;

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
    store.set('view', { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() });
    refreshConditions();
    refreshLands();
    refreshForest();
    refreshObservations();
  }, 350);
});

refreshConditions();
refreshLands();
refreshForest();
refreshObservations();
