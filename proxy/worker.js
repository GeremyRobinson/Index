/* The Jev proxy: a Cloudflare Worker (free plan) between the Index page and TypeSafe.
   The page can't hold the TypeSafe key, and TypeSafe doesn't answer browsers directly, so the page posts its
   questions here and this adds the key. Set the key once as a secret: npx wrangler secret put TYPESAFE_API_KEY
   Only pages from ALLOWED_ORIGINS get an answer (wrangler.toml), and each request is capped so a stranger
   who finds the URL can't run up a large bill. */
const TYPESAFE = "https://api.typesafe.ai/v1/systemone";
const MOST_QUESTIONS = 130; // the page asks at most 120 per request
const MOST_BYTES = 200_000;

export default {
  async fetch(req, env) {
    const allowed = (env.ALLOWED_ORIGINS || "https://geremyrobinson.github.io").split(",").map(s => s.trim());
    const origin = req.headers.get("Origin") || "";
    const ok = allowed.includes(origin) || allowed.includes("*");
    const cors = { "Access-Control-Allow-Origin": ok ? origin || "*" : allowed[0], "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
    const say = (status, error) => new Response(JSON.stringify({ error }), { status, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return say(405, "POST only");
    if (!ok) return say(403, "This page isn't allowed to use this proxy");
    if (!env.TYPESAFE_API_KEY) return say(500, "TYPESAFE_API_KEY isn't set on the worker");
    const raw = await req.text();
    if (raw.length > MOST_BYTES) return say(413, "Request too large");
    let body; try { body = JSON.parse(raw); } catch { return say(400, "Not JSON"); }
    if (!body || typeof body.questions !== "object" || Object.keys(body.questions).length > MOST_QUESTIONS) return say(400, "Too many questions");
    const res = await fetch(TYPESAFE, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", state: body.state, questions: body.questions }),
    });
    return new Response(res.body, { status: res.status, headers: { ...cors, "Content-Type": "application/json" } });
  },
};
