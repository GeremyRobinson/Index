/* ===================================================================
   IndexCore: the reusable part. No DOM code in here.
   Any app (restaurant app, company search, an API server) can use it:
     const core = IndexCore.create();
     core.addProvider(IndexCore.providers.static(records));
     const { items, facets } = await core.search({ text, filters, near });
   =================================================================== */
const IndexCore = (() => {
  // One record shape for every business, whatever the source.
  const ENTITY_FIELDS = ["id","name","legalName","description","sector","naics","status","entityType","entityNumber",
    "formed","employees","revenueBand","address","city","county","state","zip","lat","lng","phone","website","email",
    "hours","owners","tags","sources","updated","sectorBy","sectorP"];

  function normalize(raw, sourceName) {
    const e = {};
    for (const k of ENTITY_FIELDS) e[k] = raw[k] ?? null;
    e.id = e.id || `${sourceName}:${(e.entityNumber || e.name || Math.random()).toString().toLowerCase()}`;
    e.tags = Array.isArray(e.tags) ? e.tags : [];
    e.sources = e.sources && e.sources.length ? e.sources : [{ name: sourceName, fetched: new Date().toISOString().slice(0,10) }];
    e.status = (e.status || "unknown").toLowerCase();
    e.state = e.state || "CA";
    // Provenance: which source supplied each field, so every value in the one true record can say where it came from.
    const src = e.sources[0].name;
    e.provenance = {};
    for (const k of ENTITY_FIELDS) if (raw[k] != null && raw[k] !== "" && !(Array.isArray(raw[k]) && !raw[k].length)) e.provenance[k] = src;
    return e;
  }

  const tokenize = s => (s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, " ").split(/\s+/).filter(Boolean);

  function score(e, terms) {
    if (!terms.length) return 1;
    const fields = [[e.name,5],[e.legalName,4],[e.entityNumber,6],[e.sector,3],[e.entityType,3],[e.city,3],[e.tags.join(" "),2],[e.description,1],[e.naics,3]];
    let total = 0;
    for (const t of terms) {
      let best = 0;
      for (const [v, w] of fields) {
        const toks = tokenize(v);
        if (toks.includes(t)) best = Math.max(best, w);
        else if (toks.some(x => x.startsWith(t))) best = Math.max(best, w * 0.6);
        else if (t.length >= 4 && toks.some(x => near1(x, t))) best = Math.max(best, w * 0.4); // one typo allowed
        else if (t.length > 5 && toks.some(x => x.startsWith(t.slice(0, -2)))) best = Math.max(best, w * 0.4); // same stem: surgeon, surgery
      }
      if (!best) return 0; // every term must match somewhere
      total += best;
    }
    return total;
  }

  // True when a and b differ by at most one edit (typo tolerance for words of 4+ letters).
  function near1(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }
  function km(a, b) {
    const R = 6371, r = d => d * Math.PI / 180;
    const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Merge records that describe the same business (same entity number, or same name + zip).
  // Same entity number, same name and zip, or (with no zip) same name within about 100 m. Chains stay separate.
  function mergeKey(e) { return e.entityNumber ? `n:${e.entityNumber}` : e.zip ? `k:${tokenize(e.name).join("")}:${e.zip}` : e.lat != null ? `g:${tokenize(e.name).join("")}:${e.lat.toFixed(3)},${e.lng.toFixed(3)}` : `i:${e.id}`; }
  function merge(a, b) {
    const out = { ...a, provenance: { ...a.provenance } };
    for (const k of ENTITY_FIELDS) if ((out[k] == null || out[k] === "") && b[k] != null && b[k] !== "") { out[k] = b[k]; if (b.provenance[k]) out.provenance[k] = b.provenance[k]; }
    const extra = (b.tags || []).filter(t => !(a.tags || []).includes(t));
    out.tags = [...(a.tags || []), ...extra];
    if (extra.length && b.provenance.tags) out.provenance.tags = `${a.provenance.tags || "?"} + ${b.provenance.tags}`;
    out.sources = [...a.sources, ...b.sources];
    return out;
  }

  function facetCounts(items, key) {
    const m = new Map();
    for (const e of items) if (e[key]) m.set(e[key], (m.get(e[key]) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  function create() {
    const providers = [], normalized = new WeakMap(); // each source record is normalized once, then reused by every search
    return {
      addProvider(p) { providers.push(p); return this; },
      removeProvider(name) { const i = providers.findIndex(p => p.name === name); if (i >= 0) providers.splice(i, 1); },
      get providers() { return providers.map(p => p.name); },
      // filters: { key: value | [values] } (a list matches any of its values); where: an extra predicate from the host app.
      // has / missing: contact fields a remote source can check before it answers, so its limit isn't spent on rows the page drops.
      async search({ text = "", filters = {}, near = null, radiusKm = null, where = null, limit = 50, sort = "relevance", has = [], missing = [] } = {}) {
        const errors = [], metas = [];
        const batches = await Promise.all(providers.map(p =>
          p.search({ text, filters, near, radiusKm, limit, sort, has, missing }).then(rs => { if (rs.meta) metas.push(rs.meta); return rs.map(r => { let e = normalized.get(r); if (!e) normalized.set(r, e = normalize(r, p.name)); return e; }); })
           .catch(err => { errors.push({ provider: p.name, message: err.message }); return []; })));
        const byKey = new Map();
        for (const e of batches.flat()) { const k = mergeKey(e); byKey.set(k, byKey.has(k) ? merge(byKey.get(k), e) : e); }
        const terms = tokenize(text);
        let items = [...byKey.values()].map(e => ({ e, s: score(e, terms) })).filter(x => x.s > 0);
        const all = items.map(x => x.e);
        for (const [k, v] of Object.entries(filters)) if (Array.isArray(v) ? v.length : v) items = items.filter(x => Array.isArray(v) ? v.includes(x.e[k]) : x.e[k] === v);
        if (where) items = items.filter(x => where(x.e));
        if (near) {
          // Distances belong to this search, so they go on copies and the shared records stay untouched.
          items = items.map(x => ({ s: x.s, e: x.e.lat != null ? { ...x.e, distanceKm: km(near, x.e) } : x.e }));
          if (radiusKm) items = items.filter(x => x.e.distanceKm != null && x.e.distanceKm <= radiusKm);
        }
        if (sort === "newest") items.sort((a, b) => String(b.e.updated || "").localeCompare(String(a.e.updated || "")));
        else if (sort === "distance") items.sort((a, b) => (a.e.distanceKm ?? Infinity) - (b.e.distanceKm ?? Infinity) || a.e.name.localeCompare(b.e.name));
        else if (sort === "north") items.sort((a, b) => (b.e.lat ?? -Infinity) - (a.e.lat ?? -Infinity) || a.e.name.localeCompare(b.e.name));
        else items.sort((a, b) => b.s - a.s || a.e.name.localeCompare(b.e.name));
        // A remote source sends back only its best rows, so its own count and facets describe the whole match.
        const m = metas.length === 1 && providers.length === 1 ? metas[0] : null;
        return {
          total: m ? (m.total == null ? null : Math.max(items.length, m.total - (m.n - items.length))) : items.length,
          items: items.slice(0, limit).map(x => x.e),
          facets: m?.facets || { sector: facetCounts(all, "sector"), city: facetCounts(all, "city"), status: facetCounts(all, "status") },
          errors,
        };
      },
    };
  }

  const providers = {
    // Records you already hold (a JSON file, a database export, test data).
    static(records, name = "sample") {
      return { name, search: async () => records };
    },
    // A search server (index/server/server.py) holding more records than a page can. It filters and
    // orders on its side and sends back at most `limit` rows, with the full count and facets.
    remote(endpoint, name = "OpenStreetMap", fetchImpl = (...a) => fetch(...a)) {
      const url = endpoint.replace(/\/+$/, "");
      const get = async (path, init) => {
        const res = await fetchImpl(url + path, init);
        if (!res.ok) throw new Error(`Search server answered ${res.status}`);
        return res.json();
      };
      return {
        name, endpoint: url,
        vocab: () => get("/vocab"),
        async search({ text, filters, near, radiusKm, limit, sort, has, missing }) {
          const f = Object.fromEntries(Object.entries(filters || {}).filter(([, v]) => Array.isArray(v) ? v.length : v));
          const r = await get("/search", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, filters: f, near: near && { lat: near.lat, lng: near.lng }, radiusKm, limit, sort, has, missing }) });
          const rows = r.items; rows.meta = { total: r.total, facets: r.facets, n: rows.length }; return rows;
        },
      };
    },
  };

  return { create, providers, normalize, ENTITY_FIELDS };
})();

export { IndexCore };
