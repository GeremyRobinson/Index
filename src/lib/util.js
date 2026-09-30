// Small helpers every component shares.
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
export const $ = id => document.getElementById(id);
export const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
export const dotFor = s => s === "active" ? "ok" : s === "suspended" ? "busy" : s === "dissolved" ? "error" : ""; // unknown: grey
export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const miles = km => { const m = km * 0.621371; return m < 10 ? m.toFixed(1) : String(Math.round(m)); };
export const ago = iso => { const d = Math.floor((Date.now() - new Date(iso)) / 864e5); return d < 1 ? "today" : d === 1 ? "1d ago" : d < 30 ? `${d}d ago` : iso.slice(0, 10); };
export const cx = (...a) => a.filter(Boolean).join(" ");
