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

  morel: {
    name: 'Morels',
    latin: 'Morchella spp.',
    color: '#a67c52',
    inatTaxa: [{ q: 'Morchella', rank: 'genus' }],
    hosts: 'Dead and dying elms, ash, aspen, cottonwood and old apple trees. River bottoms, burns and logged areas.',
    season: 'Late April through May. They start when the soil reaches about 50°F.',
    caution:
      'False morels (Gyromitra) and early morels (Verpa) are toxic. A true morel is hollow inside from tip to stem, with the cap attached at the bottom. Always cook morels.',
    lc: { decid: 1.0, wetwood: 0.9, mixed: 0.7, conifer: 0.1 },
    hostTrees: { American_elm: 1.0, quaking_aspen: 0.8 },
    hostScale: 4,
    hostFloor: 0.45, // ash, cottonwood and apple aren't in the tree maps
    seasons: [{ start: '04-15', full: '05-01', fade: '05-28', end: '06-10', peak: 1.0 }],
    temp: { minHigh: 48, idealLow: 58, idealHigh: 78, maxHigh: 88 },
    soil: { min: 44, idealLow: 50, idealHigh: 62, max: 70 },
  },

  chanterelle: {
    name: 'Chanterelles',
    latin: 'Cantharellus spp.',
    color: '#f2b705',
    inatTaxa: [{ q: 'Cantharellus', rank: 'genus' }],
    hosts: 'On the ground under oaks and in mixed hardwoods, often on mossy slopes and along trails. In the north, also under aspen and pine.',
    season: 'Late June through August, peaking after warm, heavy rains in July.',
    caution:
      'Jack-o\'-lantern mushrooms (toxic) grow in orange clusters on wood and have true, sharp gills. False chanterelles are thinner and more orange. Chanterelles have blunt, forked ridges and grow from soil.',
    lc: { decid: 1.0, mixed: 0.9, conifer: 0.4, wetwood: 0.2 },
    hostTrees: { white_oak: 1.0, quaking_aspen: 0.4 },
    hostScale: 4,
    hostFloor: 0.4,
    seasons: [{ start: '06-20', full: '07-05', fade: '08-31', end: '09-25', peak: 1.0 }],
    temp: { minHigh: 62, idealLow: 72, idealHigh: 88, maxHigh: 96 },
  },

  trumpet: {
    name: 'Black trumpets',
    latin: 'Craterellus fallax',
    color: '#3b3a3c',
    inatTaxa: [{ q: 'Craterellus fallax', rank: 'species' }, { q: 'Craterellus cornucopioides', rank: 'species' }],
    hosts: 'On the ground under oaks and other hardwoods, often in moss along slopes and streams. Hard to spot: dark gray-black funnels in leaf litter.',
    season: 'July through September, after rain.',
    caution: 'Few risky look-alikes, but confirm the smooth or wrinkled (not gilled) underside and thin, hollow trumpet shape.',
    lc: { decid: 1.0, mixed: 0.8, conifer: 0.2, wetwood: 0.3 },
    hostTrees: { white_oak: 1.0, sugar_maple: 0.5 },
    hostScale: 4,
    hostFloor: 0.35,
    seasons: [{ start: '07-01', full: '07-20', fade: '09-10', end: '10-01', peak: 1.0 }],
    temp: { minHigh: 58, idealLow: 66, idealHigh: 85, maxHigh: 94 },
  },

  bolete: {
    name: 'King boletes',
    latin: 'Boletus edulis group',
    color: '#7b4a2a',
    inatTaxa: [
      { q: 'Boletus edulis', rank: 'species' },
      { q: 'Boletus chippewaensis', rank: 'species' },
      { q: 'Boletus variipes', rank: 'species' },
    ],
    hosts: 'Under pine, spruce, aspen and birch, often sandy soil. More common north of the Twin Cities (St. Croix and Mille Lacs areas). B. variipes grows under oak.',
    season: 'Mid-July through September, flushing a week or two after soaking rains.',
    caution:
      'The bitter bolete has pinkish pores and ruins a dish. Skip boletes with red or orange pores, or that bruise blue. Cut in half and check for worms.',
    lc: { conifer: 1.0, mixed: 0.9, decid: 0.35, wetwood: 0.2 },
    hostTrees: { quaking_aspen: 0.6, balsam_fir: 0.6, white_oak: 0.4 },
    hostScale: 4,
    hostFloor: 0.45, // pine, spruce and birch aren't in the tree maps
    seasons: [{ start: '07-10', full: '08-01', fade: '09-25', end: '10-20', peak: 1.0 }],
    temp: { minHigh: 52, idealLow: 60, idealHigh: 80, maxHigh: 90 },
  },

  lobster: {
    name: 'Lobster mushroom',
    latin: 'Hypomyces lactifluorum',
    color: '#d1462f',
    inatTaxa: [{ q: 'Hypomyces lactifluorum', rank: 'species' }],
    hosts: 'A bright orange-red mold that covers certain milk caps and brittlegills, on the ground in mixed and conifer woods.',
    season: 'Mid-July through September.',
    caution: 'The flesh inside should be firm and white. Discard any that are soft, mushy or smell off.',
    lc: { mixed: 1.0, conifer: 0.9, decid: 0.6, wetwood: 0.3 },
    hostTrees: { quaking_aspen: 0.5, balsam_fir: 0.6 },
    hostScale: 4,
    hostFloor: 0.5,
    seasons: [{ start: '07-10', full: '07-25', fade: '09-10', end: '10-01', peak: 1.0 }],
    temp: { minHigh: 55, idealLow: 62, idealHigh: 82, maxHigh: 92 },
  },

  hedgehog: {
    name: 'Hedgehogs',
    latin: 'Hydnum spp.',
    color: '#e8a87c',
    inatTaxa: [{ q: 'Hydnum', rank: 'genus' }],
    hosts: 'On the ground in mixed and conifer woods, and under oak. Look for soft teeth instead of gills under a pale orange cap.',
    season: 'August through October.',
    caution: 'Few risky look-alikes. Confirm the spines under the cap and that it grows from soil, not wood.',
    lc: { mixed: 1.0, conifer: 0.8, decid: 0.8, wetwood: 0.2 },
    hostTrees: { white_oak: 0.6, quaking_aspen: 0.5, balsam_fir: 0.4 },
    hostScale: 4,
    hostFloor: 0.5,
    seasons: [{ start: '07-25', full: '08-15', fade: '10-10', end: '11-01', peak: 1.0 }],
    temp: { minHigh: 45, idealLow: 52, idealHigh: 76, maxHigh: 88 },
    freezeKill: 24,
  },

  lionsmane: {
    name: "Lion's mane & bear's head",
    latin: 'Hericium spp.',
    color: '#f4ecd8',
    inatTaxa: [{ q: 'Hericium', rank: 'genus' }],
    hosts: 'Wounds in live hardwoods and on large dead logs: oak, maple, beech, elm. Often high up on a trunk.',
    season: 'Late August through October.',
    caution: 'All white, toothed Hericium are edible. Pick only fresh white ones; yellowed or brown specimens turn sour.',
    lc: { decid: 1.0, mixed: 0.8, wetwood: 0.5, conifer: 0.15 },
    hostTrees: { white_oak: 1.0, sugar_maple: 0.9, red_maple: 0.6, American_elm: 0.4 },
    hostScale: 5,
    hostFloor: 0.4,
    seasons: [{ start: '08-15', full: '09-01', fade: '10-20', end: '11-15', peak: 1.0 }],
    temp: { minHigh: 40, idealLow: 48, idealHigh: 74, maxHigh: 86 },
    freezeKill: 22,
  },

  cauliflower: {
    name: 'Cauliflower mushroom',
    latin: 'Sparassis spp.',
    color: '#ead7a3',
    inatTaxa: [{ q: 'Sparassis', rank: 'genus' }],
    hosts: 'At the base of oaks (and in the north, pines), coming from the roots. A ruffled, cream-colored ball the size of a head of lettuce.',
    season: 'Late August through early October.',
    caution: 'Few look-alikes. Clean it well: dirt and insects hide in the folds.',
    lc: { decid: 1.0, mixed: 0.8, conifer: 0.5, wetwood: 0.1 },
    hostTrees: { white_oak: 1.0 },
    hostScale: 4,
    hostFloor: 0.35,
    seasons: [{ start: '08-10', full: '08-25', fade: '10-05', end: '10-30', peak: 1.0 }],
    temp: { minHigh: 50, idealLow: 58, idealHigh: 80, maxHigh: 90 },
    freezeKill: 26,
  },

  puffball: {
    name: 'Giant puffball',
    latin: 'Calvatia gigantea',
    color: '#d9d9d9',
    inatTaxa: [{ q: 'Calvatia gigantea', rank: 'species' }],
    hosts: 'Open ground: meadows, pastures, park lawns, field and woodland edges. Not a forest mushroom.',
    season: 'Mid-August through September, after rain.',
    caution:
      'Slice it top to bottom. It must be pure white and even all the way through, like fresh mozzarella. Any outline of a cap or gills inside means it is not a puffball (young deadly Amanitas can look like this). Discard if yellow or brown inside.',
    lc: { grass: 1.0, devopen: 0.9, pasture: 0.8, shrub: 0.6, decid: 0.25 },
    hostTrees: {},
    hostScale: 1,
    hostFloor: 1, // no host tree needed
    seasons: [{ start: '08-01', full: '08-20', fade: '09-30', end: '10-20', peak: 1.0 }],
    temp: { minHigh: 58, idealLow: 66, idealHigh: 84, maxHigh: 94 },
  },

  shaggymane: {
    name: 'Shaggy mane',
    latin: 'Coprinus comatus',
    color: '#b9b2a6',
    inatTaxa: [{ q: 'Coprinus comatus', rank: 'species' }],
    hosts: 'Disturbed grassy ground: lawns, roadsides, park edges, trail heads, wood chips. Often in rows or clusters.',
    season: 'Mostly September through November after cool rains, sometimes in spring.',
    caution:
      'It dissolves into black ink within hours of picking: cook it the same day. Its relative the common inky cap causes a bad reaction with alcohol, so be sure of the shaggy, tall white cap.',
    lc: { devopen: 1.0, grass: 0.8, pasture: 0.6, shrub: 0.4, decid: 0.15 },
    hostTrees: {},
    hostScale: 1,
    hostFloor: 1,
    seasons: [
      { start: '08-25', full: '09-15', fade: '10-31', end: '11-25', peak: 1.0 },
      { start: '05-01', full: '05-15', fade: '06-10', end: '06-30', peak: 0.4 },
    ],
    temp: { minHigh: 36, idealLow: 45, idealHigh: 70, maxHigh: 84 },
  },

  honey: {
    name: 'Honey mushrooms',
    latin: 'Armillaria spp.',
    color: '#c99a3b',
    inatTaxa: [{ q: 'Armillaria', rank: 'genus' }],
    hosts: 'Big clusters on stumps, roots and the base of hardwoods (and some conifers), often dozens at once.',
    season: 'Mid-September through October.',
    caution:
      'Deadly Galerina grows on wood at the same time: honey mushrooms leave a white spore print, Galerina a rusty-brown one. Always cook honeys well, and try a small amount first; some people get stomach upset.',
    lc: { decid: 1.0, mixed: 0.9, wetwood: 0.6, conifer: 0.5 },
    hostTrees: { white_oak: 0.8, sugar_maple: 0.8, quaking_aspen: 0.7, red_maple: 0.6, American_elm: 0.6 },
    hostScale: 5,
    hostFloor: 0.5,
    seasons: [{ start: '09-01', full: '09-15', fade: '10-20', end: '11-10', peak: 1.0 }],
    temp: { minHigh: 42, idealLow: 50, idealHigh: 72, maxHigh: 84 },
    freezeKill: 22,
  },

  velvetfoot: {
    name: 'Velvet foot',
    latin: 'Flammulina spp.',
    color: '#b5651d',
    inatTaxa: [{ q: 'Flammulina', rank: 'genus' }],
    hosts: 'Clusters on dead elm, aspen, willow and cottonwood, especially in river bottoms. The wild form of enoki.',
    season: 'Late fall through winter, fruiting during thaws, even after freezes.',
    caution:
      'Deadly Galerina grows on the same logs in the same season. Velvet foot has a velvety dark stem and a white spore print; Galerina leaves a rusty-brown print. Do a spore print on every collection.',
    lc: { decid: 1.0, wetwood: 1.0, mixed: 0.7, conifer: 0.1 },
    hostTrees: { American_elm: 1.0, quaking_aspen: 0.6 },
    hostScale: 4,
    hostFloor: 0.5,
    seasons: [
      { start: '10-10', full: '11-01', fade: '12-31', end: '12-31', peak: 1.0 },
      { start: '01-01', full: '01-01', fade: '03-20', end: '04-20', peak: 0.7 },
    ],
    temp: { minHigh: 26, idealLow: 34, idealHigh: 55, maxHigh: 70 },
  },
};

// Preferences used with the detailed habitat grid (data/grid). Host values are weights on
// live basal area (sq ft/acre, averaged over the cell) for each tree group; hostScale is the
// weighted basal area that counts as "full" host presence. dead: weights on dead-wood and
// disturbance bands. terrain: valley (bottomland), slope, north / south (facing).
const GRID = {
  oyster: { hosts: { aspen: 1, cottonwood: 1, elm: 0.9, basswood: 0.8, maple: 0.6, willow: 0.6, birch: 0.4 }, hostScale: 15, floor: 0.3,
    dead: { dead_hw: 1, dmg_aspen: 0.6, dmg_storm: 0.6, dmg_elmash: 0.5 }, terrain: { valley: 0.5 } },
  hen: { hosts: { oak: 0.6, bigoak: 1 }, hostScale: 12, floor: 0.1, dead: {}, terrain: {} },
  chicken: { hosts: { oak: 1, bigoak: 0.5, cottonwood: 0.3, willow: 0.3 }, hostScale: 15, floor: 0.15,
    dead: { dead_hw: 0.6, dmg_oak: 0.6 }, terrain: {} },
  morel: { hosts: { elm: 1, ash: 1, cottonwood: 0.8, aspen: 0.6 }, hostScale: 8, floor: 0.2,
    dead: { dead_elmash: 1.2, dmg_elmash: 1, burn: 1 }, terrain: { valley: 0.6, south: 0.3 } },
  chanterelle: { hosts: { oak: 1, aspen: 0.4, pine: 0.4, birch: 0.3 }, hostScale: 15, floor: 0.2, dead: {}, terrain: { slope: 0.3 } },
  trumpet: { hosts: { oak: 1, maple: 0.5, basswood: 0.3 }, hostScale: 15, floor: 0.15, dead: {}, terrain: { slope: 0.4, north: 0.3, valley: 0.2 } },
  bolete: { hosts: { pine: 1, sprucefir: 0.8, aspen: 0.6, birch: 0.6, oak: 0.3 }, hostScale: 15, floor: 0.15, dead: {}, terrain: {} },
  lobster: { hosts: { pine: 0.8, sprucefir: 0.8, aspen: 0.6, birch: 0.6, oak: 0.4 }, hostScale: 15, floor: 0.25, dead: {}, terrain: {} },
  hedgehog: { hosts: { pine: 0.6, sprucefir: 0.6, oak: 0.6, aspen: 0.5, birch: 0.5 }, hostScale: 15, floor: 0.25, dead: {}, terrain: { north: 0.2 } },
  lionsmane: { hosts: { oak: 0.8, bigoak: 0.6, maple: 0.8, basswood: 0.4, birch: 0.3 }, hostScale: 15, floor: 0.2,
    dead: { dead_hw: 1, dmg_storm: 0.5 }, terrain: {} },
  cauliflower: { hosts: { bigoak: 1, oak: 0.6, pine: 0.6 }, hostScale: 12, floor: 0.1, dead: {}, terrain: {} },
  puffball: { hosts: {}, hostScale: 1, floor: 1, dead: {}, terrain: {} },
  shaggymane: { hosts: {}, hostScale: 1, floor: 1, dead: {}, terrain: {} },
  honey: { hosts: { oak: 0.8, maple: 0.8, aspen: 0.7, basswood: 0.6, birch: 0.6, elm: 0.5, ash: 0.5 }, hostScale: 15, floor: 0.3,
    dead: { dead_hw: 1, dmg_oak: 0.5, dmg_storm: 0.5, dmg_elmash: 0.5 }, terrain: {} },
  velvetfoot: { hosts: { elm: 1, cottonwood: 1, willow: 1, aspen: 0.7 }, hostScale: 10, floor: 0.25,
    dead: { dead_elmash: 1, dead_hw: 0.6, dmg_elmash: 0.5 }, terrain: { valley: 0.8 } },
};
for (const [k, g] of Object.entries(GRID)) SPECIES[k].g = g;

// Readable names for grid bands
export const GRID_TREES = {
  oak: 'Oaks (red, bur, white, pin)', maple: 'Maples & boxelder', aspen: 'Aspen & poplar', cottonwood: 'Cottonwood',
  birch: 'Birch', elm: 'Elm', ash: 'Ash', basswood: 'Basswood', willow: 'Willow', pine: 'Pine', sprucefir: 'Spruce & fir',
};
