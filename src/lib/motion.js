// The motion helpers, unchanged from the single-file page. Components call them from layout effects.
import { reduced } from "./util.js";

// Panels in panels: when a panel's content changes, its height glides from the old size to the new one,
// the same motion as a list row opening. Call before the change; call what it returns after.
export function morph(el) {
  if (!el || reduced()) return () => {};
  const h0 = el.getBoundingClientRect().height;
  el.getAnimations().forEach(a => a.id === "morph" && a.cancel());
  return () => {
    const h1 = el.getBoundingClientRect().height;
    if (Math.abs(h1 - h0) < 2) return;
    el.style.overflow = "hidden";
    const a = el.animate([{ height: h0 + "px" }, { height: h1 + "px" }], { duration: 400, easing: "cubic-bezier(.16,1,.3,1)", id: "morph" });
    a.onfinish = a.oncancel = () => { el.style.overflow = ""; };
  };
}

// Slides a tab bar's active pill under its pressed segment.
export function slideInd(bar, animate) {
  const ind = bar?.querySelector(".tab-ind"), on = bar?.querySelector('[aria-pressed="true"]');
  if (!on || !ind) return;
  ind.style.transition = animate && !reduced() ? "" : "none";
  ind.style.width = on.offsetWidth + "px"; ind.style.transform = `translateX(${on.offsetLeft}px)`;
  if (animate) on.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduced() ? "auto" : "smooth" });
}

// Looked-up values arrive like a register being read: digits roll, then settle left to right.
export function lookup(root) {
  if (reduced() || !root) return;
  root.querySelectorAll("[data-lookup]").forEach(el => {
    const final = el.textContent, t0 = performance.now(), dur = 380;
    const step = t => {
      const k = Math.min(1, (t - t0) / dur), settled = Math.floor(final.length * k);
      el.textContent = final.split("").map((ch, i) => i < settled || !/[0-9A-Za-z]/.test(ch) ? ch : (/[0-9]/.test(ch) ? String(Math.random() * 10 | 0) : ch)).join("");
      if (k < 1) requestAnimationFrame(step); else el.textContent = final;
    };
    requestAnimationFrame(step);
  });
}

// Children rise into place one after another.
export function rise(el, { delay = 80, step = 60, y = 4, duration = 300 } = {}) {
  if (!el || reduced()) return;
  [...el.children].forEach((c, i) => c.animate([{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: "none" }], { duration, delay: delay + i * step, easing: "ease-out", fill: "backwards" }));
}
