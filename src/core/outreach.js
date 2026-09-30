/* ===================================================================
   IndexOutreach: bulk contact on top of the index. No DOM code in here.
   Groups, a contact log every campaign writes to (so nobody is contacted
   twice by accident), and campaigns run by a pluggable agent + transport:
     const out = IndexOutreach.create({ load, save });
     const plan = out.plan(entities, { skipWithinDays: 30, onlyActive: true });
     await out.run({ name, brief }, entities, { agent, transport, onEvent });
   =================================================================== */
const IndexOutreach = (() => {
  const DAY = 864e5;
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function create({ load = () => null, save = () => {} } = {}) {
    const state = Object.assign({ groups: [], log: [], campaigns: [] }, load() || {});
    const persist = () => save(state);
    const api = {
      /* groups: saved lists of businesses */
      groups: () => state.groups,
      createGroup(name, ids = []) { const g = { id: uid("g_"), name, ids: [...new Set(ids)], created: new Date().toISOString() }; state.groups.unshift(g); persist(); return g; },
      addToGroup(gid, ids) { const g = state.groups.find(x => x.id === gid); if (g) { g.ids = [...new Set([...g.ids, ...ids])]; persist(); } return g; },
      removeFromGroup(gid, ids) { const g = state.groups.find(x => x.id === gid); if (g) { g.ids = g.ids.filter(i => !ids.includes(i)); persist(); } return g; },
      deleteGroup(gid) { state.groups = state.groups.filter(g => g.id !== gid); persist(); },
      groupsOf: entityId => state.groups.filter(g => g.ids.includes(entityId)),

      /* contact log: every touch, newest first */
      log: () => state.log,
      history: entityId => state.log.filter(x => x.entityId === entityId),
      lastContact(entityId) { return state.log.find(x => x.entityId === entityId && (x.status === "sent" || x.status === "drafted")) || null; },
      record(entry) { const x = { id: uid("c_"), at: new Date().toISOString(), channel: "email", ...entry }; state.log.unshift(x); persist(); return x; },
      campaigns: () => state.campaigns,

      /* who a campaign would reach, and why the rest are skipped */
      plan(entities, { skipWithinDays = 30, onlyActive = true } = {}) {
        const send = [], skip = [];
        for (const e of entities) {
          const last = api.lastContact(e.id);
          if (!e.email) skip.push({ entity: e, reason: "No email on record" });
          else if (onlyActive && ["suspended", "dissolved"].includes(e.status)) skip.push({ entity: e, reason: `Registration ${e.status}` });
          else if (skipWithinDays && last && Date.now() - new Date(last.at) < skipWithinDays * DAY) skip.push({ entity: e, reason: `Contacted ${last.at.slice(0, 10)}` });
          else send.push(e);
        }
        return { send, skip };
      },

      /* run a campaign: the agent writes each message, the transport delivers it, every result is logged */
      async run({ name, brief }, entities, { agent, transport, rules, onEvent = () => {}, concurrency = 2, signal } = {}) {
        const campaign = { id: uid("k_"), name: name || "Campaign", brief, agent: agent.name, transport: transport.name, at: new Date().toISOString(), counts: {} };
        state.campaigns.unshift(campaign);
        const { send, skip } = api.plan(entities, rules);
        onEvent({ type: "planned", campaign, send, skip });
        skip.forEach(s => onEvent({ type: "skipped", entity: s.entity, reason: s.reason }));
        const queue = [...send];
        const counts = campaign.counts = { total: send.length, done: 0, sent: 0, drafted: 0, failed: 0, skipped: skip.length };
        async function worker() {
          while (queue.length && !signal?.aborted) {
            const e = queue.shift();
            onEvent({ type: "drafting", entity: e });
            try {
              const msg = await agent.draft(e, brief);
              const res = await transport.send({ to: e.email, subject: msg.subject, body: msg.body, entity: e });
              const entry = api.record({ entityId: e.id, name: e.name, campaignId: campaign.id, campaign: campaign.name, to: e.email, subject: msg.subject, body: msg.body, status: res.status, agent: agent.name });
              counts[res.status]++; onEvent({ type: res.status, entity: e, entry });
            } catch (err) {
              const entry = api.record({ entityId: e.id, name: e.name, campaignId: campaign.id, campaign: campaign.name, to: e.email, status: "failed", error: err.message, agent: agent.name });
              counts.failed++; onEvent({ type: "failed", entity: e, entry, error: err.message });
            }
            counts.done++; onEvent({ type: "progress", counts });
          }
        }
        await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
        persist(); onEvent({ type: "finished", campaign, counts });
        return campaign;
      },
    };
    return api;
  }

  const fill = (tpl, e) => tpl.replace(/\{(\w+)\}/g, (_, k) => k === "owner" ? (e.owners?.[0] || "").replace(/\s*\(.*\)$/, "") || "there" : e[k] ?? "");

  const agents = {
    // Works with no key: fills {name}, {city}, {sector}, {owner} into your brief.
    template({ subject = "Hello from {city}" } = {}) {
      return { name: "Template", async draft(e, brief) { return { subject: fill(subject, e), body: fill(brief, e) }; } };
    },
    // Your own agent on the Claude API. It writes one tailored email per business from the brief and the record.
    claude({ apiKey, model = "claude-opus-5-5", instructions = "", sender = "", sdkUrl = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk/+esm" }) {
      let client;
      const schema = { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"], additionalProperties: false };
      return {
        name: "Claude",
        async draft(e, brief) {
          if (!client) { const { default: Anthropic } = await import(sdkUrl); client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true }); }
          const facts = { name: e.name, legalName: e.legalName, sector: e.sector, industry: e.naics, city: e.city, owners: e.owners, tags: e.tags, description: e.description, website: e.website, hours: e.hours };
          const res = await client.beta.messages.create({
            model, max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
            output_config: { effort: "low", format: { type: "json_schema", schema } },
            system: `You write short, specific outreach emails to small businesses on behalf of ${sender || "the sender"}. Use only the facts given about the business. Plain text, no placeholders, under 150 words.${instructions ? "\n\n" + instructions : ""}`,
            messages: [{ role: "user", content: `Brief:\n${brief}\n\nBusiness record:\n${JSON.stringify(facts, null, 2)}` }],
          });
          if (res.stop_reason === "refusal") throw new Error("Claude declined to write this one");
          const text = res.content.find(b => b.type === "text")?.text;
          if (!text) throw new Error("Claude returned no text");
          return JSON.parse(text);
        },
      };
    },
  };

  const transports = {
    // Keeps every message as a draft in the log. Nothing leaves the browser.
    drafts() { return { name: "Drafts only", async send() { return { status: "drafted" }; } }; },
    // Hands each message to your mail service (Resend, Postmark, a Zapier or Make hook, your own server) as JSON.
    webhook({ url, fetchImpl = (...a) => fetch(...a) }) {
      return {
        name: "Webhook",
        async send({ to, subject, body, entity }) {
          const res = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, subject, body, entityId: entity.id, name: entity.name }) });
          if (!res.ok) throw new Error(`Mail service answered ${res.status}`);
          return { status: "sent" };
        },
      };
    },
  };

  return { create, agents, transports };
})();

export { IndexOutreach };
