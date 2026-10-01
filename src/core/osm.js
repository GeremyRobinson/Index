/* ===================================================================
   IndexOSM: live businesses from OpenStreetMap's Overpass API. No DOM code in here.
   Each search asks for the businesses in one area (a city, a point and radius, or a
   state when a kind or sector narrows it) and maps them into Index records:
     core.addProvider(IndexOSM.provider({ places }));
   Data © OpenStreetMap contributors, ODbL 1.0. The public Overpass servers are shared:
   answers are cached per area, and hits while typing never start a new request.
   =================================================================== */
const IndexOSM = (() => {
  const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
  const KEYS = ["amenity", "shop", "office", "craft", "leisure", "tourism", "healthcare"];
  const words = s => s.split(" ");
  const AMENITY = {};
  for (const [sector, vs] of Object.entries({ "Food & Beverage": "cafe restaurant fast_food bar pub ice_cream food_court biergarten", Healthcare: "dentist doctors clinic pharmacy veterinary hospital", Finance: "bank bureau_de_change", Education: "language_school driving_school music_school prep_school", "Arts & Entertainment": "cinema theatre nightclub arts_centre", Automotive: "car_wash car_rental" })) for (const v of words(vs)) AMENITY[v] = sector;
  const SHOP_FOOD = words("bakery deli butcher alcohol wine coffee tea confectionery greengrocer supermarket convenience beverages pastry cheese seafood chocolate");
  const SHOP_BEAUTY = words("hairdresser beauty cosmetics massage tattoo nails perfumery");
  const SHOP_AUTO = words("car car_repair car_parts tyres motorcycle");
  const OFFICE = { estate_agent: "Real Estate", property_management: "Real Estate" };
  for (const v of words("lawyer accountant consulting architect notary tax_advisor advertising_agency employment_agency graphic_design translator")) OFFICE[v] = "Professional Services";
  for (const v of words("insurance financial financial_advisor")) OFFICE[v] = "Finance";
  for (const v of words("it software telecommunication")) OFFICE[v] = "Technology";
  const NOT_BUSINESS = words("government diplomatic religion ngo association political_party union");
  const CRAFT_FOOD = words("brewery winery distillery caterer confectionery");
  const CRAFT_HOME = words("electrician plumber carpenter hvac roofer painter locksmith gardener glaziery tiler");
  const LEISURE = words("fitness_centre sports_centre dance yoga"), TOURISM = words("hotel motel hostel guest_house");
  const label = v => (v.charAt(0).toUpperCase() + v.slice(1)).replace(/_/g, " ");

  // [sector, kind] from OSM tags, or null when the place isn't a business (a bench, a school, a town hall).
  function classify(t) {
    for (const k of KEYS) {
      const v = t[k]; if (!v) continue;
      if (k === "amenity" && AMENITY[v]) return [AMENITY[v], label(v)];
      if (k === "shop") return [SHOP_FOOD.includes(v) ? "Food & Beverage" : SHOP_BEAUTY.includes(v) ? "Beauty & Wellness" : SHOP_AUTO.includes(v) ? "Automotive" : "Retail", v === "yes" ? "Shop" : label(v)];
      if (k === "office") return NOT_BUSINESS.includes(v) ? null : [OFFICE[v] || "Professional Services", v === "yes" || v === "company" ? "Office" : label(v)];
      if (k === "craft") return [CRAFT_FOOD.includes(v) ? "Food & Beverage" : CRAFT_HOME.includes(v) ? "Home Services" : "Manufacturing", v === "yes" ? "Workshop" : label(v)];
      if (k === "leisure" && LEISURE.includes(v)) return ["Fitness & Recreation", label(v)];
      if (k === "tourism" && TOURISM.includes(v)) return ["Hospitality", label(v)];
      if (k === "healthcare") return ["Healthcare", label(v)];
    }
    return null;
  }

  // The Overpass filters that find one sector, one kind, or every business.
  const re = list => `^(${list.join("|")})$`;
  const byValue = (list, sector) => Object.keys(list).filter(v => list[v] === sector);
  const SECTOR_Q = {
    "Food & Beverage": [["amenity", byValue(AMENITY, "Food & Beverage")], ["shop", SHOP_FOOD], ["craft", CRAFT_FOOD]],
    Retail: [["shop", null]], // every shop that isn't food, beauty or cars; the extra rows are sorted away after
    Healthcare: [["amenity", byValue(AMENITY, "Healthcare")], ["healthcare", null]],
    "Beauty & Wellness": [["shop", SHOP_BEAUTY]],
    "Professional Services": [["office", null]],
    Finance: [["amenity", byValue(AMENITY, "Finance")], ["office", byValue(OFFICE, "Finance")]],
    "Real Estate": [["office", byValue(OFFICE, "Real Estate")]],
    Technology: [["office", byValue(OFFICE, "Technology")]],
    Hospitality: [["tourism", TOURISM]],
    "Fitness & Recreation": [["leisure", LEISURE]],
    Education: [["amenity", byValue(AMENITY, "Education")]],
    Automotive: [["amenity", byValue(AMENITY, "Automotive")], ["shop", SHOP_AUTO]],
    "Home Services": [["craft", CRAFT_HOME]],
    Manufacturing: [["craft", null]],
    "Arts & Entertainment": [["amenity", byValue(AMENITY, "Arts & Entertainment")]],
  };
  const ALL_Q = [["shop", null], ["amenity", Object.keys(AMENITY)], ["office", null], ["craft", null], ["leisure", LEISURE], ["tourism", TOURISM], ["healthcare", null]];
  const kindValue = kind => ({ Shop: "yes", Office: "yes|company", Workshop: "yes" }[kind] || kind.toLowerCase().replace(/ /g, "_"));
  // Plain words ("plastic surgery", "sushi", "tesla") search names and the tags that say what a place does,
  // across a wider area, so a specialist doesn't have to sit in the few blocks a broad search covers.
  const TEXT_KEYS = ["healthcare:speciality", "cuisine", "shop", "amenity", "craft", "office", "brand", "description"];
  const STOPWORDS = /^(in|at|near|the|a|an|and|or|of|for|with|me|show|find)$/i;
  function textPattern(text) {
    const terms = (text || "").toLowerCase().split(/[^a-z0-9&'-]+/).filter(t => t.length > 1 && !STOPWORDS.test(t));
    // Stems, so "surgeon" and "surgery", "dentists" and "dentist" meet; words in any order within a tag.
    return terms.length ? terms.map(t => t.length > 5 ? t.slice(0, t.length - 2) : t.replace(/s$/, "")).map(t => t.replace(/[^a-z0-9]/g, ".")).join(".*") : null;
  }
  function textClauses(text) {
    const pat = textPattern(text); if (!pat) return null;
    return [`nwr["name"~"${pat}",i]`, ...TEXT_KEYS.map(k => `nwr["name"]["${k}"~"${pat}",i]`)];
  }
  // hints: the kinds (or, failing those, sectors) Jev says plain words are probably about. They are fetched alongside the
  // name matches, so "somewhere to fix my laptop" also asks for electronics repair shops, which share none of its words.
  function clauses({ sector = [], entityType = [] }, text, hints = null) {
    if (!sector.length && !entityType.length) {
      const t = textClauses(text);
      const kinds = (hints?.entityType || []).slice(0, 4), vs = kinds.flatMap(k => kindValue(k).split("|"));
      const more = vs.length ? KEYS.map(k => [k, vs]) : (hints?.sector || []).slice(0, 2).flatMap(s => SECTOR_Q[s] || []);
      if (t || more.length) return [...(t || []), ...more];
    }
    // A kind is one tag value under any business key; exact keys use Overpass's index, a key pattern wouldn't.
    if (entityType.length) { const vs = entityType.flatMap(k => kindValue(k).split("|")); return KEYS.map(k => [k, vs]); }
    if (sector.length) return sector.flatMap(s => SECTOR_Q[s] || []);
    return ALL_Q;
  }
  const clauseQL = (c, area) => typeof c === "string" ? `${c}${area};` : clauseQL2(c, area);
  const clauseQL2 = ([k, vs], area) => `nwr["name"]["${k}"${vs ? (vs.length === 1 ? `="${vs[0]}"` : `~"${re(vs)}"`) : ""}]${area};`;

  function record(el, place) {
    const t = el.tags || {}, c = classify(t);
    if (!c) return null;
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    let street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ") || null;
    if (street && t["addr:unit"]) street += `, Unit ${t["addr:unit"]}`;
    let web = t.website || t["contact:website"] || t.url || null;
    if (web) web = web.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
    const start = t.start_date || "";
    const extra = [(t.cuisine || "").replace(/;/g, ", ").replace(/_/g, " "), (t["healthcare:speciality"] || "").replace(/;/g, ", ").replace(/_/g, " "), t.brand && `brand ${t.brand}`, t.operator && t.operator !== t.name && `run by ${t.operator}`].filter(Boolean);
    return {
      id: `osm:${el.type}/${el.id}`, name: t.name, sector: c[0], entityType: c[1], status: "unknown",
      description: t.description || null, formed: /^\d{4}/.test(start) ? start.slice(0, 10) : null,
      address: street, city: t["addr:city"] || place.city || null, zip: t["addr:postcode"] || null, state: t["addr:state"] || place.state || null,
      lat: lat != null ? +lat.toFixed(6) : null, lng: lng != null ? +lng.toFixed(6) : null,
      phone: t.phone || t["contact:phone"] || null, email: t.email || t["contact:email"] || null, website: web,
      hours: t.opening_hours || null, tags: extra, sectorBy: "rule",
      sources: [{ name: "OpenStreetMap", fetched: new Date().toISOString().slice(0, 10), ref: `${el.type}/${el.id}`, live: true }],
    };
  }

  // Answers kept in the browser (IndexedDB) for a day, so a repeat search is instant. Quietly off where storage is blocked.
  const KEEP_MS = 24 * 3600e3;
  const saved = (() => {
    let db = null;
    const open = () => db || (db = new Promise(res => { try { const r = indexedDB.open("index-osm", 1); r.onupgradeneeded = () => r.result.createObjectStore("q"); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch { res(null); } }));
    const tx = async (mode, fn) => { const d = await open(); if (!d) return null; return new Promise(res => { try { const t = d.transaction("q", mode), req = fn(t.objectStore("q")); req.onsuccess = () => res(req.result ?? null); req.onerror = () => res(null); } catch { res(null); } }); };
    return { get: ql => tx("readonly", s => s.get(ql)), set: (ql, v) => tx("readwrite", s => s.put(v, ql)) };
  })();

  // places: [[city, state, lat, lng, size], ...], largest first. size is only used to pick a sensible radius.
  function provider({ places = [], endpoints = ENDPOINTS, fetchImpl = (...a) => fetch(...a), fallbackPlace = "San Francisco", limit = 4000 } = {}) {
    const byCity = new Map(places.map(([city, state, lat, lng, n]) => [city, { city, state, lat, lng, n }]));
    const cache = new Map();
    const nearestPlace = p => { let best = null, d = Infinity; for (const x of byCity.values()) { const dd = (x.lat - p.lat) ** 2 + ((x.lng - p.lng) * Math.cos(p.lat * Math.PI / 180)) ** 2; if (dd < d) { d = dd; best = x; } } return best; };
    // Dense city centres get a small circle, towns a wider one; naming a kind or sector widens it, since fewer places match.
    // Words alone ("plastic surgery") match only names and specialties, so they can cover the whole metro area.
    const radiusFor = (n, narrowed) => { const km = n > 8000 ? 1.2 : n > 3000 ? 2 : n > 800 ? 3 : 5; return narrowed === "text" ? Math.max(km * 3, 25) : narrowed ? km * 3 : km; };
    let ep = 0;
    // Ask the fastest-known server first; if it hasn't answered in HEDGE_MS (or fails), ask the next one too.
    // The first good answer wins and the others are cancelled, so one busy server never holds a search up.
    const HEDGE_MS = 3000;
    function hedged(ql) {
      return new Promise((resolve, reject) => {
        const ctls = [], errors = []; let next = 0, done = false, timer;
        const launch = () => {
          if (done || next >= endpoints.length) return;
          const i = (ep + next++) % endpoints.length, ctl = new AbortController(); ctls.push(ctl);
          clearTimeout(timer); timer = setTimeout(launch, HEDGE_MS);
          fetchImpl(endpoints[i], { method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(ql) })
            .then(async res => {
              if (!res.ok) throw new Error(`OpenStreetMap answered ${res.status}${res.status === 429 ? " (busy)" : res.status === 504 ? " (timed out)" : ""}`);
              const json = await res.json();
              if (done) return;
              done = true; clearTimeout(timer); ep = i; ctls.forEach(c => c !== ctl && c.abort());
              const seen = new Set(), rows = [];
              for (const el of json.elements || []) { const r = record(el, placeOf(ql)); if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); } }
              resolve({ rows, capped: (json.elements || []).length >= limitOf(ql) });
            })
            .catch(err => {
              if (done || err.name === "AbortError") return;
              errors.push(err);
              if (errors.length >= endpoints.length) { done = true; clearTimeout(timer); reject(errors[0]); } else launch();
            });
        };
        launch();
      });
    }
    const areas = new Map(); // ql -> the area it asks about, for filling in city and state
    const placeOf = ql => areas.get(ql) || {};
    const limitOf = ql => +(ql.match(/out center tags qt (\d+)/) || [0, limit])[1];
    const narrowedBy = q => { const f = q.filters || {}; return (f.sector || []).length || (f.entityType || []).length ? true : textPattern(q.text) || q.hints?.entityType?.length ? "text" : false; };
    const self = {
      name: "OpenStreetMap", live: true, last: null,
      // Where a search looks, in words people can read back.
      area(q) { const a = self.areaOf(q); a.narrowed = narrowedBy(q); return a; },
      areaOf(q) {
        const f = q.filters || {}, narrowed = narrowedBy(q);
        const city = (f.city || []).map(c => byCity.get(c)).find(Boolean);
        if (q.near && q.radiusKm) { const p = nearestPlace(q.near) || {}; return { lat: q.near.lat, lng: q.near.lng, km: Math.min(q.radiusKm, narrowed ? 50 : 12), city: p.city, state: p.state, label: q.near.label || "the chosen spot" }; }
        if (city) return { lat: city.lat, lng: city.lng, km: radiusFor(city.n, narrowed), city: city.city, state: city.state, label: narrowed === "text" ? `${city.city} area` : `central ${city.city}` };
        const st = (f.state || [])[0];
        if (st && narrowed) return { state: st, label: st, iso: `US-${st}` };
        if (st) { const big = [...byCity.values()].find(x => x.state === st); if (big) return { lat: big.lat, lng: big.lng, km: radiusFor(big.n, false), city: big.city, state: st, label: `central ${big.city}, the state's busiest city` }; }
        if (q.near) { const p = nearestPlace(q.near) || {}; return { lat: q.near.lat, lng: q.near.lng, km: radiusFor(p.n || 0, narrowed), city: p.city, state: p.state, label: p.city ? `around you, near ${p.city}` : "around you" }; }
        const d = byCity.get(fallbackPlace) || [...byCity.values()][0];
        return { lat: d.lat, lng: d.lng, km: radiusFor(d.n, narrowed), city: d.city, state: d.state, label: `central ${d.city}` };
      },
      query(q) {
        const a = self.area(q);
        const where = a.iso ? "(area.a)" : `(around:${Math.round(a.km * 1000)},${a.lat.toFixed(4)},${a.lng.toFixed(4)})`;
        const body = clauses(q.filters || {}, q.text, q.hints).map(c => clauseQL(c, where)).join("\n");
        // Broad asks (every kind of business) are capped lower than narrow ones, so they come back quickly.
        const cap = a.narrowed ? limit : Math.min(limit, 1500);
        const ql = `[out:json][timeout:20];${a.iso ? `area["ISO3166-2"="${a.iso}"]->.a;` : ""}\n(${body}\n);\nout center tags qt ${cap};`;
        areas.set(ql, a);
        return { a, ql };
      },
      cached(q) { return cache.has(self.query(q).ql); },
      async search(q) {
        const { a, ql } = self.query(q);
        // Suggestions while typing only read what's already here; a search starts only on Enter or a tag.
        if ((q.limit || 50) <= 10 && !cache.has(ql)) { const rows = []; rows.meta = { total: null, facets: null, n: 0 }; return rows; }
        if (!cache.has(ql)) cache.set(ql, (async () => {
          const kept = await saved.get(ql);
          if (kept && Date.now() - kept.at < KEEP_MS) return { ...kept, ms: 0, fromCache: true };
          const t0 = performance.now();
          const got = await hedged(ql);
          const out = { rows: got.rows, ms: Math.round(performance.now() - t0), capped: got.capped, at: Date.now() };
          saved.set(ql, { rows: out.rows, capped: out.capped, at: out.at });
          return out;
        })());
        let got;
        try { got = await cache.get(ql); } catch (err) { cache.delete(ql); self.last = { area: a, error: err.message }; throw err; }
        self.last = { area: a, count: got.rows.length, ms: got.ms, capped: got.capped, at: got.at };
        const rows = got.rows.slice(); rows.meta = { total: got.rows.length, facets: null, n: got.rows.length }; return rows;
      },
      // One tiny request to learn whether this page may reach OpenStreetMap at all (a Claude preview can't).
      async reachable(ms = 8000) {
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
        const probe = async (url, i) => { const r = await fetchImpl(url + "?data=" + encodeURIComponent("[out:json];node(1);out ids;"), { signal: ctl.signal }); if (!r.ok && r.status !== 429) throw new Error(r.status); return i; };
        try { ep = await Promise.any(endpoints.map(probe)); return true; } // the first server to answer goes first
        catch { return false; } finally { clearTimeout(timer); ctl.abort(); }
      },
    };
    return self;
  }
  return { provider, classify, record, clauses, ENDPOINTS };
})();

export { IndexOSM };
