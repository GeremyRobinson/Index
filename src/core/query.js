/* ===================================================================
   IndexQuery: plain words in, tags out. No DOM code in here.
   Turns "bakeries in san diego with email, staff > 10, not contacted"
   into tags any app can show, edit and compile into a core search:
     const { tags, rest } = IndexQuery.parse(text, vocab);
     const q = IndexQuery.compile(tags, rest, ctx);  // -> { text, filters, near, radiusKm, where }
   =================================================================== */
const IndexQuery = (() => {
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&");
  const alt = list => list.length ? [...list].sort((a, b) => b.length - a.length).map(escRe).join("|") : "(?!)";
  const YEAR = new Date().getFullYear();
  const UNIT = "(?:staff|employees?|people|workers|person team|headcount)";
  const FIELD = { email: "email", "e-mail": "email", phone: "phone", number: "phone", website: "website", site: "website", web: "website", hours: "hours" };
  const SECTOR_WORDS = { tech: "Technology", software: "Technology", health: "Healthcare", medical: "Healthcare", food: "Food & Beverage", restaurants: "Food & Beverage", eats: "Food & Beverage", property: "Real Estate", realtors: "Real Estate", shops: "Retail", stores: "Retail", factories: "Manufacturing", salons: "Beauty & Wellness", beauty: "Beauty & Wellness", hotels: "Hospitality", gyms: "Fitness & Recreation", fitness: "Fitness & Recreation", auto: "Automotive", cars: "Automotive", banks: "Finance", lawyers: "Professional Services", trades: "Home Services" };
  const CITY_WORDS = { sf: "San Francisco", la: "Los Angeles", sd: "San Diego", sj: "San Jose", sac: "Sacramento", oak: "Oakland", lb: "Long Beach" };
  // Everyday words for the kinds of place in the records (used only when that kind is in the index).
  const TYPE_WORDS = { coffee: "Cafe", "coffee shop": "Cafe", "coffee shops": "Cafe", cafes: "Cafe", dentists: "Dentist", banks: "Bank", hotels: "Hotel", motels: "Hotel", bars: "Bar", pubs: "Pub", pharmacies: "Pharmacy", gym: "Fitness centre", gyms: "Fitness centre", bakeries: "Bakery", supermarkets: "Supermarket", "grocery stores": "Supermarket", grocery: "Supermarket", "fast food": "Fast food", barbers: "Hairdresser", "hair salons": "Hairdresser", "auto repair": "Car repair", mechanics: "Car repair", "car dealers": "Car", doctors: "Doctors", clinics: "Clinic", "hardware stores": "Hardware", "hardware store": "Hardware" };
  const STATES = { alabama: "AL", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york state": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", "washington state": "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC" };
  const STATE_NAME = Object.fromEntries(Object.entries(STATES).map(([k, v]) => [v, k.replace(/ state$/, "").replace(/\b\w/g, c => c.toUpperCase())]));
  const STOP = /\b(in|at|around|near|that|are|is|the|a|an|and|or|with|of|for|me|show|find|all|any|businesses|business|companies|company|which|who|have|has)\b/gi;

  // Every tag: { kind, v, label }. Same-kind tags of a list kind are OR'd; everything else is AND'd.
  const T = {
    city: v => ({ kind: "city", v, label: v }),
    state: v => ({ kind: "state", v, label: STATE_NAME[v] || v }),
    sector: v => ({ kind: "sector", v, label: v }),
    status: v => ({ kind: "status", v, label: v[0].toUpperCase() + v.slice(1) }),
    type: v => ({ kind: "type", v, label: v }),
    group: v => ({ kind: "group", v, label: v }),
    staff: (min, max) => ({ kind: "staff", v: [min, max], label: max == null ? `${min}+ staff` : min == null ? `≤ ${max} staff` : min === max ? `${min} staff` : `${min}–${max} staff` }),
    formed: (min, max) => ({ kind: "formed", v: [min, max], label: max == null ? `Since ${min}` : min == null ? `Before ${max + 1}` : min === max ? `Formed ${min}` : `${min}–${max}` }),
    has: f => ({ kind: "has", v: f, label: `Has ${f}` }),
    missing: f => ({ kind: "missing", v: f, label: `No ${f}` }),
    contacted: yes => ({ kind: "contacted", v: yes, label: yes ? "Contacted" : "Not contacted" }),
    near: (place, km) => ({ kind: "near", v: { place, km }, label: `${km == null ? "Near" : `≤ ${Math.round(km * 0.621371)} mi of`} ${place === "me" ? "you" : place}` }),
    phrase: p => ({ kind: "phrase", v: p, label: `“${p}”` }),
    exclude: w => ({ kind: "exclude", v: w, label: `Not ${w}` }),
  };
  const toKm = (n, unit) => /^k/i.test(unit) ? +n : +n / 0.621371;

  function parse(input, vocab = {}) {
    let s = " " + input.replace(/\s+/g, " ") + " ";
    const tags = [];
    const take = (re, make) => { s = s.replace(re, (...m) => { const t = make(...m); if (!t) return m[0]; [].concat(t).forEach(x => tags.push(x)); return " "; }); };
    const cities = alt([...(vocab.city || []), ...Object.keys(CITY_WORDS)].filter(Boolean));
    const cityOf = c => CITY_WORDS[c.toLowerCase()] || (vocab.city || []).find(x => x.toLowerCase() === c.toLowerCase()) || c;
    take(/"([^"]+)"/g, (_, p) => T.phrase(p.trim()));
    take(/\s-([a-z][\w'&-]*)(?=\s)/gi, (_, w) => T.exclude(w));
    take(new RegExp(`\\s(?:within|under|inside)\\s+(\\d+(?:\\.\\d+)?)\\s*(mi|miles?|km|kilometers?)\\s+(?:of|from|around)\\s+(me|here|${cities})(?=\\s)`, "gi"), (_, n, u, c) => T.near(/^(me|here)$/i.test(c) ? "me" : cityOf(c), toKm(n, u)));
    take(/\s(?:near|around|close to)\s+(?:me|here)(?=\s)/gi, () => T.near("me", 40));
    take(/\s(?:within|under)\s+(\d+(?:\.\d+)?)\s*(mi|miles?|km)(?=\s)/gi, (_, n, u) => T.near("me", toKm(n, u)));
    // staff: "staff > 20", "staff:10-50", "more than 20 employees", "under 10 staff", "10-50 people", "20+ staff", "small"
    take(/\s(?:staff|employees|headcount)\s*(>=|<=|>|<|=|:)\s*(\d+)(?:\s*-\s*(\d+))?(?=\s)/gi, (_, op, a, b) => b ? T.staff(+a, +b) : op === ">" ? T.staff(+a + 1) : op === ">=" ? T.staff(+a) : op === "<" ? T.staff(null, +a - 1) : op === "<=" ? T.staff(null, +a) : T.staff(+a, +a));
    take(new RegExp(`\\s(more than|over|at least|above)\\s+(\\d+)\\s*${UNIT}(?=\\s)`, "gi"), (_, w, n) => T.staff(/least/i.test(w) ? +n : +n + 1));
    take(new RegExp(`\\s(fewer than|less than|under|at most|below)\\s+(\\d+)\\s*${UNIT}(?=\\s)`, "gi"), (_, w, n) => T.staff(null, /most/i.test(w) ? +n : +n - 1));
    take(new RegExp(`\\s(\\d+)\\s*(?:-|to)\\s*(\\d+)\\s*${UNIT}(?=\\s)`, "gi"), (_, a, b) => T.staff(+a, +b));
    take(new RegExp(`\\s(\\d+)\\+\\s*${UNIT}?(?=\\s)`, "gi"), (_, n) => T.staff(+n));
    take(/\s(?:solo|one[- ]person)(?=\s)/gi, () => T.staff(null, 1));
    // formed: "formed < 2015", "founded before 2015", "since 2018", "in 2019", "older than 10 years", "under 5 years old", "new"
    take(/\s(?:formed|founded|year)\s*(>=|<=|>|<|=|:)\s*(\d{4})(?:\s*-\s*(\d{4}))?(?=\s)/gi, (_, op, a, b) => b ? T.formed(+a, +b) : op === ">" ? T.formed(+a + 1) : op === ">=" ? T.formed(+a) : op === "<" ? T.formed(null, +a - 1) : op === "<=" ? T.formed(null, +a) : T.formed(+a, +a));
    take(/\s(?:(?:formed|founded|started|registered|opened)\s+)?(before|after|since|in|during)\s+((?:19|20)\d\d)(?=\s)/gi, (m, w, y) => /before/i.test(w) ? T.formed(null, +y - 1) : /after/i.test(w) ? T.formed(+y + 1) : /since/i.test(w) ? T.formed(+y) : T.formed(+y, +y));
    take(/\s(?:formed|founded|started|registered|opened)\s+((?:19|20)\d\d)(?=\s)/gi, (_, y) => T.formed(+y, +y));
    take(/\s(?:older than|over|more than)\s+(\d+)\s+years?(?:\s+old)?(?=\s)/gi, (_, n) => T.formed(null, YEAR - +n));
    take(/\s(?:newer than|younger than|under|less than)\s+(\d+)\s+years?(?:\s+old)?(?=\s)/gi, (_, n) => T.formed(YEAR - +n + 1));
    // contact fields
    take(/\s(?:has|with):(\w+)(?=\s)/gi, (_, f) => FIELD[f.toLowerCase()] && T.has(FIELD[f.toLowerCase()]));
    take(/\s(?:no|missing|without):(\w+)(?=\s)/gi, (_, f) => FIELD[f.toLowerCase()] && T.missing(FIELD[f.toLowerCase()]));
    take(/\s(?:no|without|missing|lacking)\s+(?:an?\s+)?(e-mail|email|phone|number|website|site|web|hours)(?=\s)/gi, (_, f) => T.missing(FIELD[f.toLowerCase()]));
    take(/\s(?:with|has|have|having)\s+(?:an?\s+)?(e-mail|email|phone|number|website|site|web|hours)(?=\s)/gi, (_, f) => T.has(FIELD[f.toLowerCase()]));
    take(/\s(?:emailable|reachable)(?=\s)/gi, () => T.has("email"));
    // outreach history
    take(/\s(?:not|never|un)[- ]?contacted(?: yet)?(?=\s)/gi, () => T.contacted(false));
    take(/\s(?:already\s+)?(?:contacted|emailed|reached)(?=\s)/gi, () => T.contacted(true));
    if (vocab.group?.length) take(new RegExp(`\\s(?:group:?|in group|from group)\\s*(${alt(vocab.group)})(?=\\s)`, "gi"), (_, g) => T.group(vocab.group.find(x => x.toLowerCase() === g.toLowerCase())));
    // registration
    take(/\s(?:inactive|closed|defunct)(?=\s)/gi, () => [T.status("suspended"), T.status("dissolved")]);
    take(/\s(active|suspended|dissolved)(?=\s)/gi, (_, w) => T.status(w.toLowerCase()));
    const typeWords = Object.keys(TYPE_WORDS).filter(w => vocab.type?.includes(TYPE_WORDS[w]));
    if (vocab.type?.length) take(new RegExp(`\\s(${alt([...vocab.type, ...typeWords, "llcs", "corporations", "corps", "inc"])})(?=\\s)`, "gi"), (_, w) => {
      const k = w.toLowerCase(); const v = vocab.type.find(x => x.toLowerCase() === k) || (typeWords.includes(k) ? TYPE_WORDS[k] : /^llc/.test(k) ? "LLC" : /^corp|^inc/.test(k) ? "Corporation" : null);
      return v && T.type(v);
    });
    // sector and place; a state only when its name isn't also a city ("new york" is the city, "new york state" the state)
    const cityNames = new Set((vocab.city || []).map(c => c.toLowerCase()));
    const states = Object.keys(STATES).filter(k => !cityNames.has(k));
    take(new RegExp(`\\s(?:(?:in|across|around|from)\\s+)?(${alt(states)})(?=\\s)`, "gi"), (_, w) => T.state(STATES[w.toLowerCase()]));
    take(new RegExp(`\\s(${alt([...(vocab.sector || []), ...Object.keys(SECTOR_WORDS)])})(?=\\s)`, "gi"), (_, w) => T.sector(SECTOR_WORDS[w.toLowerCase()] || vocab.sector.find(x => x.toLowerCase() === w.toLowerCase())));
    take(new RegExp(`\\s(?:(?:in|around|near|from)\\s+)?(${cities})(?=\\s)`, "gi"), (_, c) => T.city(cityOf(c)));
    const rest = s.replace(/[,;]/g, " ").replace(/\s+/g, " ").trim();
    return { tags, rest };
  }

  // Tags plus leftover words -> a core search. ctx supplies what only the host app knows.
  function compile(tags, rest, { centers = new Map(), me = null, lastContact = () => null, groups = () => [] } = {}) {
    const by = k => tags.filter(t => t.kind === k).map(t => t.v);
    const text = (rest || "").replace(STOP, " ").replace(/\s+/g, " ").trim();
    const filters = { sector: by("sector"), city: by("city"), state: by("state"), status: by("status"), entityType: by("type") };
    const preds = [];
    for (const [min, max] of by("staff")) preds.push(e => e.employees != null && (min == null || e.employees >= min) && (max == null || e.employees <= max));
    for (const [min, max] of by("formed")) preds.push(e => { const y = e.formed ? +e.formed.slice(0, 4) : null; return y != null && (min == null || y >= min) && (max == null || y <= max); });
    for (const f of by("has")) preds.push(e => !!e[f]);
    for (const f of by("missing")) preds.push(e => !e[f]);
    for (const yes of by("contacted")) preds.push(e => !!lastContact(e.id) === yes);
    const gs = by("group"); if (gs.length) preds.push(e => groups().some(g => gs.includes(g.name) && g.ids.includes(e.id)));
    const hay = e => [e.name, e.legalName, e.description, e.sector, e.naics, e.city, (e.tags || []).join(" ")].join(" ").toLowerCase();
    for (const p of by("phrase")) preds.push(e => hay(e).includes(p.toLowerCase()));
    for (const w of by("exclude")) preds.push(e => !new RegExp(`\\b${escRe(w.toLowerCase())}`).test(hay(e)));
    let near = null, radiusKm = null;
    const n = by("near")[0];
    if (n) { const c = n.place === "me" ? me : centers.get(n.place); if (c) { near = { lat: c.lat, lng: c.lng, label: n.place === "me" ? "Nearest to you" : `Out from central ${n.place}` }; radiusKm = n.km; } }
    return { text, filters, near, radiusKm, has: by("has"), missing: by("missing"), where: preds.length ? e => preds.every(p => p(e)) : null };
  }

  // What a half-typed word could become: entities and phrasings the parser understands.
  const TEMPLATES = ["has email", "has website", "has phone", "no email", "no website", "not contacted", "contacted", "within 25 mi of me", "near me"];
  function complete(partial, vocab = {}) {
    const p = partial.toLowerCase().trim(); if (p.length < 2) return [];
    const out = [];
    const ent = (kind, list) => { for (const v of list || []) if (v.toLowerCase().startsWith(p) || v.toLowerCase().split(/\s+/).some(w => w.startsWith(p))) out.push({ kind, v, text: v }); };
    ent("sector", vocab.sector); ent("city", vocab.city);
    for (const [k, v] of Object.entries(STATES)) if (k.startsWith(p) && !(vocab.city || []).some(c => c.toLowerCase() === k)) out.push({ kind: "state", v, text: STATE_NAME[v] }); ent("type", vocab.type); ent("group", vocab.group);
    const alias = (kind, words) => { for (const [w, v] of Object.entries(words)) if (w.startsWith(p) && !out.some(x => x.kind === kind && x.v === v)) out.push({ kind, v, text: v }); };
    alias("city", CITY_WORDS); alias("sector", SECTOR_WORDS);
    for (const c of vocab.city || []) if (("within 25 mi of " + c.toLowerCase()).startsWith(p) && p.startsWith("with")) out.push({ kind: "near", v: c, text: `within 25 mi of ${c}` });
    for (const t of TEMPLATES) if (t.startsWith(p) && t !== p) out.push({ kind: "phrase", v: t, text: t });
    return out;
  }

  return { parse, compile, complete, tag: T, STATE_NAME };
})();

export { IndexQuery };
