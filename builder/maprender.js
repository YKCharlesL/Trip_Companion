/* Trip Builder - maps.
 * 1) pin editor: small MapLibre map with a draggable pin, from the local PMTiles extract;
 * 2) static map renderer: overview + one map per day, drawn to JPEG with numbered pins,
 *    route line, category key, legend, scale bar and OpenStreetMap attribution. */
window.MapRender = (function () {
  'use strict';
  var R = window.TripRender;
  var protocolAdded = false, pinMap = null, pinMarker = null, pinCb = null;
  var FONT = '"Atkinson Hyperlegible", "Segoe UI", Arial, sans-serif';
  var ATTRIBUTION = '© OpenStreetMap contributors · Protomaps';

  function ensureProtocol() {
    if (protocolAdded) return;
    var protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    protocolAdded = true;
  }
  function langOf(P) { return (P.settings.speechLang || 'en').split('-')[0]; }
  function style(P, flavor) {
    var a = P.settings.mapArea;
    var url = location.origin + '/api/projects/' + P.id + '/map/area.pmtiles?v=' + (a.v || a.size || 0);
    flavor = flavor || 'light';
    return {
      version: 8,
      glyphs: location.origin + '/glyphs/{fontstack}/{range}.pbf',
      sprite: location.origin + '/sprites/' + flavor,
      sources: { protomaps: { type: 'vector', url: 'pmtiles://' + url, attribution: ATTRIBUTION } },
      layers: basemaps.layers('protomaps', basemaps.namedFlavor(flavor), { lang: langOf(P) })
    };
  }
  function bboxCenter(P) {
    var b = P.settings.mapArea.bbox || autoBbox(P);
    return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : [0, 0];
  }
  function pins(P) {
    var out = [];
    R.SECTION_ORDER.forEach(function (k) { P.sections[k].forEach(function (e) { if (R.hasPin(e)) out.push(e); }); });
    return out;
  }
  // Pins plus about 1.5 km margin, rounded outwards.
  function autoBbox(P) {
    var ps = pins(P);
    if (!ps.length) return null;
    var lat0 = Math.min.apply(null, ps.map(function (e) { return e.lat; })), lat1 = Math.max.apply(null, ps.map(function (e) { return e.lat; }));
    var lng0 = Math.min.apply(null, ps.map(function (e) { return e.lng; })), lng1 = Math.max.apply(null, ps.map(function (e) { return e.lng; }));
    var padLat = 0.014, padLng = 0.014 / Math.cos((lat0 + lat1) / 2 * Math.PI / 180);
    var f = function (v, up) { return (up ? Math.ceil(v * 1000) : Math.floor(v * 1000)) / 1000; };
    return [f(lng0 - padLng), f(lat0 - padLat), f(lng1 + padLng, 1), f(lat1 + padLat, 1)];
  }

  // ------------------------------------------------------------------ pin editor
  function pinEditor(el, P, e, onMove) {
    destroyPinEditor();
    ensureProtocol();
    var has = R.hasPin(e);
    pinCb = onMove;
    pinMap = new maplibregl.Map({ container: el, style: style(P), center: has ? [e.lng, e.lat] : bboxCenter(P), zoom: has ? 16 : 13, attributionControl: { compact: true } });
    pinMap.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    if (has) setMarker(e.lat, e.lng);
    pinMap.on('click', function (ev) { setMarker(ev.lngLat.lat, ev.lngLat.lng); onMove(ev.lngLat.lat, ev.lngLat.lng); });
  }
  function setMarker(lat, lng) {
    if (!pinMap) return;
    if (!pinMarker) {
      pinMarker = new maplibregl.Marker({ draggable: true, color: '#d22' }).setLngLat([lng, lat]).addTo(pinMap);
      pinMarker.on('dragend', function () { var p = pinMarker.getLngLat(); if (pinCb) pinCb(p.lat, p.lng); });
    } else pinMarker.setLngLat([lng, lat]);
  }
  function movePin(lat, lng) { if (pinMap) { setMarker(lat, lng); pinMap.easeTo({ center: [lng, lat] }); } }
  function destroyPinEditor() {
    if (pinMarker) { pinMarker.remove(); pinMarker = null; }
    if (pinMap) { pinMap.remove(); pinMap = null; }
  }
  function reset() { destroyPinEditor(); }

  // ------------------------------------------------------------------ map definitions
  function shortDate(d) { return R.fmtDate(d, { weekday: 'short', month: 'short' }); }
  function definitions(P, trip) {
    var defs = [];
    var overview = [], n = 0;
    trip.sections.forEach(function (s) {
      s.entries.forEach(function (e) {
        if (!R.hasPin(e)) return;
        overview.push({ n: String(++n), entry: e, cat: R.entryCategory(s.key, e), sub: R.SECTION_META[s.key].title });
      });
    });
    if (overview.length) defs.push({ key: 'overview', title: 'Overview: the whole trip', subtitle: trip.settings.tripName, stops: overview, route: false });
    var hotels = [];
    (trip.sections.filter(function (s) { return s.key === 'accommodation'; })[0] || { entries: [] }).entries.forEach(function (e) {
      if (R.hasPin(e)) hotels.push(e);
    });
    R.planDays(trip).forEach(function (d, i) {
      var stops = [], seen = {}, k = 0;
      d.items.forEach(function (it) {
        if (it.kind !== 'start' || !R.hasPin(it.entry) || seen[it.entry.id]) return;
        seen[it.entry.id] = 1;
        stops.push({ n: String(++k), entry: it.entry, cat: R.entryCategory(it.section, it.entry), sub: it.entry.time || '' });
      });
      if (!stops.length) return;
      hotels.forEach(function (h) {
        var from = h.date || '0000', to = h.endDate || h.date || '9999';
        if (!seen[h.id] && d.date >= from && d.date <= to) stops.unshift({ n: 'H', entry: h, cat: 'accommodation', sub: 'Where you sleep', home: true });
      });
      defs.push({ key: 'day-' + d.date, date: d.date, title: 'Day ' + d.n + ' · ' + R.fmtDate(d.date), subtitle: trip.settings.tripName, stops: stops, route: true });
    });
    return defs;
  }

  // ------------------------------------------------------------------ static rendering
  var MW = 640, MH = 760, PR = 2.5, HEAD = 70;

  function waitIdle(map) {
    return new Promise(function (res) {
      var done = false;
      var finish = function () { if (!done) { done = true; res(); } };
      map.once('idle', finish);
      map.triggerRepaint();
      setTimeout(finish, 20000);
    });
  }

  function renderAll(P, onProgress) {
    ensureProtocol();
    if (!P.settings.mapArea.file) return Promise.reject(new Error('Download the map area first (Maps page).'));
    var trip = TripExporter.buildAppTrip(P, 'preview').trip;
    var defs = definitions(P, trip);
    if (!defs.length) return Promise.resolve([]);
    var stage = document.createElement('div');
    stage.className = 'render-stage';
    stage.style.width = MW + 'px'; stage.style.height = MH + 'px';
    document.body.appendChild(stage);
    var map = new maplibregl.Map({
      container: stage, style: style(P), interactive: false, pixelRatio: PR, fadeDuration: 0, attributionControl: false,
      preserveDrawingBuffer: true, canvasContextAttributes: { preserveDrawingBuffer: true, antialias: true },
      center: bboxCenter(P), zoom: 12
    });
    var results = [];
    var fontReady = document.fonts ? Promise.all([document.fonts.load('700 20px "Atkinson Hyperlegible"'), document.fonts.load('400 20px "Atkinson Hyperlegible"')]).catch(function () {}) : Promise.resolve();
    var loaded = new Promise(function (res, rej) { map.once('load', res); map.once('error', function (e) { if (!map.loaded()) rej(e.error || e); }); });
    return Promise.all([loaded, fontReady]).then(function () {
      return defs.reduce(function (p, def, i) {
        return p.then(function () {
          onProgress && onProgress(i, defs.length, def.title);
          return renderOne(map, P, def).then(function (r) { results.push(r); });
        });
      }, Promise.resolve());
    }).then(function () {
      onProgress && onProgress(defs.length, defs.length, '');
      map.remove(); stage.remove();
      return results;
    }, function (err) { map.remove(); stage.remove(); throw err; });
  }

  function renderOne(map, P, def) {
    var lngs = def.stops.map(function (s) { return s.entry.lng; }), lats = def.stops.map(function (s) { return s.entry.lat; });
    var w = Math.min.apply(null, lngs), e = Math.max.apply(null, lngs), s = Math.min.apply(null, lats), n = Math.max.apply(null, lats);
    if (e - w < 0.002 && n - s < 0.002) map.jumpTo({ center: [(w + e) / 2, (s + n) / 2], zoom: 15.5 });
    else map.fitBounds([[w, s], [e, n]], { padding: { top: 120, bottom: 70, left: 60, right: 60 }, maxZoom: 16, animate: false });
    return waitIdle(map).then(function () { return compose(map, P, def); });
  }

  function compose(map, P, def) {
    var pal = R.palette(P.settings.icon.color), color = pal.brand;
    var cats = {};
    def.stops.forEach(function (st) { cats[st.cat] = 1; });
    var catList = Object.keys(R.CATEGORIES).filter(function (c) { return cats[c]; });
    var cols = 2, rowH = 34, legendRows = Math.ceil(def.stops.length / cols);
    var legendH = 46 + legendRows * rowH + 14;
    var H = HEAD + MH + legendH;
    var c = document.createElement('canvas');
    c.width = Math.round(MW * PR); c.height = Math.round(H * PR);
    var g = c.getContext('2d');
    g.scale(PR, PR);
    g.fillStyle = '#fff'; g.fillRect(0, 0, MW, H);
    // header
    g.fillStyle = color; g.fillRect(0, 0, MW, HEAD);
    g.fillStyle = pal.onBrand; g.textBaseline = 'middle';
    g.font = '700 24px ' + FONT; g.fillText(fitText(g, def.title, MW - 32), 16, 26);
    g.font = '400 16px ' + FONT; g.fillText(fitText(g, def.subtitle || '', MW - 32), 16, 52);
    // map
    g.drawImage(map.getCanvas(), 0, HEAD, MW, MH);
    // pins (project lat/lng to CSS px)
    var pts = def.stops.map(function (st) {
      var p = map.project([st.entry.lng, st.entry.lat]);
      return { st: st, x: p.x, y: p.y + HEAD };
    });
    if (def.route) drawRoute(g, pts.filter(function (p) { return !p.st.home; }));
    placeLabels(pts);
    pts.forEach(function (p) { drawPin(g, p); });
    drawCategoryKey(g, catList);
    drawNorth(g);
    drawScale(g, map);
    drawAttribution(g);
    // legend panel
    var y0 = HEAD + MH;
    g.fillStyle = '#f3f4f6'; g.fillRect(0, y0, MW, legendH);
    g.fillStyle = '#111'; g.font = '700 18px ' + FONT; g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText('Numbers on the map', 16, y0 + 24);
    pts.forEach(function (p, i) {
      var col = i % cols, row = Math.floor(i / cols);
      var x = 16 + col * (MW - 16) / cols, y = y0 + 46 + row * rowH + rowH / 2;
      circle(g, x + 13, y, 13, R.CATEGORIES[p.st.cat].color);
      g.fillStyle = '#fff'; g.font = '700 14px ' + FONT; g.textAlign = 'center'; g.fillText(p.st.n, x + 13, y + 1);
      g.textAlign = 'left'; g.fillStyle = '#111'; g.font = '400 16px ' + FONT;
      g.fillText(fitText(g, (p.st.sub && def.route && !p.st.home ? p.st.sub + '  ' : '') + p.st.entry.title, (MW - 16) / cols - 44), x + 32, y + 1);
    });
    return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.86); }).then(function (blob) {
      return BuilderAPI.upload(blob, 'map-' + def.key + '.jpg');
    }).then(function (r) {
      return {
        key: def.key, title: def.title, subtitle: def.date ? def.stops.filter(function (s) { return !s.home; }).length + ' stops, numbered in order' : 'All places with an address',
        date: def.date || null, fileId: r.fileId, bytes: r.size, w: c.width, h: c.height,
        legend: pts.map(function (p) {
          return { n: p.st.n, entryId: p.st.entry.id, title: p.st.entry.title, cat: p.st.cat, time: def.route && !p.st.home ? p.st.sub : (p.st.home ? 'Where you sleep' : p.st.sub),
            x: +(p.x / MW).toFixed(4), y: +(p.y / H).toFixed(4) };
        })
      };
    });
  }

  function fitText(g, t, max) {
    t = String(t || '');
    if (g.measureText(t).width <= max) return t;
    while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }
  function circle(g, x, y, r, fill) {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = fill; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke();
  }
  function drawRoute(g, pts) {
    if (pts.length < 2) return;
    g.save();
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath(); pts.forEach(function (p, i) { if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); });
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 7; g.stroke();
    g.setLineDash([10, 7]); g.strokeStyle = '#1b1f24'; g.lineWidth = 3.5; g.stroke();
    g.restore();
  }
  // Put each number bubble above its point; move it aside if it would cover another bubble.
  var PIN_R = 17, PIN_UP = 30;
  function placeLabels(pts) {
    var placed = [];
    pts.forEach(function (p) {
      var cands = [[0, -PIN_UP]];
      [38, 58, 80].forEach(function (d) { for (var a = -90; a < 270; a += 45) { if (d === 38 && a === -90) continue; cands.push([Math.cos(a * Math.PI / 180) * d, Math.sin(a * Math.PI / 180) * d]); } });
      var best = cands[0];
      for (var i = 0; i < cands.length; i++) {
        var lx = p.x + cands[i][0], ly = p.y + cands[i][1];
        var ok = placed.every(function (q) { return Math.hypot(q.lx - lx, q.ly - ly) > PIN_R * 2 + 3; }) &&
          lx > PIN_R && lx < MW - PIN_R && ly > HEAD + PIN_R && ly < HEAD + MH - PIN_R;
        if (ok) { best = cands[i]; break; }
      }
      p.lx = p.x + best[0]; p.ly = p.y + best[1]; p.moved = best !== cands[0];
      placed.push(p);
    });
  }
  function drawPin(g, p) {
    var col = R.CATEGORIES[p.st.cat].color;
    g.save();
    if (p.moved) {
      g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.lx, p.ly);
      g.strokeStyle = '#fff'; g.lineWidth = 5; g.stroke();
      g.strokeStyle = col; g.lineWidth = 2.5; g.stroke();
    } else {
      // teardrop: bubble with a point at the exact location
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.lx - PIN_R * 0.62, p.ly + PIN_R * 0.78);
      g.lineTo(p.lx + PIN_R * 0.62, p.ly + PIN_R * 0.78);
      g.closePath();
      g.fillStyle = col; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#fff'; g.stroke();
    }
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 4; g.shadowOffsetY = 1;
    circle(g, p.lx, p.ly, PIN_R, col);
    g.shadowColor = 'transparent';
    // location dot
    g.beginPath(); g.arc(p.x, p.y, 3.5, 0, Math.PI * 2); g.fillStyle = '#111'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 ' + (p.st.n.length > 2 ? 13 : 17) + 'px ' + FONT;
    g.fillText(p.st.n, p.lx, p.ly + 1);
    g.restore();
  }
  function box(g, x, y, w, h) {
    g.fillStyle = 'rgba(255,255,255,.93)';
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1;
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, 8); else g.rect(x, y, w, h);
    g.fill(); g.stroke();
  }
  function drawCategoryKey(g, cats) {
    if (!cats.length) return;
    g.font = '400 14px ' + FONT;
    var w = Math.max.apply(null, cats.map(function (c) { return g.measureText(R.CATEGORIES[c].label).width; })) + 40;
    var h = cats.length * 22 + 12;
    box(g, 10, HEAD + 10, w, h);
    cats.forEach(function (c, i) {
      var y = HEAD + 10 + 6 + i * 22 + 11;
      g.beginPath(); g.arc(26, y, 7, 0, Math.PI * 2); g.fillStyle = R.CATEGORIES[c].color; g.fill();
      g.fillStyle = '#111'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(R.CATEGORIES[c].label, 40, y + 1);
    });
  }
  function drawNorth(g) {
    var x = MW - 30, y = HEAD + 34;
    box(g, x - 20, y - 24, 40, 50);
    g.fillStyle = '#111'; g.beginPath(); g.moveTo(x, y - 18); g.lineTo(x + 8, y + 2); g.lineTo(x, y - 3); g.lineTo(x - 8, y + 2); g.closePath(); g.fill();
    g.font = '700 14px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', x, y + 15);
  }
  function drawScale(g, map) {
    var lat = map.getCenter().lat, z = map.getZoom();
    var mpp = 40075016.686 * Math.cos(lat * Math.PI / 180) / (512 * Math.pow(2, z)); // metres per CSS pixel
    var nice = [20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
    var L = nice[0];
    nice.forEach(function (v) { if (v / mpp <= 150) L = v; });
    var px = L / mpp;
    var label = (L >= 1000 ? L / 1000 + ' km' : L + ' m') + (L <= 3000 ? '  ≈ ' + Math.max(1, Math.round(L / 75)) + ' min walk' : '');
    g.font = '700 14px ' + FONT;
    var w = Math.max(px, g.measureText(label).width) + 24;
    var x = 10, y = HEAD + MH - 58;
    box(g, x, y, w, 48);
    g.fillStyle = '#111'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, x + 12, y + 15);
    var by = y + 34;
    g.fillRect(x + 12, by - 2, px, 4);
    g.fillRect(x + 12, by - 8, 2.5, 12); g.fillRect(x + 12 + px - 2.5, by - 8, 2.5, 12);
  }
  function drawAttribution(g) {
    g.font = '400 12px ' + FONT;
    var w = g.measureText(ATTRIBUTION).width + 14;
    g.fillStyle = 'rgba(255,255,255,.88)'; g.fillRect(MW - w, HEAD + MH - 20, w, 20);
    g.fillStyle = '#222'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(ATTRIBUTION, MW - 7, HEAD + MH - 10);
  }

  return { pinEditor: pinEditor, movePin: movePin, destroyPinEditor: destroyPinEditor, reset: reset, autoBbox: autoBbox, renderAll: renderAll, definitions: definitions, style: style };
})();
