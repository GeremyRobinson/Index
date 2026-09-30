/* Index: one shell. Its foot is the bar (Index, Search, Outreach); everything else (the index, suggestions, outreach,
   the selection) grows up out of it as one accordion. It starts alone in the centre; once there is something to look for,
   the index opens and pushes the bar to the bottom of the screen. */
import { render } from "preact";
import { useEffect } from "preact/hooks";
import "./styles.css";
import { S, connect, run, startHint, fitStage, setView, closeOpen, isIdle, locate } from "./state.js";
import { Bar, Tray } from "./components/Dock.jsx";
import { Results } from "./components/Results.jsx";
import { Outreach, SelRow } from "./components/Outreach.jsx";
import { $ } from "./lib/util.js";

function App() {
  useEffect(() => {
    // The stage follows its content as rows open and panels change, within the room the screen has.
    const ro = new ResizeObserver(() => fitStage()); ro.observe($("biz")); ro.observe($("outreach"));
    const resize = () => fitStage();
    const keys = ev => {
      const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); $("q").focus(); $("q").select(); }
      else if (ev.key === "/" && !typing) { ev.preventDefault(); $("q").focus(); }
      else if (ev.key === "Escape" && S.view.value === "outreach" && !typing && !isIdle()) setView("results");
      else if (ev.key === "Escape" && S.openId.value) closeOpen();
    };
    addEventListener("resize", resize); document.addEventListener("keydown", keys);
    navigator.permissions?.query({ name: "geolocation" }).then(p => { if (p.state === "granted") locate(false); }).catch(() => {});
    connect().then(() => { startHint(); run(); });
    return () => { ro.disconnect(); removeEventListener("resize", resize); document.removeEventListener("keydown", keys); };
  }, []);
  return (
    <div class="shell" id="shell">
      <div class="stage" id="stage"><div class="stage-in" id="stage-in"><Results /><Outreach /></div></div>
      <Tray />
      <SelRow />
      <Bar />
      <p class="readout mono" id="readout" aria-live="polite">{S.readout.value}</p>
    </div>
  );
}

render(<App />, $("app"));
