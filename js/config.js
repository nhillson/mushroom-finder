// Regions with their own habitat data, mushrooms, seasons and rules.
// box: area covered by the detailed habitat grid. rain: which past days count toward
// "wet enough" (from/to days ago) and how many inches count as fully wet.
export const REGIONS = {
  mn: {
    id: 'mn', name: 'Minnesota (Twin Cities)', state: 'MN', tz: 'America/Chicago',
    center: [44.98, -93.27], zoom: 9, box: [[43.5, -95.6], [46.6, -91.0]],
    grid: 'data/grid', model: 'data/model.json', trails: 'data/trails',
    rain: { from: 2, to: 10, full: 0.9 },
    club: { name: 'Minnesota Mycological Society', url: 'https://www.minnesotamushrooms.org/' },
    rulesChecked: 'November 2026',
  },
  socal: {
    id: 'socal', name: 'Southern California (LA)', state: 'CA', tz: 'America/Los_Angeles',
    center: [34.15, -118.3], zoom: 9, box: [[32.5, -120.7], [35.2, -116.0]],
    grid: 'data/grid-socal', model: 'data/model-socal.json', trails: 'data/trails-socal',
    // fruiting follows soaking winter rains by a few weeks
    rain: { from: 3, to: 24, full: 1.5 },
    club: { name: 'Los Angeles Mycological Society', url: 'https://lamushrooms.org/' },
    rulesChecked: 'November 2026',
  },
};
export const ACTIVE = { region: 'mn' };
export const region = () => REGIONS[ACTIVE.region];
export function regionAt(lat, lng) {
  for (const r of Object.values(REGIONS)) {
    if (lat >= r.box[0][0] && lat <= r.box[1][0] && lng >= r.box[0][1] && lng <= r.box[1][1]) return r.id;
  }
  return null;
}

// All live data sources. Every one is called directly from the browser.
export const CFG = {

  // USFS FIA Forest Atlas: live basal area (sq ft/acre) by tree species, 250 m.
  // A mosaic of one raster per species, named by FIA species code (s802 = white oak).
  treeSpecies:
    'https://imagery.geoplatform.gov/iipp/rest/services/Vegetation/USFS_EDW_FIA_ForestAtlas_TreeSpecies_107/ImageServer',

  // NLCD 2021 land cover, 30 m (MRLC WMS)
  nlcd: {
    url: 'https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/wms',
    layer: 'NLCD_2021_Land_Cover_L48',
  },

  // PAD-US (protected/public lands), public-access edition, national feature layer
  padus:
    'https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/PADUS_Public_Access/FeatureServer/0',

  // Weather (no key needed)
  openMeteo: 'https://api.open-meteo.com/v1/forecast',

  // Community observations
  inat: 'https://api.inaturalist.org/v1',

  basemaps: {
    topo: {
      name: 'Topo',
      url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
      attribution: 'USGS The National Map',
      maxNativeZoom: 16,
    },
    satellite: {
      name: 'Satellite',
      url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}',
      attribution: 'USGS The National Map',
      maxNativeZoom: 16,
    },
    streets: {
      name: 'Streets',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
      maxNativeZoom: 19,
    },
  },
};

// NLCD classes: code -> [name, rgb as drawn by the MRLC WMS default style]
export const NLCD = {
  11: ['Open water', [71, 107, 160]],
  12: ['Ice / snow', [209, 221, 249]],
  21: ['Developed, open space', [221, 201, 201]],
  22: ['Developed, low', [216, 147, 130]],
  23: ['Developed, medium', [237, 0, 0]],
  24: ['Developed, high', [170, 0, 0]],
  31: ['Barren', [179, 172, 159]],
  41: ['Deciduous forest', [104, 170, 99]],
  42: ['Evergreen forest', [28, 99, 48]],
  43: ['Mixed forest', [181, 201, 142]],
  52: ['Shrub / scrub', [204, 186, 124]],
  71: ['Grassland', [226, 226, 193]],
  81: ['Pasture / hay', [219, 216, 61]],
  82: ['Cropland', [170, 112, 40]],
  90: ['Woody wetland', [186, 216, 234]],
  95: ['Herbaceous wetland', [112, 163, 186]],
};

// Tree species we track: key -> FIA species raster name in the Forest Atlas mosaic
export const TREES = {
  white_oak: { raster: 's802', name: 'White oak' },
  quaking_aspen: { raster: 's746', name: 'Quaking aspen' },
  American_elm: { raster: 's972', name: 'American elm' },
  sugar_maple: { raster: 's318', name: 'Sugar maple' },
  red_maple: { raster: 's316', name: 'Red maple' },
  balsam_fir: { raster: 's12', name: 'Balsam fir' },
};

// Optional map overlays
export const OVERLAYS = [
  { id: 'nlcd', name: 'Land cover (forest = green)' },
  { id: 'white_oak', name: 'White oak (tree density)', color: '#8e5b3a' },
  { id: 'quaking_aspen', name: 'Aspen (tree density)', color: '#c9a227' },
];
