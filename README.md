# Mushroom Finder

A map of promising places to look for **oysters**, **hen-of-the-woods** and **chicken-of-the-woods** within about two hours of the Twin Cities.

It combines, live in your browser:

- **Land cover** — NLCD 2021 (30 m): how much deciduous, mixed and wooded-wetland forest is around
- **Host trees** — USFS FIA Forest Atlas tree-species density (250 m): white oak, aspen, elm, sugar and red maple
- **Weather** — Open-Meteo: last 14 days of rain, last week's temperatures, soil moisture and temperature, 7-day forecast
- **Public land** — PAD-US, translated into Minnesota picking rules (`js/landrules.js`)
- **Sightings** — iNaturalist research-grade and needs-ID observations

No backend, no API keys. It's a static site that runs on GitHub Pages.

## How scoring works

Each grid cell or tapped spot gets three numbers, multiplied together:

1. **Habitat** — suitable forest fraction × host-tree density (`js/species.js`, `js/score.js`)
2. **Timing** — season window × temperature fit × wetness (rain 2–10 days ago, soil moisture)
3. **Access** — Look mode counts any open public land. Harvest mode counts only land where personal-use picking is allowed, and half-counts land where rules vary.

## Files

| File | What it holds |
|---|---|
| `js/config.js` | Data source URLs, land-cover classes, tracked trees |
| `js/species.js` | Each mushroom's hosts, season, temperature range |
| `js/landrules.js` | Land designation → picking rule table (edit as rules change) |
| `js/score.js` | Habitat, timing and scoring math |
| `js/data.js` | Fetching from each data source |
| `js/app.js` | Map and interface |

## Known gaps

- The tree maps don't include red or bur oak, so oak habitat is underestimated in places.
- The MN DNR forest stand inventory would be a big upgrade on state land, but its server blocks browser requests. It would need a small proxy.
- PAD-US doesn't cover every county tax-forfeit parcel. Unmapped land is treated as private.

## Safety

This shows habitat, not identification. Never eat a wild mushroom unless someone experienced has confirmed it in person.

## Run locally

Any static server works, for example `python3 -m http.server` in this folder, then open http://localhost:8000.
