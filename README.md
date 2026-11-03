# Mushroom Finder

A map of promising places to look for choice wild mushrooms within about two hours of the Twin Cities:

morels, chanterelles, black trumpets, king boletes, lobster mushrooms, hedgehogs, hen-of-the-woods, chicken-of-the-woods, beefsteak fungus, oysters, lion's mane and bear's head, cauliflower mushrooms, giant puffballs, shaggy manes, honey mushrooms and velvet foot.

Live at https://nhillson.github.io/mushroom-finder/

## Data

**Built weekly by GitHub Actions** (`pipeline/build.py`, `.github/workflows/build-data.yml`) into `data/`:

- **Trees** — USFS TreeMap 2023 (30 m): live basal area for oaks, big oaks, maples, aspen, cottonwood, birch, elm, ash, basswood, willow, pine, spruce/fir, plus standing dead hardwoods and dead elm/ash
- **Land cover** — NLCD 2021: deciduous, mixed, evergreen, wooded wetland, grass, pasture, park lawn, shrub
- **Terrain** — USGS 3DEP: slope, north/south facing, bottomland (valley) index
- **Disturbance** — USFS aerial insect & disease surveys (elm/ash die-off, oak damage, aspen damage, storm damage) and NIFC fire perimeters
- **Trails and parking** — OpenStreetMap (Geofabrik extracts for Minnesota and Wisconsin)
- **Local seasons and sighting models** — iNaturalist research-grade records in the region. Seasons are measured against how many people log fungi each week. Habitat models compare where each mushroom was found with where people look for fungi in general, and are used only when they pass spatial cross-validation (AUC ≥ 0.6).

All of that is stored as a ~140 m lat/lng grid (`data/grid`, gzip tiles) the browser reads directly.

**Live in the browser:** Open-Meteo weather and forecast, PAD-US public land, iNaturalist sightings (including a "found nearby in the last two weeks" boost).

No backend, no API keys. Static site on GitHub Pages.

## How scoring works

Each grid cell or tapped spot gets:

1. **Habitat** — suitable land cover × host-tree density × terrain, plus dead wood and recent die-off for decay fungi; blended 50/50 with the sightings model where one exists (`js/species.js`, `js/score.js`)
2. **Timing** — local season curve × temperature fit × wetness (rain 2–10 days ago, soil moisture); soil temperature for morels; raised if someone logged it nearby in the last two weeks. The 7-day strip runs the same math on the forecast.
3. **Access** — Look mode counts any open public land. Harvest mode counts land where personal-use picking is allowed, 80% for free-permit areas, 50% where rules vary.

Overall = √(habitat × timing) × access.

## Features

- Scan the view for the best areas (one entry per park/forest)
- Tap any spot: land rules, hunting-season warning, forest and trees, dead wood, terrain, per-mushroom chances, 7-day outlook
- "In season" quick filter
- Save spots and log finds (stored only on the device; export/import as GeoJSON)
- Save an area for offline use (map tiles, habitat data, public land, trails, weather)
- Installable to a phone home screen

## Files

| File | What it holds |
|---|---|
| `js/species.js` | Each mushroom's hosts, season, temperature range, grid preferences, look-alike cautions |
| `js/landrules.js` | Land designation → picking rule table, metro park systems, hunting seasons (edit as rules change) |
| `js/score.js` | Habitat, timing, outlook and scoring math |
| `js/grid.js` | Reads the habitat grid and sightings models |
| `js/data.js` | Live data sources |
| `js/mine.js` | Saved spots and finds |
| `js/offline.js`, `sw.js` | Offline areas |
| `js/app.js` | Map and interface |
| `pipeline/build.py` | Data build |

## Known gaps

- The MN DNR forest stand inventory would help on state land, but its server refuses both browser and GitHub requests.
- PAD-US doesn't cover every county tax-forfeit parcel. Unmapped land is treated as private.
- Minneapolis and Ramsey County park rules are matched by approximate location; Dakota, Anoka, Carver and Scott County parks still show "check first."
- Hunting season dates beyond the Nov. 7, 2026 firearms opener are typical windows, not exact.

## Safety

This shows habitat, not identification. Never eat a wild mushroom unless someone experienced has confirmed it in person.

## Run locally

Any static server works, for example `python3 -m http.server` in this folder, then open http://localhost:8000.
