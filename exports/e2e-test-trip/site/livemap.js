/* Trip Companion - optional moving map (MapLibre GL + bundled PMTiles extract), fully offline. */
(function () {
  'use strict';
  var R = window.TripRender;
  var map = null, archive = null, protocolAdded = false, watchId = null, meMarker = null;

  function base() { return location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, ''); }

  function loadArchive(trip) {
    if (archive) return Promise.resolve(archive);
    // Read the whole extract (from the offline cache) and serve tiles from memory.
    return fetch(trip.interactive.pmtiles).then(function (r) {
      if (!r.ok) throw new Error('map file missing');
      return r.blob();
    }).then(function (blob) {
      var file = new File([blob], 'area.pmtiles');
      archive = new pmtiles.PMTiles(new pmtiles.FileSource(file));
      if (!protocolAdded) {
        var protocol = new pmtiles.Protocol();
        maplibregl.addProtocol('pmtiles', protocol.tile);
        protocol.add(archive);
        protocolAdded = true;
      }
      return archive;
    });
  }

  function pinsFor(trip) {
    var overview = (trip.maps || []).filter(function (m) { return m.key === 'overview'; })[0];
    var num = {};
    if (overview) overview.legend.forEach(function (l) { num[l.entryId] = l.n; });
    var out = [], n = 0;
    trip.sections.forEach(function (s) {
      s.entries.forEach(function (e) {
        if (!R.hasPin(e)) return;
        n++;
        out.push({ e: e, n: num[e.id] || String(n), cat: R.entryCategory(s.key, e) });
      });
    });
    return out;
  }

  function open(el, trip, focusId) {
    close();
    var dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
    var flavor = dark ? 'dark' : 'light';
    loadArchive(trip).then(function () {
      el.innerHTML = '';
      var b = trip.interactive.bbox;
      map = new maplibregl.Map({
        container: el,
        style: {
          version: 8,
          glyphs: base() + 'map/glyphs/{fontstack}/{range}.pbf',
          sprite: base() + 'map/sprites/' + flavor,
          sources: { protomaps: { type: 'vector', url: 'pmtiles://area.pmtiles', attribution: '© OpenStreetMap contributors · Protomaps' } },
          layers: basemaps.layers('protomaps', basemaps.namedFlavor(flavor), { lang: trip.interactive.lang || 'en' })
        },
        bounds: b ? [[b[0], b[1]], [b[2], b[3]]] : undefined,
        maxBounds: b ? [[b[0] - 0.05, b[1] - 0.05], [b[2] + 0.05, b[3] + 0.05]] : undefined,
        attributionControl: { compact: false },
        dragRotate: false, pitchWithRotate: false
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      var markers = {};
      pinsFor(trip).forEach(function (p) {
        var div = document.createElement('div');
        div.className = 'lm-pin';
        div.style.background = R.CATEGORIES[p.cat].color;
        div.textContent = p.n;
        div.setAttribute('aria-label', p.e.title);
        var popup = new maplibregl.Popup({ offset: 24, maxWidth: '300px' }).setHTML(
          '<strong>' + R.esc(p.e.title) + '</strong>' + (p.e.address ? '<br>' + R.esc(p.e.address.split('\n')[0]) : '') +
          '<a class="btn btn-primary" href="#/entry/' + encodeURIComponent(p.e.id) + '">Show details</a>');
        markers[p.e.id] = { m: new maplibregl.Marker({ element: div }).setLngLat([p.e.lng, p.e.lat]).setPopup(popup).addTo(map), div: div };
      });
      if (focusId && markers[focusId]) {
        var f = markers[focusId];
        f.div.classList.add('focus');
        map.easeTo({ center: f.m.getLngLat(), zoom: 16, offset: [0, 90], duration: 0 });
        f.m.togglePopup();
      }
      startGps();
    }).catch(function () {
      el.innerHTML = '<p class="card">The moving map could not start. Use the picture maps or the address list instead.</p>';
    });
  }

  function startGps() {
    if (!('geolocation' in navigator) || !map) return;
    watchId = navigator.geolocation.watchPosition(function (pos) {
      var ll = [pos.coords.longitude, pos.coords.latitude];
      if (!meMarker) {
        var d = document.createElement('div'); d.className = 'lm-me'; d.title = 'You are here';
        meMarker = new maplibregl.Marker({ element: d }).setLngLat(ll).addTo(map);
      } else meMarker.setLngLat(ll);
    }, function () { /* no permission or no fix: map still works */ }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  }

  function close() {
    if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    meMarker = null;
    if (map) { map.remove(); map = null; }
  }

  window.TripLiveMap = { open: open, close: close };
})();
