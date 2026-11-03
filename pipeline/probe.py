"""Probe data sources from the GitHub runner and write findings to data/probe.txt."""
import io
import json
import traceback
import zipfile

import requests

OUT = []
BOX = 'https://usfs-public.box.com/shared/static/xlaazfhic3ugd1yetoxcicjgtl2t3mry.zip'
META = 'https://www.fs.usda.gov/rds/archive/products/RDS-2026-0038/RDS-2026-0038_Metadata_Fileindex.zip'
BBOX = (-95.6, 43.6, -91.2, 46.5)
H = {'User-Agent': 'mushroom-finder-data-pipeline (github.com/nhillson/mushroom-finder)'}


def log(*a):
    s = ' '.join(str(x) for x in a)
    print(s, flush=True)
    OUT.append(s)


def section(name, fn):
    log(f'\n===== {name} =====')
    try:
        fn()
    except Exception:
        log(traceback.format_exc()[-2000:])


def treemap_listing():
    from remotezip import RemoteZip
    with RemoteZip(BOX, headers=H) as z:
        for i in z.infolist():
            log(f'{i.file_size:>14,}  {i.compress_size:>14,}  {i.filename}')
        # peek at CSV headers
        for i in z.infolist():
            if i.filename.lower().endswith('.csv'):
                with z.open(i) as f:
                    head = f.read(4000).decode('utf-8', 'replace').splitlines()[:4]
                log(f'--- head of {i.filename}:')
                for line in head:
                    log('   ', line[:600])


def treemap_meta():
    r = requests.get(META, headers=H, timeout=120)
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))
    for n in z.namelist():
        log('meta file:', n)
    for n in z.namelist():
        if n.lower().endswith(('.txt', '.html', '.htm')):
            txt = z.read(n).decode('utf-8', 'replace')
            log(f'--- {n} (first 3500 chars)')
            log(txt[:3500])


def arcgis_count(name, url, extra=None):
    p = {
        'where': '1=1', 'geometry': ','.join(map(str, BBOX)), 'geometryType': 'esriGeometryEnvelope',
        'inSR': '4326', 'spatialRel': 'esriSpatialRelIntersects', 'returnCountOnly': 'true', 'f': 'json',
    }
    if extra:
        p.update(extra)
    r = requests.post(url + '/query', data=p, headers=H, timeout=120)
    log(name, r.status_code, r.text[:400])


def endpoints():
    arcgis_count('DNR stands (deciduous)', 'https://arcgis.dnr.state.mn.us/public/rest/services/for/forest_finder/MapServer/1')
    arcgis_count('DNR stands (coniferous)', 'https://arcgis.dnr.state.mn.us/public/rest/services/for/forest_finder/MapServer/2')
    arcgis_count('DNR stand boundaries', 'https://arcgis.dnr.state.mn.us/public/rest/services/for/forest_finder/MapServer/5')
    for lid in (4, 5):
        r = requests.get(f'https://arcgis.dnr.state.mn.us/public/rest/services/for/forest_finder/MapServer/{lid}?f=json', headers=H, timeout=60)
        j = r.json()
        log(f'DNR layer {lid} fields:', [f['name'] for f in j.get('fields', [])])
    arcgis_count('IDS areas', 'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_InsectandDiseaseSurvey_01/MapServer/1')
    r = requests.get('https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_InsectandDiseaseSurvey_01/MapServer/1?f=json', headers=H, timeout=60)
    log('IDS fields:', [f['name'] for f in r.json().get('fields', [])])
    arcgis_count('WFIGS perimeters', 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0')
    r = requests.get('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage',
                     params={'bbox': '-93.5,44.8,-93.4,44.9', 'bboxSR': 4326, 'size': '50,50', 'format': 'tiff',
                             'pixelType': 'F32', 'f': 'image'}, headers=H, timeout=120)
    log('3DEP exportImage', r.status_code, r.headers.get('content-type'), len(r.content))
    r = requests.get('https://www.mrlc.gov/geoserver/mrlc_download/NLCD_2021_Land_Cover_L48/wcs',
                     params={'service': 'WCS', 'version': '2.0.1', 'request': 'GetCoverage',
                             'coverageid': 'NLCD_2021_Land_Cover_L48', 'subset': ['X(-93.5,-93.4)', 'Y(44.8,44.9)'],
                             'subsettingcrs': 'http://www.opengis.net/def/crs/EPSG/0/4326', 'format': 'image/geotiff'},
                     headers=H, timeout=120)
    log('NLCD WCS', r.status_code, r.headers.get('content-type'), len(r.content), r.text[:300] if r.status_code != 200 else '')


section('TreeMap 2023 zip listing', treemap_listing)
section('TreeMap metadata', treemap_meta)
section('Endpoints', endpoints)

import os
os.makedirs('data', exist_ok=True)
with open('data/probe.txt', 'w') as f:
    f.write('\n'.join(OUT))
