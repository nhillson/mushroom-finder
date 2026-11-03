// Foraging rules by land designation. PAD-US says who manages a parcel, not what you may pick,
// so this table translates designation -> rule. Edit it as rules change.
// status: 'harvest' = personal-use picking allowed, 'check' = rules vary, look first,
//         'look' = visiting OK but no picking, 'closed' = no public access.

export const RULES_CHECKED = 'November 2026';

const LINKS = {
  stateParks: 'https://www.dnr.state.mn.us/state_parks/harvesting.html',
  stateForests: 'https://www.dnr.state.mn.us/forestry/harvest-permits-state-lands.html',
  wma: 'https://www.dnr.state.mn.us/wmas/index.html',
  sna: 'https://www.dnr.state.mn.us/snas/rules.html',
  ruleRevision: 'https://www.dnr.state.mn.us/input/rules/parks/rule_revisions.html',
};

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
    note: 'WMA foraging rules differ from parks and forests. Check the WMA rules before picking.',
    link: LINKS.wma,
  },
  {
    test: (d, m, n) => /aquatic management/.test(d + ' ' + n),
    status: 'check',
    label: 'Aquatic Management Area',
    note: 'Check DNR rules for this area before picking.',
  },
  {
    test: (d, m) => /national forest/.test(d) || /forest service/.test(m),
    status: 'harvest',
    label: 'National forest',
    note: 'Personal-use picking is generally allowed, often with a daily limit (about one gallon). Confirm with the district office.',
  },
  {
    test: (d, m) => /wildlife refuge|national wildlife/.test(d) || /fish and wildlife service/.test(m),
    status: 'check',
    label: 'National wildlife refuge',
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
    test: (d, m) => /private|non-governmental|ngo|land trust|conservancy|easement/.test(d + ' ' + m),
    status: 'look',
    label: 'Private conservation land',
    note: 'Owned by a land trust or private group. Check whether visitors are allowed, and ask before picking.',
  },
];

export function classifyLand(props) {
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

  for (const r of RULES) {
    if (r.test(d, m, n)) {
      const out = { status: r.status, label: r.label, note: r.note, link: r.link };
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
  if (mode === 'harvest') return { harvest: 1, check: 0.5, look: 0, closed: 0 }[status] ?? 0;
  return { harvest: 1, check: 1, look: 1, closed: 0 }[status] ?? 0;
}

export const STATUS_STYLE = {
  harvest: { color: '#2e7d32', label: 'Picking allowed (personal use)' },
  check: { color: '#e0a800', label: 'Rules vary — check first' },
  look: { color: '#1f6fb2', label: 'Look only' },
  closed: { color: '#9e2a2b', label: 'Closed / no access' },
};
