// Saved spots and logged finds. Stored only in this browser (localStorage), never sent anywhere.
const KEY = 'mf.spots';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}

export function allSpots() {
  return read();
}

export function spotNear(lat, lng, meters = 60) {
  const m = meters / 111320;
  return read().find((s) => Math.abs(s.lat - lat) < m && Math.abs(s.lng - lng) < m / Math.cos((lat * Math.PI) / 180));
}

export function saveSpot({ lat, lng, name, note }) {
  const list = read();
  const existing = list.find((s) => s.lat === lat && s.lng === lng);
  if (existing) {
    existing.name = name || existing.name;
    existing.note = note ?? existing.note;
  } else {
    list.push({ id: Date.now().toString(36), lat, lng, name: name || 'Saved spot', note: note || '', created: new Date().toISOString().slice(0, 10), finds: [] });
  }
  return write(list) ? (existing || list[list.length - 1]) : null;
}

export function logFind(spotId, { k, date, note, qty }) {
  const list = read();
  const s = list.find((x) => x.id === spotId);
  if (!s) return null;
  s.finds.unshift({ k, date, note: note || '', qty: qty || '' });
  return write(list) ? s : null;
}

export function deleteSpot(id) {
  write(read().filter((s) => s.id !== id));
}

export function deleteFind(spotId, index) {
  const list = read();
  const s = list.find((x) => x.id === spotId);
  if (s) s.finds.splice(index, 1);
  write(list);
}

// GeoJSON download of everything saved
export function exportGeoJSON(speciesNames) {
  const fc = {
    type: 'FeatureCollection',
    features: read().map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: {
        name: s.name, note: s.note, created: s.created,
        finds: s.finds.map((f) => ({ ...f, mushroom: speciesNames[f.k] || f.k })),
      },
    })),
  };
  const blob = new Blob([JSON.stringify(fc, null, 1)], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mushroom-spots-${new Date().toISOString().slice(0, 10)}.geojson`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function importGeoJSON(text) {
  const fc = JSON.parse(text);
  const list = read();
  let n = 0;
  for (const f of fc.features || []) {
    if (!f.geometry || f.geometry.type !== 'Point') continue;
    const [lng, lat] = f.geometry.coordinates;
    if (list.some((s) => s.lat === lat && s.lng === lng)) continue;
    const p = f.properties || {};
    list.push({ id: (Date.now() + n).toString(36), lat, lng, name: p.name || 'Imported spot', note: p.note || '', created: p.created || '', finds: (p.finds || []).map((x) => ({ k: x.k, date: x.date, note: x.note || '', qty: x.qty || '' })) });
    n++;
  }
  write(list);
  return n;
}
