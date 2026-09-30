# Index

Search US businesses with live data from OpenStreetMap. A static site, no server: every search asks
OpenStreetMap's Overpass API for the businesses in the place you name, so results are as current as the map.

**Try it:** https://geremyrobinson.github.io/Index/

## How it works

- Type a place and what you want: "cafe in chicago", "dentist in seattle", "bakery in chicago with email",
  "coffee in texas", "restaurants within 2 mi of me". Words the page knows become tags.
- Plain words ("plastic surgery", "sushi", "tesla") search business names and the tags that say what a place
  does (specialty, cuisine, shop type, brand, description) across the whole metro area.
- A city search covers its centre (a few miles; wider when you name a kind or sector). "within N mi of"
  sets the radius. A state search needs a kind or sector ("cafes in texas") so the answer stays small.
- Businesses come from OpenStreetMap tags (shop, amenity, office, craft, leisure, tourism, healthcare) and are
  sorted into 15 sectors by tag rules.
- The page asks overpass-api.de first; if it has not answered in 3 seconds it also asks overpass.private.coffee,
  then maps.mail.ru, and the first answer wins. Answers are kept in the browser for a day.
  `?overpass=URL` pins one server.

The free Overpass servers are shared: a search takes a few seconds, and heavy use gets slowed down.

## Files

The page is built from Preact components (Preact is a 4 KB take on React) with Vite. The built site is about
45 KB compressed.

- `src/core/`: the search engine, with no page code in it: `core.js` (records, merging, ranking), `query.js`
  (words to tags), `osm.js` (live OpenStreetMap search), `judge.js` (Jev, search understanding) and `outreach.js`
  (groups and campaigns). Any other app can reuse these files as they are.
- `src/components/`: the page, one component per part: `Dock.jsx` (the bar, search field and suggestions),
  `Results.jsx` (the list), `Record.jsx` (a business's record), `Outreach.jsx` (selection, campaigns, settings).
- `src/state.js`: what the page shows and the actions that change it.
- `src/lib/motion.js`: the shared motion (panels that glide to fit, the sliding tab pill, values that roll into place).
- `public/places.json`: the 5,500 US cities the search recognises, with their centres. Loaded after the page appears.

## Working on it

```
npm install
npm run dev      # local site with live reload
npm run build    # the site, in dist/
```

Every push to `main` builds the site and publishes it to GitHub Pages (`.github/workflows/pages.yml`).

## Data

Map data © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0).
The page shows this credit wherever the data appears.
