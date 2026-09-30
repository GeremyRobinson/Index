// Small shared pieces: icons, the sliding-pill tab bar, the rolling count.
import { useLayoutEffect, useRef, useEffect } from "preact/hooks";
import { ICONS } from "../icons.js";
import { slideInd, morph } from "../lib/motion.js";
import { dotFor } from "../lib/util.js";

// One icon set for every product (Lucide, ISC licence), drawn inline so nothing loads from outside.
export const Icon = ({ n }) => <svg class="i" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[n] || "" }} />;
export const Dot = ({ s, cls }) => <span class={`dot ${cls ?? dotFor(s)}`} />;

// Segmented control. The active segment is one pill that slides between segments.
// items: [[value, label, extra props]]; the pill glides when the value changes and snaps into place otherwise.
export function Tabs({ items, value, onPick, id, cls = "segs tabs", role = "tablist", label, render }) {
  const ref = useRef(), was = useRef(value);
  useLayoutEffect(() => { slideInd(ref.current, was.current !== value); was.current = value; });
  useEffect(() => { const f = () => slideInd(ref.current, false); addEventListener("resize", f); return () => removeEventListener("resize", f); }, []);
  return (
    <div class={cls} role={role} id={id} aria-label={label} ref={ref}>
      <span class="tab-ind" aria-hidden="true" />
      {items.map(([k, l, extra]) => (
        <button key={k} class={extra?.icon ? "seg icon" : "seg"} role={role === "tablist" ? "tab" : undefined} aria-pressed={String(k === value)}
          aria-selected={role === "tablist" ? String(k === value) : undefined} title={extra?.title} aria-label={extra?.aria}
          onClick={() => k !== value && onPick(k)} {...(extra?.attrs || {})}>
          {extra?.icon && <Icon n={extra.icon} />}{render ? render(k, l) : l}
        </button>
      ))}
    </div>
  );
}

// Counts roll on digit reels in mono, so every change reads as a change in quantity.
export function Count({ n }) {
  const ref = useRef();
  useLayoutEffect(() => {
    const el = ref.current, digits = String(n).split("");
    let reels = el.querySelector(".reels");
    if (!reels || reels.children.length !== digits.length) {
      el.innerHTML = `<span class="reels" aria-hidden="true">${digits.map(() => `<span class="reel"><span>${"0123456789".split("").map(d => `<span>${d}</span>`).join("")}</span></span>`).join("")}</span> <span class="rw"></span>`;
      reels = el.querySelector(".reels");
      reels.querySelectorAll(".reel > span").forEach(c => c.style.transition = "none");
      void reels.offsetWidth;
    }
    digits.forEach((d, i) => { reels.children[i].firstElementChild.style.transform = `translateY(${-d * 20}px)`; });
    requestAnimationFrame(() => reels.querySelectorAll(".reel > span").forEach(c => c.style.transition = ""));
    el.querySelector(".rw").textContent = n === 1 ? "result" : "results";
  }, [n]);
  return <span class="num" id="count" style="text-transform:none" ref={ref} aria-label={`${n} ${n === 1 ? "result" : "results"}`} />;
}

// A panel whose height glides between contents: call before() just ahead of a change; the glide runs once it renders.
export function useMorph() {
  const ref = useRef(), pend = useRef(null);
  useLayoutEffect(() => { if (pend.current) { const f = pend.current; pend.current = null; f(); } });
  return [ref, () => { pend.current = morph(ref.current); }];
}

// Label and value rows, as in every S01 form.
export function Form({ label, rows }) {
  return (
    <div class="form"><span class="label">{label}</span><div class="rows">{rows.map(([k, v, copy, mono]) => {
      const empty = v == null || v === "" || (Array.isArray(v) && !v.length);
      const txt = Array.isArray(v) ? v.join(", ") : v;
      return (
        <div class="r" key={k}><span class="kv"><span class="k">{k}</span>
          {empty ? <span class="muted">Not on record</span> : mono ? <span class="mono" data-lookup>{txt}</span> : <span>{txt}</span>}</span>
          {!empty && copy ? <span class="act"><Copy text={txt} label={k} /></span> : <span />}</div>
      );
    })}</div></div>
  );
}
function Copy({ text, label }) {
  const ref = useRef();
  const go = async () => {
    const b = ref.current;
    try { await navigator.clipboard.writeText(text); b.textContent = "copied"; }
    catch { const r = document.createRange(); r.selectNodeContents(b.closest(".r").querySelector(".kv span:last-child")); getSelection().removeAllRanges(); getSelection().addRange(r); b.textContent = "selected"; }
    setTimeout(() => b.textContent = "copy", 1400);
  };
  return <button ref={ref} onClick={go} aria-label={`Copy ${label}`}>copy</button>;
}
// A plain row: key, value, and an optional action.
export const Row = ({ k, v, act, mono = true }) => (
  <div class="r"><span class="kv"><span class="k">{k}</span><span class={mono ? undefined : "plain"}>{v}</span></span>{act ? <span class="act">{act}</span> : <span />}</div>
);
