// Foraging rules by land designation. PAD-US says who manages a parcel, not what you may pick,
// so this table translates designation -> rule. Edit it as rules change.
// status: 'harvest' = personal-use picking allowed, 'permit' = allowed with a (free) permit in set areas,
//         'check' = rules vary, look first, 'look' = visiting OK but no picking, 'closed' = no public access.
// hunt: true marks land that is generally open to hunting (used for the blaze-orange warning).

export const RULES_CHECKED = 'November 2026';

const LINKS = {
  stateParks: 'https://www.dnr.state.mn.us/state_parks/harvesting.html',
  stateForests: 'https://www.dnr.state.mn.us/forestry/harvest-permits-state-lands.html',
  wma: 'https://www.dnr.state.mn.us/wmas/index.html',
  sna: 'https://www.dnr.state.mn.us/snas/rules.html',
  ruleRevision: 'https://www.dnr.state.mn.us/input/rules/parks/rule_revisions.html',
  washCo: 'https://washingtoncountymn.gov/3798/Foraging',
  threeRivers: 'https://www.threeriversparks.org/blog/foraging-parks-and-why-it-isnt-allowed',
  wiParks: 'https://dnr.wisconsin.gov/topic/parks/rules/gathering',
  hunting: 'https://www.dnr.state.mn.us/hunting/index.html',
  // California
  caParks: 'https://www.law.cornell.edu/regulations/california/14-CCR-4306',
  cdfwLands: 'https://www.law.cornell.edu/regulations/california/14-CCR-550',
  angelesPermits: 'https://www.fs.usda.gov/r05/angeles/permits',
  samo: 'https://www.nps.gov/samo/learn/management/compendium.htm',
  blm: 'https://www.blm.gov/sites/default/files/docs/2021-10/Can%20I%20Keep%20This%202021%20-%20508%20Final%20Version.pdf',
  caHunting: 'https://wildlife.ca.gov/Hunting',
};

// ---------- California (Southern California region) ----------
// Checked Nov 2026: CA State Parks ban picking unless posted (14 CCR 4306); CDFW lands ban removing
// plants (14 CCR 550); Angeles and San Bernardino NFs require a forest product permit for mushrooms;
// Santa Monica Mountains NRA (NPS land) allows one handful per person to eat in the park; BLM allows
// small personal-use amounts.
const CA_RULES = [
  { test: (d, m) => /tribal|indian|reservation/.test(d + m), status: 'closed', label: 'Tribal land', note: 'Tribal land. Do not enter or forage without permission from the tribe.' },
  { test: (d, m) => /military|defense/.test(d + ' ' + m), status: 'closed', label: 'Military land', note: 'Closed to the public.' },
  {
    test: (d, m) => /forest service/.test(m),
    status: 'permit', hunt: true, label: 'National forest',
    note: 'The Angeles and San Bernardino National Forests require a forest product permit to collect mushrooms, even for personal use. Call the district ranger station before picking. Wilderness areas can have extra limits.',
    link: LINKS.angelesPermits,
  },
  {
    test: (d, m, n) => /national park service/.test(m) && /santa monica mountains/.test(n),
    status: 'check', label: 'Santa Monica Mountains NRA',
    note: 'On National Park Service land here you may pick one handful of mushrooms per person to eat in the park, not to take home. State, county and conservancy land inside the recreation area has its own (stricter) rules.',
    link: LINKS.samo,
  },
  { test: (d, m) => /national park service/.test(m), status: 'check', label: 'National Park Service', note: 'Each park sets its own gathering rules in its compendium. Check before picking.' },
  {
    test: (d, m) => /bureau of land management/.test(m),
    status: 'harvest', hunt: true, label: 'BLM land',
    note: 'Small amounts of mushrooms may be collected for personal use on most BLM land. Rules are stricter in wilderness areas and national monuments.',
    link: LINKS.blm,
  },
  { test: (d, m) => /fish and wildlife service|wildlife refuge/.test(d + ' ' + m), status: 'check', hunt: true, label: 'National wildlife refuge', note: 'Each refuge sets its own gathering rules. Check that refuge\'s regulations.' },
  {
    test: (d, m) => /fish and wildlife|ecological reserve|wildlife area/.test(d + ' ' + m),
    status: 'look', hunt: true, label: 'CDFW wildlife land',
    note: 'California Fish and Wildlife lands prohibit removing plants and other natural material. Look only.',
    link: LINKS.cdfwLands,
  },
  {
    test: (d, m) => /state park|state recreation|state beach|state historic|state reserve/.test(d) || /state park and recreation/.test(m),
    status: 'look', label: 'California state park',
    note: 'California State Parks prohibit picking unless mushroom gathering is posted as allowed at that park. In Southern California, assume look only.',
    link: LINKS.caParks,
  },
  { test: (d, m) => /^state |\bstate\b/.test(m), status: 'look', label: 'State land', note: 'State conservation land: assume no collecting unless signs say otherwise.' },
  { test: (d, m) => /regional agency|regional water|water district|conservancy|conservation authority/.test(m), status: 'look', label: 'Regional park or conservancy land', note: 'Regional park agencies and conservancies (such as the Mountains Recreation and Conservation Authority) generally prohibit removing natural materials. Look only.' },
  { test: (d, m) => /army corps/.test(m), status: 'check', label: 'Army Corps of Engineers', note: 'Recreation areas run by the Army Corps have their own rules. Check before picking.' },
  { test: (d, m) => /local|county|city|municipal/.test(d + ' ' + m), status: 'look', label: 'City or county park', note: 'City and county parks in Southern California generally prohibit removing plants or natural materials. Look only, or check the park\'s rules.' },
  { test: (d, m) => /private|non-governmental|ngo|land trust|easement/.test(d + ' ' + m), status: 'look', label: 'Private or conservation land', note: 'Owned by a land trust or private group. Check whether visitors are allowed, and ask before picking.' },
];

function classifyCA(props) {
  if (!props) {
    return { status: 'closed', label: 'Private or unmapped', note: 'Not in the public lands database. Treat it as private: get the owner\'s permission first.' };
  }
  const d = (props.DesTp_Desc || '').toLowerCase();
  const m = ((props.MngTp_Desc || '') + ' ' + (props.MngNm_Desc || '')).toLowerCase();
  const n = (props.Unit_Nm || '').toLowerCase();
  const access = props.Pub_Access;
  for (const r of CA_RULES) {
    if (r.test(d, m, n)) {
      const out = { status: r.status, label: r.label, note: r.note, link: r.link, hunt: !!r.hunt };
      if (access === 'XA') return { ...out, status: 'closed', note: 'Closed to public access.' };
      if (access === 'RA') out.note = 'Restricted access (permit, season or hours may apply). ' + out.note;
      return out;
    }
  }
  if (access === 'XA') return { status: 'closed', label: props.DesTp_Desc || 'Closed', note: 'Closed to public access.' };
  return { status: 'check', label: props.DesTp_Desc || 'Public land', note: 'Public land with no foraging rule on file here. Check with the manager before picking.' };
}

// Metro park systems with known rules (matched on unit name)
const THREE_RIVERS = /baker park|carver park|crow-hassan|crow hassan|elm creek park|hyland|bush lake|anderson lakes|lake rebecca|murphy-hanrehan|murphy hanrehan|cleary lake|bryant lake|french regional|french park|fish lake regional|silverwood|eagle lake regional|lake sarah|gale woods|noerenberg|coon rapids dam|mississippi gateway|spring lake regional|cedar lake farm|kingswood|glen lake|lowry nature/;
const WASHCO_PERMIT = /lake elmo park reserve|cottage grove ravine|pine point|st\.? croix bluffs|square lake/;
const WASHCO_NO = /big marine|long lake conservation/;
const RAMSEY_BOX = [44.89, -93.207, 45.125, -92.984];
const MPLS_BOX = [44.89, -93.329, 45.051, -93.194];
const inBox = (lat, lng, b) => lat != null && lat >= b[0] && lat <= b[2] && lng >= b[1] && lng <= b[3];

const METRO_RULES = [
  {
    test: (d, m, n) => THREE_RIVERS.test(n),
    status: 'look',
    label: 'Three Rivers park',
    note: 'Three Rivers Park District bans collecting plants, mushrooms and other natural objects. Look only.',
    link: LINKS.threeRivers,
  },
  {
    test: (d, m, n) => WASHCO_NO.test(n),
    status: 'look',
    label: 'Washington County park',
    note: 'Washington County does not allow foraging in this park.',
    link: LINKS.washCo,
  },
  {
    test: (d, m, n) => WASHCO_PERMIT.test(n),
    status: 'permit',
    label: 'Washington County park',
    note: 'Foraging allowed only in designated areas, with a free annual permit (April–October). Check the county\'s current foraging area map.',
    link: LINKS.washCo,
  },
  {
    test: (d, m, n, lat, lng) => /county/.test(m) && inBox(lat, lng, RAMSEY_BOX),
    status: 'look',
    label: 'Ramsey County park',
    note: 'Ramsey County\'s park ordinance bars removing natural resources without the director\'s written permission. Look only.',
  },
  {
    test: (d, m, n, lat, lng) => /city/.test(m) && inBox(lat, lng, MPLS_BOX),
    status: 'look',
    label: 'Minneapolis park (likely)',
    note: 'Minneapolis parks allow picking approved fruit and nuts, but not mushrooms. Look only.',
  },
];

const RULES = [
  {
    test: (d, m, n) => /tribal|indian|reservation/.test(d + m),
    status: 'closed',
    label: 'Tribal land',
    note: 'Tribal land. Do not enter or forage without permission from the tribe.',
  },
  {
    test: (d) => /state trail/.test(d),
    status: 'look',
    label: 'State trail',
    note: 'Mushroom picking is not allowed along Minnesota state trails.',
    link: LINKS.stateParks,
  },
  {
    test: (d, m, n) => /scientific and natural|\bsna\b/.test(d + ' ' + n),
    status: 'look',
    label: 'Scientific & Natural Area',
    note: 'Mushroom picking is allowed at only one SNA in Minnesota. Assume look only.',
    link: LINKS.sna,
  },
  {
    test: (d) => /state forest/.test(d) && !/recreation area/.test(d),
    status: 'harvest',
    label: 'State forest',
    hunt: true,
    note: 'Personal-use mushroom picking is allowed in Minnesota state forests.',
    link: LINKS.stateForests,
  },
  {
    test: (d, m, n) => /state park|state recreation area|state wayside/.test(d + ' ' + n),
    status: 'harvest',
    label: 'State park',
    note: 'Edible mushrooms may be picked for personal, noncommercial use. The DNR is revising these rules, so check before you go.',
    link: LINKS.ruleRevision,
  },
  {
    test: (d, m, n) => /wildlife management area|\bwma\b/.test(d + ' ' + n),
    status: 'check',
    label: 'Wildlife Management Area',
    hunt: true,
    note: 'WMA foraging rules differ from parks and forests. Check the WMA rules before picking.',
    link: LINKS.wma,
  },
  {
    test: (d, m, n) => /aquatic management/.test(d + ' ' + n),
    status: 'check',
    label: 'Aquatic Management Area',
    hunt: true,
    note: 'Check DNR rules for this area before picking.',
  },
  {
    test: (d, m) => /national forest/.test(d) || /forest service/.test(m),
    status: 'harvest',
    label: 'National forest',
    hunt: true,
    note: 'Personal-use picking is generally allowed, often with a daily limit (about one gallon). Confirm with the district office.',
  },
  {
    test: (d, m, n) => /waterfowl production/.test(d + ' ' + n),
    status: 'check',
    label: 'Waterfowl Production Area',
    note: 'Federal WPAs are open to hunting and have their own gathering rules. Check with the local wetland management district.',
    hunt: true,
  },
  {
    test: (d, m) => /wildlife refuge|national wildlife/.test(d) || /fish and wildlife service/.test(m),
    status: 'check',
    label: 'National wildlife refuge',
    hunt: true,
    note: 'Each refuge sets its own gathering rules. Check that refuge\'s regulations.',
  },
  {
    test: (d, m) => /national park|national monument|national scenic/.test(d) || /national park service/.test(m),
    status: 'check',
    label: 'National Park Service',
    note: 'Gathering rules are set per park unit. Check the unit\'s rules.',
  },
  {
    test: (d, m) => /local|county|city|municipal|regional|park district/.test(d + ' ' + m),
    status: 'check',
    label: 'County / city / regional park',
    note: 'Many county, regional and city parks prohibit removing plants or fungi. Enjoy looking; check the park\'s ordinance before picking.',
  },
  {
    test: (d) => /private park|private recreation/.test(d),
    status: 'closed',
    label: 'Private park',
    note: 'Privately owned (golf course, club, camp). Ask the owner before entering.',
  },
  {
    test: (d, m) => /private|non-governmental|ngo|land trust|conservancy|easement/.test(d + ' ' + m),
    status: 'look',
    label: 'Private conservation land',
    note: 'Owned by a land trust or private group. Check whether visitors are allowed, and ask before picking.',
  },
];

// Approximate MN–WI–IA border for the area this app covers (lat, lng from north to south).
const WI_BORDER = [
  [46.75, -92.10], [46.42, -92.29], [45.73, -92.29], [45.73, -92.88], [45.4, -92.67], [45.18, -92.76],
  [44.95, -92.762], [44.86, -92.762], [44.80, -92.775], [44.745, -92.80], [44.6, -92.62], [44.45, -92.27], [44.36, -91.95], [44.1, -91.71],
  [43.85, -91.27], [43.5, -91.22],
];
export function stateAt(lat, lng) {
  if (lng < -114 && lat < 42.1) return 'CA';
  if (lat < 43.5) return 'IA';
  for (let i = 0; i < WI_BORDER.length - 1; i++) {
    const [la1, ln1] = WI_BORDER[i], [la2, ln2] = WI_BORDER[i + 1];
    if (lat <= la1 && lat >= la2) {
      const edge = la1 === la2 ? Math.min(ln1, ln2) : ln1 + ((lat - la1) / (la2 - la1)) * (ln2 - ln1);
      return lng > edge ? 'WI' : 'MN';
    }
  }
  return 'MN';
}

export function classifyLand(props, lat, lng) {
  const st = lat != null ? stateAt(lat, lng) : 'MN';
  if (st === 'CA') return { ...classifyCA(props), state: 'CA' };
  const out = { ...classifyMN(props, lat, lng), state: st };
  if (st === 'WI' && props && out.label === 'State park') {
    return { ...out, note: 'Wisconsin state parks allow hand-picking wild mushrooms for personal consumption.', link: LINKS.wiParks };
  }
  if (st !== 'MN' && props && (out.status === 'harvest' || out.status === 'permit')) {
    const name = st === 'WI' ? 'Wisconsin' : 'Iowa';
    return { ...out, status: 'check', note: `This is in ${name}. The Minnesota rules in this app don't apply here; check ${name}'s rules before picking.`, link: undefined };
  }
  return out;
}

function classifyMN(props, lat, lng) {
  if (!props) {
    return {
      status: 'closed',
      label: 'Private or unmapped',
      note: 'Not in the public lands database. Treat it as private: get the owner\'s permission first.',
    };
  }
  const d = (props.DesTp_Desc || '').toLowerCase();
  const m = ((props.MngTp_Desc || '') + ' ' + (props.MngNm_Desc || '')).toLowerCase();
  const n = (props.Unit_Nm || '').toLowerCase();
  const access = props.Pub_Access;

  for (const r of [...METRO_RULES, ...RULES]) {
    if (r.test(d, m, n, lat, lng)) {
      const out = { status: r.status, label: r.label, note: r.note, link: r.link, hunt: !!r.hunt };
      if (access === 'XA') return { ...out, status: 'closed', note: 'Closed to public access.' };
      if (access === 'RA') out.note = 'Restricted access (permit, season or hours may apply). ' + out.note;
      return out;
    }
  }
  if (access === 'XA') return { status: 'closed', label: props.DesTp_Desc || 'Closed', note: 'Closed to public access.' };
  return {
    status: 'check',
    label: props.DesTp_Desc || 'Public land',
    note: 'Public land with no foraging rule on file here. Check with the manager before picking.',
  };
}

// How much a land status counts toward the score in each mode
export function accessFactor(status, mode) {
  if (mode === 'harvest') return { harvest: 1, permit: 0.8, check: 0.5, look: 0, closed: 0 }[status] ?? 0;
  return { harvest: 1, permit: 1, check: 1, look: 1, closed: 0 }[status] ?? 0;
}

// Hunting-season reminder for land open to hunting. Only the Nov 7, 2026 firearms opener is
// confirmed from the DNR; the other windows are typical season timing and are labeled approximate.
export function huntingWarning(cls, date = new Date()) {
  if (!cls || !cls.hunt) return null;
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  const y = date.getFullYear();
  if (cls.state === 'CA') {
    // Quail dates confirmed for 2026-27; deer windows are typical timing for zones D11-D16.
    if (md >= 1010 && md <= 1122)
      return { level: 'high', text: 'Deer season is likely open in Southern California\'s national forests (the general season usually runs mid-October into November; later in zone D16). Wear bright colors and stay on trails.', link: LINKS.caHunting };
    if (md >= 901 || md <= 131)
      return { level: 'medium', text: `Hunting seasons are open on national forest and BLM land (archery deer in September; quail ${y === 2026 || (y === 2027 && md <= 131) ? 'Oct. 17, 2026 to Jan. 31, 2027' : 'mid-October through January'}). Wear something bright.`, link: LINKS.caHunting };
    if (md >= 325 && md <= 531)
      return { level: 'medium', text: 'Spring turkey season typically runs late March into May on public hunting land. Wear something bright.', link: LINKS.caHunting };
    return null;
  }
  if (y === 2026 && md >= 1107 && md <= 1122)
    return { level: 'high', text: 'Firearms deer season is open (opened Nov. 7). Wear blaze orange, stay on trails, and consider going midday or picking somewhere that doesn\'t allow hunting.', link: LINKS.hunting };
  if (md >= 1123 && md <= 1215)
    return { level: 'high', text: 'Late deer seasons (muzzleloader, some firearms zones) typically run late November to mid-December. Wear blaze orange.', link: LINKS.hunting };
  if (md >= 415 && md <= 531)
    return { level: 'medium', text: 'Spring turkey season typically runs mid-April through May — the same weeks as morels. Wear something bright and stay out of sight lines at dawn.', link: LINKS.hunting };
  if (md >= 901 || md <= 131)
    return { level: 'medium', text: 'Hunting seasons (archery deer, small game, waterfowl) are open on most public hunting land from September through December. Wear something bright.', link: LINKS.hunting };
  return null;
}

export const STATUS_STYLE = {
  harvest: { color: '#2e7d32', label: 'Picking allowed (personal use)' },
  permit: { color: '#16a085', label: 'Allowed with a permit' },
  check: { color: '#e0a800', label: 'Rules vary — check first' },
  look: { color: '#1f6fb2', label: 'Look only' },
  closed: { color: '#9e2a2b', label: 'Closed / no access' },
};
