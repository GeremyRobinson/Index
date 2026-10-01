/* The page's state and actions. Components read the signals; actions change them.
   The search engine (IndexCore, IndexQuery, IndexOSM, IndexJudge, IndexOutreach) is the same code as before, with no DOM in it. */
import { signal, batch } from "@preact/signals";
import { IndexCore } from "./core/core.js";
import { IndexOutreach } from "./core/outreach.js";
import { IndexQuery } from "./core/query.js";
import { IndexJudge } from "./core/judge.js";
import { IndexOSM } from "./core/osm.js";
import { store, $, reduced } from "./lib/util.js";

export { IndexQuery, IndexJudge, IndexOutreach };

export const core = IndexCore.create();
export let source = null, live = null; // source: { kind: "live" | "server", url?, count, error? }; live: the OpenStreetMap provider
export const vocab = { sector: [], city: [], type: [], status: [] }; // status words become tags once a registration source reports them
export const cityCenters = new Map();
export const allById = new Map();

export const out = IndexOutreach.create({
  load: () => { try { return JSON.parse(store.get("outreach") || "null"); } catch { return null; } },
  save: s => store.set("outreach", JSON.stringify(s)),
});

export const S = {
  q: signal(""), tags: signal([]), tagSel: signal(-1), ph: signal("Search businesses"),
  idle: signal(true), view: signal("results"),
  hits: signal([]), hitsV: signal(0), hi: signal(-1), trayOpen: signal(false),
  res: signal({ items: [], total: 0, origin: null, errors: [], prev: new Set(), entering: false, flip: null }),
  where: signal(""), readout: signal(""),
  openId: signal(null), mode: signal("browse"), picked: signal(new Set()),
  me: signal(null), locating: signal(false), order: signal(""),
  outv: signal(0), otab: signal("activity"), campv: signal(0), running: signal(null), runv: signal(0),
  flash: signal(""), selGroups: signal(false), jevStatus: signal(store.get("jev.endpoint") ? "saved" : "stand-in"),
};
export const bumpOut = () => S.outv.value++;
export const qvocab = () => ({ ...vocab, group: out.groups().map(g => g.name) });
export const isIdle = () => document.body.classList.contains("idle");
export const afterRender = fn => requestAnimationFrame(() => fn());

// Light or dark follows the system setting. Clear settings older versions kept.
store.set("theme", null); store.set("jev.key", null); store.set("jev.url", null);

/* Jev: search understanding. The page only ever knows your endpoint, never the TypeSafe key. */
export const jevCache = new Map();
let jevT;
export const judge = () => { const u = store.get("jev.endpoint"); return u ? IndexJudge.typesafe({ endpoint: u }) : IndexJudge.standIn(); };
// Jev reads a phrase once: the tags it implies, and the kinds and sectors it is probably about. The tray and the list share the answer.
const readings = new Map();
export function understood(text) {
  const key = text.trim().toLowerCase();
  if (!readings.has(key)) readings.set(key, IndexJudge.understand(judge(), key, qvocab(), IndexQuery.tag)
    .then(r => { if (S.jevStatus.value !== "ok" && store.get("jev.endpoint")) S.jevStatus.value = "ok"; return r; })
    .catch(() => { S.jevStatus.value = "error"; readings.delete(key); return IndexJudge.understand(IndexJudge.standIn(), key, qvocab(), IndexQuery.tag); }));
  return readings.get(key);
}
// Answers are cached per phrase; a new phrase is asked for after a short pause in typing.
function jevFor(text) {
  const key = text.trim().toLowerCase();
  if (jevCache.has(key)) return jevCache.get(key);
  clearTimeout(jevT);
  jevT = setTimeout(async () => {
    jevCache.set(key, { pending: true });
    const r = await understood(key);
    jevCache.set(key, r);
    if (liveQuery().rest.trim().toLowerCase() === key) renderHits();
  }, 350);
  return null;
}

/* ============ The dock ============
   The word Index and the search. The search is a tag field: words the index understands turn into tags as you type;
   everything else stays as text. One tray opens upward from it with suggestions while typing. */
export const KIND_ICON = { city: "map-pin", state: "map-pin", sector: "briefcase", type: "building-2", group: "folder", staff: "users", formed: "calendar", has: "at-sign", missing: "at-sign", contacted: "mail", near: "navigation", phrase: "quote", exclude: "minus" };
const LIST_KINDS = ["city", "state", "sector", "status", "type", "group"];
export const tagKey = t => t.kind + ":" + JSON.stringify(t.v);
// The live query: committed tags, plus whatever the words still in the field already imply.
export function liveQuery() {
  const p = IndexQuery.parse(S.q.value, qvocab());
  return { tags: [...S.tags.value, ...p.tags], rest: p.rest, pending: p.tags };
}
export function compiled() {
  const { tags: all, rest } = liveQuery();
  return IndexQuery.compile(all, rest, { centers: cityCenters, me: S.me.value, lastContact: id => out.lastContact(id), groups: () => out.groups() });
}
export function addTag(t) {
  let tags = S.tags.value;
  if (tags.some(x => x.kind === t.kind && JSON.stringify(x.v) === JSON.stringify(t.v))) return;
  // One range per kind: a new staff or year range replaces the old one; list kinds stack (either city, either sector).
  if (!LIST_KINDS.includes(t.kind) && !["has", "missing", "phrase", "exclude"].includes(t.kind)) tags = tags.filter(x => x.kind !== t.kind);
  S.tags.value = [...tags, t];
}
export function removeTag(i) { S.tags.value = S.tags.value.filter((_, j) => j !== i); S.tagSel.value = -1; refresh(); }
// Commit: every word the field understands becomes a tag; the rest stays as text.
export function commit() {
  const p = IndexQuery.parse(S.q.value, qvocab());
  batch(() => { p.tags.forEach(addTag); S.q.value = p.rest ? p.rest + " " : ""; S.tagSel.value = -1; });
  engage(); return refresh();
}
export function clearSearch() { batch(() => { S.tags.value = []; S.q.value = ""; S.tagSel.value = -1; }); refresh(); }

// Opening happens in two beats, never at once: the bar slides down to the bottom, then the index opens up out of it.
// Going home runs the same beats backwards: the index folds into the bar, then the bar rises to the centre.
export const SLIDE = 450;
export let stageHold = false, entering = false;
let beatT;
export function engage() {
  if (!isIdle()) { if (stageHold) { clearTimeout(beatT); stageHold = false; fitStage(true); } return; }
  document.body.classList.remove("idle"); S.idle.value = false; stopHint(); entering = true;
  stageHold = true; clearTimeout(beatT);
  beatT = setTimeout(() => { stageHold = false; fitStage(true); }, reduced() ? 0 : SLIDE);
}
export function home() {
  batch(() => { S.tags.value = []; S.q.value = ""; S.tagSel.value = -1; S.openId.value = null; });
  stageHold = true; clearTimeout(beatT); fitStage(true);
  beatT = setTimeout(() => {
    document.body.classList.add("idle"); S.idle.value = true; stageHold = false; setView("results");
    $("stage-in").scrollTop = 0; scrollMem.results = scrollMem.outreach = 0;
    refresh(); startHint();
  }, reduced() ? 0 : SLIDE - 50);
}

/* ============ The stage: one panel that grows out of the bar ============
   It holds the index or outreach, one at a time. Its height is its content, up to the room the screen has left
   once the bar, the selection and the suggestions have theirs, so the shell always fits the screen. */
export let trayH = 0;
export const setTrayH = h => { if (h !== trayH) { trayH = h; fitStage(true); } };
const scrollMem = { results: 0, outreach: 0 };
export function setView(v) {
  const was = S.view.value;
  if (v === was) return;
  const si = $("stage-in"); scrollMem[was] = si.scrollTop;
  S.view.value = v;
  afterRender(() => {
    si.scrollTop = scrollMem[v];
    const shown = $(v === "results" ? "biz" : "outreach");
    if (!reduced() && !isIdle()) shown.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 350, easing: "cubic-bezier(.16,1,.3,1)" });
    fitStage(true);
  });
}
export function fitStage(glide) {
  const st = $("stage"), shell = $("shell");
  if (!st) return;
  let h = 0;
  if (!isIdle() && !stageHold) {
    const edge = parseFloat(getComputedStyle(shell).bottom) || 20;
    const sel = S.picked.value.size ? $("selbox").offsetHeight : 0;
    const room = innerHeight - edge * 2 - 10 - $("steps").offsetHeight - trayH - sel - 6;
    h = Math.max(0, Math.min($(S.view.value === "results" ? "biz" : "outreach").offsetHeight + 1, room)); // +1 for the rule under it
  }
  if (glide && !reduced()) { st.classList.add("glide"); clearTimeout(fitStage.t); fitStage.t = setTimeout(() => st.classList.remove("glide"), 550); }
  st.style.height = h + "px";
  shell.classList.toggle("open", h > 0);
}
let refreshT;
export function refresh() {
  if (S.tags.value.length || S.q.value.trim()) engage();
  clearTimeout(refreshT); refreshT = setTimeout(renderHits, 60);
  return run();
}

/* ============ Suggestions ============ */
let hitSeq = 0;
export async function renderHits() {
  const raw = S.q.value, seq = ++hitSeq;
  if (!S.trayOpen.value || !raw.trim()) { S.hits.value = []; return; }
  const lq = liveQuery(), q = compiled();
  const r = await core.search({ text: q.text, filters: q.filters, near: q.near, radiusKm: q.radiusKm, has: q.has, missing: q.missing, where: q.where, limit: 5 });
  if (seq !== hitSeq) return;
  const words = raw.trimEnd().split(/\s+/), vq = qvocab();
  // Completions for the last one or two words, so "san" offers the cities and "has" offers has email.
  const seen = new Set(), comps = [];
  for (const k of [2, 1]) {
    const partial = words.slice(-k).join(" ");
    for (const c of IndexQuery.complete(partial, vq)) if (!seen.has(c.text)) { seen.add(c.text); comps.push({ ...c, partial }); }
  }
  const hits = [{ kind: "apply", pending: lq.pending, rest: lq.rest, n: r.total }];
  // Words the parser couldn't read go to Jev, which answers with tags and how sure it is.
  const rest = lq.rest.trim();
  if (rest.length >= 3) {
    const j = jevFor(rest), have = new Set([...S.tags.value, ...lq.pending].map(tagKey)), fresh = (j?.tags || []).filter(t => !have.has(tagKey(t)));
    if (fresh.length) hits.push({ kind: "jev", tags: fresh, conf: j.conf, by: j.by });
  }
  const cap = s => s[0].toUpperCase() + s.slice(1);
  comps.slice(0, 4).forEach(c => hits.push({ kind: "complete", c, path: [c.kind === "phrase" ? "Filter" : cap(c.kind === "near" ? "distance" : c.kind)], leaf: c.text, icon: KIND_ICON[c.kind === "phrase" ? "phrase" : c.kind], n: c.kind === "city" || c.kind === "sector" ? new Map(lastFacets?.[c.kind] || []).get(c.v) ?? "" : "" }));
  r.items.forEach(e => hits.push({ kind: "biz", path: [e.city], leaf: e.name, e, status: e.status }));
  batch(() => { S.hits.value = hits; S.hitsV.value++; S.hi.value = Math.min(S.hi.value, hits.length - 1); });
}
export function setHi(i, scroll) {
  S.hi.value = Math.max(-1, Math.min(i, S.hits.value.length - 1));
  if (scroll && S.hi.value >= 0) afterRender(() => $(`hit-${S.hi.value}`)?.scrollIntoView({ block: "nearest" }));
}
export async function choose(i) {
  const h = S.hits.value[i]; if (!h) return;
  if (h.kind === "apply") return commit();
  if (h.kind === "jev") {
    // Jev's tags stand in for the words it read, so those words leave the field.
    batch(() => { IndexQuery.parse(S.q.value, qvocab()).tags.forEach(addTag); h.tags.forEach(addTag); S.q.value = ""; S.hi.value = -1; S.tagSel.value = -1; });
    engage(); return refresh();
  }
  if (h.kind === "complete") {
    const v = S.q.value.trimEnd();
    batch(() => {
      S.q.value = v.slice(0, v.length - h.c.partial.length) + (h.c.kind === "phrase" || h.c.kind === "near" ? h.c.text : "");
      if (h.c.kind !== "phrase" && h.c.kind !== "near") addTag(IndexQuery.tag[h.c.kind](h.c.v));
      S.hi.value = -1;
    });
    return commit();
  }
  await commit(); $("q").blur(); openBiz(h.e.id);
}
// A finished phrase (followed by a space) becomes a tag straight away.
export function typed(value) {
  batch(() => {
    S.hi.value = -1; S.tagSel.value = -1;
    const p = /\s$/.test(value) ? IndexQuery.parse(value, qvocab()) : null;
    if (p?.tags.length) { p.tags.forEach(addTag); S.q.value = p.rest ? p.rest + " " : ""; }
    else S.q.value = value;
  });
  refresh();
}

// Idle hint: the placeholder types out example searches, one after another.
let hintT;
export let hintOn = false;
const HINTS = ["bakery in san diego with email", "coffee in the bay", "dentist in oakland with website", "within 2 mi of me", "restaurants in la not contacted"];
export function startHint() {
  if (reduced() || hintOn) return; hintOn = true;
  let h = 0, i = 0, dir = 1;
  const step = () => {
    if (!hintOn) return;
    const t = HINTS[h];
    if (S.q.value || S.tags.value.length) { hintT = setTimeout(step, 400); return; }
    i += dir; S.ph.value = t.slice(0, i) || "Search businesses";
    if (dir > 0 && i >= t.length) { dir = -1; hintT = setTimeout(step, 1800); return; }
    if (dir < 0 && i <= 0) { dir = 1; h = (h + 1) % HINTS.length; hintT = setTimeout(step, 350); return; }
    hintT = setTimeout(step, dir > 0 ? 45 : 18);
  };
  hintT = setTimeout(step, 900);
}
export function stopHint() { hintOn = false; clearTimeout(hintT); S.ph.value = document.activeElement === $("q") && S.tags.value.length ? "Add more…" : "Search businesses"; }

/* ============ The list: all businesses, in location order ============ */
let runSeq = 0, lastFacets = null, shownIds = new Set();
export const itemEl = id => id && $("list")?.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
// Nearest to you when the browser shares a location; otherwise from the chosen city's centre; otherwise north to south.
export function originFor(q) {
  if (q.near) return q.near;
  if (S.me.value) return { ...S.me.value, label: "Nearest to you" };
  const city = q.filters.city.length === 1 && q.filters.city[0], c = city && cityCenters.get(city);
  return c ? { ...c, label: `Out from central ${city}` } : null;
}
// Plain words are ranked the way madewithjev's YC Indexor ranks: words and Jev's likely kinds nominate candidates,
// then Jev reads each candidate and says how likely it is what the person meant. Those probabilities order the list.
const fits = new Map(); // `${words}\u0000${id}` -> probability, so refining a search doesn't ask about the same business twice
const JUDGED = 240, SHOWN = 0.3, FEWEST = 9; // candidates read per search; the bar for being shown; the closest few always show
export async function run() {
  const seq = ++runSeq, q = compiled(), o = originFor(q), text = q.text;
  // Words are read once typing pauses, so each keystroke doesn't start its own Jev and OpenStreetMap requests.
  if (text) { await new Promise(res => setTimeout(res, 250)); if (seq !== runSeq) return; }
  // Jev reads the whole ask, including words the parser already turned into kind or sector tags ("pet store" is the Pet tag plus "store").
  const said = text && [...liveQuery().tags.filter(t => ["type", "sector", "phrase", "exclude"].includes(t.kind)).map(t => t.label), text].join(" ");
  const u = text ? await understood(said) : null;
  if (seq !== runSeq) return;
  const hints = u && (u.kinds.length || u.sectors.length) ? { entityType: u.kinds, sector: u.sectors } : null;
  if (live) {
    const lq = { text, filters: q.filters, near: o, radiusKm: q.near ? q.radiusKm : null, limit: 5000, hints };
    S.where.value = live.cached(lq) ? "" : `Asking OpenStreetMap about ${live.area(lq).label}…`;
  }
  const r = await core.search({ text, filters: q.filters, near: o, radiusKm: q.near ? q.radiusKm : null, has: q.has, missing: q.missing, where: q.where, hints, sort: text ? "relevance" : o ? "distance" : "north", limit: 5000 });
  if (seq !== runSeq) return;
  let ranked = text ? "words" : null;
  if (text && u?.live && r.items.length) {
    const cands = r.items.slice(0, JUDGED), need = cands.filter(e => !fits.has(said + "\u0000" + e.id));
    if (need.length) {
      S.where.value = `Jev is reading ${need.length.toLocaleString()} matches…`;
      const ps = await IndexJudge.rank(judge(), said, need);
      if (seq !== runSeq) return;
      if (ps) need.forEach((e, i) => ps[i] != null && fits.set(said + "\u0000" + e.id, ps[i]));
      else S.jevStatus.value = "error";
    }
    const scored = cands.map(e => ({ e, p: fits.get(said + "\u0000" + e.id) })).filter(x => x.p != null).sort((a, b) => b.p - a.p);
    if (scored.length) {
      r.items = scored.filter((x, i) => x.p >= SHOWN || i < FEWEST).map(x => ({ ...x.e, fit: x.p }));
      r.total = r.items.length; ranked = "jev";
    }
  }
  lastFacets = r.facets;
  let where = "";
  if (live) {
    const l = live.last, a = l?.area;
    where = !a ? "" : l.error ? "OpenStreetMap didn't answer" : `Live · ${IndexQuery.STATE_NAME[a.label] || a.label.replace(/^Out from/, "out from")}${a.km ? `, ${a.km < 1.6 ? a.km.toFixed(1) + " km" : Math.round(a.km * 0.621371) + " mi"}` : ""}${l.capped ? " · first " + l.count.toLocaleString() : ""}`;
    if (a?.city && !l.error) store.set("index.place", a.city);
  }
  if (ranked === "jev") where += `${where ? " · " : ""}ranked by Jev`;
  r.items.forEach(e => allById.set(e.id, e));
  // Rows that stay glide to their new place; new rows fade in; the first arrival cascades down (see List).
  const before = new Map(), motion = !reduced() && !isIdle();
  const si = $("stage-in"), box = si.getBoundingClientRect(), inView = t => t > box.top - 60 && t < box.bottom + 60;
  if (motion && !entering) $("list").querySelectorAll(".item, .grp").forEach(el => { const t = el.getBoundingClientRect().top; if (inView(t)) before.set(el.dataset.id || "g:" + el.dataset.city, t); });
  const openId = S.openId.value;
  batch(() => {
    S.where.value = where;
    if (!S.tags.value.length && !q.text) S.readout.value = source?.kind === "live" ? "Live from OpenStreetMap · any US city · © OpenStreetMap contributors" : `${(r.total ?? 0).toLocaleString()} businesses indexed${source?.kind === "server" ? " across the US" : ""} · © OpenStreetMap contributors`;
    S.res.value = { items: r.items, total: r.total ?? 0, origin: o, ranked, errors: r.errors, facets: r.facets, prev: shownIds, entering, flip: motion ? { before, entering, hold: stageHold, inView } : null };
    if (openId && !r.items.some(e => e.id === openId)) S.openId.value = null;
  });
  if (!isIdle()) entering = false;
  shownIds = new Set(r.items.map(e => e.id));
}

// Browse opens rows; Select picks them. Opening a row closes the one that was open.
export let instantClose = null, pendingSwitch = null;
export function toggleItem(id, always) {
  const prev = S.openId.value, next = prev === id ? null : id, nextEl = next && itemEl(next);
  pendingSwitch = { prev, next, always, before: prev && nextEl ? nextEl.getBoundingClientRect().top : null };
  instantClose = prev && next ? prev : null;
  S.openId.value = next;
}
export const takeSwitch = () => { const s = pendingSwitch; pendingSwitch = null; return s; };
// Brings a row to just under the pinned heading, unless it already sits in the upper part of the stage.
export function showRow(el, always) {
  if (!el) return;
  const si = $("stage-in"), box = si.getBoundingClientRect(), head = $("biz").querySelector(".view-head").offsetHeight;
  const top = el.getBoundingClientRect().top - box.top;
  if (always || top < head + 5 || top > box.height * 0.45) si.scrollTo({ top: si.scrollTop + top - head - 5, behavior: reduced() ? "auto" : "smooth" });
}
export async function openBiz(id) {
  setView("results");
  if (!S.res.value.items.some(e => e.id === id)) { // outside the current results: show everything (or, from the server, that business by name), then open it
    const e = allById.get(id), far = source?.kind === "server" && e;
    batch(() => { S.tags.value = far && e.city ? [IndexQuery.tag.city(e.city)] : []; S.q.value = far ? e.name : ""; });
    await refresh();
  }
  if (!S.res.value.items.some(e => e.id === id)) return;
  if (S.openId.value !== id) toggleItem(id);
  else { pendingSwitch = null; afterRender(() => showRow(itemEl(id), true)); }
  afterRender(() => itemEl(id)?.querySelector(".item-head").focus({ preventScroll: true }));
}
export function closeOpen() {
  const id = S.openId.value; if (!id) return;
  toggleItem(id); afterRender(() => itemEl(id)?.querySelector(".item-head").focus({ preventScroll: true }));
}

/* selection */
export function togglePick(id, on) {
  const p = new Set(S.picked.value); on ? p.add(id) : p.delete(id); S.picked.value = p;
}
export function pickMany(ids, on) {
  const p = new Set(S.picked.value); ids.forEach(id => on ? p.add(id) : p.delete(id)); S.picked.value = p;
}
export function setListMode(m) {
  if (m === S.mode.value) return;
  S.mode.value = m;
  if (m === "select" && S.openId.value) toggleItem(S.openId.value);
}
let flashT;
export function flash(text) { S.flash.value = text; clearTimeout(flashT); flashT = setTimeout(() => S.flash.value = "", 1800); }

// Order: by region (north to south, or out from the chosen city) or nearest to you. Location is asked for only when you pick it,
// or used straight away if you already allowed it.
let orderT;
export function sortMsg(t) { S.order.value = t; clearTimeout(orderT); if (t) orderT = setTimeout(() => sortMsg(""), 1800); }
export function locate(asked) {
  if (!navigator.geolocation) { if (asked) sortMsg("Location unavailable"); return; }
  if (asked) { sortMsg("Locating…"); S.locating.value = true; }
  navigator.geolocation.getCurrentPosition(
    p => { batch(() => { S.me.value = { lat: p.coords.latitude, lng: p.coords.longitude }; S.locating.value = false; }); sortMsg(""); run(); },
    () => { batch(() => { S.me.value = null; S.locating.value = false; }); if (asked) sortMsg("Location blocked"); },
    { maximumAge: 6e5, timeout: 8000 });
}
export function sortBy(k) { if (k === "near") { if (!S.me.value) locate(true); } else if (S.me.value) { S.me.value = null; run(); } }

/* ============ Outreach ============ */
export const camp = { audience: "selected", skipWithinDays: 30, onlyActive: true, name: "", brief: "Hi {owner},\n\nI'm opening a business near {city} and would love to hear how {name} got started in {sector}. Could I buy you a coffee and ask a few questions?\n\nThanks," };
export let lastRun = null;
export function agentFor() {
  const key = store.get("claude.key");
  return key ? IndexOutreach.agents.claude({ apiKey: key, instructions: store.get("agent.instructions") || "", sender: store.get("agent.sender") || "" }) : IndexOutreach.agents.template();
}
export function transportFor() { const u = store.get("mail.webhook"); return u ? IndexOutreach.transports.webhook({ url: u }) : IndexOutreach.transports.drafts(); }
export function audience() {
  if (camp.audience === "selected") return [...S.picked.value].map(id => allById.get(id)).filter(Boolean);
  if (camp.audience === "results") return S.res.value.items;
  const g = out.groups().find(x => x.id === camp.audience);
  return g ? g.ids.map(id => allById.get(id)).filter(Boolean) : [];
}
export function openOutreach(t) {
  if (t) S.otab.value = t;
  engage();
  setView("outreach");
}
export async function runCampaign() {
  const list = audience();
  const ctl = new AbortController(); S.running.value = ctl;
  lastRun = { counts: { total: 0, done: 0, sent: 0, drafted: 0, failed: 0, skipped: 0 }, rows: [], transport: transportFor().name };
  const rowOf = e => lastRun.rows.find(x => x.entity.id === e.id);
  S.otab.value = "activity"; S.runv.value++;
  await out.run({ name: camp.name || `Campaign ${out.campaigns().length + 1}`, brief: camp.brief }, list, {
    agent: agentFor(), transport: transportFor(), rules: camp, signal: ctl.signal,
    onEvent(ev) {
      if (ev.type === "planned") { lastRun.rows = [...ev.send.map(e => ({ entity: e, state: "queued" }))]; lastRun.counts.total = ev.send.length; }
      else if (ev.type === "skipped") { lastRun.rows.push({ entity: ev.entity, state: "skipped", note: ev.reason }); lastRun.counts.skipped++; }
      else if (ev.type === "drafting") rowOf(ev.entity).state = "drafting";
      else if (ev.type === "sent" || ev.type === "drafted") Object.assign(rowOf(ev.entity), { state: ev.type, entry: ev.entry });
      else if (ev.type === "failed") Object.assign(rowOf(ev.entity), { state: "failed", note: ev.error });
      else if (ev.type === "progress") Object.assign(lastRun.counts, ev.counts);
      S.runv.value++;
    },
  });
  batch(() => { S.running.value = null; bumpOut(); });
}

/* ============ Records: the all-US search server when one is set, otherwise OpenStreetMap live ============ */
const DEFAULT_SERVER = "";
const serverUrl = () => new URLSearchParams(location.search).get("server") || store.get("index.server") || DEFAULT_SERVER;
export async function connect() {
  const url = serverUrl();
  if (url) {
    const remote = IndexCore.providers.remote(url);
    try {
      const v = await remote.vocab();
      core.addProvider(remote);
      vocab.sector = v.sectors; vocab.type = v.types; vocab.city = v.cities.map(c => c[0]).filter(Boolean);
      for (const [c, , , lat, lng] of v.cities) cityCenters.set(c, { lat, lng });
      source = { kind: "server", url: remote.endpoint, count: v.count, built: v.built };
      return;
    } catch (err) { source = { error: `${url} couldn't be reached (${err.message})` }; }
  }
  // Live: every search asks OpenStreetMap for the area it names. The city list loads as its own file after the page is up.
  const only = new URLSearchParams(location.search).get("overpass"); // ?overpass=URL pins one Overpass server
  let places;
  try { places = await (await fetch("places.json")).json(); } catch { places = { cities: [], types: [] }; }
  live = IndexOSM.provider({ places: places.cities, fallbackPlace: store.get("index.place") || "San Francisco", ...(only ? { endpoints: [only] } : {}) });
  core.addProvider(live);
  vocab.sector = ["Food & Beverage", "Retail", "Healthcare", "Beauty & Wellness", "Professional Services", "Finance", "Real Estate", "Technology", "Hospitality", "Fitness & Recreation", "Education", "Automotive", "Home Services", "Manufacturing", "Arts & Entertainment"];
  vocab.type = places.types; vocab.city = places.cities.map(c => c[0]);
  for (const [c, , lat, lng] of places.cities) cityCenters.set(c, { lat, lng });
  source = { ...(source || {}), kind: "live" };
}
