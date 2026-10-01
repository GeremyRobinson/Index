/* ===================================================================
   IndexJudge: words the search doesn't know, turned into tags. No DOM code in here.
   Judgments come from TypeSafe's Jev: typed questions in, answers with probabilities out.
   The index keeps only the confident answers and turns them into the same tags the parser makes.
     const judge = IndexJudge.typesafe({ endpoint });  // your server adds the key and forwards to api.typesafe.ai/v1/systemone
     const judge = IndexJudge.standIn();               // no network: a word list that answers in Jev's shape
     const { tags, conf, kinds, sectors } = await IndexJudge.understand(judge, "coffee in the bay", vocab, IndexQuery.tag);
     const fit = await IndexJudge.rank(judge, "coffee in the bay", candidates);  // [p, ...] or null without live Jev
   The TypeSafe key never reaches the browser: the page only knows your endpoint.
   =================================================================== */
const IndexJudge = (() => {
  const MIN = 0.6; // below this probability an answer is ignored
  const HINT = 0.15; // a sector or kind this likely is worth fetching and reading, even though it doesn't become a tag
  const CHUNK = 120; // candidates per request to Jev; more go out as several requests side by side
  function questions(vocab) {
    const choice = (instructions, criteria) => ({ type: "choice", instructions, criteria });
    const opts = (list, say, none) => Object.fromEntries([...list.map(v => [v, say(v)]), ["none", none]]);
    return {
      sector: choice("Which business sector is this search looking for?", opts(vocab.sector || [], v => `${v} businesses`, "No sector is implied")),
      city: choice("Which US city is this search about?", opts((vocab.city || []).slice(0, 60), v => `In or around ${v}`, "No place, or a place not listed")),
      contact: choice("Does the searcher need a way to reach the business?", { email: "They need an email address", phone: "They need a phone number", website: "They need a website", none: "Contact details aren't mentioned" }),
      size: choice("What size of business do they want?", { small: "Small: under 10 staff", medium: "Medium: 10 to 50 staff", large: "Large: over 50 staff", any: "Size isn't mentioned" }),
      // The kinds of place the index knows (Bicycle, Pet, Electronics repair...). People rarely use these words, so Jev judges by what they want, not what they typed.
      ...((vocab.type || []).length ? { kind: choice("Which kind of place would have what this person wants? Judge by what they are looking for, not the exact words they used: someone who wants their laptop fixed wants Electronics repair.", opts(vocab.type.slice(0, 250), v => v, "None of these")) } : {}),
    };
  }
  // POST { model, state, questions } → { answers }. Retries once or twice when Jev is busy (429, 529).
  function typesafe({ endpoint, fetchImpl = (...a) => fetch(...a) }) {
    return {
      name: "Jev", live: true,
      async ask(state, qs, { signal } = {}) {
        for (let attempt = 0; ; attempt++) {
          const res = await fetchImpl(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: "jev-latest", state, questions: qs }), signal });
          if ((res.status === 429 || res.status === 529) && attempt < 2) { await new Promise(r => setTimeout(r, 500 * 2 ** attempt)); continue; }
          if (!res.ok) throw new Error(`Jev answered ${res.status}`);
          return (await res.json()).answers || {};
        }
      },
    };
  }
  // Stand-in: the same answer shape from a word list, so the interface can be built and tested before the key is added.
  const LEX = {
    sector: {
      "Food & Beverage": "coffee cafe café espresso bakery bakeries bread pastry pastries croissant eat eats food dinner lunch brunch breakfast restaurant restaurants pizza taco tacos burger burgers bar bars brewery beer wine winery deli",
      Technology: "app apps startup startups saas ai software code coding developer developers tech cloud data computer computers phone repair",
      Healthcare: "clinic clinics doctor doctors dentist dentists dental therapy therapist medical pharmacy vet vets veterinarian optician",
      "Beauty & Wellness": "hair haircut barber barbers salon salons nails spa massage tattoo beauty",
      "Real Estate": "homes housing realtor realtors rent rental rentals apartment apartments property properties",
      Retail: "shop shops store stores boutique boutiques clothes clothing gifts books bookstore florist flowers",
      Hospitality: "hotel hotels motel stay sleep hostel lodging",
      "Fitness & Recreation": "gym gyms fitness yoga workout climbing pilates",
      Automotive: "car cars auto mechanic garage tires tyres",
      Finance: "bank banks atm insurance financial",
      Education: "school lessons classes tutoring",
      "Home Services": "plumber plumbers electrician electricians locksmith contractor",
      Manufacturing: "factory factories machining fabrication makers manufacturing workshop",
      "Arts & Entertainment": "cinema movies theater theatre club nightclub gallery music",
      "Professional Services": "lawyer lawyers law legal accountant accountants accounting consultant consultants consulting agency agencies marketing architect",
    },
    city: { "San Francisco": "bay|bay area|frisco|soma|mission district", Oakland: "east bay|oakland|the town", "Long Beach": "lbc|long beach", "Los Angeles": "hollywood|socal|westside|venice|silver lake", "San Diego": "la jolla|gaslamp", "San Jose": "silicon valley|south bay", Sacramento: "capital|capitol|midtown", Fresno: "central valley" },
    contact: { email: "email emails e-mail inbox mail write", phone: "call phone ring number", website: "website site online web url" },
    size: { small: "small|tiny|little|family|mom and pop|local|indie|independent|solo", medium: "medium mid midsize mid-size growing", large: "large big biggest major enterprise corporate" },
  };
  function standIn() {
    return {
      name: "Jev stand-in", live: false,
      async ask(state, qs, { text = state } = {}) {
        const hay = " " + text.toLowerCase().replace(/[^\w&'-]+/g, " ") + " ";
        const answers = {};
        for (const [id, q] of Object.entries(qs)) {
          const options = Object.keys(q.criteria), fallback = options.includes("none") ? "none" : "any";
          const words = o => { const w = LEX[id]?.[o] || ""; return w.split(w.includes("|") ? "|" : " ").concat(o.toLowerCase()); };
          const score = o => words(o).filter(w => w && hay.includes(" " + w + " ")).length;
          const scored = options.filter(o => o !== fallback).map(o => [o, score(o)]).filter(x => x[1]).sort((a, b) => b[1] - a[1]);
          const choice = scored[0]?.[0] || fallback, top = scored.length ? (scored[0][1] > 1 ? .93 : .86) : .9;
          const probabilities = Object.fromEntries(options.map(o => [o, o === choice ? top : (1 - top) / (options.length - 1)]));
          answers[id] = { type: "choice", choice, probabilities, confidence: top };
        }
        return answers;
      },
    };
  }
  const SIZE = { small: [null, 9], medium: [10, 50], large: [51, null] };
  async function understand(judge, text, vocab, T, opts = {}) {
    const answers = await judge.ask(`Someone is searching a directory of US businesses. Their words: "${text}"`, questions(vocab), { ...opts, text });
    const tags = [], ps = [];
    const take = id => { const a = answers[id]; if (!a || a.type !== "choice") return null; const p = a.probabilities?.[a.choice] ?? a.confidence ?? 0; return p >= MIN && a.choice !== "none" && a.choice !== "any" ? (ps.push(p), a.choice) : null; };
    const sector = take("sector"), city = take("city"), contact = take("contact"), size = take("size");
    if (sector && (vocab.sector || []).includes(sector)) tags.push(T.sector(sector));
    if (city && (vocab.city || []).includes(city)) tags.push(T.city(city));
    if (contact) tags.push(T.has(contact));
    if (size && SIZE[size]) tags.push(T.staff(...SIZE[size]));
    // Likely sectors and kinds don't become tags; they tell the search what else to fetch so Jev has something to rank.
    const likely = id => { const pr = answers[id]?.probabilities || {}; return Object.keys(pr).filter(k => k !== "none" && pr[k] >= HINT).sort((a, b) => pr[b] - pr[a]); };
    return { tags, conf: ps.length ? Math.min(...ps) : 0, by: judge.name, live: !!judge.live, sectors: likely("sector").filter(s => (vocab.sector || []).includes(s)), kinds: likely("kind").filter(k => (vocab.type || []).includes(k)) };
  }

  // What Jev reads about one business.
  const line = e => [e.name, e.entityType, e.sector, e.description, (e.tags || []).join(", "), e.city].filter(Boolean).join(" | ");
  const HOW = "Each question shows one business from OpenStreetMap as name | kind | sector | notes | city. Answer how likely it is that the person who typed `looking_for` would want this business in their results. Judge what the business is and does, not whether it shares words with the search.";
  // Jev reads every candidate and says how likely each is what the words ask for: one yes/no question per business, in one
  // request per 120. Returns probabilities in the candidates' order, or null when only the stand-in is here (it can't judge fit).
  async function rank(judge, text, items, { signal } = {}) {
    if (!judge.live || !items.length) return null;
    const parts = [];
    for (let at = 0; at < items.length; at += CHUNK) parts.push(items.slice(at, at + CHUNK));
    const got = await Promise.all(parts.map(part => judge.ask({ looking_for: text.slice(0, 300), how_to_judge: HOW },
      Object.fromEntries(part.map((e, i) => [`c${i}`, { type: "noul", instructions: { candidate: line(e), question: "Does candidate fit looking_for?" } }])), { signal })
      .then(a => part.map((_, i) => a[`c${i}`]?.noul ?? null)).catch(() => part.map(() => null))));
    const flat = got.flat();
    return flat.every(p => p == null) ? null : flat;
  }
  return { typesafe, standIn, understand, rank, questions, line };
})();

export { IndexJudge };
