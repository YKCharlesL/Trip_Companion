/* Trip Builder - turning the project into the parents' app: data, checks, size, icons, export. */
window.TripExporter = (function () {
  'use strict';
  var R = window.TripRender;
  var esc = R.esc;
  var LIMIT = 50 * 1048576;
  var APP_BASE_BYTES = 150 * 1024;          // html, css, js, fonts, icons
  var LIVEMAP_ENGINE_BYTES = 3.4 * 1048576; // maplibre + pmtiles.js + styles + glyphs + sprites
  var ENTRY_KEYS = ['id', 'title', 'localName', 'details', 'date', 'time', 'endDate', 'endTime', 'tz', 'address', 'lat', 'lng', 'phone', 'ref', 'notes', 'role', 'help'];

  // mode 'preview': asset paths are file ids (served by the builder); 'export': docs/… and maps/… paths.
  function buildAppTrip(P, mode) {
    var s = P.settings, exp = mode === 'export';
    var assets = {}, assetFiles = [];
    var docPath = function (fid) { return exp ? 'docs/' + fid : fid; };
    var sections = R.SECTION_ORDER.map(function (key) {
      return {
        key: key,
        entries: P.sections[key].map(function (e) {
          var o = {};
          ENTRY_KEYS.forEach(function (k) { if (e[k] !== undefined && e[k] !== '' && e[k] !== null) o[k] = e[k]; });
          if (typeof o.lat === 'string') o.lat = parseFloat(o.lat);
          if (typeof o.lng === 'string') o.lng = parseFloat(o.lng);
          if (!o.title) o.title = 'Untitled';
          o.files = (e.files || []).filter(function (fid) { return P.files[fid]; });
          o.files.forEach(function (fid) {
            if (assets[fid]) return;
            var m = P.files[fid];
            var a = { name: m.name, label: m.label || m.name, type: m.type };
            // PDFs are shown from their page pictures; the original PDF file is not shipped
            if (m.type !== 'pdf') { a.src = docPath(fid); assetFiles.push({ fileId: fid, path: 'docs/' + fid }); }
            if (m.type === 'pdf') {
              a.pages = (m.pages || []).map(docPath);
              a.pageSizes = m.pageSizes || [];
              (m.pages || []).forEach(function (pid) { assetFiles.push({ fileId: pid, path: 'docs/' + pid }); });
            } else { a.w = m.w; a.h = m.h; }
            assets[fid] = a;
          });
          return o;
        })
      };
    });
    var maps = (P.maps.list || []).map(function (m) {
      assetFiles.push({ fileId: m.fileId, path: 'maps/' + m.key + '.jpg' });
      return { key: m.key, title: m.title, subtitle: m.subtitle, date: m.date, src: exp ? 'maps/' + m.key + '.jpg' : m.fileId, w: m.w, h: m.h, legend: m.legend };
    });
    var trip = {
      settings: {
        tripName: s.tripName || 'Our trip', destination: s.destination || '', langName: s.langName || '', speechLang: s.speechLang || 'en-GB',
        timeZone: s.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone, emergencyNumber: s.emergencyNumber || '112',
        myName: s.myName || '', myPhone: s.myPhone || '', color: (s.icon && s.icon.color) || R.DEFAULT_BRAND,
        phraseTemplates: s.phraseTemplates || {}
      },
      sections: sections,
      phrases: (P.phrases || []).filter(function (p) { return p.local; }).map(function (p) { return { id: p.id, en: p.en, local: p.local, hint: p.hint || '' }; }),
      assets: assets,
      maps: maps,
      interactive: s.interactiveMap && s.mapArea.file ? { pmtiles: 'map/area.pmtiles', bbox: s.mapArea.bbox, lang: (s.speechLang || 'en').split('-')[0] } : null,
      builtAt: new Date().toISOString()
    };
    return { trip: trip, assetFiles: assetFiles };
  }

  function mapSignature(P) {
    var parts = [P.settings.mapArea.v || P.settings.mapArea.size, P.settings.icon.color, P.settings.speechLang, P.settings.tripName];
    R.SECTION_ORDER.forEach(function (k) {
      P.sections[k].forEach(function (e) { if (R.hasPin(e)) parts.push([k, e.id, e.title, e.lat, e.lng, e.date, e.time, e.endDate, e.role].join('|')); });
    });
    var str = parts.join('#'), h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return String(h);
  }
  function mapsStale(P) { return P.settings.mapArea.file && P.maps.signature !== mapSignature(P); }

  function sizes(P) {
    var docs = 0, pages = 0, seen = {};
    R.SECTION_ORDER.forEach(function (k) {
      P.sections[k].forEach(function (e) {
        (e.files || []).forEach(function (fid) {
          var m = P.files[fid]; if (!m || seen[fid]) return; seen[fid] = 1;
          if (m.type !== 'pdf') docs += m.size || 0;
          pages += m.pagesBytes || 0;
        });
      });
    });
    var maps = (P.maps.list || []).reduce(function (a, m) { return a + (m.bytes || 450 * 1024); }, 0);
    if (!P.maps.list.length && P.settings.mapArea.file) maps = 450 * 1024 * (1 + R.planDays(buildAppTrip(P, 'preview').trip).length);
    var live = P.settings.interactiveMap && P.settings.mapArea.file ? (P.settings.mapArea.size || 0) + LIVEMAP_ENGINE_BYTES : 0;
    var total = APP_BASE_BYTES + docs + pages + maps + live;
    return { docs: docs, pages: pages, maps: maps, live: live, base: APP_BASE_BYTES, total: total,
      single: Math.round((APP_BASE_BYTES + docs + pages + maps) * 1.37) };
  }

  // ------------------------------------------------------------------ checks
  function validate(P) {
    var out = [], s = P.settings;
    var add = function (level, msg, pg) { out.push({ level: level, msg: msg, page: pg }); };
    if (!s.tripName) add('warn', 'The trip has no name.', 'settings');
    if (!s.emergencyNumber) add('error', 'No local emergency number (it is the big red button).', 'settings');
    if (!s.myPhone) add('warn', 'Your phone number is missing (the “Call me” button will not appear).', 'settings');
    if (!s.speechLang) add('warn', 'No speech code: the Play button will use English.', 'settings');
    if (!s.timeZone) add('warn', 'No time zone: countdown and reminders may be off by some hours.', 'settings');
    else { try { new Intl.DateTimeFormat('en', { timeZone: s.timeZone }); } catch (e) { add('error', 'Time zone “' + s.timeZone + '” is not valid (use e.g. Europe/Lisbon).', 'settings'); } }
    var total = 0;
    var bbox = s.mapArea.bbox;
    R.SECTION_ORDER.forEach(function (k) {
      var meta = R.SECTION_META[k];
      P.sections[k].forEach(function (e) {
        total++;
        var name = '“' + (e.title || 'untitled') + '” (' + meta.title + ')';
        if (!e.title) add('warn', 'An entry in ' + meta.title + ' has no title.', 'section:' + k);
        if (['accommodation', 'tours', 'restaurants', 'sightseeing'].indexOf(k) >= 0 && !e.address) add('warn', name + ' has no address.', 'section:' + k);
        if (e.address && !R.hasPin(e)) add('warn', name + ' has an address but no map pin, so it will not be on the maps.', 'section:' + k);
        if (R.hasPin(e) && bbox && (e.lng < bbox[0] || e.lng > bbox[2] || e.lat < bbox[1] || e.lat > bbox[3])) add('warn', name + ' is outside the downloaded map area; its map will show a blank background there.', 'maps');
        if (e.time && !e.date) add('warn', name + ' has a time but no date, so it is not in the plan or countdown.', 'section:' + k);
        if (e.endDate && e.date && e.endDate < e.date) add('error', name + ' ends before it starts.', 'section:' + k);
        if (e.phone && !/^[+\d][\d\s().-]{4,}$/.test(e.phone.trim())) add('warn', name + ': phone number “' + e.phone + '” looks unusual. Include the country code, e.g. +351…', 'section:' + k);
        (e.files || []).forEach(function (fid) {
          var m = P.files[fid];
          if (!m) add('error', name + ' refers to a missing file.', 'section:' + k);
          else if (m.type === 'pdf' && !(m.pages && m.pages.length)) add('warn', name + ': PDF “' + m.name + '” has no page previews yet (wait a moment).', 'section:' + k);
          else if (m.truncated) add('warn', name + ': only the first 30 pages of “' + m.name + '” are shown as pictures; the full PDF is included.', 'section:' + k);
        });
      });
    });
    if (!total) add('error', 'The trip has no entries yet.', 'section:accommodation');
    var contacts = P.sections.contacts;
    if (!contacts.some(function (e) { return e.role === 'hospital'; })) add('warn', 'No hospital on the Help screen (a contact with role “Hospital”).', 'help');
    contacts.filter(R.onHelpScreen).forEach(function (e) {
      if (!e.phone) add(e.role === 'emergency' ? 'error' : 'warn', 'Help card “' + (e.title || 'untitled') + '” has no phone number.', 'help');
    });
    if (!contacts.some(function (e) { return e.role === 'insurance'; })) add('warn', 'No travel insurance on the Help screen (a contact with role “Travel insurance”).', 'help');
    var untranslated = P.phrases.filter(function (p) { return !p.local; }).length;
    if (!P.phrases.length) add('warn', 'No phrases on the Say it screen.', 'phrases');
    else if (untranslated) add('warn', untranslated + ' phrase' + (untranslated > 1 ? 's have' : ' has') + ' no translation and will be left out.', 'phrases');
    if (!s.langName && !s.speechLang) add('warn', 'No language chosen for the Say it screen.', 'phrases');
    if (!(s.phraseTemplates || {}).takeMeTo) add('warn', '“Please take me to…” is not translated: taxi cards will show it in English and speak only the address.', 'phrases');
    if (!s.mapArea.file) add('warn', 'No map area downloaded, so the app will have no picture maps (the address list still works).', 'maps');
    else if (mapsStale(P) || !P.maps.list.length) add('info', 'The maps will be drawn again during export (pins or dates changed).', 'maps');
    var sz = sizes(P);
    if (sz.total > LIMIT) add('warn', 'The app will be about ' + mb(sz.total) + ', more than the 50 MB target. Remove large files or the moving map.', 'export');
    if (s.interactiveMap && s.mapArea.file) add('info', 'The moving map adds ' + mb(sz.live) + ' to the download.', 'maps');
    return out;
  }
  function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }

  // ------------------------------------------------------------------ icons
  function drawIcon(P, size, maskable) {
    var ic = P.settings.icon, c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    var pal = R.palette(ic.color);
    g.fillStyle = pal.brand; g.fillRect(0, 0, size, size);
    var done = function () { return c.toDataURL('image/png'); };
    var text = ic.text || '✈';
    var fs = (text.length > 2 ? 0.34 : text.length === 2 ? 0.42 : 0.55) * size * (maskable ? 0.8 : 1);
    g.fillStyle = pal.onBrand; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 ' + fs + 'px "Atkinson Hyperlegible", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    g.fillText(text, size / 2, size / 2 + fs * 0.05);
    return Promise.resolve(done());
  }
  function makeIcons(P) {
    return Promise.all([drawIcon(P, 192), drawIcon(P, 512), drawIcon(P, 512, true), drawIcon(P, 180)]).then(function (x) {
      return { 'icon-192.png': x[0], 'icon-512.png': x[1], 'icon-maskable-512.png': x[2], 'apple-touch-icon.png': x[3] };
    });
  }

  // ------------------------------------------------------------------ export page
  function renderExportPage(P, el, ctx) {
    var checks = validate(P), sz = sizes(P);
    var errors = checks.filter(function (c) { return c.level === 'error'; });
    var h = '<h2>📦 Export trip app</h2><p class="lead">Checks your trip, draws the maps and builds the app folder, a .zip and a single-file backup.</p>';
    h += '<div class="panel"><h3>Checks</h3><ul class="checks">';
    if (!checks.length) h += '<li class="ok">✓ Everything looks good.</li>';
    checks.forEach(function (c) {
      h += '<li class="' + (c.level === 'info' ? 'ok' : c.level) + '">' + (c.level === 'error' ? '✖' : c.level === 'warn' ? '⚠' : 'ℹ') + ' <span>' + esc(c.msg) + '</span>' +
        (c.page && c.page !== 'export' ? '<a href="#" data-page="' + c.page + '">Fix</a>' : '') + '</li>';
    });
    h += '</ul></div>';
    h += '<div class="panel"><h3>Estimated size</h3><table class="sizes">' +
      '<tr><td>Photos and images</td><td>' + mb(sz.docs) + '</td></tr><tr><td>PDF page pictures</td><td>' + mb(sz.pages) + '</td></tr>' +
      '<tr><td>Picture maps</td><td>' + mb(sz.maps) + '</td></tr>' + (sz.live ? '<tr><td>Moving map</td><td>' + mb(sz.live) + '</td></tr>' : '') +
      '<tr><td>App itself</td><td>' + mb(sz.base) + '</td></tr><tr class="total"><td>Total (hosted app)</td><td>' + mb(sz.total) + '</td></tr>' +
      '<tr><td>Single-file backup</td><td>' + mb(sz.single) + '</td></tr></table>' +
      (sz.total > LIMIT ? '<p class="checks"><span class="warn">⚠ Over the 50 MB target. It will still work, but the first download on the phone takes longer.</span></p>' : '<p class="muted small">Target: under 50 MB.</p>') + '</div>';
    h += '<div class="panel"><div class="row"><button class="primary big" id="do-export"' + (errors.length ? ' data-has-errors="1"' : '') + '>Export trip app</button>' +
      (errors.length ? '<span class="muted">Fix the ✖ items first, or export anyway.</span>' : '') + '</div><div class="progress" id="export-progress" hidden><div></div></div><p id="export-msg" class="muted"></p></div><div id="export-result"></div>';
    el.innerHTML = h;
    el.querySelector('#do-export').addEventListener('click', function (ev) {
      if (ev.currentTarget.getAttribute('data-has-errors') && !confirm('There are problems marked ✖. Export anyway?')) return;
      if (sz.total > LIMIT && !confirm('The app will be about ' + mb(sz.total) + ' (more than 50 MB). Continue?')) return;
      if (sz.live && !confirm('The moving map is switched on. It adds ' + mb(sz.live) + ' (total about ' + mb(sz.total) + '). Continue?')) return;
      doExport(P, ctx, ev.currentTarget);
    });
  }

  function doExport(P, ctx, btn) {
    var msg = document.getElementById('export-msg'), prog = document.getElementById('export-progress');
    var setP = function (f, t) { prog.hidden = false; prog.firstChild.style.width = Math.round(f * 100) + '%'; msg.textContent = t; };
    btn.disabled = true;
    var busy = ctx.mapsBusy();
    if (busy) setP(0.05, 'Waiting for the maps being drawn…');
    var step = busy ? busy.then(function () { return ctx.saveNow(); }) : Promise.resolve();
    if (P.settings.mapArea.file && (mapsStale(P) || !P.maps.list.length)) {
      step = step.then(function () {
        setP(0.05, 'Drawing maps…');
        return ctx.renderMaps().then(function () { return ctx.saveNow(); });
      });
    }
    return step.then(function () {
      setP(0.55, 'Making icons…');
      return Promise.all([makeIcons(P), ctx.saveNow()]);
    }).then(function (x) {
      setP(0.65, 'Building the app (copying documents, writing the offline cache list, zipping)…');
      var built = buildAppTrip(P, 'export');
      var staticTrip = JSON.parse(JSON.stringify(built.trip));
      staticTrip._assetBase = '';
      return ctx.api.send('POST', '/api/projects/' + P.id + '/export', {
        trip: built.trip, assetFiles: built.assetFiles, icons: x[0], interactive: !!built.trip.interactive,
        staticHtml: R.staticDocumentHtml(staticTrip), siteUrl: P.settings.siteUrl || ''
      });
    }).then(function (r) {
      setP(1, 'Done.');
      showResult(P, r, ctx);
    }).catch(function (e) {
      msg.textContent = '⚠ Export failed: ' + e.message;
    }).then(function () { btn.disabled = false; });
  }

  function showResult(P, r, ctx) {
    var el = document.getElementById('export-result');
    var h = '<div class="panel result"><h3>✓ Exported (version ' + esc(r.version) + ')</h3>';
    r.warnings.forEach(function (w) { h += '<p>⚠ ' + esc(w) + '</p>'; });
    h += '<table class="sizes"><tr><td>App folder (' + r.files + ' files)</td><td>' + mb(r.siteBytes) + '</td></tr><tr><td>Zip</td><td>' + mb(r.zipBytes) + '</td></tr><tr><td>Single-file backup</td><td>' + mb(r.singleBytes) + '</td></tr></table>' +
      '<p><b>Folder to upload:</b> <code>' + esc(r.site) + '</code></p>' +
      '<p><b>Zip:</b> <code>' + esc(r.zip) + '</code><br><b>Single file:</b> <code>' + esc(r.single) + '</code><br><b>How-to sheet for your parents:</b> <code>' + esc(r.howto) + '</code></p>' +
      '<div class="row"><button data-open-folder="' + esc(r.folder) + '">Open export folder</button>' +
      '<a class="btn-like" href="' + esc(r.urls.site) + '" target="_blank">Try the app here ↗</a>' +
      '<a class="btn-like" href="' + esc(r.urls.single) + '" target="_blank">Try the single file ↗</a>' +
      '<a class="btn-like" href="' + esc(r.urls.howto) + '" target="_blank">How-to sheet (print) ↗</a></div>' +
      '<h3 style="margin-top:16px">Next: put it online</h3><ol>' +
      '<li><b>Netlify</b> (easiest): log in at <a href="https://app.netlify.com/drop" target="_blank">app.netlify.com/drop</a> (free account) and drag the <code>site</code> folder onto the page. <b>To update later:</b> open the same site → <i>Deploys</i> → drag the new <code>site</code> folder there. The link stays the same.</li>' +
      '<li><b>GitHub Pages</b>: see README.md, section “Host it for free”.</li>' +
      '<li>Send your parents the link and the how-to sheet. They open it once on Wi-Fi, tap “Add to Home Screen”, then open it from the home screen once more until it says “Ready for offline”.</li></ol>' +
      '<p class="muted small">Re-exporting replaces the folder. When your parents next open the app with internet, it updates itself and says “Your trip was updated”.</p></div>';
    el.innerHTML = h;
    el.querySelector('[data-open-folder]').addEventListener('click', function (ev) {
      ctx.api.get('/api/open-folder?path=' + encodeURIComponent(ev.currentTarget.getAttribute('data-open-folder'))).then(function (x) {
        if (!x.ok) ctx.toast('Could not open the folder. Path: ' + r.folder, 5000);
      });
    });
    el.scrollIntoView({ behavior: 'smooth' });
  }

  return { buildAppTrip: buildAppTrip, validate: validate, sizes: sizes, mapSignature: mapSignature, mapsStale: mapsStale, renderExportPage: renderExportPage, makeIcons: makeIcons };
})();
