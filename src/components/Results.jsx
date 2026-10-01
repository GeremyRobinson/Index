/* The index: every business the search found, in location order, grouped by city.
   A row opens in place into its record; in Select mode rows are picked for outreach. */
import { useLayoutEffect, useEffect, useRef, useState } from "preact/hooks";
import { S, live, out, toggleItem, takeSwitch, instantClose, showRow, itemEl, togglePick, pickMany, setListMode, sortBy, SLIDE } from "../state.js";
import { Tabs, Count } from "./bits.jsx";
import { Record } from "./Record.jsx";
import { $, cap, dotFor, miles, ago, reduced, cx } from "../lib/util.js";

const STEP = 300; // rows are drawn in pages as you scroll, so a 5,000-row answer never blocks typing

function Item({ e, i, open, isNew, picked, selecting, last, onHead }) {
  // A closing row keeps its record while the panel folds shut; switching rows closes the old one at once.
  const was = useRef(open), linger = useRef(false), instant = useRef(false), [, bump] = useState(0);
  if (was.current !== open) {
    if (!open) { instant.current = instantClose === e.id; linger.current = !instant.current; } else { linger.current = instant.current = false; }
    was.current = open;
  }
  useEffect(() => {
    if (instant.current) { let a = requestAnimationFrame(() => a = requestAnimationFrame(() => { instant.current = false; bump(x => x + 1); })); return () => cancelAnimationFrame(a); }
    if (linger.current) { const t = setTimeout(() => { linger.current = false; bump(x => x + 1); }, 380); return () => clearTimeout(t); }
  }, [open]);
  return (
    <div class={cx("item", picked && "picked", open && "open", isNew && "new", instant.current && "instant")} data-id={e.id} role="listitem" style={`--i:${Math.min(i, 12)}`}>
      <button class="item-head" aria-expanded={String(open)} aria-pressed={selecting ? String(picked) : undefined} onClick={ev => onHead(ev, e.id)}>
        <span class="nmw"><span class="nm trunc">{e.name}</span>{last && <span class="tag" title={`${last.status === "sent" ? "Emailed" : "Draft written"} ${ago(last.at)}`}>✉ {ago(last.at)}</span>}</span>
        <span class="c-hide muted">{e.entityType || ""}</span><span class="c-hide muted">{e.sector}</span>
        <span class="km num mono muted" title={e.fit != null ? "How likely Jev thinks this is what you meant" : undefined}>{e.fit != null ? Math.round(e.fit * 100) + "%" : e.distanceKm != null ? miles(e.distanceKm) + " mi" : "—"}</span>
        <span class={`dot ${dotFor(e.status)}`} title={cap(e.status)} />
      </button>
      <div class="item-body"><div>{(open || linger.current) && <Record e={e} />}</div></div>
    </div>
  );
}

function List() {
  const res = S.res.value, openId = S.openId.value, picked = S.picked.value, selecting = S.mode.value === "select";
  S.outv.value; // contact tags follow the outreach log
  const [lim, setLim] = useState({ res, n: STEP }), lastPick = useRef(null), sentinel = useRef();
  const limit = lim.res === res ? lim.n : STEP; // a new answer starts again from the first page
  const items = res.items, oi = openId ? items.findIndex(e => e.id === openId) : -1;
  const shown = Math.max(limit, oi + 50);

  // Rows that stay glide to their new place; new rows fade in; the first arrival cascades down.
  useLayoutEffect(() => {
    const f = res.flip; if (!f) return; res.flip = null;
    const els = $("list").querySelectorAll(".item, .grp");
    if (f.entering) els.forEach((el, i) => i < 30 && el.animate([{ opacity: 0, transform: "translateY(-12px)" }, { opacity: 1, transform: "none" }], { duration: 500, delay: (f.hold ? SLIDE + 120 : 150) + i * 22, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }));
    else els.forEach(el => {
      const was = f.before.get(el.dataset.id || "g:" + el.dataset.city); if (was == null) return;
      const now = el.getBoundingClientRect().top, dy = was - now;
      if (Math.abs(dy) > 1 && f.inView(now)) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 350, easing: "cubic-bezier(.16,1,.3,1)" });
    });
  }, [res]);
  // Opening a row: when another row closes at the same time, the page holds still so the row you clicked stays under your pointer.
  useLayoutEffect(() => {
    const sw = takeSwitch(); if (!sw) return;
    if (sw.prev && sw.next && sw.before != null) {
      const el = itemEl(sw.next), after = el?.getBoundingClientRect().top;
      if (el && after !== sw.before) $("stage-in").scrollTop += after - sw.before;
    }
    if (sw.next) showRow(itemEl(sw.next), sw.always);
  }, [openId]);
  useEffect(() => {
    const el = sentinel.current; if (!el) return;
    const io = new IntersectionObserver(([x]) => x.isIntersecting && setLim(l => ({ res, n: (l.res === res ? l.n : STEP) + STEP })), { root: $("stage-in"), rootMargin: "600px" });
    io.observe(el); return () => io.disconnect();
  }, [res, shown]);

  const onHead = (ev, id) => {
    if (!selecting) return toggleItem(id);
    // Select mode: click toggles a row, shift-click takes the whole run since the last one.
    if (ev.shiftKey && lastPick.current) {
      const ids = items.map(e => e.id), a = ids.indexOf(lastPick.current), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) pickMany(ids.slice(Math.min(a, b), Math.max(a, b) + 1), !picked.has(id));
    } else togglePick(id, !picked.has(id));
    lastPick.current = id;
  };
  const onKey = ev => {
    if (!ev.target.classList?.contains("item-head") || !/^Arrow(Up|Down)$/.test(ev.key)) return;
    ev.preventDefault();
    const heads = [...ev.currentTarget.querySelectorAll(".item-head")], i = heads.indexOf(ev.target);
    heads[i + (ev.key === "ArrowDown" ? 1 : -1)]?.focus();
  };

  let body;
  if (!items.length) body = res.errors.length ? <p class="muted empty">OpenStreetMap didn't answer ({res.errors[0].message}). Its free servers are shared, so try again in a moment.</p>
    : <p class="muted empty">No businesses match{live ? ` ${live.last?.area?.label ? "in " + live.last.area.label : "here"}` : ""}. Remove a tag{live ? ", name a city," : ""} or search for fewer words.</p>;
  else {
    const lastOf = new Map(); new Set(out.log().map(x => x.entityId)).forEach(id => lastOf.set(id, out.lastContact(id)));
    body = [];
    for (let i = 0; i < Math.min(shown, items.length); i++) {
      const e = items[i];
      // A ranked list is one block, best first; otherwise rows are grouped by city.
      if (res.ranked ? i === 0 : i === 0 || items[i - 1].city !== e.city) {
        let n = 0; if (res.ranked) n = items.length; else for (let j = i; j < items.length && items[j].city === e.city; j++) n++;
        const head = res.ranked === "jev" ? "Best matches" : res.ranked ? "Matching words" : e.city || "No city";
        body.push(<div class="grp" role="presentation" data-city={res.ranked ? "ranked" : e.city || ""} key={"g:" + (res.ranked ? "ranked" : e.city || "") + ":" + e.id}><span>{head}</span><span class="mono">{n}</span></div>);
      }
      body.push(<Item key={e.id} e={e} i={i} open={openId === e.id} isNew={!res.entering && !res.prev.has(e.id)} picked={picked.has(e.id)} selecting={selecting} last={lastOf.get(e.id)} onHead={onHead} />);
    }
    if (shown < items.length) body.push(<div key="more" ref={sentinel} class="muted empty" aria-hidden="true">…</div>);
  }
  return <div class="list" id="list" role="list" onKeyDown={onKey}>{body}</div>;
}

function Sort() {
  const o = S.res.value.origin, me = S.me.value, near = !!me || S.locating.value, label = o && !me ? o.label : "North to south";
  return (
    <Tabs id="sort" role="radiogroup" label="Order" value={near ? "near" : "region"} onPick={sortBy} items={[
      ["region", "", { icon: "map", title: label, aria: label, attrs: { "data-sort": "region" } }],
      ["near", "", { icon: "navigation", title: "Nearest to you", aria: "Nearest to you", attrs: { "data-sort": "near" } }],
    ]} />
  );
}

export function Results() {
  const res = S.res.value, mode = S.mode.value, items = res.items, picked = S.picked.value;
  const all = items.length > 0 && items.every(e => picked.has(e.id));
  return (
    <section class={cx("view", !res.origin && res.ranked !== "jev" && "nokm", mode === "select" && "selecting")} id="biz" aria-labelledby="res-h" hidden={S.view.value !== "results"}>
      <div class="view-head">
        <div class="cap"><h2 class="label" id="res-h" style="flex:1;display:flex;justify-content:space-between">
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Businesses <span id="res-where" class="muted" style="text-transform:none;font-weight:400">{S.where.value}</span></span>
          <Count n={res.total} /></h2></div>
        <div class="toolbar">
          <Tabs id="mode" label="List mode" value={mode} onPick={setListMode} items={[
            ["browse", "", { icon: "list", title: "Browse: open a business", aria: "Browse", attrs: { "data-mode": "browse" } }],
            ["select", "", { icon: "list-checks", title: "Select: pick businesses for outreach", aria: "Select", attrs: { "data-mode": "select" } }],
          ]} />
          <button class="btn" id="pick-all" hidden={mode !== "select"} onClick={() => pickMany(items.map(e => e.id), !all)}>{all ? "None" : "All"}</button>
          <span class="order" id="order" role="status">{S.order.value}</span>
          <Sort />
        </div>
        <div class="lhead" aria-hidden="true"><span>Name</span><span class="c-hide">Kind</span><span class="c-hide">Sector</span><span class="km num">{res.ranked === "jev" ? "Fit" : "Distance"}</span><span /></div>
      </div>
      <List />
    </section>
  );
}
