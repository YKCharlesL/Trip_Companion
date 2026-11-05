/* Trip Builder - editor UI. Project state lives in P and is autosaved to the local server. */
(function () {
  'use strict';
  var R = window.TripRender, D = window.BuilderDefaults;
  var P = null;
  var page = 'settings';
  var openEntryId = null;
  var saveTimer = null, previewTimer = null, previewReady = false;
  var pdfjsPromise = null;

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = R.esc;
  var uid = function (p) { return (p || 'e') + Math.random().toString(36).slice(2, 10); };

  var FIELDS = {
    // which entry fields each section shows, and custom labels
    accommodation: { labels: { date: 'Check-in date', time: 'Check-in time', endDate: 'Check-out date', endTime: 'Check-out time' }, loc: true, end: true },
    tours: { labels: { time: 'Start / pickup time', address: 'Pickup or meeting point address' }, loc: true, end: true },
    travel: { labels: { date: 'Departure date', time: 'Departure time', endDate: 'Arrival date', endTime: 'Arrival time', address: 'Address (airport, station, pickup point)' }, loc: true, end: true, tz: true },
    restaurants: { labels: { time: 'Reservation time' }, loc: true },
    sightseeing: { labels: { time: 'Time (if booked)' }, loc: true, end: true },
    documents: { labels: { ref: 'Document / policy number' }, loc: false, nodate: true },
    tips: { loc: false, nodate: true, noref: true, nophone: true },
    contacts: { loc: true, role: true, nodate: true }
  };
  var LOCATION_SECTIONS = ['accommodation', 'tours', 'restaurants', 'sightseeing'];

  // ------------------------------------------------------------------ API
  var api = {
    get: function (u) { return fetch(u, { cache: 'no-store' }).then(checkJson); },
    send: function (method, u, data) {
      return fetch(u, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(checkJson);
    },
    upload: function (blob, name) {
      return fetch('/api/projects/' + P.id + '/files?name=' + encodeURIComponent(name), { method: 'POST', body: blob }).then(checkJson);
    }
  };
  function checkJson(r) {
    return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.statusText); return j; });
  }
  window.BuilderAPI = api;

  // ------------------------------------------------------------------ init / projects
  function init() {
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    window.addEventListener('message', function (ev) {
      if (ev.data && ev.data.type === 'preview-ready') { previewReady = true; pushPreview(); }
    });
    $('#preview').addEventListener('load', function () { previewReady = true; pushPreview(); });
    $('#import-input').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      status('Opening project file…');
      fetch('/api/import', { method: 'POST', body: f }).then(checkJson).then(function (p) { loadProject(p.id); toast('Project opened'); })
        .catch(function (err) { alert(err.message); });
      e.target.value = '';
    });
    $('#project-select').addEventListener('change', function (e) { if (e.target.value) loadProject(e.target.value); });
    refreshProjectList().then(function (list) {
      var last = localStorage.getItem('tb-last');
      // Re-open the trip you worked on last in this browser; otherwise ask, so you never
      // type into a trip (e.g. the Lisbon demo) without noticing.
      var pick = list.filter(function (p) { return p.id === last; })[0];
      if (pick) loadProject(pick.id); else showWelcome(list);
    });
  }
  function refreshProjectList() {
    return api.get('/api/projects').then(function (list) {
      var sel = $('#project-select');
      sel.innerHTML = list.length ? list.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (P && P.id === p.id ? ' selected' : '') + '>' + esc(p.tripName) + '</option>';
      }).join('') : '<option value="">(no trips yet)</option>';
      return list;
    });
  }
  function showWelcome(list) {
    P = null;
    $('#sidebar').innerHTML = '';
    var sel = $('#project-select');
    sel.insertAdjacentHTML('afterbegin', '<option value="" selected>Choose a trip…</option>');
    $('#main').innerHTML = '<div class="welcome"><h2>Welcome to the Trip Builder</h2>' +
      '<p class="lead">Build a simple offline travel app for your parents. Start a new trip, or look at the sample trip first to see how it works.</p>' +
      '<div class="row"><button class="primary" data-cmd="new">Start a new trip</button><button data-cmd="sample">Load the sample trip (Lisbon)</button></div>' +
      (list && list.length ? '<h3 style="margin-top:22px">Or open an existing trip</h3><div class="row">' + list.map(function (p) {
        return '<button data-open="' + esc(p.id) + '">' + esc(p.tripName) + '</button>';
      }).join('') + '</div>' : '') + '</div>';
  }
  function createProject(template) {
    var name = template === 'blank' ? prompt('Name of the trip (for example “Lisbon with Mum and Dad”):', 'Our trip') : null;
    if (template === 'blank' && name === null) return;
    status('Creating…');
    api.send('POST', '/api/projects', { template: template, name: name }).then(function (p) { loadProject(p.id); });
  }
  function loadProject(id) {
    return api.get('/api/projects/' + id).then(function (p) {
      P = migrate(p);
      P.id = id;
      localStorage.setItem('tb-last', id);
      openEntryId = null;
      MapRender.reset();
      refreshProjectList();
      page = 'settings';
      renderAll();
      status('Saved ✓');
      ensurePdfPages();
    });
  }
  function migrate(p) {
    p.settings = p.settings || {};
    var s = p.settings;
    s.icon = s.icon || { text: '✈', color: R.DEFAULT_BRAND };
    delete s.icon.fileId; // picture icons are no longer offered
    s.phraseTemplates = s.phraseTemplates || { takeMeTo: '', whereIs: '' };
    s.mapArea = s.mapArea || { bbox: null, maxzoom: 15, file: null, size: 0, auto: true };
    p.sections = p.sections || {};
    R.SECTION_ORDER.forEach(function (k) { p.sections[k] = p.sections[k] || []; });
    p.phrases = p.phrases || [];
    p.files = p.files || {};
    p.maps = p.maps || { list: [], signature: null };
    return p;
  }

  // ------------------------------------------------------------------ saving & preview
  function changed(opts) {
    opts = opts || {};
    status('Saving…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 600);
    clearTimeout(previewTimer);
    previewTimer = setTimeout(pushPreview, 350);
    if (!opts.noSidebar) renderSidebar();
  }
  function saveNow() {
    clearTimeout(saveTimer);
    return api.send('PUT', '/api/projects/' + P.id, P).then(function () {
      status('Saved ✓ ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    }).catch(function (e) { status('⚠ Not saved: ' + e.message); });
  }
  window.addEventListener('beforeunload', function () { if (saveTimer) saveNow(); });
  function status(t) { $('#save-status').textContent = t; }
  function toast(t, ms) {
    var el = $('#toast'); el.textContent = t; el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove('show'); }, ms || 2500);
  }
  function pushPreview() {
    if (!P) return; // if the preview is not listening yet, it asks again with 'preview-ready'
    var built = TripExporter.buildAppTrip(P, 'preview');
    $('#preview').contentWindow.postMessage({ type: 'trip', trip: built.trip, assetBase: '/api/projects/' + P.id + '/files/' }, '*');
  }
  function previewGo(hash) {
    try { $('#preview').contentWindow.location.hash = hash; } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ layout
  function renderAll() { renderSidebar(); renderPage(); pushPreview(); }
  function renderSidebar() {
    if (!P) return;
    var h = '<h6>Trip</h6>' + navItem('settings', '⚙️ Trip settings') + navItem('help', '🆘 Help screen', P.sections.contacts.filter(R.onHelpScreen).length);
    h += '<h6>Sections</h6>';
    R.SECTION_ORDER.forEach(function (k) {
      var list = P.sections[k], meta = R.SECTION_META[k];
      var missing = list.filter(function (e) { return needsPin(k, e); }).length;
      h += navItem('section:' + k, meta.icon + ' ' + meta.title, list.length, missing);
    });
    h += '<h6>Extras</h6>' + navItem('phrases', '💬 Say it (phrases)', P.phrases.length) + navItem('maps', '🗺️ Maps', P.maps.list.length);
    h += '<h6>Finish</h6>' + navItem('export', '📦 Export trip app');
    $('#sidebar').innerHTML = h;
  }
  function navItem(key, label, count, warn) {
    return '<a href="#" data-page="' + key + '" class="' + (page === key ? 'active' : '') + '"><span>' + label + '</span>' +
      (count != null ? '<span class="count' + (warn ? ' warn' : '') + '" title="' + (warn ? warn + ' without map pin' : '') + '">' + count + '</span>' : '') + '</a>';
  }
  function renderPage() {
    MapRender.destroyPinEditor();
    var m = $('#main');
    var keepScroll = m.scrollTop;
    if (page === 'settings') m.innerHTML = settingsHtml();
    else if (page.indexOf('section:') === 0) m.innerHTML = sectionPageHtml(page.slice(8));
    else if (page === 'phrases') m.innerHTML = phrasesHtml();
    else if (page === 'help') m.innerHTML = helpPageHtml();
    else if (page === 'maps') { m.innerHTML = mapsPageHtml(); }
    else if (page === 'export') { m.innerHTML = '<h2>Export trip app</h2><p class="lead">Checking your trip…</p>'; TripExporter.renderExportPage(P, m, ctx()); }
    if ((page.indexOf('section:') === 0 || page === 'help') && openEntryId) mountPinEditor();
    if (page === 'phrases') showTranslateStatus();
    if (page !== lastPage) m.scrollTop = 0; else m.scrollTop = keepScroll; // redraws keep your place
    lastPage = page;
  }
  var lastPage = null;
  function go(p) {
    page = p; openEntryId = null; renderSidebar(); renderPage();
    if (p.indexOf('section:') === 0) previewGo('#/section/' + p.slice(8));
    else if (p === 'phrases') previewGo('#/say');
    else if (p === 'maps') previewGo('#/map');
    else if (p === 'settings') previewGo('#/home');
    else if (p === 'help') previewGo('#/help');
  }

  // ------------------------------------------------------------------ settings page
  function settingsHtml() {
    var s = P.settings;
    var tzs = [];
    try { tzs = Intl.supportedValuesOf('timeZone'); } catch (e) { tzs = ['Europe/Lisbon', 'Europe/Madrid', 'Europe/Paris', 'Europe/Rome', 'Europe/Berlin', 'Europe/London', 'Europe/Stockholm']; }
    return '<h2>Trip settings</h2><p class="lead">The basics. Everything saves automatically.</p>' +
      '<div class="panel"><h3>Trip</h3><div class="grid2">' +
      fieldS('tripName', 'Trip name (shown at the top of the app)') + fieldS('shortName', 'Home-screen name (max 12 letters)', 'maxlength="12"') +
      fieldS('destination', 'Destination (e.g. Lisbon, Portugal)') +
      '<label class="f">Time zone at the destination<input type="text" list="tzlist" data-s="timeZone" placeholder="e.g. Europe/Oslo" value="' + esc(s.timeZone) + '"><datalist id="tzlist">' +
      tzs.map(function (t) { return '<option value="' + t + '">'; }).join('') + '</datalist></label>' +
      '</div></div>' +
      '<div class="panel"><h3>Language</h3><p>' + (s.langName || s.speechLang ? 'Phrases are in <b>' + esc(s.langName || s.speechLang) + '</b> (' + esc(s.speechLang || 'no speech code') + ').' : 'No language chosen yet.') +
      ' Choose the language and the phrases on the <a href="#" data-page="phrases">Say it</a> page.</p></div>' +
      '<div class="panel"><h3>Help numbers</h3><p>Emergency number ' + esc(s.emergencyNumber || '(not set)') + ', your phone ' + esc(s.myPhone || '(not set)') +
      '. Set these and the Help cards on the <a href="#" data-page="help">Help screen</a> page.</p></div>' +
      '<div class="panel"><h3>Home-screen icon</h3><div class="row">' +
      '<div class="icon-preview" id="icon-preview" style="background:' + esc(s.icon.color) + '">' + iconInner() + '</div>' +
      '<label class="f" style="width:140px">Emoji or letters<input type="text" maxlength="3" data-icon="text" value="' + esc(s.icon.text || '') + '"></label>' +
      '<label class="f" style="width:110px">Colour<input type="color" data-icon="color" value="' + esc(s.icon.color) + '" style="height:34px;padding:2px"></label>' +
      '</div>' +
      '<p class="muted small">The colour is also used for the app’s header.</p></div>' +
      '<div class="panel"><h3>After hosting (optional)</h3>' + fieldS('siteUrl', 'The web address of the hosted app (printed on the parents’ how-to sheet)', 'type="url" placeholder="https://our-lisbon-trip.netlify.app"') + '</div>';
  }
  function fieldS(key, label, extra) {
    return '<label class="f">' + label + '<input type="text" data-s="' + key + '" value="' + esc(P.settings[key] || '') + '" ' + (extra || '') + '></label>';
  }
  function fieldT(key, label) {
    return '<label class="f">' + label + '<input type="text" data-tpl="' + key + '" lang="' + esc(P.settings.speechLang || '') + '" placeholder="' + esc(D.TEMPLATE_HINTS[key]) + ' (in ' + esc(P.settings.langName || 'the local language') + ')" value="' + esc(P.settings.phraseTemplates[key] || '') + '"></label>';
  }
  function iconInner() {
    var i = P.settings.icon;
    return esc(i.text || '✈');
  }

  // ------------------------------------------------------------------ help screen page
  function helpPageHtml() {
    var contacts = P.sections.contacts;
    var cards = R.helpCards({ sections: [{ key: 'contacts', entries: contacts }] });
    var rest = contacts.filter(function (e) { return !R.onHelpScreen(e); });
    var h = '<h2>🆘 Help screen</h2><p class="lead">What your parents see under Help, from top to bottom. Help cards are contacts: they also appear under Contacts.</p>';
    h += '<div class="panel"><h3>1 · Big buttons at the top</h3><div class="grid3">' +
      fieldS('emergencyNumber', 'Local emergency number (big red button)', 'inputmode="tel"') + fieldS('myName', 'Your name (green “Call” button)') +
      fieldS('myPhone', 'Your phone number, with country code', 'inputmode="tel" placeholder="+46 70 123 45 67"') + '</div></div>';
    h += '<div class="panel"><h3>2 · Help cards (' + cards.length + ')</h3><p class="muted small"><b>Emergency services</b> (ski patrol, mountain rescue, coast guard…) come first, with a red call button. ' +
      'The other cards (hospital, embassy, insurance, pharmacy, anything else) follow in the order of Contacts: use ↑ ↓ to change it.</p><div id="entries">';
    cards.forEach(function (e) { h += entryCardHtml('contacts', e); });
    h += '</div><div class="row"><button class="add-entry" data-cmd="add-entry" data-section="contacts" data-help-role="emergency">+ Add emergency service (e.g. ski patrol)</button>' +
      '<button class="add-entry" data-cmd="add-entry" data-section="contacts" data-help-role="other">+ Add other Help card</button></div></div>';
    if (rest.length) h += '<div class="panel"><h3>Contacts not on the Help screen</h3>' + rest.map(function (e) {
      return '<div class="row" style="margin-bottom:6px"><span>' + esc(e.title || '(untitled)') + '</span><button data-cmd="help-on" data-id="' + e.id + '">Show on Help screen</button></div>';
    }).join('') + '</div>';
    return h;
  }

  // ------------------------------------------------------------------ section page / entries
  function sectionPageHtml(key) {
    var meta = R.SECTION_META[key], list = P.sections[key];
    var intro = {
      accommodation: 'Hotels and apartments. Add check-in and check-out so they appear in the day-by-day plan.',
      tours: 'Booked tours. The address is the pickup or meeting point.',
      travel: 'Flights, trains, transfers. If a time is in another time zone (e.g. departure from home), set it under “Time zone”.',
      restaurants: 'Reservations and good places to eat.',
      sightseeing: 'Places to visit.',
      documents: 'Passport copies, insurance, tickets. Drop the files onto the entry.',
      tips: 'Short practical tips.',
      contacts: 'Hospital, embassy, insurance, local helpers. Choose the role so they show on the Help screen.'
    }[key];
    var h = '<h2>' + meta.icon + ' ' + esc(meta.title) + '</h2><p class="lead">' + intro + ' Drag ⠿ to reorder. Drop files onto any entry.</p><div id="entries">';
    list.forEach(function (e) { h += entryCardHtml(key, e); });
    h += '</div><button class="add-entry" data-cmd="add-entry" data-section="' + key + '">+ Add ' + esc(meta.title.toLowerCase()) + ' entry</button>';
    return h;
  }
  function needsPin(key, e) { return (e.address || LOCATION_SECTIONS.indexOf(key) >= 0) && !R.hasPin(e) && FIELDS[key].loc; }
  function entryCardHtml(key, e) {
    var open = openEntryId === e.id;
    var sub = [e.date ? R.fmtDate(e.date, { weekday: 'short', month: 'short' }) : '', e.time || ''].filter(Boolean).join(' ');
    var pinBadge = FIELDS[key].loc ? (R.hasPin(e) ? '<span class="badge ok">📍 pin</span>' : (e.address || LOCATION_SECTIONS.indexOf(key) >= 0 ? '<span class="badge warn">no pin</span>' : '')) : '';
    var files = ((e.files || []).length ? '<span class="badge">📎 ' + e.files.length + '</span>' : '') +
      (key === 'contacts' && R.onHelpScreen(e) ? '<span class="badge ' + (e.role === 'emergency' ? 'warn' : 'ok') + '">🆘 Help</span>' : '');
    var h = '<div class="entry-card" data-id="' + e.id + '" data-section="' + key + '">' +
      '<div class="entry-head" draggable="true" data-toggle="' + e.id + '"><span class="handle" title="Drag to reorder">⠿</span>' +
      '<span class="t">' + esc(e.title || '(untitled)') + '</span><span class="sub">' + esc(sub) + '</span>' + pinBadge + files +
      '<button data-cmd="move" data-dir="-1" title="Move up">↑</button><button data-cmd="move" data-dir="1" title="Move down">↓</button>' +
      '<button data-cmd="del-entry" class="danger" title="Delete">🗑</button></div>';
    if (open) h += '<div class="entry-body">' + entryFormHtml(key, e) + '</div>';
    return h + '</div>';
  }
  function entryFormHtml(key, e) {
    var F = FIELDS[key], L = F.labels || {};
    var f = function (name, label, type, extra) {
      return '<label class="f">' + label + '<input type="' + (type || 'text') + '" data-f="' + name + '" value="' + esc(e[name] == null ? '' : e[name]) + '" ' + (extra || '') + '></label>';
    };
    var ta = function (name, label, rows) {
      return '<label class="f">' + label + '<textarea data-f="' + name + '" rows="' + (rows || 2) + '">' + esc(e[name] || '') + '</textarea></label>';
    };
    var h = '<div class="grid2">' + f('title', 'Title') + (F.role ? '<label class="f">Role (for the Help screen)<select data-f="role">' +
      [['other', 'Other contact'], ['emergency', 'Emergency service (ski patrol, mountain rescue…)'], ['hospital', 'Hospital (red pin)'], ['embassy', 'Embassy'], ['insurance', 'Travel insurance'], ['pharmacy', 'Pharmacy']].map(function (o) {
        return '<option value="' + o[0] + '"' + ((e.role || 'other') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>' : (F.loc ? f('localName', 'Name in the local language (optional, for “Where is…?”)') : '<span></span>')) + '</div>';
    h += ta('details', 'Details', 2);
    if (!F.nodate) {
      h += '<div class="grid4">' + f('date', L.date || 'Date', 'date') + f('time', L.time || 'Time', 'time') +
        (F.end ? f('endDate', L.endDate || 'End date', 'date') + f('endTime', L.endTime || 'End time', 'time') : '') + '</div>';
      if (F.tz) h += '<div class="grid2">' + f('tz', 'Time zone of these times (leave empty = destination)', 'text', 'list="tzlist2" placeholder="' + esc(P.settings.timeZone) + '"') + '<span></span></div><datalist id="tzlist2"><option value="Europe/Stockholm"><option value="Europe/London"><option value="Europe/Berlin"><option value="Europe/Helsinki"></datalist>';
    }
    if (F.loc) {
      h += ta('address', L.address || 'Address', 2);
      h += '<div class="pin-box" id="pin-box">' + pinBoxInner(e) + '</div>';
    }
    if (F.role) h += '<label class="check"><input type="checkbox" data-help-check' + (R.onHelpScreen(e) ? ' checked' : '') + '> Show on the Help screen</label>';
    h += '<div class="grid2">' + (F.nophone ? '' : f('phone', key === 'contacts' && e.role === 'insurance' ? 'Claims phone line' : key === 'contacts' && e.role === 'emergency' ? 'Phone (red call button on Help)' : 'Phone', 'tel')) +
      (F.noref ? '' : f('ref', L.ref || (e.role === 'insurance' ? 'Policy number' : 'Booking reference'))) + '</div>';
    h += ta('notes', 'Notes (shown highlighted)', 2);
    h += '<label class="f">Documents (PDF, JPG, PNG)</label>' + filesHtml(e);
    return h;
  }
  function pinBoxInner(e) {
    var has = R.hasPin(e);
    var src = { geocode: 'found from the address', drag: 'placed by you', manual: 'typed by you' }[e.pinSource] || '';
    var h = '<div class="row"><strong>Map pin</strong>' + (has ? '<span class="badge ok">' + e.lat.toFixed(5) + ', ' + e.lng.toFixed(5) + (src ? ' · ' + src : '') + '</span>' : '<span class="badge warn">no pin yet</span>') +
      '<button data-cmd="geocode">🔎 Find address on map</button>' + (has ? '<button data-cmd="clear-pin">Remove pin</button>' : '') +
      (e.address || has ? '<a href="' + esc(R.mapsUrl(e)) + '" target="_blank" rel="noopener" class="small">Google Maps link ↗</a>' : '') + '</div>';
    h += '<ul class="geo-results" id="geo-results"></ul>';
    h += '<div class="grid2" style="margin-top:6px"><label class="f">Latitude<input type="number" step="0.000001" data-coord="lat" value="' + (has ? e.lat : '') + '"></label>' +
      '<label class="f">Longitude<input type="number" step="0.000001" data-coord="lng" value="' + (has ? e.lng : '') + '"></label></div>';
    h += P.settings.mapArea.file && has && !inMapArea(e) ? outsideAreaHtml()
      : P.settings.mapArea.file ? '<div class="pin-map" id="pin-map"></div><p class="muted small">Drag the pin, or click on the map, to correct the position.</p>'
      : '<p class="muted small">To see the pin on a map and drag it, download the map area on the <a href="#" data-page="maps">Maps</a> page first.</p>';
    return h;
  }
  function inMapArea(e) {
    var b = P.settings.mapArea.bbox;
    return !b || !R.hasPin(e) || (e.lng >= b[0] && e.lng <= b[2] && e.lat >= b[1] && e.lat <= b[3]);
  }
  function outsideAreaHtml() {
    var where = P.settings.mapArea.place || P.settings.destination || 'another place';
    return '<div class="pin-outside"><strong>📍 This address is outside the downloaded map area</strong> (around ' + esc(where) + '), so there is no map to show here.' +
      '<ul><li>If this address belongs to a different trip, you are editing the wrong trip (“' + esc(P.settings.tripName) + '”). Use <button data-cmd="new">New trip</button> or pick your trip at the top.</li>' +
      '<li>If it is part of this trip, go to <a href="#" data-page="maps">Maps</a> → <em>Fit area to all pins</em> → <em>Download again</em>.</li></ul></div>';
  }
  function filesHtml(e) {
    var h = '<div class="dropzone" data-dropzone="' + e.id + '">Drop PDF, JPG or PNG files here, or <u>click to choose</u>. Large photos are made smaller automatically.' +
      '<input type="file" multiple accept="application/pdf,image/jpeg,image/png" data-file-input hidden></div><div class="thumbs">';
    (e.files || []).forEach(function (fid) {
      var m = P.files[fid] || { name: fid };
      var thumb = m.type === 'pdf' ? (m.pages && m.pages[0]) : fid;
      h += '<div class="thumb" data-fid="' + fid + '">' +
        (thumb ? '<img src="/api/projects/' + P.id + '/files/' + thumb + '" alt="" data-zoom="' + thumb + '">' : '<div class="ph">PDF<br>preparing…</div>') +
        '<button class="x" data-cmd="del-file" title="Remove">×</button>' +
        '<input type="text" data-file-label value="' + esc(m.label || m.name) + '" title="Name shown in the app">' +
        '<div class="meta">' + (m.type === 'pdf' ? 'PDF · ' + ((m.pages || []).length || '?') + ' p · ' : '') + fmtSize(fileBytes(m)) + (m.compressed ? ' · compressed' : '') + '</div></div>';
    });
    return h + '</div>';
  }
  function fileBytes(m) { return (m.size || 0) + (m.pagesBytes || 0); }
  function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB'; }

  function findEntry(id) {
    var hit = null;
    R.SECTION_ORDER.forEach(function (k) { P.sections[k].forEach(function (e, i) { if (e.id === id) hit = { key: k, entry: e, index: i }; }); });
    return hit;
  }
  function rerenderEntry(id) {
    var f = findEntry(id); if (!f) return;
    var el = document.querySelector('.entry-card[data-id="' + id + '"]');
    if (!el) return;
    MapRender.destroyPinEditor();
    var tmp = document.createElement('div'); tmp.innerHTML = entryCardHtml(f.key, f.entry);
    el.replaceWith(tmp.firstChild);
    if (openEntryId === id) mountPinEditor();
  }
  function refreshEntryHead(id) {
    var f = findEntry(id); if (!f) return;
    var el = document.querySelector('.entry-card[data-id="' + id + '"] .entry-head');
    if (!el) return;
    var tmp = document.createElement('div'); tmp.innerHTML = entryCardHtml(f.key, Object.assign({}, f.entry, { id: '__' }));
    el.innerHTML = tmp.querySelector('.entry-head').innerHTML;
  }
  function refreshPinBox(id) {
    var f = findEntry(id), box = $('#pin-box');
    if (!f || !box) return;
    MapRender.destroyPinEditor();
    box.innerHTML = pinBoxInner(f.entry);
    mountPinEditor();
    refreshEntryHead(id);
  }
  function mountPinEditor() {
    var el = $('#pin-map'), f = findEntry(openEntryId);
    if (!el || !f) return;
    MapRender.pinEditor(el, P, f.entry, function (lat, lng) {
      f.entry.lat = round6(lat); f.entry.lng = round6(lng); f.entry.pinSource = 'drag';
      var box = $('#pin-box');
      box.querySelector('[data-coord=lat]').value = f.entry.lat;
      box.querySelector('[data-coord=lng]').value = f.entry.lng;
      box.querySelector('.badge').outerHTML = '<span class="badge ok">' + f.entry.lat.toFixed(5) + ', ' + f.entry.lng.toFixed(5) + ' · placed by you</span>';
      refreshEntryHead(f.entry.id);
      changed();
    });
  }
  function round6(v) { return Math.round(v * 1e6) / 1e6; }

  function geocodeEntry(e, silent) {
    if (!e.address) { if (!silent) toast('Type an address first.'); return Promise.resolve(); }
    var q = e.address.replace(/\n/g, ', ');
    if (P.settings.destination && q.toLowerCase().indexOf(P.settings.destination.split(',').pop().trim().toLowerCase()) < 0) q += ', ' + P.settings.destination;
    if (!silent) status('Looking up address…');
    return api.get('/api/geocode?q=' + encodeURIComponent(q)).then(function (res) {
      if (!res.length && q !== e.address) return api.get('/api/geocode?q=' + encodeURIComponent(e.address.replace(/\n/g, ', ')));
      return res;
    }).then(function (res) {
      status('Saved ✓');
      if (!res.length) { if (!silent) toast('Address not found. Try a simpler address, or type the coordinates.', 4000); return false; }
      e.lat = res[0].lat; e.lng = res[0].lng; e.pinSource = 'geocode'; e.geocodedFor = e.address;
      changed();
      if (!silent && openEntryId === e.id) {
        refreshPinBox(e.id);
        var ul = $('#geo-results');
        if (ul && res.length > 1) ul.innerHTML = '<li class="muted">Other matches – click to use:</li>' + res.map(function (r, i) {
          return '<li data-georesult="' + i + '" data-lat="' + r.lat + '" data-lng="' + r.lng + '">' + (i === 0 ? '✓ ' : '') + esc(r.label) + '</li>';
        }).join('');
      }
      return true;
    }).catch(function (err) { status(''); if (!silent) toast('Lookup failed: ' + err.message, 4000); });
  }
  function geocodeAllMissing() {
    var todo = [];
    R.SECTION_ORDER.forEach(function (k) { P.sections[k].forEach(function (e) { if (e.address && !R.hasPin(e)) todo.push(e); }); });
    if (!todo.length) { toast('All addresses already have a pin.'); return Promise.resolve(0); }
    var found = 0, i = 0;
    return todo.reduce(function (p, e) {
      return p.then(function () { status('Finding pins ' + (++i) + '/' + todo.length + '…'); return geocodeEntry(e, true).then(function (ok) { if (ok) found++; }); });
    }, Promise.resolve()).then(function () {
      status('Saved ✓'); renderSidebar(); renderPage();
      toast('Found ' + found + ' of ' + todo.length + ' addresses.' + (found < todo.length ? ' Fix the others by hand.' : ''), 4000);
      return found;
    });
  }

  // ------------------------------------------------------------------ files
  function handleFiles(entryId, fileList) {
    var f = findEntry(entryId); if (!f) return;
    var files = Array.prototype.slice.call(fileList);
    var bad = files.filter(function (x) { return !/^(application\/pdf|image\/jpeg|image\/png)$/.test(x.type) && !/\.(pdf|jpe?g|png)$/i.test(x.name); });
    if (bad.length) alert('Only PDF, JPG and PNG files can be added.\nSkipped: ' + bad.map(function (b) { return b.name; }).join(', ') +
      (bad.some(function (b) { return /heic/i.test(b.name); }) ? '\n\nTip: iPhone photos (HEIC) can be exported as JPG first.' : ''));
    files = files.filter(function (x) { return bad.indexOf(x) < 0; });
    return files.reduce(function (p, file, i) {
      return p.then(function () {
        status('Adding ' + file.name + ' (' + (i + 1) + '/' + files.length + ')…');
        return addFile(file).then(function (fid) {
          f.entry.files = f.entry.files || [];
          f.entry.files.push(fid);
          changed();
          if (openEntryId === entryId) rerenderEntry(entryId); else refreshEntryHead(entryId);
        });
      });
    }, Promise.resolve()).then(function () {
      status('Saved ✓');
      var big = files.filter(function (x) { return x.size > 15 * 1048576; });
      if (big.length) toast('Large file added (' + big.map(function (b) { return b.name; }).join(', ') + '). Check the total size on the Export page.', 5000);
    }).catch(function (err) { alert('Could not add file: ' + err.message); status(''); });
  }
  function addFile(file) {
    var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) {
      return api.upload(file, file.name).then(function (r) {
        P.files[r.fileId] = { name: file.name, label: file.name.replace(/\.pdf$/i, ''), type: 'pdf', size: r.size, pages: [] };
        return renderPdfPages(r.fileId, file).then(function () { return r.fileId; });
      });
    }
    return compressImage(file).then(function (out) {
      return api.upload(out.blob, out.name).then(function (r) {
        P.files[r.fileId] = { name: out.name, label: file.name.replace(/\.(jpe?g|png)$/i, ''), type: 'image', size: r.size, w: out.w, h: out.h, compressed: out.compressed };
        return r.fileId;
      });
    });
  }
  // Large photos: longest side 2000 px, JPEG quality 0.85. PNGs (often screenshots of tickets
  // with QR codes) stay PNG so codes stay sharp; they are only resized if larger than 2000 px.
  function compressImage(file) {
    return createImageBitmap(file).then(function (bmp) {
      var w = bmp.width, h = bmp.height, max = 2000;
      var isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
      if ((isPng || file.size <= 600 * 1024) && Math.max(w, h) <= max) return { blob: file, name: file.name, w: w, h: h, compressed: false };
      var k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      var g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (res) { c.toBlob(res, isPng ? 'image/png' : 'image/jpeg', 0.85); }).then(function (blob) {
        if (blob.size >= file.size && k === 1) return { blob: file, name: file.name, w: w, h: h, compressed: false };
        return { blob: blob, name: file.name.replace(/\.(png|jpe?g)$/i, '') + (isPng ? '.png' : '.jpg'), w: c.width, h: c.height, compressed: true };
      });
    });
  }
  function pdfjs() {
    if (!pdfjsPromise) pdfjsPromise = import('/vendor/pdfjs/pdf.min.mjs').then(function (m) {
      m.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'; return m;
    });
    return pdfjsPromise;
  }
  // Each PDF page becomes a sharp JPEG (2000 px wide, about 240 dpi on A4, quality 0.92) so the
  // phone shows it full screen offline and QR codes on tickets can be scanned from the screen.
  var PDF_PAGE_WIDTH = 2000;
  function renderPdfPages(fid, blob) {
    var meta = P.files[fid];
    return Promise.all([pdfjs(), blob ? blob.arrayBuffer() : fetch('/api/projects/' + P.id + '/files/' + fid).then(function (r) { return r.arrayBuffer(); })]).then(function (x) {
      return x[0].getDocument({ data: new Uint8Array(x[1]) }).promise;
    }).then(function (pdf) {
      var n = Math.min(pdf.numPages, 30);
      var pages = [], sizes = [], bytes = 0;
      var chain = Promise.resolve();
      for (var i = 1; i <= n; i++) (function (i) {
        chain = chain.then(function () {
          status('Preparing PDF page ' + i + '/' + n + ' of ' + meta.name + '…');
          return pdf.getPage(i).then(function (pg) {
            var vp0 = pg.getViewport({ scale: 1 });
            var vp = pg.getViewport({ scale: PDF_PAGE_WIDTH / vp0.width });
            var c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
            var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
            return pg.render({ canvasContext: g, viewport: vp }).promise.then(function () {
              return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.92); });
            }).then(function (b) {
              return api.upload(b, fid.replace(/\.pdf$/, '') + '-p' + i + '.jpg').then(function (r) { pages.push(r.fileId); sizes.push([c.width, c.height]); bytes += r.size; });
            });
          });
        });
      })(i);
      return chain.then(function () {
        meta.pages = pages; meta.pageSizes = sizes; meta.pagesBytes = bytes; meta.pageCount = pdf.numPages; meta.pageWidth = PDF_PAGE_WIDTH;
        if (pdf.numPages > n) meta.truncated = true;
        changed();
      });
    });
  }
  function ensurePdfPages() {
    // also re-render pages made at the older, lower resolution
    var todo = Object.keys(P.files).filter(function (fid) { var m = P.files[fid]; return m.type === 'pdf' && (!(m.pages && m.pages.length) || (m.pageWidth || 0) < PDF_PAGE_WIDTH); });
    return todo.reduce(function (p, fid) { return p.then(function () { return renderPdfPages(fid); }); }, Promise.resolve()).then(function () {
      if (todo.length) { status('Saved ✓'); if (page.indexOf('section:') === 0) renderPage(); pushPreview(); }
    }).catch(function (e) { status('PDF preview failed: ' + e.message); });
  }

  // ------------------------------------------------------------------ phrases page
  function phrasesHtml() {
    var s = P.settings;
    var lang = s.langName || 'the local language';
    var have = {};
    P.phrases.forEach(function (p) { have[p.en.trim().toLowerCase()] = 1; });
    var h = '<h2>💬 Say it: phrases</h2><p class="lead">Choose the language and the phrases. They are translated automatically where this browser can; otherwise type the translations. Each phrase becomes a big card with a ▶ Play button on the phone. Every event with an address also gets a “Say it” button with “Please take me to…” and “Where is…?”.</p>';
    // 1. language
    h += '<div class="panel"><h3>1 · Language</h3><div class="grid3">' +
      fieldS('langName', 'Language (e.g. Portuguese)') +
      '<label class="f">Speech code for “Play” (type or pick)<input type="text" list="speechcodes" data-s="speechLang" placeholder="e.g. pt-PT" value="' + esc(s.speechLang || '') + '"><datalist id="speechcodes">' +
      D.SPEECH_CODES.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + '</option>'; }).join('') + '</datalist></label>' +
      '<div><label class="f">&nbsp;</label><button data-cmd="test-voice">▶ Test the voice on this laptop</button></div></div>' +
      '<p class="muted small">The speech code is language-country, e.g. <code>pt-PT</code> for Portugal and <code>pt-BR</code> for Brazil. The phone uses its own voice for that code.</p>' +
      '<p class="tr-status" id="tr-status">Checking automatic translation…</p></div>';
    // 2. suggestions
    var total = 0, topN = 0;
    h += '<div class="panel"><h3>2 · Pick phrases</h3><p class="muted small">Tick the ones you want; they are added to your list below and translated automatically if possible. ★ = most useful.</p>' +
      '<div class="row" style="margin-bottom:8px"><button data-cmd="add-top">Add all ★ phrases</button></div><div class="suggest">';
    D.SUGGESTED.forEach(function (g) {
      h += '<div class="suggest-group"><h4>' + esc(g.group) + '</h4>';
      g.items.forEach(function (it) {
        total++; if (it.top) topN++;
        var on = have[it.en.toLowerCase()];
        h += '<label class="suggest-item"><input type="checkbox" data-suggest="' + esc(it.en) + '"' + (on ? ' checked' : '') + '> ' + (it.top ? '★ ' : '') + esc(it.en) + '</label>';
      });
      h += '</div>';
    });
    h += '</div></div>';
    // 3. your phrases
    var missing = P.phrases.filter(function (p) { return !p.local; }).length;
    h += '<div class="panel"><h3>3 · Your phrases (' + P.phrases.length + ')' + (missing ? ' <span class="badge warn">' + missing + ' still need a translation</span>' : '') + '</h3>' +
      '<p class="muted small">Type your own phrase in English and press Enter or Tab: it is translated automatically. <span class="auto-key">Shaded</span> = machine translation: please check it, especially health and allergy phrases. Phrases without a translation are left out of the app.</p>' +
      (missing ? '<div class="row" style="margin-bottom:8px"><button data-cmd="translate-empty">Translate the ' + missing + ' empty one' + (missing > 1 ? 's' : '') + '</button></div>' : '') +
      '<table class="phrases"><tr><th>In English (what your parents read)</th><th>In ' + esc(lang) + ' (shown big and spoken)</th><th>Hint (optional)</th><th></th></tr>';
    P.phrases.forEach(function (p, i) {
      h += '<tr data-phrase="' + i + '"' + (p.local ? '' : ' class="untranslated"') + '><td><input type="text" data-p="en" value="' + esc(p.en) + '"></td>' +
        '<td><input type="text" data-p="local"' + (p.auto ? ' class="auto" title="Machine translation: please check"' : '') + ' value="' + esc(p.local) + '" lang="' + esc(s.speechLang) + '" placeholder="Type it in ' + esc(lang) + '"></td>' +
        '<td><input type="text" data-p="hint" value="' + esc(p.hint || '') + '" placeholder="e.g. a woman says …"></td>' +
        '<td><button data-cmd="retranslate" title="Translate again">↻</button><button data-cmd="speak-phrase" title="Listen">▶</button><button data-cmd="phrase-move" data-dir="-1">↑</button><button data-cmd="phrase-move" data-dir="1">↓</button><button class="danger" data-cmd="del-phrase">🗑</button></td></tr>';
    });
    h += '</table><div class="row" style="margin-top:10px"><button data-cmd="add-phrase">+ Add your own phrase</button></div></div>';
    // 4. place-card templates
    h += '<div class="panel"><h3>4 · Place cards</h3><p class="muted small">Used for every address. <code>{place}</code> is replaced by the place name (or its “name in the local language”). Leave “Where is…?” empty to skip those cards.</p><div class="grid2">' +
      fieldT('takeMeTo', '“Please take me to this address:” in ' + esc(lang)) + fieldT('whereIs', '“Where is {place}?” in ' + esc(lang)) + '</div>' +
      '<div class="row"><button data-cmd="translate-tpl">↻ Translate these two again</button></div>';
    var cards = R.addressCards(TripExporter.buildAppTrip(P, 'preview').trip);
    h += '<p class="muted small">Example: ' + (cards[0] ? esc(cards[0].kind === 'take' ? (cards[0].heading + ' ' + cards[0].local.replace(/\n/g, ', ')) : cards[0].local) : '(add an address to see one)') + '</p></div>';
    return h;
  }
  // ---- automatic translation (see translate.js)
  function showTranslateStatus() {
    var el = $('#tr-status'), code = P.settings.speechLang;
    if (!el) return;
    if (!code) { el.textContent = '🌐 Choose the speech code first; phrases are then translated into that language.'; return; }
    BuilderTranslate.status(code).then(function (st) {
      el.className = 'tr-status ' + (st === 'available' || st === 'downloadable' ? 'ok' : 'warn');
      el.textContent = {
        available: '🌐 Automatic translation into ' + code + ' is on. It happens on this laptop; nothing is sent anywhere.',
        downloadable: '🌐 Automatic translation into ' + code + ' is on. The first translation downloads the language pack to this laptop; nothing is sent anywhere.',
        unavailable: '🌐 This browser cannot translate into ' + code + '. Please type the translations yourself.',
        unsupported: '🌐 Automatic translation is not available in this browser. Please type the translations yourself, or open the Builder in Chrome or Edge on a computer.'
      }[st];
    });
  }
  function translationFailed(e) {
    var m = String((e && e.name) || '') + ' ' + String((e && e.message) || e || '');
    if (/unsupported/.test(m)) return;
    if (/NotAllowed/i.test(m)) toast('Click ↻ next to the phrase to translate it (the browser wants a click first).', 4500);
    else if (/unavailable/.test(m)) toast('This browser cannot translate into ' + P.settings.speechLang + '. Please type the translation.', 4500);
    else toast('Translation did not work: ' + m.trim(), 4500);
  }
  function translatePhrase(p) {
    var code = P.settings.speechLang;
    if (!code || !BuilderTranslate.supported() || !p.en.trim()) return Promise.resolve(false);
    return BuilderTranslate.translate(p.en, code).then(function (r) {
      if (!r) return false;
      p.local = r; p.auto = true; p.autoLang = code;
      var row = document.querySelector('tr[data-phrase="' + P.phrases.indexOf(p) + '"]');
      if (row) { var inp = row.querySelector('[data-p=local]'); inp.value = r; inp.classList.add('auto'); row.classList.remove('untranslated'); }
      changed({ noSidebar: true });
      return true;
    });
  }
  function translateMany(list) {
    if (!list.length || !P.settings.speechLang || !BuilderTranslate.supported()) return Promise.resolve();
    var i = 0;
    return list.reduce(function (pr, p) {
      return pr.then(function () { status('Translating ' + (++i) + '/' + list.length + '…'); return translatePhrase(p); });
    }, Promise.resolve()).catch(translationFailed).then(function () { status('Saved ✓'); if (page === 'phrases') renderPage(); });
  }
  // The two place phrases. {place} must survive the translation, otherwise "Where is" is left for you to type.
  function translateTemplates(force) {
    var code = P.settings.speechLang, t = P.settings.phraseTemplates;
    var auto = P.settings.phraseTemplatesAuto || (P.settings.phraseTemplatesAuto = {});
    if (!code || !BuilderTranslate.supported()) return Promise.resolve();
    var jobs = [['takeMeTo', 'Please take me to this address:'], ['whereIs', 'Where is {place}?']];
    return jobs.reduce(function (pr, j) {
      return pr.then(function () {
        if (!force && t[j[0]] && !(auto[j[0]] && auto[j[0]] !== code)) return;
        return BuilderTranslate.translate(j[1], code).then(function (r) {
          if (j[0] === 'whereIs' && r.indexOf('{place}') < 0) { toast('Please type “Where is {place}?” yourself; keep {place} in it.', 4500); return; }
          if (r) { t[j[0]] = r; auto[j[0]] = code; }
        });
      });
    }, Promise.resolve()).catch(translationFailed).then(function () { changed(); if (page === 'phrases') renderPage(); });
  }

  function suggestedPhrase(en) { return { id: uid('ph'), en: en, local: '', hint: '' }; }
  function hasPhrase(en) { return P.phrases.some(function (p) { return p.en.trim().toLowerCase() === en.toLowerCase(); }); }

  // ------------------------------------------------------------------ maps page
  function mapsPageHtml() {
    var a = P.settings.mapArea, pins = allPins();
    var auto = MapRender.autoBbox(P);
    var outside = a.file ? pins.filter(function (e) { return !inMapArea(e); }) : [];
    var bbox = outside.length && auto ? auto : (a.bbox || auto);
    var span = auto ? Math.max(auto[2] - auto[0], auto[3] - auto[1]) : 0;
    var h = '<h2>🗺️ Maps</h2><p class="lead">The app gets picture maps (one overview plus one per day) with numbered pins. They are drawn here on your laptop from an offline map extract, so they work on the phone without internet.</p>';
    h += '<div class="panel"><h3>1 · Pins</h3><p>' + pins.length + ' entries have a map pin. ' + missingPins().length + ' have an address but no pin.</p>' +
      '<button data-cmd="geocode-all">🔎 Find pins for all addresses</button> <span class="muted small">Uses OpenStreetMap Nominatim, one address per second.</span></div>';
    if (outside.length) h += '<div class="panel pin-outside"><strong>' + outside.length + ' pin' + (outside.length > 1 ? 's are' : ' is') + ' outside the downloaded map area</strong>: ' +
      outside.slice(0, 5).map(function (e) { return esc(e.title || 'untitled'); }).join(', ') + (outside.length > 5 ? ', …' : '') +
      '. The area below has been widened to fit all pins; click <em>Download again</em>.' +
      (span > 1.5 ? '<br><b>Your pins are very far apart</b> (about ' + Math.round(span * 111) + ' km). If some belong to another trip, delete them first, otherwise the map download gets very large.' : '') + '</div>';
    h += '<div class="panel"><h3>2 · Map area (offline map extract)</h3>' +
      (a.file ? '<p>✓ Map area downloaded: ' + fmtSize(a.size) + (a.date ? ' on ' + esc(a.date) : '') + '.</p>' : '<p class="muted">No map area yet.</p>') +
      '<div class="grid4"><label class="f">West (min lon)<input type="number" step="0.001" data-bbox="0" value="' + (bbox ? bbox[0] : '') + '"></label>' +
      '<label class="f">South (min lat)<input type="number" step="0.001" data-bbox="1" value="' + (bbox ? bbox[1] : '') + '"></label>' +
      '<label class="f">East (max lon)<input type="number" step="0.001" data-bbox="2" value="' + (bbox ? bbox[2] : '') + '"></label>' +
      '<label class="f">North (max lat)<input type="number" step="0.001" data-bbox="3" value="' + (bbox ? bbox[3] : '') + '"></label></div>' +
      '<div class="row"><label class="f" style="width:220px">Detail (max zoom)<select data-maxzoom>' +
      [[13, '13 · neighbourhoods (small)'], [14, '14 · main streets'], [15, '15 · all streets (recommended)'], [16, '16 · house numbers (large)']].map(function (z) {
        return '<option value="' + z[0] + '"' + (a.maxzoom === z[0] ? ' selected' : '') + '>' + z[1] + '</option>';
      }).join('') + '</select></label>' +
      '<button data-cmd="bbox-auto">Fit area to all pins</button><button data-cmd="map-estimate">Estimate size</button>' +
      '<button class="primary" data-cmd="map-download">' + (a.file ? 'Download again' : 'Download map area') + '</button></div>' +
      '<p class="muted small" id="map-area-msg">Map data © OpenStreetMap contributors (ODbL), from the Protomaps daily build, which permits offline use. Only the area above is downloaded (typically 5–20 MB for a city).</p></div>';
    h += '<div class="panel"><h3>3 · Picture maps</h3>' +
      (P.maps.list.length ? (TripExporter.mapsStale(P) ? '<p class="badge warn">Pins or dates changed since the maps were drawn. They will be redrawn on export.</p>' : '<p class="badge ok">Up to date</p>') : '') +
      '<div class="row" style="margin:8px 0"><button class="primary" data-cmd="render-maps"' + (a.file ? '' : ' disabled') + '>Draw maps now</button><span class="muted small">Also happens automatically on export.</span></div>' +
      '<div class="progress" id="map-progress" hidden><div></div></div><div class="map-thumbs">' +
      P.maps.list.map(function (m) { return '<figure><img src="/api/projects/' + P.id + '/files/' + m.fileId + '" data-zoom="' + m.fileId + '" alt=""><figcaption>' + esc(m.title) + ' · ' + m.legend.length + ' pins</figcaption></figure>'; }).join('') +
      '</div></div>';
    h += '<div class="panel"><h3>4 · Moving map (optional)</h3><label><input type="checkbox" data-interactive ' + (P.settings.interactiveMap ? 'checked' : '') + '> Also include a moving map with a “You are here” GPS dot</label>' +
      '<p class="muted small">Adds about ' + fmtSize((a.size || 0) + 3.4 * 1048576) + ' to the app (map extract + map engine + fonts). Works offline. Not included in the single-file backup.</p></div>';
    return h;
  }
  function allPins() { var out = []; R.SECTION_ORDER.forEach(function (k) { P.sections[k].forEach(function (e) { if (R.hasPin(e)) out.push(e); }); }); return out; }
  function missingPins() { var out = []; R.SECTION_ORDER.forEach(function (k) { P.sections[k].forEach(function (e) { if (e.address && !R.hasPin(e)) out.push(e); }); }); return out; }
  function readBbox() {
    var v = [0, 1, 2, 3].map(function (i) { return parseFloat(document.querySelector('[data-bbox="' + i + '"]').value); });
    if (v.some(isNaN) || v[0] >= v[2] || v[1] >= v[3]) { alert('The map area is not valid. Click “Fit area to all pins”.'); return null; }
    return v;
  }
  function mapExtract(dry) {
    var bbox = readBbox(); if (!bbox) return;
    var z = +document.querySelector('[data-maxzoom]').value;
    var msg = $('#map-area-msg');
    msg.textContent = dry ? 'Estimating… (the first time, the pmtiles tool is downloaded, about 17 MB)' : 'Downloading the map area… this can take a minute.';
    document.querySelectorAll('[data-cmd^=map-]').forEach(function (b) { b.disabled = true; });
    return api.send('POST', '/api/projects/' + P.id + '/map-area', { bbox: bbox, maxzoom: z, dryRun: dry }).then(function (r) {
      if (dry) { msg.textContent = 'Estimated size: ' + fmtSize(r.estimatedBytes || 0) + '. ' + (r.estimatedBytes > 25e6 ? 'That is large: make the area smaller or lower the detail.' : 'That is fine.'); }
      else {
        Object.assign(P.settings.mapArea, { bbox: bbox, maxzoom: z, file: r.file, size: r.size, date: r.date, auto: false, v: Date.now(), place: P.settings.destination || '' });
        MapRender.reset();
        changed(); renderPage(); toast('Map area downloaded (' + fmtSize(r.size) + ')');
      }
    }).catch(function (e) { msg.textContent = '⚠ ' + e.message; })
      .then(function () { document.querySelectorAll('[data-cmd^=map-]').forEach(function (b) { b.disabled = false; }); });
  }
  var renderingMaps = null;
  function renderMaps() {
    if (renderingMaps) return renderingMaps; // already drawing: share that run
    renderingMaps = drawMaps().then(function (x) { renderingMaps = null; return x; }, function (e) { renderingMaps = null; throw e; });
    return renderingMaps;
  }
  function drawMaps() {
    var prog = $('#map-progress');
    if (prog) prog.hidden = false;
    status('Drawing maps…');
    return MapRender.renderAll(P, function (done, total, title) {
      if (prog) prog.firstChild.style.width = Math.round(done / total * 100) + '%';
      status('Drawing map ' + done + '/' + total + (title ? ': ' + title : '') + '…');
    }).then(function (list) {
      P.maps = { list: list, signature: TripExporter.mapSignature(P) };
      changed();
      status('Saved ✓');
      if (page === 'maps') renderPage();
      return list;
    });
  }

  // ------------------------------------------------------------------ events
  function onClick(ev) {
    var t = ev.target;
    var op = t.closest('[data-open]');
    if (op) { loadProject(op.getAttribute('data-open')); return; }
    var pg = t.closest('[data-page]');
    if (pg) { ev.preventDefault(); go(pg.getAttribute('data-page')); return; }
    var pv = t.closest('[data-preview]');
    if (pv) { previewGo('#/' + pv.getAttribute('data-preview')); return; }
    var zoom = t.closest('[data-zoom]');
    if (zoom) { showModal('<img src="/api/projects/' + P.id + '/files/' + zoom.getAttribute('data-zoom') + '">'); return; }
    if (t.closest('[data-close]') || t.id === 'modal') { hideModal(); return; }
    var dz = t.closest('[data-dropzone]');
    if (dz && !t.matches('input')) { dz.querySelector('input').click(); return; }
    var gr = t.closest('[data-georesult]');
    if (gr) {
      var f0 = findEntry(openEntryId);
      f0.entry.lat = +gr.getAttribute('data-lat'); f0.entry.lng = +gr.getAttribute('data-lng'); f0.entry.pinSource = 'geocode';
      changed(); refreshPinBox(openEntryId); return;
    }
    var cmdEl = t.closest('[data-cmd]');
    var tog = t.closest('[data-toggle]');
    if (tog && !cmdEl) {
      var id = tog.getAttribute('data-toggle');
      var prev = openEntryId;
      openEntryId = openEntryId === id ? null : id;
      if (prev && prev !== id) rerenderEntry(prev);
      rerenderEntry(id);
      if (openEntryId) previewGo('#/entry/' + id);
      return;
    }
    if (!cmdEl) return;
    var cmd = cmdEl.getAttribute('data-cmd');
    var card = cmdEl.closest('.entry-card');
    var entry = card ? findEntry(card.getAttribute('data-id')) : null;
    switch (cmd) {
      case 'new': createProject('blank'); break;
      case 'sample': createProject('sample'); break;
      case 'download': if (P) { saveNow().then(function () { location.href = '/api/projects/' + P.id + '/download'; }); } break;
      case 'delete':
        if (P && confirm('Delete the trip “' + P.settings.tripName + '”? (It is moved to projects/.trash, not erased.)')) {
          api.send('DELETE', '/api/projects/' + P.id).then(function () { P = null; refreshProjectList().then(function (l) { if (l[0]) loadProject(l[0].id); else showWelcome(); }); });
        }
        break;
      case 'add-entry':
        var key = cmdEl.getAttribute('data-section');
        var e = { id: uid('e'), title: '', files: [] };
        if (key === 'contacts') e.role = cmdEl.getAttribute('data-help-role') || 'other';
        if (cmdEl.hasAttribute('data-help-role')) e.help = true;
        P.sections[key].push(e); openEntryId = e.id; changed(); renderPage();
        var inp = document.querySelector('.entry-card[data-id="' + e.id + '"] [data-f=title]'); if (inp) inp.focus();
        break;
      case 'help-on':
        var he = findEntry(cmdEl.getAttribute('data-id'));
        if (he) { he.entry.help = true; changed(); renderPage(); }
        break;
      case 'del-entry':
        if (confirm('Delete “' + (entry.entry.title || 'this entry') + '”?')) { P.sections[entry.key].splice(entry.index, 1); changed(); renderPage(); }
        break;
      case 'move':
        var to = entry.index + +cmdEl.getAttribute('data-dir'), list = P.sections[entry.key];
        if (to >= 0 && to < list.length) { list.splice(to, 0, list.splice(entry.index, 1)[0]); changed(); renderPage(); }
        break;
      case 'geocode': geocodeEntry(entry.entry); break;
      case 'clear-pin': delete entry.entry.lat; delete entry.entry.lng; delete entry.entry.pinSource; changed(); refreshPinBox(entry.entry.id); break;
      case 'del-file':
        var fid = cmdEl.closest('[data-fid]').getAttribute('data-fid');
        entry.entry.files = entry.entry.files.filter(function (x) { return x !== fid; });
        if (!isFileUsed(fid)) delete P.files[fid];
        changed(); rerenderEntry(entry.entry.id);
        break;
      case 'test-voice':
        var sample = P.phrases.filter(function (p) { return p.local; })[0];
        if (!P.settings.speechLang) { alert('Type a speech code first, e.g. pt-PT.'); break; }
        speakHere(sample ? sample.local : (P.settings.phraseTemplates.takeMeTo || 'Hello'), P.settings.speechLang); break;
      case 'add-top':
        var added = [];
        D.SUGGESTED.forEach(function (g) { g.items.forEach(function (it) { if (it.top && !hasPhrase(it.en)) { var np = suggestedPhrase(it.en); P.phrases.push(np); added.push(np); } }); });
        changed(); renderPage(); translateMany(added); break;
      case 'translate-empty': translateMany(P.phrases.filter(function (x) { return !x.local; })); break;
      case 'retranslate':
        var rp = P.phrases[+cmdEl.closest('[data-phrase]').getAttribute('data-phrase')];
        if (!BuilderTranslate.supported()) { toast('Automatic translation is not available in this browser.'); break; }
        status('Translating…'); translatePhrase(rp).catch(translationFailed).then(function () { status('Saved ✓'); });
        break;
      case 'translate-tpl': translateTemplates(true); break;
      case 'add-phrase': P.phrases.push({ id: uid('ph'), en: '', local: '', hint: '' }); changed(); renderPage(); break;
      case 'del-phrase': P.phrases.splice(+cmdEl.closest('[data-phrase]').getAttribute('data-phrase'), 1); changed(); renderPage(); break;
      case 'phrase-move':
        var pi = +cmdEl.closest('[data-phrase]').getAttribute('data-phrase'), pt = pi + +cmdEl.getAttribute('data-dir');
        if (pt >= 0 && pt < P.phrases.length) { P.phrases.splice(pt, 0, P.phrases.splice(pi, 1)[0]); changed(); renderPage(); }
        break;
      case 'speak-phrase':
        var sp = P.phrases[+cmdEl.closest('[data-phrase]').getAttribute('data-phrase')];
        if (!sp.local) { toast('Type the translation first.'); break; }
        speakHere(sp.local, P.settings.speechLang); break;
      case 'geocode-all': geocodeAllMissing(); break;
      case 'bbox-auto':
        var b = MapRender.autoBbox(P);
        if (!b) { alert('Add some pins first.'); break; }
        [0, 1, 2, 3].forEach(function (i) { document.querySelector('[data-bbox="' + i + '"]').value = b[i]; });
        break;
      case 'map-estimate': mapExtract(true); break;
      case 'map-download': mapExtract(false); break;
      case 'render-maps': cmdEl.disabled = true; renderMaps().catch(function (e) { alert('Map drawing failed: ' + e.message); }).then(function () { cmdEl.disabled = false; }); break;
    }
  }
  function isFileUsed(fid) {
    return R.SECTION_ORDER.some(function (k) { return P.sections[k].some(function (e) { return (e.files || []).indexOf(fid) >= 0; }); });
  }
  function voicesReady() {
    var v = speechSynthesis.getVoices();
    if (v.length) return Promise.resolve(v);
    // Chrome loads voices a moment after the page; without waiting, the first Play uses an English voice
    return new Promise(function (res) {
      var done = function () { res(speechSynthesis.getVoices()); };
      speechSynthesis.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1500);
    });
  }
  function speakHere(text, lang) {
    if (!('speechSynthesis' in window)) return alert('This browser cannot speak.');
    lang = lang || 'en-GB';
    voicesReady().then(function (voices) {
      var v = R.pickVoice(voices, lang);
      if (!v) { toast('This laptop has no ' + lang + ' voice, so it cannot read it properly. Phones usually have one: try it in the exported app.', 5000); return; }
      speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = v.lang; u.voice = v; u.rate = 0.85;
      speechSynthesis.speak(u);
      status('Voice: ' + v.name);
    });
  }

  function onInput(ev) {
    var t = ev.target;
    if (!P) return;
    if (t.hasAttribute('data-s')) {
      P.settings[t.getAttribute('data-s')] = t.value;
      if (t.getAttribute('data-s') === 'tripName' && !P.settings.shortNameTouched) {
        P.settings.shortName = t.value.slice(0, 12);
        var sn = document.querySelector('[data-s=shortName]'); if (sn) sn.value = P.settings.shortName;
      }
      if (t.getAttribute('data-s') === 'shortName') P.settings.shortNameTouched = true;
      changed({ noSidebar: true });
    } else if (t.hasAttribute('data-tpl')) {
      P.settings.phraseTemplates[t.getAttribute('data-tpl')] = t.value;
      if (P.settings.phraseTemplatesAuto) delete P.settings.phraseTemplatesAuto[t.getAttribute('data-tpl')];
      changed({ noSidebar: true });
    }
    else if (t.hasAttribute('data-icon')) {
      P.settings.icon[t.getAttribute('data-icon')] = t.value;
      var ip = $('#icon-preview'); if (ip) { ip.style.background = P.settings.icon.color; ip.innerHTML = iconInner(); }
      changed({ noSidebar: true });
    } else if (t.hasAttribute('data-f')) {
      var card = t.closest('.entry-card'), f = findEntry(card.getAttribute('data-id'));
      var name = t.getAttribute('data-f');
      f.entry[name] = t.value;
      if (!t.value) delete f.entry[name];
      if (name === 'title' || name === 'date' || name === 'time') refreshEntryHead(f.entry.id);
      changed({ noSidebar: name !== 'title' });
    } else if (t.hasAttribute('data-coord')) {
      var f2 = findEntry(openEntryId);
      var lat = parseFloat(document.querySelector('[data-coord=lat]').value), lng = parseFloat(document.querySelector('[data-coord=lng]').value);
      if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        f2.entry.lat = lat; f2.entry.lng = lng; f2.entry.pinSource = 'manual';
        MapRender.movePin(lat, lng);
        refreshEntryHead(f2.entry.id);
        changed();
      }
    } else if (t.hasAttribute('data-p')) {
      var i = +t.closest('[data-phrase]').getAttribute('data-phrase');
      P.phrases[i][t.getAttribute('data-p')] = t.value;
      if (t.getAttribute('data-p') === 'local') { delete P.phrases[i].auto; t.classList.remove('auto'); } // your own wording wins
      changed({ noSidebar: true });
    } else if (t.hasAttribute('data-file-label')) {
      var fid = t.closest('[data-fid]').getAttribute('data-fid');
      P.files[fid].label = t.value; changed({ noSidebar: true });
    }
  }
  function onChange(ev) {
    var t = ev.target;
    if (!P) return;
    if (t.hasAttribute('data-file-input')) { handleFiles(t.closest('.entry-card').getAttribute('data-id'), t.files); t.value = ''; return; }
    if (t.getAttribute('data-f') === 'address') {
      var f = findEntry(t.closest('.entry-card').getAttribute('data-id'));
      // Auto-pin when the address changes, unless you placed the pin yourself.
      if (f.entry.address && (!R.hasPin(f.entry) || (f.entry.pinSource === 'geocode' && f.entry.geocodedFor !== f.entry.address))) geocodeEntry(f.entry);
    }
    if (t.getAttribute('data-f') === 'role' || t.hasAttribute('data-help-check')) {
      var he2 = findEntry(t.closest('.entry-card').getAttribute('data-id'));
      if (t.hasAttribute('data-help-check')) he2.entry.help = t.checked;
      changed();
      if (page === 'help') renderPage(); else rerenderEntry(he2.entry.id);
    }
    if (t.getAttribute('data-s') === 'speechLang' || t.getAttribute('data-s') === 'langName') {
      P.settings[t.getAttribute('data-s')] = t.value.trim(); changed();
      if (t.getAttribute('data-s') === 'speechLang' && P.settings.speechLang) {
        // new language: fill the place phrases and any empty or machine-translated phrases
        var code2 = P.settings.speechLang;
        translateTemplates(false).then(function () {
          return translateMany(P.phrases.filter(function (x) { return !x.local || (x.auto && x.autoLang !== code2); }));
        });
      }
      // refresh labels like "In Greek", but not while you are still typing in the language fields
      setTimeout(function () { var a = document.activeElement; if (!(a && /^(langName|speechLang)$/.test(a.getAttribute('data-s') || ''))) renderPage(); }, 0);
    }
    if (t.hasAttribute('data-suggest')) {
      var en = t.getAttribute('data-suggest');
      var fresh = null;
      if (t.checked) { if (!hasPhrase(en)) { fresh = suggestedPhrase(en); P.phrases.push(fresh); } }
      else {
        var idx = P.phrases.map(function (p) { return p.en.trim().toLowerCase(); }).indexOf(en.toLowerCase());
        if (idx >= 0 && (!P.phrases[idx].local || confirm('Remove “' + en + '” and its translation?'))) P.phrases.splice(idx, 1);
      }
      changed(); renderPage();
      if (fresh) translateMany([fresh]);
    }
    if (t.getAttribute('data-p') === 'local') { changed(); renderSidebar(); var row = t.closest('tr'); if (row) row.classList.toggle('untranslated', !t.value); }
    if (t.getAttribute('data-p') === 'en') {
      // a new or changed English phrase: translate it, unless you wrote the translation yourself
      var ep = P.phrases[+t.closest('[data-phrase]').getAttribute('data-phrase')];
      if (ep.en.trim() && (!ep.local || ep.auto)) { status('Translating…'); translatePhrase(ep).catch(translationFailed).then(function () { status('Saved ✓'); }); }
    }
    if (t.hasAttribute('data-maxzoom')) { P.settings.mapArea.maxzoom = +t.value; changed({ noSidebar: true }); }
    if (t.hasAttribute('data-bbox')) { var b = readBbox(); if (b) { P.settings.mapArea.bbox = b; changed({ noSidebar: true }); } }
    if (t.hasAttribute('data-interactive')) { P.settings.interactiveMap = t.checked; changed(); }
  }

  // drag & drop: files onto entries, and reordering entries
  var dragId = null;
  document.addEventListener('dragstart', function (ev) {
    var head = ev.target.closest && ev.target.closest('.entry-head');
    if (!head) return;
    dragId = head.closest('.entry-card').getAttribute('data-id');
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', dragId);
  });
  document.addEventListener('dragend', function () { dragId = null; clearDropMarks(); });
  function clearDropMarks() { document.querySelectorAll('.drop-files,.drop-before,.drop-after,.over').forEach(function (el) { el.classList.remove('drop-files', 'drop-before', 'drop-after', 'over'); }); }
  function isFileDrag(ev) { return ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types, 'Files') >= 0; }
  document.addEventListener('dragover', function (ev) {
    var card = ev.target.closest && ev.target.closest('.entry-card');
    if (isFileDrag(ev)) {
      ev.preventDefault();
      clearDropMarks();
      if (card) { card.classList.add('drop-files'); var dz = card.querySelector('.dropzone'); if (dz) dz.classList.add('over'); ev.dataTransfer.dropEffect = 'copy'; }
      else ev.dataTransfer.dropEffect = 'none';
      return;
    }
    if (dragId && card) {
      ev.preventDefault();
      clearDropMarks();
      var r = card.getBoundingClientRect();
      card.classList.add(ev.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    }
  });
  document.addEventListener('drop', function (ev) {
    var card = ev.target.closest && ev.target.closest('.entry-card');
    if (isFileDrag(ev)) {
      ev.preventDefault(); clearDropMarks();
      if (card) handleFiles(card.getAttribute('data-id'), ev.dataTransfer.files);
      else toast('Drop files onto an entry.');
      return;
    }
    if (dragId && card) {
      ev.preventDefault();
      var before = card.classList.contains('drop-before');
      clearDropMarks();
      var src = findEntry(dragId), dst = findEntry(card.getAttribute('data-id'));
      if (!src || !dst || src.key !== dst.key || src.entry.id === dst.entry.id) return;
      var list = P.sections[src.key];
      list.splice(src.index, 1);
      var di = list.indexOf(dst.entry) + (before ? 0 : 1);
      list.splice(di, 0, src.entry);
      changed(); renderPage();
    }
  });

  function showModal(html) { var m = $('#modal'); m.innerHTML = '<div class="modal-box">' + html + '<p style="text-align:right"><button data-close>Close</button></p></div>'; m.hidden = false; }
  function hideModal() { var m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

  function ctx() {
    return { mapsBusy: function () { return renderingMaps; }, api: api, status: status, toast: toast, saveNow: saveNow, renderMaps: renderMaps, go: go, changed: changed, geocodeAllMissing: geocodeAllMissing, fmtSize: fmtSize, showModal: showModal };
  }
  window.Builder = { get project() { return P; }, ctx: ctx, renderPage: renderPage };

  init();
})();
