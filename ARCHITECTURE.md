# Architecture

Two parts that share one renderer:

```
            ┌───────────────────────── your laptop ─────────────────────────┐
            │  python3 start.py  →  http://localhost:8765  (Trip Builder)   │
            │                                                               │
 browser ── │  builder/          editor UI, drag & drop, image compression, │
            │                    PDF page rendering (pdf.js), map pins and  │
            │                    static map rendering (MapLibre + PMTiles)  │
            │  app-template/     the parents' app, also used for the live   │
            │                    phone preview (iframe)                     │
            │  start.py          tiny stdlib server: saves projects, proxies│
            │                    geocoding (Nominatim, 1 req/s), cuts the   │
            │                    PMTiles map extract, writes the export     │
            └───────────────────────────────────────────────────────────────┘
                                   │ Export
                                   ▼
   exports/<trip>/site/            static PWA folder → Netlify / GitHub Pages
   exports/<trip>/<trip>-site.zip  the same folder zipped
   exports/<trip>/<trip>-offline.html  single file, everything base64-inlined
   exports/<trip>/How-to-use-<trip>.html  one-page sheet for your parents
```

## Why it is built this way

* **No build step anywhere.** Plain HTML/CSS/JS. Python 3 standard library only on the laptop
  (no `pip install`). The `pmtiles` command-line tool is downloaded automatically the first time
  you fetch a map area.
* **One renderer, three outputs.** `app-template/render.js` turns trip data into HTML. The
  builder preview, the hosted PWA and the single-file backup all use it, so they look the same.
* **Maps are rendered on the laptop, not on the phone.** The builder draws each map with
  MapLibre from a local Protomaps (PMTiles) extract of the destination, then paints numbered
  pins, a route line, a category key, a legend, a scale bar and the OpenStreetMap attribution
  onto the image. The phone only shows JPEGs, which works on any phone and offline.
* **PDFs are pre-rendered to page images on the laptop.** The phone shows them in the same
  pinch-to-zoom viewer as maps. The original PDF is still included ("Open PDF" button).
  This avoids shipping a 1.7 MB PDF engine that older phones handle badly.
* **The single `.html` file works without JavaScript.** iPhones open local HTML files in
  Quick Look, which does not run scripts. The file therefore contains a complete,
  readable version of the trip (all text, phone links, documents and maps as images). Where
  scripts do run (Android Chrome, computers), it upgrades itself to the full app.
* **Offline:** a service worker precaches every file of the export (documents, maps, fonts)
  under a version key. Re-exporting changes the key; the next time the phone opens the link
  online, the new version downloads in the background and the app reloads itself.

## Data model (project file `projects/<id>/project.json`)

```
settings  tripName, destination, speechLang (pt-PT), timeZone, emergencyNumber,
          myName, myPhone, icon {text, color}, phraseTemplates, mapArea, interactiveMap
sections  accommodation | tours | travel | restaurants | sightseeing | documents | tips | contacts
          → entries: title, details, date, time, endDate, endTime, tz, address, lat, lng,
            phone, ref, notes, role (contacts: hospital | embassy | insurance | other), files[]
phrases   [{en, local, hint}]
files     fileId → {name, type, size, pages[] (PDF page images), w, h}
maps      rendered static maps → {key, title, fileId, legend[{n, entryId, x, y}]}
```

## File structure

```
trip-companion/
  start.py                 one-command local server (Python 3.9+, stdlib only)
  README.md                run, export, host, install, update
  PARENTS-HOW-TO-USE.md    one-page sheet (a trip-specific printable copy is made on export)
  builder/                 Trip Builder UI (index.html, builder.css, builder.js,
                           maprender.js, exporter.js, defaults.js)
  app-template/            parents' app: index.html, app.css, render.js, app.js, sw.js,
                           livemap.js (optional interactive map), fonts/
  vendor/                  MapLibre GL, pmtiles.js, Protomaps basemap styles, glyphs,
                           sprites, pdf.js (builder only)
  sample/                  demo trip (Lisbon) + its map extract
  tools/                   pmtiles CLI (auto-downloaded)
  projects/                your saved projects
  exports/                 export output
```
