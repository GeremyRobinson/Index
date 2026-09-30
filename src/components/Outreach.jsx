/* Outreach: the selection row above the search, and the outreach panel (activity, campaign, groups, settings). */
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { S, out, bumpOut, allById, camp, audience, agentFor, transportFor, runCampaign, lastRun, openOutreach, fitStage, flash, pickMany,
  source, judge, jevCache, qvocab, IndexJudge, IndexQuery } from "../state.js";
import { Tabs, Row, useMorph } from "./bits.jsx";
import { store, ago, cx } from "../lib/util.js";

/* selection row */
export function SelRow() {
  const picked = S.picked.value, n = picked.size, open = S.selGroups.value && n > 0, msg = S.flash.value;
  S.outv.value;
  const groups = out.groups(), name = useRef();
  useLayoutEffect(() => fitStage(true), [n > 0, open, groups.length]);
  const add = gid => {
    const ids = [...picked];
    if (gid === "new") out.createGroup(name.current.value.trim() || `Group ${groups.length + 1}`, ids);
    else out.addToGroup(gid, ids);
    S.selGroups.value = false; bumpOut(); flash(`Added ${ids.length} to the group`);
  };
  return (
    <div class={cx("selrow", n && "open")} id="selbar" role="region" aria-label="Selected businesses"><div class="selrow-in"><div class="selrow-box" id="selbox">
      <div class="segs" id="sel-groups" hidden={!open}>
        <label class="newg"><input id="g-new" ref={name} class="plain-in" placeholder="New group name" aria-label="New group name" /><button class="seg" data-g="new" onClick={() => add("new")}>Create</button></label>
        {groups.map(g => <button key={g.id} class="seg" data-g={g.id} onClick={() => add(g.id)}>{g.name} <span class="n">{g.ids.length}</span></button>)}
      </div>
      <div class="acts"><span class="cnt" role="status"><span id="sel-count" hidden={!!msg}><span class="mono" id="sel-n">{n}</span><span class="wide"> selected</span></span><span class="muted" id="sel-msg" hidden={!msg}>{msg}</span></span>
        <button class="btn" id="sel-add" onClick={() => { S.selGroups.value = !S.selGroups.value; if (S.selGroups.value) requestAnimationFrame(() => name.current?.focus({ preventScroll: true })); }}><span class="wide">Add to </span>group</button>
        <button class="btn" id="sel-run" onClick={() => { camp.audience = "selected"; S.campv.value++; openOutreach("campaign"); }}>Campaign</button>
        <button class="btn" id="sel-clear" onClick={() => { S.picked.value = new Set(); S.selGroups.value = false; }}>Clear</button></div>
    </div></div></div>
  );
}

const redraw = () => S.campv.value++;

function Campaign() {
  S.campv.value; S.outv.value;
  const picked = S.picked.value, res = S.res.value, running = S.running.value;
  const groups = out.groups(), ag = agentFor(), tr = transportFor();
  const opts = [["selected", "Selected", picked.size], ["results", "Current results", res.items.length], ...groups.map(g => [g.id, g.name, g.ids.length])];
  const pl = out.plan(audience(), camp);
  return <>
    <div class="form"><span class="label">1 Audience</span>
      <div class="segs chips">{opts.map(([k, l, n]) => <button key={k} class="seg" data-aud={k} aria-pressed={String(camp.audience === k)} onClick={() => { camp.audience = k; redraw(); }}>{l} <span class="n">{n}</span></button>)}</div></div>
    <div class="form"><span class="label">2 Rules</span><div class="rows">
      <Row k="Repeats" v={camp.skipWithinDays ? `Skip anyone contacted in the last ${camp.skipWithinDays} days` : "Allow repeat contact"} mono={false}
        act={<button data-rule="repeat" onClick={() => { camp.skipWithinDays = camp.skipWithinDays ? 0 : 30; redraw(); }}>{camp.skipWithinDays ? "on" : "off"}</button>} />
      <Row k="Status" v={camp.onlyActive ? "Skip businesses registered as closed" : "Include closed registrations"} mono={false}
        act={<button data-rule="active" onClick={() => { camp.onlyActive = !camp.onlyActive; redraw(); }}>{camp.onlyActive ? "on" : "off"}</button>} />
      <Row k="Email" v="Businesses without an email on record are skipped" mono={false} />
    </div></div>
    <div class="form"><span class="label">3 Message</span>
      <label class="field-row"><span class="muted">Name</span><input id="c-name" class="plain-in" value={camp.name} placeholder="Campaign name" onInput={ev => camp.name = ev.currentTarget.value} /></label>
      <textarea id="c-brief" class="area" rows="7" aria-label="Brief" value={camp.brief} onInput={ev => camp.brief = ev.currentTarget.value} />
      <p class="muted">{ag.name === "Claude" ? "Your Claude agent reads this brief and each business record, then writes one email per business." : "No Claude key yet, so {name}, {city}, {sector} and {owner} are filled in from each record. Add a Claude key under Settings to have Claude write each email."}</p></div>
    <div class="stats"><div><span class="muted">Will contact</span><span>{pl.send.length}</span></div><div><span class="muted">Skipped</span><span>{pl.skip.length}</span></div><div><span class="muted">Delivery</span><span class="trunc">{tr.name === "Webhook" ? "Mail service" : "Drafts only"}</span></div></div>
    {pl.skip.length > 0 && <div class="form"><div class="rows">{pl.skip.slice(0, 6).map((s, i) => <Row key={i} k={s.entity.name} v={<span class="muted">{s.reason}</span>} mono={false} />)}
      {pl.skip.length > 6 && <Row k="" v={<span class="muted">and {pl.skip.length - 6} more</span>} mono={false} />}</div></div>}
    <div class="acts"><button class="btn" id="c-run" disabled={!(pl.send.length && !running)} onClick={runCampaign}>{running ? "Running…" : `Run for ${pl.send.length}`}</button>
      {running && <button class="btn" id="c-stop" onClick={() => running.abort()}>Stop</button>}</div>
  </>;
}

function Groups({ go }) {
  S.outv.value;
  const groups = out.groups();
  return <>
    <p class="muted">Pick businesses in the index, then use Add to group just above the search. Groups keep their members across searches.</p>
    {groups.length ? <div class="form"><div class="rows">{groups.map(g => (
      <Row key={g.id} k={g.name} v={<>{g.ids.length} <span class="muted plain">{g.ids.slice(0, 3).map(id => allById.get(id)?.name || "").join(", ")}{g.ids.length > 3 ? "…" : ""}</span></>}
        act={<><button data-use={g.id} onClick={() => { camp.audience = g.id; go("campaign"); }}>campaign</button> <button data-pickg={g.id} onClick={() => pickMany(g.ids, true)}>select</button> <button data-del={g.id} onClick={() => { out.deleteGroup(g.id); if (camp.audience === g.id) camp.audience = "selected"; bumpOut(); }}>delete</button></>} />
    ))}</div></div> : <p class="muted">No groups yet.</p>}
  </>;
}

/* live report */
function Report() {
  S.runv.value;
  const [ref, before] = useMorph(), [, bump] = useState(0);
  if (!lastRun) return null;
  const c = lastRun.counts, pct = c.total ? Math.round(c.done / c.total * 100) : 100;
  const dot = s => s === "drafting" ? "busy pulse" : s === "failed" ? "error" : s === "skipped" || s === "queued" ? "" : "ok";
  return (
    <div id="report" ref={ref}><div class="form"><span class="label" style="display:flex;justify-content:space-between"><span>Live report</span><span class="mono" style="text-transform:none">{c.done} / {c.total}</span></span>
      <div class="meter" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100"><i style={`width:${pct}%`} /></div>
      <div class="stats four"><div><span class="muted">{lastRun.transport === "Webhook" ? "Sent" : "Drafted"}</span><span>{c.sent + c.drafted}</span></div><div><span class="muted">Writing</span><span>{lastRun.rows.filter(x => x.state === "drafting").length}</span></div><div><span class="muted">Failed</span><span>{c.failed}</span></div><div><span class="muted">Skipped</span><span>{c.skipped}</span></div></div>
      <div class="rows">{lastRun.rows.map((x, i) => [
        <button key={"b" + i} class="r runrow" aria-expanded={String(!!x.open)} onClick={() => { before(); x.open = !x.open; bump(n => n + 1); }}><span class="kv"><span class="k"><span class={`dot ${dot(x.state)}`} /> {x.state}</span><span class="trunc">{x.entity.name}{x.note ? <> <span class="muted plain">{x.note}</span></> : null}</span></span><span /></button>,
        x.open && x.entry?.body ? <div key={"d" + i} class="draft"><span class="mono">{x.entry.subject}</span>{"\n\n"}{x.entry.body}</div> : null])}</div></div></div>
  );
}

function Activity() {
  S.outv.value;
  const log = out.log(), reached = new Set(log.filter(x => x.status !== "failed").map(x => x.entityId)).size;
  return <>
    <div class="stats"><div><span class="muted">Reached</span><span>{reached}</span></div><div><span class="muted">Groups</span><span>{out.groups().length}</span></div><div><span class="muted">Campaigns</span><span>{out.campaigns().length}</span></div></div>
    <Report />
    {log.length ? <>
      <div class="form"><div class="rows">{log.slice(0, 50).map((x, i) => <Row key={i} k={<><span class={`dot ${x.status === "failed" ? "error" : "ok"}`} /> {ago(x.at)}</>} v={<>{x.name} <span class="muted plain">{x.campaign} · {x.status}{x.error ? " · " + x.error : ""}</span></>} />)}</div></div>
      <p class="muted">Every campaign writes here. Campaigns skip anyone contacted recently, so no one hears from you twice by accident.</p>
    </> : <p class="muted">Nothing sent yet. Select businesses in the list, then start a campaign. Its progress shows here live, and every business it reaches is logged.</p>}
  </>;
}

const JEV_DOT = { saved: "busy", ok: "ok", error: "error" }, JEV_SAY = { "stand-in": "Stand-in answering", saved: "Endpoint saved", ok: "Connected", error: "Unreachable" };
function Settings() {
  const [, bump] = useState(0), [srvMsg, setSrvMsg] = useState(""), [jevMsg, setJevMsg] = useState(""), [aMsg, setAMsg] = useState("");
  const f = useRef({});
  const key = store.get("claude.key"), ju = store.get("jev.endpoint"), su = store.get("index.server") || "", jevStatus = S.jevStatus.value;
  const v = k => f.current[k]?.value.trim() || "";
  // Fields start from what's saved and are then left to the person typing.
  const bind = (k, init) => el => { if (el && f.current[k] !== el) { f.current[k] = el; el.value = init; } };
  const srcLine = source?.kind === "server" ? <><span class="dot ok" />{(source.count || 0).toLocaleString()} businesses from the search server</>
    : source?.error ? <><span class="dot error" />{source.error}. Searching OpenStreetMap live instead.</> : <><span class="dot ok" />Live from OpenStreetMap</>;
  const jevTest = async () => {
    const has = !!store.get("jev.endpoint"), probe = "coffee in the bay with email";
    setJevMsg(has ? "Asking Jev…" : "Asking the stand-in…");
    try {
      const r = await IndexJudge.understand(judge(), probe, qvocab(), IndexQuery.tag);
      S.jevStatus.value = has ? "ok" : "stand-in";
      setJevMsg(`${has ? "Jev" : "The stand-in"} read “${probe}” as ${r.tags.map(t => t.label).join(", ") || "nothing it knows"}.`);
    } catch (err) { S.jevStatus.value = "error"; setJevMsg(`Your endpoint couldn't be reached (${err.message}).`); }
  };
  const aTest = async () => {
    setAMsg("Asking the agent for a sample…");
    try { const d = await agentFor().draft(S.res.value.items[0] || [...allById.values()][0], camp.brief); setAMsg(`Works. Sample subject: “${d.subject}”`); }
    catch (err) { setAMsg(`The agent couldn't be reached (${err.message}).`); }
  };
  return <>
    <div class="form"><span class="label">Records: search server</span>
      <p class="muted">Index searches OpenStreetMap live. If you run your own Index search server, paste its address here to search it instead.</p>
      <div class="fields"><label class="field-row"><span class="muted">Server</span><input id="srv-url" ref={bind("srv", su)} class="plain-in" type="url" placeholder="https://your-index-server" /></label></div>
      <div class="acts"><button class="btn" id="srv-save" onClick={() => { const u = v("srv"); if (!/^https?:\/\//.test(u)) return setSrvMsg("Enter the server's address, starting with https://"); store.set("index.server", u); location.reload(); }}>Save and reload</button>
        {su && <button class="btn" id="srv-clear" onClick={() => { store.set("index.server", null); location.reload(); }}>Remove</button>}
        <span class="muted lead" id="srv-msg" role="status">{srvMsg || srcLine}</span></div>
    </div>
    <div class="form"><span class="label">Search understanding: Jev</span>
      <p class="muted">Jev, from TypeSafe, reads the words the search doesn't know, like “coffee in the bay”, and turns them into tags with how sure it is. Your TypeSafe key stays on your own server: give Index an endpoint there that adds the key and forwards the request to api.typesafe.ai/v1/systemone. Until then a stand-in answers in the same shape.</p>
      <div class="fields"><label class="field-row"><span class="muted">Endpoint</span><input id="jev-url" ref={bind("jev", ju || "")} class="plain-in" type="url" placeholder="https://your-server/jev" /></label></div>
      <div class="acts"><button class="btn" id="jev-save" onClick={() => { const u = v("jev"); if (!/^https:\/\//.test(u)) return setJevMsg("Enter your endpoint, starting with https://"); store.set("jev.endpoint", u); S.jevStatus.value = "saved"; jevCache.clear(); setJevMsg(""); }}>Save</button>
        <button class="btn" id="jev-test" onClick={jevTest}>Test</button>
        {ju && <button class="btn" id="jev-clear" onClick={() => { store.set("jev.endpoint", null); S.jevStatus.value = "stand-in"; jevCache.clear(); setJevMsg(""); }}>Remove</button>}
        <span class="muted lead" id="jev-msg" role="status">{jevMsg || <><span class={`dot ${JEV_DOT[jevStatus] || ""}`} />{JEV_SAY[jevStatus]}</>}</span></div>
    </div>
    <div class="form"><span class="label">Agent: Claude</span>
      <p class="muted">Bring your own agent. With a Claude API key, Claude writes each email from your brief and the business record. Keys stay in this browser.</p>
      <div class="fields">
        <label class="field-row"><span class="muted">Claude key</span><input id="a-key" ref={bind("key", key ? "••••••••" + key.slice(-4) : "")} class="plain-in" type="password" autocomplete="off" placeholder="sk-ant-…" /></label>
        <label class="field-row"><span class="muted">Model</span><span class="mono">claude-opus-5-5</span></label>
        <label class="field-row"><span class="muted">Sign as</span><input id="a-sender" ref={bind("sender", store.get("agent.sender") || "")} class="plain-in" placeholder="Your name and business" /></label>
        <label class="field-row"><span class="muted">Mail hook</span><input id="a-hook" ref={bind("hook", store.get("mail.webhook") || "")} class="plain-in" type="url" placeholder="https://… (optional)" /></label>
      </div>
      <textarea id="a-instr" ref={bind("instr", store.get("agent.instructions") || "")} class="area" rows="4" aria-label="Agent instructions" placeholder="Standing instructions for your agent, e.g. tone, what to offer, what never to say" />
      <p class="muted">Without a mail hook, campaigns save drafts to the log. Add a hook from your mail service (Resend, Postmark, a Zapier or Make webhook) to send for real.</p>
      <div class="acts"><button class="btn" id="a-save" onClick={() => {
          const k = v("key"), h = v("hook");
          if (h && !/^https:\/\//.test(h)) return setAMsg("The mail hook must start with https://");
          if (k && !k.startsWith("••••")) store.set("claude.key", k);
          store.set("mail.webhook", h || null); store.set("agent.sender", v("sender") || null); store.set("agent.instructions", v("instr") || null);
          bump(n => n + 1); redraw(); setAMsg("Saved in this browser.");
        }}>Save</button>
        <button class="btn" id="a-test" onClick={aTest}>Test agent</button>
        {key && <button class="btn" id="a-clear" onClick={() => { store.set("claude.key", null); bump(n => n + 1); redraw(); }}>Remove key</button>}
        <span class="muted" id="a-msg" role="status">{aMsg}</span></div>
    </div>
  </>;
}

const OTABS = [["activity", "Activity"], ["campaign", "Campaign"], ["groups", "Groups"], ["settings", "Settings"]];
export function Outreach() {
  const otab = S.otab.value, running = S.running.value, [panel, before] = useMorph();
  S.campv.value;
  const go = t => { before(); S.otab.value = t; };
  const hasKey = !!store.get("claude.key");
  return (
    <section class="view" id="outreach" aria-labelledby="out-h" hidden={S.view.value !== "outreach"}>
      <div class="view-head">
        <div class="cap"><h2 class="label" id="out-h" style="flex:1;display:flex;justify-content:space-between"><span>Outreach</span>
          <span class="plain" style="text-transform:none" id="out-status">{running ? <span class="lead"><span class="dot busy pulse" />Running</span> : <span class="lead"><span class={`dot ${hasKey ? "ok" : ""}`} />{hasKey ? "Claude agent" : "Template agent"}</span>}</span></h2></div>
        <Tabs id="out-tabs" value={otab} onPick={go} items={OTABS.map(([k, l]) => [k, l, { attrs: { "data-otab": k } }])} />
      </div>
      <div id="out-panel" style="display:grid;gap:var(--lh);min-width:0" ref={panel}>
        {otab === "activity" ? <Activity /> : otab === "campaign" ? <Campaign /> : otab === "groups" ? <Groups go={go} /> : <Settings />}
      </div>
    </section>
  );
}
