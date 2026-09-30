# Index

Search US businesses with live data from OpenStreetMap. One static page, no server: every search asks
OpenStreetMap's Overpass API for the businesses in the place you name, so results are as current as the map.

**Try it:** https://geremyrobinson.github.io/Index/

## How it works

- Type a place and what you want: "cafe in chicago", "dentist in seattle", "bakery in chicago with email",
  "coffee in texas", "restaurants within 2 mi of me". Words the page knows become tags.
- A city search covers its centre (a few miles; wider when you name a kind or sector). "within N mi of"
  sets the radius. A state search needs a kind or sector ("cafes in texas") so the answer stays small.
- Businesses come from OpenStreetMap tags (shop, amenity, office, craft, leisure, tourism, healthcare) and are
  sorted into 15 sectors by tag rules.
- The page asks overpass-api.de first; if it has not answered in 3 seconds it also asks overpass.private.coffee,
  then maps.mail.ru, and the first answer wins. Answers are kept in the browser for a day.
  `?overpass=URL` pins one server.

The free Overpass servers are shared: a search takes a few seconds, and heavy use gets slowed down.

## Data

Map data © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0).
The page shows this credit wherever the data appears.
