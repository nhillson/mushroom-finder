// What each target mushroom needs, encoded as simple rules.
// Habitat: weights for NLCD land-cover types and for host-tree density from the USFS tree-species maps.
// Season is a trapezoid over day-of-year: [start, rampedUp, rampDown, end] as 'MM-DD'.
// Temperature fit uses the last 7 days of daily highs/lows (°F).

export const SPECIES = {
  oyster: {
    name: 'Oysters',
    latin: 'Pleurotus spp.',
    color: '#5d6d7e',
    inatTaxa: [{ q: 'Pleurotus', rank: 'genus' }],
    hosts: 'Dead or dying hardwoods: aspen, cottonwood, elm, maple, basswood. Logs and standing snags.',
    season: 'Spring through early winter. Late fall oysters come in after cold snaps and thaws.',
    caution:
      'Look-alikes include angel wings (on conifer wood, linked to serious illness) and other white shelf fungi. Confirm spore print and growth on hardwood.',
    // weight of each land-cover type, and host trees (basal area sq ft/acre, 250 m average)
    lc: { decid: 1.0, mixed: 0.8, wetwood: 0.9, conifer: 0.15 },
    hostTrees: { quaking_aspen: 1.0, American_elm: 1.0, sugar_maple: 0.6, red_maple: 0.6 },
    hostScale: 5,
    hostFloor: 0.55, // many oyster hosts (cottonwood, basswood, silver maple) aren't in the tree maps
    seasons: [
      // two windows: main season, and a weak winter-thaw window
      { start: '04-10', full: '05-01', fade: '11-25', end: '12-31', peak: 1.0 },
      { start: '01-01', full: '01-01', fade: '03-15', end: '04-10', peak: 0.25 },
    ],
    // ideal band for 7-day mean daily high; outside it the fit tapers off
    temp: { minHigh: 34, idealLow: 42, idealHigh: 72, maxHigh: 88 },
  },

  hen: {
    name: 'Hen-of-the-woods',
    latin: 'Grifola frondosa',
    color: '#8e5b3a',
    inatTaxa: [{ q: 'Grifola frondosa', rank: 'species' }],
    hosts: 'Base of large, old oaks, especially red and white oak. Comes back to the same tree year after year.',
    season: 'Late August through October, peaking mid-September to early October.',
    caution:
      'The black-staining polypore is the usual look-alike. Many foragers also mistake other rosette polypores at oak bases. Get an ID from someone experienced.',
    lc: { decid: 1.0, mixed: 0.6, wetwood: 0.2, conifer: 0.05 },
    hostTrees: { white_oak: 1.0 },
    hostScale: 4,
    hostFloor: 0.35, // red and bur oak aren't in the tree maps, so deciduous forest keeps a floor
    seasons: [{ start: '08-20', full: '09-08', fade: '10-12', end: '11-05', peak: 1.0 }],
    temp: { minHigh: 45, idealLow: 55, idealHigh: 75, maxHigh: 86 },
    // a hard freeze ends the season
    freezeKill: 24,
  },

  chicken: {
    name: 'Chicken-of-the-woods',
    latin: 'Laetiporus spp.',
    color: '#e67e22',
    inatTaxa: [{ q: 'Laetiporus', rank: 'genus' }],
    hosts: 'Oaks most of all, also other hardwoods. Shelves on trunks and stumps, or rosettes at the base of oaks.',
    season: 'June through mid-October, peaking late July to mid-September.',
    caution:
      'Some people react to chicken-of-the-woods even when correctly identified, especially from conifer or locust hosts. Cook thoroughly and try a small amount first.',
    lc: { decid: 1.0, mixed: 0.7, wetwood: 0.5, conifer: 0.1 },
    hostTrees: { white_oak: 1.0, American_elm: 0.5 },
    hostScale: 4,
    hostFloor: 0.45,
    seasons: [{ start: '06-01', full: '07-20', fade: '09-20', end: '10-20', peak: 1.0 }],
    temp: { minHigh: 55, idealLow: 65, idealHigh: 85, maxHigh: 95 },
    freezeKill: 26,
  },
};
