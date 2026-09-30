/* The dock: the only chrome on the page. The word Index, the search, and Outreach.
   Above it, the tray of suggestions opens upward while you type. */
import { useLayoutEffect, useRef } from "preact/hooks";
import { S, KIND_ICON, tagKey, commit, choose, setHi, typed, removeTag, clearSearch, renderHits, refresh, engage, home, setView, isIdle,
  openOutreach, hintOn, setTrayH } from "../state.js";
import { Icon, Dot } from "./bits.jsx";
import { $ } from "../lib/util.js";

const TagIcon = ({ t }) => t.kind === "status" ? <Dot s={t.v} /> : <span class="ti"><Icon n={KIND_ICON[t.kind]} /></span>;

function Tags() {
  const ref = useRef(), seen = useRef(new Set());
  const tags = S.tags.value, sel = S.tagSel.value;
  useLayoutEffect(() => {
    const box = ref.current;
    box.scrollLeft = box.scrollWidth; box.classList.toggle("clipped", box.scrollLeft > 0);
    seen.current = new Set(tags.map(tagKey));
  });
  return (
    <span class="tags" id="tags" ref={ref} onScroll={ev => ev.currentTarget.classList.toggle("clipped", ev.currentTarget.scrollLeft > 0)}>
      {tags.map((t, i) => (
        <button key={tagKey(t)} class={`tag-chip${i === sel ? " sel" : ""}${seen.current.has(tagKey(t)) ? "" : " born"}`} title={`Remove ${t.label}`} aria-label={`Remove ${t.label}`}
          onMouseDown={ev => ev.preventDefault()} onClick={() => { removeTag(i); $("q").focus(); }}>
          <TagIcon t={t} /><span class="x"><Icon n="x" /></span><span>{t.label}</span>
        </button>
      ))}
    </span>
  );
}

function onKey(ev) {
  const q = S.q.value, typing = !!q.trim(), hits = S.hits.value, hi = S.hi.value, tags = S.tags.value;
  if (ev.key === "ArrowUp" && typing) { ev.preventDefault(); setHi(hi + 1, true); } // suggestions stack upward
  else if (ev.key === "ArrowDown" && typing) { ev.preventDefault(); setHi(hi - 1, true); }
  // Enter applies what's typed; when that finds nothing and Jev has a reading, Enter takes Jev's reading instead.
  else if (ev.key === "Enter") { ev.preventDefault(); hi >= 0 ? choose(hi) : hits[0]?.n === 0 && hits[1]?.kind === "jev" ? choose(1) : commit(); }
  else if (ev.key === "Tab" && typing && hits.some(h => h.kind === "complete")) { ev.preventDefault(); choose(hits.findIndex(h => h.kind === "complete")); }
  else if (ev.key === "Backspace" && !q && tags.length) {
    // First Backspace marks the last tag, the second turns it back into words you can edit.
    ev.preventDefault();
    if (S.tagSel.value !== tags.length - 1) S.tagSel.value = tags.length - 1;
    else { const t = tags[tags.length - 1]; S.tags.value = tags.slice(0, -1); S.tagSel.value = -1; S.q.value = t.label.replace(/^[“"]|[”"]$/g, () => '"') + " "; refresh(); }
  }
  else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); if (S.trayOpen.value) S.trayOpen.value = false; else ev.currentTarget.blur(); }
}

export function Bar() {
  const q = S.q.value, tags = S.tags.value, idle = S.idle.value, view = S.view.value, hi = S.hi.value;
  const has = !!q || tags.length > 0, show = S.trayOpen.value && !!q.trim() && S.hits.value.length > 0;
  return (
    <div class="bar" id="steps" role="group" aria-label="Index">
      <button class="btn logo" id="logo" aria-pressed={String(!idle && view === "results")} title="The index"
        onClick={() => { if (isIdle()) { engage(); refresh(); return; } if (view !== "results") return setView("results"); home(); $("q").focus(); }}>Index</button>
      <label class={`field${has ? " has" : ""}`} id="field"><Icon n="search" /><Tags />
        <input id="q" type="text" placeholder={S.ph.value} autocomplete="off" spellcheck={false} role="combobox" aria-expanded={String(show)} aria-controls="segs"
          aria-autocomplete="list" aria-label="Search businesses" aria-activedescendant={hi >= 0 ? `hit-${hi}` : ""} value={q}
          onInput={ev => typed(ev.currentTarget.value)} onKeyDown={onKey}
          onFocus={() => { S.trayOpen.value = true; if (!hintOn) S.ph.value = S.tags.value.length ? "Add more…" : "Try “bakery in san diego with email”"; renderHits(); }}
          onBlur={() => { if (!hintOn) S.ph.value = "Search businesses"; S.trayOpen.value = false; S.tagSel.value = -1; }} />
        <span class="kbd mono" aria-hidden="true">⌘K</span></label>
      <button class="btn icon" id="reset" hidden={!(q.trim() || tags.length)} aria-label="Clear search" title="Clear search"
        onMouseDown={ev => ev.preventDefault()} onClick={clearSearch}><Icon n="x" /></button>
      <button class="btn" id="outbtn" aria-pressed={String(!idle && view === "outreach")} title="Outreach and settings"
        onClick={() => !isIdle() && view === "outreach" ? setView("results") : openOutreach()}><Icon n="send" /><span class="lbl">Outreach</span></button>
    </div>
  );
}

const Ghost = ({ t }) => <span class="tag-chip ghost"><TagIcon t={t} /><span>{t.label}</span></span>;
function Hit({ h, i, sel }) {
  const common = { role: "option", id: `hit-${i}`, "aria-selected": String(sel), onMouseDown: ev => ev.preventDefault(), onMouseMove: () => S.hi.value !== i && setHi(i), onClick: () => choose(i) };
  if (h.kind === "jev") return <div class="hit jev" {...common}><span class="ti"><Icon n="sparkles" /></span><span class="chips">{h.tags.map(t => <Ghost t={t} key={tagKey(t)} />)}</span><span class="n num" title={`${h.by}: the least sure of its answers`}>{h.by === "Jev" ? "Jev" : "Stand-in"} {Math.round(h.conf * 100)}%</span></div>;
  if (h.kind === "apply") return <div class="hit apply" {...common}><span class="ti"><Icon n="corner-down-left" /></span><span class="chips">{h.pending.map(t => <Ghost t={t} key={tagKey(t)} />)}{h.rest ? <span class="leaf">{h.rest}</span> : null}</span><span class="n num">{h.n ?? ""}</span></div>;
  const parts = [...h.path.map(x => <span class="p">{x}</span>), <span class="leaf">{h.leaf}</span>];
  const lead = h.kind === "biz" ? <Dot s={h.status} /> : h.icon ? <span class="ti"><Icon n={h.icon} /></span> : null;
  return (
    <div class="hit" {...common}>{lead}
      {parts.map((x, j) => [j ? <span class="sep">/</span> : null, <span class="pi" style={`animation-delay:${Math.min(i, 6) * 30 + j * 45}ms`}>{x}</span>])}
      {h.n !== undefined && h.n !== "" ? <span class="n num">{h.n}</span> : null}</div>
  );
}

// The tray shows only while you type. Its height glides to fit whatever it holds.
export function Tray() {
  const segs = useRef(), tray = useRef(), kept = useRef({ hits: [], v: 0 });
  const hi = S.hi.value, show = S.trayOpen.value && !!S.q.value.trim() && S.hits.value.length > 0;
  if (show) kept.current = { hits: S.hits.value, v: S.hitsV.value }; // closing keeps the last rows while the tray folds away
  const { hits, v } = kept.current;
  useLayoutEffect(() => {
    const h = show ? segs.current.offsetHeight : 0;
    tray.current.style.height = h + "px";
    setTrayH(h);
  });
  return (
    <div class={`tray${show ? " open" : ""}`} id="tray" ref={tray}>
      <div class="segs hits" id="segs" role="listbox" aria-label="Suggestions" ref={segs}>
        {hits.map((h, i) => <Hit key={`${v}-${i}`} h={h} i={i} sel={i === hi} />)}
      </div>
    </div>
  );
}
