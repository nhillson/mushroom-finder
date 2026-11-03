"""Build the Mushroom Finder habitat grid.

Runs on GitHub Actions. Produces:
  data/grid/meta.json            grid layout, band names and scales
  data/grid/{ty}_{tx}.bin.gz     256x256 tiles, band-major uint8, gzip
  data/model.json                local season curves and sighting-based habitat models
  data/build-report.txt          what worked, what didn't

Grid: plain lat/lng cells (EPSG:4326) so the browser can index it without a projection library.
Each step is independent; a failed step is reported and its bands are left out.
"""
import gzip
import io
import json
import math
import os
import subprocess
import sys
import time
import traceback
import zipfile

import numpy as np
import requests

# ---------------------------------------------------------------- grid layout
WEST, SOUTH, EAST, NORTH = -95.6, 43.5, -91.0, 46.6
DLAT, DLNG = 0.00125, 0.00175          # ~139 m x ~138 m at 45N
ROWS = int(round((NORTH - SOUTH) / DLAT))  # 2480
COLS = int(round((EAST - WEST) / DLNG))    # 2629
TILE = 256
WORK = os.environ.get('WORK', '/mnt/work')
UA = {'User-Agent': 'mushroom-finder-data-pipeline (github.com/nhillson/mushroom-finder)'}
os.makedirs(WORK, exist_ok=True)
os.makedirs('data/grid', exist_ok=True)

CACHE = os.environ.get('BAND_CACHE', os.path.expanduser('~/band-cache'))
os.makedirs(CACHE, exist_ok=True)
REPORT = []
BANDS = {}      # name -> float32 array (ROWS, COLS) in natural units
SCALES = {}     # name -> (unit, multiply-by to get stored uint8, offset)


def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s, flush=True)
    REPORT.append(s)


def step(name):
    def wrap(fn):
        def run(*args, **kw):
            log(f'\n===== {name} =====')
            t0 = time.time()
            try:
                out = fn(*args, **kw)
                log(f'[ok] {name} in {time.time() - t0:.0f}s')
                return out
            except Exception:
                log(f'[failed] {name}')
                log(traceback.format_exc()[-3000:])
                return None
        return run
    return wrap


def add_band(name, arr, scale, offset=0.0, unit=''):
    """Store a band. stored = clip(round(value*scale + offset), 0, 255)."""
    BANDS[name] = arr.astype(np.float32)
    SCALES[name] = {'scale': scale, 'offset': offset, 'unit': unit}


def cached(key):
    """Load bands saved by an earlier run (heavy steps are cached between GitHub runs)."""
    fn = os.path.join(CACHE, key + '.npz')
    if not os.path.exists(fn):
        return False
    z = np.load(fn, allow_pickle=True)
    for n in z.files:
        if n == '_scales':
            continue
        BANDS[n] = z[n].astype(np.float32)
    SCALES.update(z['_scales'].item())
    log(f'loaded {len(z.files) - 1} cached bands from {key}')
    return True


def save_cache(key, names):
    fn = os.path.join(CACHE, key + '.npz')
    np.savez_compressed(fn, _scales=np.array({n: SCALES[n] for n in names}, dtype=object),
                        **{n: BANDS[n].astype(np.float16) for n in names})
    log(f'cached {names} -> {key}')


def grid_transform():
    from rasterio.transform import from_origin
    return from_origin(WEST, NORTH, DLNG, DLAT)


# ---------------------------------------------------------------- TreeMap 2023
TREEMAP_URL = 'https://usfs-public.box.com/shared/static/xlaazfhic3ugd1yetoxcicjgtl2t3mry.zip'

# FIA species code ranges -> band
SP_GROUPS = {
    'oak': lambda c: (800 <= c) & (c <= 842),
    'maple': lambda c: (310 <= c) & (c <= 319),
    'aspen': lambda c: np.isin(c, [741, 743, 744, 746, 747]),
    'cottonwood': lambda c: c == 742,
    'birch': lambda c: (370 <= c) & (c <= 379),
    'elm': lambda c: (970 <= c) & (c <= 977),
    'ash': lambda c: (540 <= c) & (c <= 549),
    'basswood': lambda c: (950 <= c) & (c <= 953),
    'willow': lambda c: (920 <= c) & (c <= 929),
    'pine': lambda c: (100 <= c) & (c <= 149),
    'sprucefir': lambda c: ((10 <= c) & (c <= 19)) | ((90 <= c) & (c <= 99)),
}
HARDWOOD = lambda c: c >= 300


@step('TreeMap 2023: download')
def treemap_download():
    if cached('treemap_v1'):
        return 'cached'
    zpath = os.path.join(WORK, 'treemap.zip')
    tif = os.path.join(WORK, 'TreeMap2023_CONUS.tif')
    trees = os.path.join(WORK, 'TreeMap2023_CONUS_Tree_Table.csv')
    if os.path.exists(tif) and os.path.exists(trees):
        log('using cached TreeMap files')
        return tif, trees
    subprocess.run(['df', '-h', WORK], check=False)
    subprocess.run(['curl', '-L', '--retry', '5', '--retry-delay', '10', '-sS', '-o', zpath, TREEMAP_URL], check=True)
    log('zip size', os.path.getsize(zpath))
    with zipfile.ZipFile(zpath) as z:
        for i in z.infolist():
            log(f'  {i.file_size:>14,}  {i.filename}')
        for i in z.infolist():
            base = os.path.basename(i.filename)
            if base in ('TreeMap2023_CONUS.tif', 'TreeMap2023_CONUS_Tree_Table.csv', '_variable_descriptions.csv') or base.endswith('.tif.aux.xml') or base.endswith('.vat.dbf'):
                with z.open(i) as src, open(os.path.join(WORK, base), 'wb') as dst:
                    while True:
                        b = src.read(1 << 24)
                        if not b:
                            break
                        dst.write(b)
                log('extracted', base)
    os.remove(zpath)
    vd = os.path.join(WORK, '_variable_descriptions.csv')
    if os.path.exists(vd):
        log('--- variable descriptions:')
        log(open(vd, encoding='utf-8', errors='replace').read()[:6000])
    return tif, trees


@step('TreeMap 2023: tree density bands')
def treemap_bands(paths):
    import pandas as pd
    import rasterio
    from rasterio.warp import reproject, Resampling, transform_bounds
    from rasterio.windows import from_bounds

    if paths == 'cached':
        return
    tif, trees_csv = paths
    with rasterio.open(tif) as src:
        log('raster', src.crs, src.res, src.width, src.height, 'nodata', src.nodata, src.dtypes)
        b = transform_bounds('EPSG:4326', src.crs, WEST - 0.05, SOUTH - 0.05, EAST + 0.05, NORTH + 0.05, densify_pts=50)
        win = from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
        ids = src.read(1, window=win)
        win_transform = src.window_transform(win)
        crs = src.crs
        nodata = src.nodata
    log('window', ids.shape, 'unique ids', len(np.unique(ids)))
    present = np.unique(ids)
    if nodata is not None:
        present = present[present != nodata]

    head = pd.read_csv(trees_csv, nrows=5)
    log('tree table columns:', list(head.columns))
    cols = {c.lower(): c for c in head.columns}
    id_col = cols.get('tm_id')
    need = ['spcd', 'dia', 'tpa_unadj', 'statuscd']
    missing = [n for n in need if n not in cols]
    if id_col is None or missing:
        raise RuntimeError(f'tree table missing columns: tm_id={id_col}, missing={missing}')
    use = [id_col] + [cols[n] for n in need]

    max_id = int(present.max()) + 1
    nb = len(SP_GROUPS) + 4
    names = list(SP_GROUPS) + ['bigoak', 'dead_hw', 'dead_elmash', 'live_total']
    lut = np.zeros((max_id, nb), dtype=np.float32)
    pset = set(present.tolist())
    n_rows = 0
    for chunk in pd.read_csv(trees_csv, usecols=use, chunksize=2_000_000):
        chunk = chunk[chunk[id_col].isin(pset)]
        if chunk.empty:
            continue
        n_rows += len(chunk)
        tid = chunk[id_col].to_numpy().astype(np.int64)
        sp = chunk[cols['spcd']].to_numpy()
        dia = chunk[cols['dia']].to_numpy(dtype=np.float64)
        tpa = chunk[cols['tpa_unadj']].to_numpy(dtype=np.float64)
        st = chunk[cols['statuscd']].to_numpy()
        ba = 0.005454154 * np.nan_to_num(dia) ** 2 * np.nan_to_num(tpa)  # sq ft per acre
        live = st == 1
        dead = st == 2
        for j, (name, fn) in enumerate(SP_GROUPS.items()):
            m = live & fn(sp)
            np.add.at(lut[:, j], tid[m], ba[m])
        k = len(SP_GROUPS)
        m = live & SP_GROUPS['oak'](sp) & (dia >= 16)
        np.add.at(lut[:, k], tid[m], ba[m])
        m = dead & HARDWOOD(sp)
        np.add.at(lut[:, k + 1], tid[m], ba[m])
        m = dead & (SP_GROUPS['elm'](sp) | SP_GROUPS['ash'](sp))
        np.add.at(lut[:, k + 2], tid[m], ba[m])
        m = live
        np.add.at(lut[:, k + 3], tid[m], ba[m])
    log('tree rows used', n_rows)

    ids_safe = ids.astype(np.int64)
    valid = (ids_safe >= 0) & (ids_safe < max_id)
    if nodata is not None:
        valid &= ids_safe != nodata
    dst_t = grid_transform()
    for j, name in enumerate(names):
        vals = np.zeros(ids.shape, dtype=np.float32)
        vals[valid] = lut[ids_safe[valid], j]
        out = np.zeros((ROWS, COLS), dtype=np.float32)
        reproject(vals, out, src_transform=win_transform, src_crs=crs, dst_transform=dst_t, dst_crs='EPSG:4326',
                  resampling=Resampling.average, src_nodata=None, dst_nodata=0)
        add_band(name, out, 2.0, unit='sq ft/acre (avg over cell)')  # 0.5 ft2/ac steps up to 127
        log(f'  {name}: mean {out.mean():.2f}, p99 {np.percentile(out, 99):.1f}, max {out.max():.1f}')
    del ids, vals
    save_cache('treemap_v1', names)


# ---------------------------------------------------------------- NLCD land cover via WMS pixels
NLCD_WMS = 'https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/wms'
NLCD_COLORS = {
    11: (71, 107, 160), 12: (209, 221, 249), 21: (221, 201, 201), 22: (216, 147, 130), 23: (237, 0, 0),
    24: (170, 0, 0), 31: (179, 172, 159), 41: (104, 170, 99), 42: (28, 99, 48), 43: (181, 201, 142),
    52: (204, 186, 124), 71: (226, 226, 193), 81: (219, 216, 61), 82: (170, 112, 40), 90: (186, 216, 234),
    95: (112, 163, 186),
}
LC_BANDS = {'lc_decid': [41], 'lc_conifer': [42], 'lc_mixed': [43], 'lc_wetwood': [90], 'lc_grass': [71],
            'lc_pasture': [81], 'lc_devopen': [21], 'lc_shrub': [52], 'lc_water': [11, 95]}


@step('NLCD 2021 land cover')
def nlcd_bands():
    from PIL import Image
    SUB = 5                                   # fine pixels per coarse cell side (~28 m)
    fr, fc = ROWS * SUB, COLS * SUB
    if cached('nlcd_v1'):
        return
    keys = np.array([(r << 16) | (g << 8) | b for r, g, b in NLCD_COLORS.values()], dtype=np.int64)
    order = np.argsort(keys)
    keys_sorted = keys[order]
    codes_sorted = np.array(list(NLCD_COLORS), dtype=np.int32)[order]
    counts = {k: np.zeros((ROWS, COLS), dtype=np.float32) for k in LC_BANDS}
    TR, TC = 400, 400                         # 2000 x 2000 px per request
    n = 0
    for r0 in range(0, ROWS, TR):
        for c0 in range(0, COLS, TC):
            r1, c1 = min(ROWS, r0 + TR), min(COLS, c0 + TC)
            n_lat, s_lat = NORTH - r0 * DLAT, NORTH - r1 * DLAT
            w_lng, e_lng = WEST + c0 * DLNG, WEST + c1 * DLNG
            h, w = (r1 - r0) * SUB, (c1 - c0) * SUB
            params = {'service': 'WMS', 'version': '1.1.1', 'request': 'GetMap', 'layers': 'NLCD_2021_Land_Cover_L48',
                      'styles': '', 'srs': 'EPSG:4326', 'bbox': f'{w_lng},{s_lat},{e_lng},{n_lat}', 'width': w, 'height': h,
                      'format': 'image/png'}
            for attempt in range(4):
                try:
                    r = requests.get(NLCD_WMS, params=params, headers=UA, timeout=180)
                    r.raise_for_status()
                    img = np.asarray(Image.open(io.BytesIO(r.content)).convert('RGB'), dtype=np.int32)
                    break
                except Exception as e:
                    if attempt == 3:
                        raise
                    time.sleep(5 * (attempt + 1))
            # exact palette lookup (the WMS draws the standard NLCD colors)
            k = (img[..., 0].astype(np.int64) << 16) | (img[..., 1].astype(np.int64) << 8) | img[..., 2]
            idx = np.clip(np.searchsorted(keys_sorted, k), 0, len(keys_sorted) - 1)
            cls = np.where(keys_sorted[idx] == k, codes_sorted[idx], 0)
            if n == 0:
                log('  first tile: matched', round(float((cls > 0).mean()), 3), 'of pixels')
            for k, cl in LC_BANDS.items():
                m = np.isin(cls, cl).astype(np.float32)
                counts[k][r0:r1, c0:c1] = m.reshape(r1 - r0, SUB, c1 - c0, SUB).mean(axis=(1, 3))
            n += 1
    log('NLCD requests', n)
    for k, arr in counts.items():
        add_band(k, arr, 250.0, unit='fraction of cell')
        log(f'  {k}: mean {arr.mean():.3f}')
    save_cache('nlcd_v1', list(counts))


# ---------------------------------------------------------------- terrain (USGS 3DEP)
DEP = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'


@step('Terrain from USGS 3DEP')
def terrain_bands():
    if cached('terrain_v1'):
        return
    import rasterio
    from rasterio.io import MemoryFile
    elev = np.full((ROWS, COLS), np.nan, dtype=np.float32)
    TR, TC = 1240, 1315
    for r0 in range(0, ROWS, TR):
        for c0 in range(0, COLS, TC):
            r1, c1 = min(ROWS, r0 + TR), min(COLS, c0 + TC)
            bbox = f'{WEST + c0 * DLNG},{NORTH - r1 * DLAT},{WEST + c1 * DLNG},{NORTH - r0 * DLAT}'
            params = {'bbox': bbox, 'bboxSR': 4326, 'imageSR': 4326, 'size': f'{c1 - c0},{r1 - r0}', 'format': 'tiff',
                      'pixelType': 'F32', 'interpolation': 'RSP_BilinearInterpolation', 'f': 'image'}
            for attempt in range(4):
                try:
                    r = requests.get(DEP, params=params, headers=UA, timeout=300)
                    r.raise_for_status()
                    with MemoryFile(r.content) as mf, mf.open() as ds:
                        a = ds.read(1).astype(np.float32)
                        if ds.nodata is not None:
                            a[a == ds.nodata] = np.nan
                    break
                except Exception:
                    if attempt == 3:
                        raise
                    time.sleep(10 * (attempt + 1))
            elev[r0:r1, c0:c1] = a[: r1 - r0, : c1 - c0]
    elev[elev < -100] = np.nan
    log('elevation range', np.nanmin(elev), np.nanmax(elev))
    e = np.where(np.isnan(elev), np.nanmean(elev), elev)
    lat = NORTH - (np.arange(ROWS) + 0.5) * DLAT
    dy = DLAT * 111320.0
    dx = (DLNG * 111320.0 * np.cos(np.radians(lat)))[:, None]
    gy, gx = np.gradient(e)
    sy, sx = gy / dy, gx / dx                                   # +y = south (row increases)
    slope = np.degrees(np.arctan(np.hypot(sx, sy)))
    # aspect: direction the slope faces. Downhill direction is -gradient.
    # northness = cos(aspect): +1 north-facing, -1 south-facing.
    down_n = sy                                                # elevation rises southward -> faces north
    northness = np.where(slope > 1, down_n / np.maximum(np.hypot(sx, sy), 1e-6), 0)
    # valley index: elevation minus local mean (~1.4 km window). Negative = valley / floodplain.
    from scipy.ndimage import uniform_filter
    valley = e - uniform_filter(e, size=11, mode='nearest')
    add_band('slope', slope, 5.0, unit='degrees')
    add_band('northness', northness, 120.0, 128.0, unit='-1 south .. +1 north')
    add_band('valley', valley, 4.0, 128.0, unit='m relative to ~1.4 km surroundings')
    log(f'  slope p95 {np.percentile(slope, 95):.1f}, valley p5 {np.percentile(valley, 5):.1f}')
    save_cache('terrain_v1', ['slope', 'northness', 'valley'])


# ---------------------------------------------------------------- disturbance
IDS = 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_InsectandDiseaseSurvey_01/MapServer/1'
WFIGS = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0'


def arcgis_features(url, where, out_fields='*', page=1000, method='get'):
    feats, off = [], 0
    while True:
        p = {'where': where, 'geometry': f'{WEST},{SOUTH},{EAST},{NORTH}', 'geometryType': 'esriGeometryEnvelope',
             'inSR': 4326, 'outSR': 4326, 'spatialRel': 'esriSpatialRelIntersects', 'outFields': out_fields,
             'returnGeometry': 'true', 'f': 'geojson', 'resultOffset': off, 'resultRecordCount': page,
             'geometryPrecision': 5}
        r = (requests.get if method == 'get' else requests.post)(url + '/query', params=p if method == 'get' else None,
                                                                   data=p if method == 'post' else None, headers=UA, timeout=300)
        r.raise_for_status()
        j = r.json()
        if 'error' in j:
            raise RuntimeError(j['error'])
        fs = j.get('features', [])
        feats += fs
        if len(fs) < page and not j.get('exceededTransferLimit') and not (j.get('properties') or {}).get('exceededTransferLimit'):
            break
        off += len(fs)
        if not fs:
            break
    return feats


def rasterize(features, value_fn):
    from rasterio.features import rasterize as rz
    shapes = [(f['geometry'], v) for f in features if f.get('geometry') for v in [value_fn(f['properties'])] if v]
    if not shapes:
        return np.zeros((ROWS, COLS), dtype=np.float32)
    return rz(shapes, out_shape=(ROWS, COLS), transform=grid_transform(), fill=0, all_touched=True,
              merge_alg=__import__('rasterio').enums.MergeAlg.replace, dtype='float32')


@step('Insect & disease damage (USFS aerial survey)')
def disturbance_ids():
    meta = requests.get(IDS + '?f=json', headers=UA, timeout=120).json()
    fields = [f['name'] for f in meta.get('fields', [])]
    log('IDS fields', fields)
    yr = next((f for f in fields if f.lower() in ('survey_year', 'surveyyear', 'year')), None)
    where = f'{yr} >= 2016' if yr else '1=1'
    feats = arcgis_features(IDS, where)
    log('IDS features', len(feats))
    if feats:
        log('sample props', json.dumps(feats[0]['properties'])[:800])
    txt = lambda p: ' '.join(str(v) for v in p.values() if isinstance(v, str)).lower()
    year = lambda p: int(p.get(yr) or 0) if yr else 2020
    this_year = time.gmtime().tm_year
    def recency(p):  # 1.0 this year, fading to ~0.3 after 8 years
        return max(0.3, 1 - 0.09 * max(0, this_year - year(p)))
    elmash = rasterize(feats, lambda p: recency(p) if any(k in txt(p) for k in ('dutch elm', 'emerald ash', 'ash ', ' ash', 'elm')) else 0)
    oak = rasterize(feats, lambda p: recency(p) if any(k in txt(p) for k in ('oak wilt', 'oak', 'two-lined', 'twolined')) else 0)
    aspen = rasterize(feats, lambda p: recency(p) if any(k in txt(p) for k in ('aspen', 'poplar', 'forest tent', 'hypoxylon')) else 0)
    wind = rasterize(feats, lambda p: recency(p) if any(k in txt(p) for k in ('wind', 'storm', 'abiotic', 'flood', 'drought')) else 0)
    for name, a in (('dmg_elmash', elmash), ('dmg_oak', oak), ('dmg_aspen', aspen), ('dmg_storm', wind)):
        add_band(name, a, 250.0, unit='recent damage, 0..1 (1 = this year)')
        log(f'  {name}: cells {int((a > 0).sum())}')


@step('Wildfire perimeters (NIFC)')
def disturbance_fire():
    feats = arcgis_features(WFIGS, '1=1')
    log('fire features', len(feats))
    if feats:
        log('sample props keys', list(feats[0]['properties'])[:40])
    this_year = time.gmtime().tm_year
    def yr(p):
        for k, v in p.items():
            if 'discoverydatetime' in k.lower() and v:
                return time.gmtime(v / 1000).tm_year if isinstance(v, (int, float)) else int(str(v)[:4])
        return 0
    burn = rasterize(feats, lambda p: max(0.0, 1 - 0.34 * (this_year - yr(p))) if yr(p) else 0)
    add_band('burn', burn, 250.0, unit='1 = burned this year, fades over ~3 years')
    log('  burned cells', int((burn > 0).sum()))


# ---------------------------------------------------------------- iNaturalist: seasons + habitat models
INAT = 'https://api.inaturalist.org/v1'
TAXA = {
    'oyster': [('Pleurotus', 'genus')], 'hen': [('Grifola frondosa', 'species')], 'chicken': [('Laetiporus', 'genus')],
    'morel': [('Morchella', 'genus')], 'chanterelle': [('Cantharellus', 'genus')],
    'trumpet': [('Craterellus fallax', 'species'), ('Craterellus cornucopioides', 'species')],
    'bolete': [('Boletus edulis', 'species'), ('Boletus chippewaensis', 'species'), ('Boletus variipes', 'species')],
    'lobster': [('Hypomyces lactifluorum', 'species')], 'hedgehog': [('Hydnum', 'genus')],
    'lionsmane': [('Hericium', 'genus')], 'cauliflower': [('Sparassis', 'genus')],
    'puffball': [('Calvatia gigantea', 'species')], 'shaggymane': [('Coprinus comatus', 'species')],
    'honey': [('Armillaria', 'genus')], 'velvetfoot': [('Flammulina', 'genus')],
}
BG_TAXON = 47170  # Fungi


def inat_get(path, params):
    for attempt in range(5):
        r = requests.get(INAT + path, params=params, headers=UA, timeout=120)
        if r.status_code == 429:
            time.sleep(30)
            continue
        r.raise_for_status()
        time.sleep(1.1)
        return r.json()
    raise RuntimeError('iNat rate limited')


def taxon_id(q, rank):
    j = inat_get('/taxa', {'q': q, 'rank': rank, 'per_page': 5})
    hit = next((t for t in j['results'] if t['name'].lower() == q.lower()), j['results'][0])
    return hit['id']


def inat_points(taxon_ids, max_n=6000, accurate=True):
    pts, last = [], 0
    while len(pts) < max_n:
        p = {'taxon_id': ','.join(map(str, taxon_ids)), 'swlat': SOUTH, 'swlng': WEST, 'nelat': NORTH, 'nelng': EAST,
             'quality_grade': 'research', 'per_page': 200, 'order_by': 'id', 'order': 'asc', 'id_above': last,
             'fields': 'id,observed_on,location,obscured,positional_accuracy'}
        j = inat_get('/observations', p)
        res = j.get('results', [])
        if not res:
            break
        for o in res:
            last = max(last, o['id'])
            if not o.get('location'):
                continue
            lat, lng = map(float, o['location'].split(','))
            ok_loc = not o.get('obscured') and (o.get('positional_accuracy') or 0) <= 500
            pts.append((lat, lng, o.get('observed_on'), ok_loc))
        if len(res) < 200:
            break
    return pts


def sample_bands(names, lat, lng):
    r = np.clip(((NORTH - np.asarray(lat)) / DLAT).astype(int), 0, ROWS - 1)
    c = np.clip(((np.asarray(lng) - WEST) / DLNG).astype(int), 0, COLS - 1)
    return np.stack([BANDS[n][r, c] for n in names], axis=1)


@step('iNaturalist: local seasons and habitat models')
def inat_models():
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import roc_auc_score
    feats = [n for n in BANDS if n not in ('northness',)]  # use everything we have
    log('model features', feats)
    bg = inat_points([BG_TAXON], max_n=60000)
    bg_ok = [(a, b) for a, b, _, ok in bg if ok]
    log('background fungi points', len(bg), 'precise', len(bg_ok))
    Xb = sample_bands(feats, [p[0] for p in bg_ok], [p[1] for p in bg_ok])

    def weekly(points):
        wk = np.zeros(53)
        for _, _, d, _ in points:
            if d:
                try:
                    wk[min(52, time.strptime(d[:10], '%Y-%m-%d').tm_yday // 7)] += 1
                except ValueError:
                    pass
        return wk

    def smooth(wk):
        return np.convolve(np.concatenate([wk[-2:], wk, wk[:2]]), np.ones(5) / 5, mode='valid')

    bg_week = smooth(weekly(bg))
    model = {'built': time.strftime('%Y-%m-%d'), 'features': feats, 'species': {}}
    for k, taxa in TAXA.items():
        try:
            ids = [taxon_id(q, r) for q, r in taxa]
            pts = inat_points(ids)
        except Exception as e:
            log(k, 'fetch failed', e)
            continue
        entry = {'n': len(pts)}
        # season: sightings by week of year, divided by how many people log fungi that week
        # (otherwise everything looks like it peaks in fall, when most people are out looking)
        wk = weekly(pts)
        if wk.sum() >= 40:
            ratio = smooth(wk) / (bg_week + 0.03 * bg_week.max())
            entry['season'] = [round(float(v), 4) for v in (ratio / ratio.max())]
        # habitat model: species points vs all-fungi background (corrects for where people look)
        pos = [(a, b) for a, b, _, ok in pts if ok]
        entry['n_precise'] = len(pos)
        if len(pos) >= 60:
            Xp = sample_bands(feats, [p[0] for p in pos], [p[1] for p in pos])
            X = np.vstack([Xp, Xb])
            y = np.r_[np.ones(len(Xp)), np.zeros(len(Xb))]
            Xt = X.copy()
            mu, sd = Xt.mean(0), Xt.std(0) + 1e-6
            Z = (Xt - mu) / sd
            # spatial block cross-validation (0.3 degree blocks)
            lat_all = np.r_[[p[0] for p in pos], [p[0] for p in bg_ok]]
            lng_all = np.r_[[p[1] for p in pos], [p[1] for p in bg_ok]]
            block = (np.floor(lat_all / 0.3) * 1000 + np.floor(lng_all / 0.3)).astype(int)
            folds = block % 5
            aucs = []
            for f in range(5):
                tr, te = folds != f, folds == f
                if y[te].sum() < 5 or (1 - y[te]).sum() < 5:
                    continue
                m = LogisticRegression(C=0.3, class_weight='balanced', max_iter=2000).fit(Z[tr], y[tr])
                aucs.append(roc_auc_score(y[te], m.decision_function(Z[te])))
            m = LogisticRegression(C=0.3, class_weight='balanced', max_iter=2000).fit(Z, y)
            dec_bg = m.decision_function(Z[len(Xp):])
            entry['model'] = {
                'mean': [round(float(v), 5) for v in mu], 'sd': [round(float(v), 5) for v in sd],
                'coef': [round(float(v), 5) for v in m.coef_[0]], 'intercept': round(float(m.intercept_[0]), 5),
                # background score percentiles, to turn a raw score into "better than X% of places people look"
                'bg_q': [round(float(v), 4) for v in np.percentile(dec_bg, np.arange(0, 101, 5))],
                'auc': round(float(np.mean(aucs)), 3) if aucs else None,
            }
            top = sorted(zip(feats, m.coef_[0]), key=lambda t: -abs(t[1]))[:6]
            log(f'{k}: n={len(pts)} precise={len(pos)} AUC={entry["model"]["auc"]} top: ' +
                ', '.join(f'{n} {c:+.2f}' for n, c in top))
        else:
            log(f'{k}: n={len(pts)} precise={len(pos)} (too few for a model)')
        model['species'][k] = entry
    with open('data/model.json', 'w') as f:
        json.dump(model, f, separators=(',', ':'))


# ---------------------------------------------------------------- write tiles
@step('Write grid tiles')
def write_tiles():
    names = list(BANDS)
    if not names:
        raise RuntimeError('no bands')
    tr, tc = math.ceil(ROWS / TILE), math.ceil(COLS / TILE)
    q = {}
    for n in names:
        s = SCALES[n]
        q[n] = np.clip(np.round(BANDS[n] * s['scale'] + s['offset']), 0, 255).astype(np.uint8)
    # clear old tiles
    for fn in os.listdir('data/grid'):
        if fn.endswith('.bin.gz'):
            os.remove(os.path.join('data/grid', fn))
    total = 0
    for ty in range(tr):
        for tx in range(tc):
            buf = np.zeros((len(names), TILE, TILE), dtype=np.uint8)
            r0, c0 = ty * TILE, tx * TILE
            r1, c1 = min(ROWS, r0 + TILE), min(COLS, c0 + TILE)
            for i, n in enumerate(names):
                buf[i, : r1 - r0, : c1 - c0] = q[n][r0:r1, c0:c1]
            if not buf.any():
                continue
            data = gzip.compress(buf.tobytes(), compresslevel=9, mtime=0)
            total += len(data)
            with open(f'data/grid/{ty}_{tx}.bin.gz', 'wb') as f:
                f.write(data)
    meta = {'west': WEST, 'south': SOUTH, 'east': EAST, 'north': NORTH, 'dlat': DLAT, 'dlng': DLNG,
            'rows': ROWS, 'cols': COLS, 'tile': TILE, 'bands': names, 'scales': SCALES,
            'built': time.strftime('%Y-%m-%d')}
    with open('data/grid/meta.json', 'w') as f:
        json.dump(meta, f, indent=1)
    log(f'tiles written, {total / 1e6:.1f} MB total, bands: {names}')


if __name__ == '__main__':
    only = set(sys.argv[1:])
    want = lambda s: not only or s in only
    if want('treemap'):
        p = treemap_download()
        if p:
            treemap_bands(p)
    if want('nlcd'):
        nlcd_bands()
    if want('terrain'):
        terrain_bands()
    if want('disturbance'):
        disturbance_ids()
        disturbance_fire()
    if BANDS:
        write_tiles()
    if want('inat') and BANDS:
        inat_models()
    with open('data/build-report.txt', 'w') as f:
        f.write('\n'.join(REPORT))
