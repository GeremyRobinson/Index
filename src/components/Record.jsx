/* A business's record, inside its open row: status line and actions, the description, then sliding tabs. */
import { useLayoutEffect, useRef, useState, useEffect } from "preact/hooks";
import { S, core, out, allById, togglePick, closeOpen, openBiz } from "../state.js";
import { Tabs, Form, Icon, useMorph } from "./bits.jsx";
import { lookup, rise } from "../lib/motion.js";
import { cap, dotFor, miles, reduced } from "../lib/util.js";

const TABS = [["overview", "Overview"], ["registration", "Registration"], ["location", "Location"], ["sources", "Sources"], ["outreach", "Outreach"], ["raw", "JSON"]];

// Opens the address in the map app the device already uses: Apple Maps on Apple devices, the default maps app on Android
// (geo: link), Google Maps in the browser everywhere else.
function mapHref(e) {
  const q = encodeURIComponent([e.name, e.address, e.city, e.state].filter(Boolean).join(", ")), ua = navigator.userAgent;
  if (/iPhone|iPad|iPod|Macintosh/.test(ua)) return `https://maps.apple.com/?q=${q}&ll=${e.lat},${e.lng}`;
  if (/Android/.test(ua)) return `geo:${e.lat},${e.lng}?q=${e.lat},${e.lng}(${q})`;
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

// Same core search any app would call: same sector, nearest first.
function Nearby({ e }) {
  const [others, setOthers] = useState(null), [ref, before] = useMorph();
  useEffect(() => {
    if (e.lat == null) return;
    let gone = false;
    core.search({ filters: { sector: e.sector }, near: { lat: e.lat, lng: e.lng }, sort: "distance", limit: 5 }).then(r => {
      if (gone) return;
      before(); setOthers(r.items.filter(x => x.id !== e.id && x.distanceKm != null).slice(0, 4));
    });
    return () => { gone = true; };
  }, [e.id]);
  useLayoutEffect(() => { if (others) lookup(ref.current); }, [others]);
  const open = x => { if (!allById.has(x.id)) allById.set(x.id, x); openBiz(x.id); };
  return (
    <div class="tree" id="near" ref={ref}>
      {e.lat == null ? <span class="muted">No location on record.</span>
        : !others ? <span class="muted">…</span>
        : others.length ? others.map((x, i) => (
          <button key={x.id} data-id={x.id} onClick={() => open(x)}><span class="muted">{i === others.length - 1 ? "└" : "├"}</span>
            <span class="nm trunc">{x.name} <span class="muted">{x.city}</span></span><span class="num muted" data-lookup>{miles(x.distanceKm)} mi</span></button>))
        : <span class="muted">No other {e.sector.toLowerCase()} businesses in the index yet.</span>}
    </div>
  );
}

const TRUE = [["Name", "name"], ["Kind", "entityType"], ["Sector", "sector"], ["Address", "address"], ["Phone", "phone"], ["Email", "email"], ["Website", "website"], ["Hours", "hours"], ["Legal name", "legalName"], ["Entity no.", "entityNumber", 1]];
// Replays how the record was assembled: each value sharpens into place with its source, top to bottom.
function TrueRecord({ e }) {
  const ref = useRef();
  useLayoutEffect(() => {
    const rows = [...ref.current.querySelectorAll(".r")];
    if (reduced() || !rows.length) return;
    rows.forEach(r => r.classList.add("walk"));
    const ts = rows.map((r, i) => setTimeout(() => { r.classList.add("lit"); r.classList.remove("walk"); }, 250 + i * 110));
    return () => ts.forEach(clearTimeout);
  }, [e.id]);
  return (
    <div class="form"><span class="label">One true record</span><div class="rows" id="truerec" ref={ref}>{TRUE.map(([l, k, mono]) => {
      const v = Array.isArray(e[k]) ? e[k].join(", ") : e[k], empty = v == null || v === "";
      return (
        <div class="r" key={k}><span class="kv"><span class="k">{l}</span><span>
          <span class={empty ? "muted" : mono ? "mono" : undefined}>{empty ? "Not on record" : v}</span>
          {e.provenance?.[k] ? <span class="prov">{e.provenance[k].replace(/ \(sample\)/g, "")}</span> : null}</span></span><span /></div>
      );
    })}</div></div>
  );
}

const Json = ({ e }) => {
  // Keys stay plain, values are set in bold, as in the single-file page.
  const lines = JSON.stringify(e, null, 2).split("\n");
  return <pre class="json mono">{lines.map((l, i) => { const m = l.match(/^(\s*"[^"]*": )(.*?)(,?)$/); return [i ? "\n" : "", m ? [m[1], <b>{m[2]}</b>, m[3]] : l]; })}</pre>;
};

function TabBody({ e, tab }) {
  S.outv.value; // the outreach tab follows the contact log
  if (tab === "overview") return <>
    <div class="stats"><div><span class="muted">Kind</span><span class="trunc">{e.entityType || "—"}</span></div><div><span class="muted">Since</span><span class="num" style="text-align:left" data-lookup>{e.formed ? e.formed.slice(0, 4) : "—"}</span></div><div><span class="muted">Sorted by</span><span class="trunc">{e.sectorBy === "Jev" ? `Jev ${Math.round((e.sectorP || 0) * 100)}%` : "Tag rules"}</span></div></div>
    <Form label="Business" rows={[["Sector", e.sector], ["Details", e.tags], ["Hours", e.hours]]} />
    <Form label="Contact" rows={[["Phone", e.phone, true], ["Email", e.email, true], ["Website", e.website, true]]} />
    <div class="form"><span class="label">Same sector nearby</span><Nearby e={e} /></div>
  </>;
  if (tab === "registration") return <>
    <Form label="Secretary of State" rows={[["Legal name", e.legalName, true], ["Entity type", e.entityType], ["Entity no.", e.entityNumber, true, true], ["Status", cap(e.status)], ["Formed", e.formed], ["Officers", e.owners], ["State", e.state]]} />
    <p class="muted">OpenStreetMap doesn't record registrations. These fill in once the Secretary of State's bizfile records are added as a source and matched to this business.</p>
  </>;
  if (tab === "location") return <>
    <Form label="Address" rows={[["Street", e.address, true], ["City", e.city && `${e.city}, ${e.state} ${e.zip || ""}`.trim()], ["County", e.county], ["Lat, lng", e.lat != null ? `${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}` : null, true, true]]} />
    <Form label="Contact" rows={[["Phone", e.phone, true], ["Email", e.email, true], ["Website", e.website, true]]} />
    {e.lat != null && <a class="ext" href={mapHref(e)} target="_blank" rel="noopener">Open in Maps →</a>}
  </>;
  if (tab === "sources") return <>
    <TrueRecord e={e} />
    <Form label={e.sources.length > 1 ? `Merged from ${e.sources.length} sources` : "Source"} rows={e.sources.map((x, i) => [i === 0 ? "Primary" : "Added", `${x.name}${x.ref ? " " + x.ref : ""} · fetched ${x.fetched}`])} />
    <p class="muted">Every business gets one record. When sources overlap, the index keeps each value once and remembers where it came from. Map data © OpenStreetMap contributors, ODbL.</p>
  </>;
  if (tab === "outreach") {
    const hist = out.history(e.id), gs = out.groupsOf(e.id);
    return <>
      <Form label="Groups" rows={gs.length ? gs.map(g => [g.name, `${g.ids.length} businesses`]) : [["Groups", null]]} />
      {hist.length ? <div class="form"><span class="label">Contact history</span><div class="rows">{hist.map((x, i) => (
        <div class="r" key={i}><span class="kv"><span class="k"><span class={`dot ${x.status === "failed" ? "error" : "ok"}`} /> {x.at.slice(0, 10)}</span><span>{x.subject || x.error || ""} <span class="muted plain">{x.campaign} · {x.status}</span></span></span><span /></div>))}</div></div>
        : <p class="muted">Not contacted yet. {e.email ? "Press Select above to add it to a group or a campaign." : "There's no email on record, so campaigns will skip it."}</p>}
    </>;
  }
  return <><Json e={e} /><p class="muted">Every app built on the index gets this shape.</p></>;
}

export function Record({ e }) {
  const [tab, setTab] = useState("overview"), sheet = useRef(), [panel, before] = useMorph(), switched = useRef(false);
  const picked = S.picked.value.has(e.id);
  useLayoutEffect(() => { rise(sheet.current); }, []);
  // Only the panel under the tabs changes: its height glides and the new body fades in; looked-up values roll into place.
  useLayoutEffect(() => {
    if (switched.current && !reduced()) panel.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: "ease-out" });
    lookup(panel.current);
  }, [tab]);
  const pick = t => { before(); switched.current = true; setTab(t); };
  return (
    <article class="card sheet" id="sheet" aria-live="polite" ref={sheet}>
      <div class="rec-top"><span class="lead pill"><span class={`dot ${dotFor(e.status)}`} /><span class="trunc">{e.entityType || cap(e.sector)} · {e.address ? `${e.address}, ${e.city}` : e.city}</span></span>
        <span class="acts"><button class="btn" data-sel onClick={() => togglePick(e.id, !picked)}>{picked ? "Selected" : "Select"}</button>
          <button class="btn icon" data-close aria-label="Close" title="Close" onClick={closeOpen}><Icon n="x" /></button></span></div>
      {e.description ? <p>{e.description}</p> : null}
      <Tabs value={tab} onPick={pick} items={TABS.map(([k, l]) => [k, l, { attrs: { "data-tab": k } }])} />
      <div role="tabpanel" id="tabpanel" ref={panel}><TabBody e={e} tab={tab} /></div>
    </article>
  );
}
