/* Trip Companion - parents' app. No editor, no admin mode: it only shows TRIP. */
(function () {
  'use strict';
  var R = window.TripRender;
  var trip = null;
  var params = new URLSearchParams(location.search);
  var isPreview = params.has('preview');
  var isSingle = document.body.classList.contains('single-file');
  var app, toastTimer, tickTimer;
  var lastNonViewerHash = '#/home';

  // ------------------------------------------------------------------ boot
  function boot() {
    if (isPreview) {
      window.addEventListener('message', function (ev) {
        if (!ev.data || ev.data.type !== 'trip') return;
        trip = ev.data.trip;
        trip._assetBase = ev.data.assetBase || '';
        if (!app) shell();
        render();
      });
      if (window.parent !== window) window.parent.postMessage({ type: 'preview-ready' }, '*');
      return;
    }
    trip = window.TRIP;
    if (!trip) {
      document.body.innerHTML = '<p style="padding:24px;font:20px sans-serif">This trip could not be loaded. Please open the link again with internet.</p>';
      return;
    }
    if (isSingle) collectInlineAssets();
    shell();
    render();
    if (!isSingle) registerServiceWorker();
    watchConnection();
    startTicker();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  }

  // Single-file export: documents and maps are already in the page as data: URLs in the
  // no-JavaScript version. Reuse them instead of storing everything twice.
  function collectInlineAssets() {
    var map = {};
    document.querySelectorAll('#static-doc img[src^="data:"], #static-doc a[href^="data:"]').forEach(function (el) {
      var v = el.getAttribute('src') || el.getAttribute('href');
      var key = el.getAttribute('data-asset');
      if (key) map[key] = v;
    });
    trip._resolve = function (p) { return map[p] || p; };
    var stat = document.getElementById('static-doc');
    if (stat) stat.remove();
  }
  function src(p) {
    if (!p) return '';
    if (trip._resolve) return trip._resolve(p);
    return (trip._assetBase || '') + p;
  }
  // render.js builds asset URLs from _assetBase; in single-file mode swap them after rendering.
  function fixAssetUrls(root) {
    if (!trip._resolve) return;
    root.querySelectorAll('img[src], a[href]').forEach(function (el) {
      var attr = el.tagName === 'IMG' ? 'src' : 'href';
      var v = el.getAttribute(attr);
      if (v && (v.indexOf('docs/') === 0 || v.indexOf('maps/') === 0)) el.setAttribute(attr, trip._resolve(v));
    });
  }

  function shell() {
    var s = trip.settings;
    document.title = s.tripName || 'Our trip';
    applyPalette(R.palette(s.color));
    app = document.getElementById('app');
    if (!app) { app = document.createElement('div'); app.id = 'app'; document.body.appendChild(app); }
    app.innerHTML =
      '<div class="statusbar" id="statusbar" hidden></div>' +
      '<main id="view" tabindex="-1"></main>' +
      '<nav class="bottom-nav" aria-label="Main">' +
      navLink('home', 'Home') + navLink('plan', 'Plan') + navLink('map', 'Map') + navLink('say', 'Say it') + navLink('help', 'Help') +
      '</nav><div id="overlay"></div><div class="toast" id="toast" role="status" aria-live="polite"></div>';
    window.addEventListener('hashchange', render);
    document.addEventListener('click', onClick);
  }
  // The whole colour scheme is derived from the trip colour (default amber #FCB300 on white).
  function applyPalette(p) {
    var st = document.documentElement.style;
    st.setProperty('--brand', p.brand);
    st.setProperty('--on-brand', p.onBrand);
    st.setProperty('--brand-ink-l', p.ink);
    st.setProperty('--brand-line', p.line);
    st.setProperty('--brand-tint-l', p.tint);
    st.setProperty('--brand-tint2-l', p.tint2);
    st.setProperty('--brand-ink-d', p.inkDark);
    st.setProperty('--brand-tint-d', p.tintDark);
    st.setProperty('--on-tint-d', p.onTintDark);
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', p.brand);
  }
  function navLink(key, label) {
    return '<a href="#/' + key + '" data-nav="' + key + '" class="nav-' + key + '">' + R.ICON[key] + '<span>' + label + '</span></a>';
  }

  // ------------------------------------------------------------------ routing
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    return h ? h.split('/').map(decodeURIComponent) : ['home'];
  }
  function render() {
    if (!trip || !app) return;
    applyPalette(R.palette(trip.settings.color)); // cheap; keeps the builder preview in sync
    var r = route(), view = document.getElementById('view'), overlay = document.getElementById('overlay');
    var top = r[0], html = '', nav = top;
    closeViewer();
    if (window.TripLiveMap) window.TripLiveMap.close();
    if (top === 'doc' || top === 'mapview') {
      openViewer(r);
      return;
    }
    if (top === 'livemap') {
      overlay.innerHTML = '';
      openLiveMap(r[1]);
      setNav('map');
      return;
    }
    lastNonViewerHash = location.hash || '#/home';
    var now = Date.now();
    switch (top) {
      case 'home': html = R.homeHtml(trip, now); break;
      case 'section': html = backBtn() + R.sectionHtml(trip, r[1]); nav = 'home'; break;
      case 'entry':
        var f = R.findEntry(trip, r[1]);
        html = backBtn() + (f ? R.entryCardHtml(trip, f.section, f.entry) : '<p class="card">Not found.</p>');
        nav = f && f.section === 'contacts' ? 'help' : 'home';
        break;
      case 'plan': html = R.planHtml(trip); break;
      case 'map': html = r[1] ? backBtn() + R.mapPageHtml(trip, r[1]) : R.mapsHtml(trip); nav = 'map'; break;
      case 'addresses': html = backBtn() + R.addressListHtml(trip); nav = 'map'; break;
      case 'say':
        if (r[1] === 'p') {
          var c = R.phraseById(trip, r[1], r[2]);
          html = backBtn() + (c ? R.phraseBigHtml(trip, c) : '<p class="card">Not found.</p>');
        } else if (r[1]) { // a place, opened from the "Say it" button on an event
          var pl = R.findEntry(trip, r[2]);
          html = backBtn() + (pl && pl.entry.address ? R.placeSayHtml(trip, pl.entry) : '<p class="card">Not found.</p>');
        } else html = R.sayHtml(trip);
        nav = 'say';
        break;
      case 'help': html = R.helpHtml(trip); break;
      default: html = R.homeHtml(trip, now); nav = 'home';
    }
    view.innerHTML = html;
    view.className = 'view view-' + top;
    fixAssetUrls(view);
    setNav(nav);
    if (top === 'home') renderReminderSlot();
    if (top === 'plan') {
      var today = view.querySelector('.day.is-today');
      if (today) today.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
    } else window.scrollTo(0, 0);
    if (top === 'say' && r[1] && !isPreview) {
      // Load voices early (iOS loads them lazily).
      try { speechSynthesis.getVoices(); } catch (e) { /* no speech */ }
    }
  }
  function setNav(key) {
    document.querySelectorAll('.bottom-nav a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === key);
      if (a.getAttribute('data-nav') === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }
  function backBtn() {
    return '<button class="back" data-action="back">' + R.ICON.back + ' Back</button>';
  }

  // ------------------------------------------------------------------ clicks
  function onClick(ev) {
    var t = ev.target.closest('[data-copy],[data-speak],[data-action]');
    if (!t) return;
    if (t.hasAttribute('data-copy')) { copyText(t.getAttribute('data-copy')); return; }
    if (t.hasAttribute('data-speak')) { speak(t.getAttribute('data-speak'), t); return; }
    var a = t.getAttribute('data-action');
    if (a === 'back') { history.length > 1 ? history.back() : (location.hash = '#/home'); }
    if (a === 'notify-on') enableNotifications();
    if (a === 'reminder-ok') { try { localStorage.setItem('tc-reminder-ok', '1'); } catch (e) { /* ignore */ } renderReminderSlot(); }
    if (a === 'dismiss-alert') { var o = document.getElementById('alert'); if (o) o.remove(); }
  }

  function copyText(text) {
    var done = function () { toast('Copied ✓'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }
  function toast(msg, ms) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, ms || 2600);
  }

  // ------------------------------------------------------------------ speech
  function pickVoice(lang) {
    var voices = [];
    try { voices = speechSynthesis.getVoices(); } catch (e) { return null; }
    var l = lang.toLowerCase(), base = l.split('-')[0];
    var exact = voices.filter(function (v) { return v.lang.toLowerCase().replace('_', '-') === l; });
    var near = voices.filter(function (v) { return v.lang.toLowerCase().replace('_', '-').split('-')[0] === base; });
    var list = exact.length ? exact : near;
    return list.filter(function (v) { return v.localService; })[0] || list[0] || null;
  }
  function speak(text, btn) {
    if (!('speechSynthesis' in window)) { toast('This phone cannot speak. Show the screen instead.', 4000); return; }
    var lang = trip.settings.speechLang || 'en-GB';
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = 0.85;
    var v = pickVoice(lang);
    if (v) u.voice = v;
    else if (speechSynthesis.getVoices().length) toast('No ' + (trip.settings.langName || lang) + ' voice on this phone. Show the screen instead.', 4500);
    if (btn) { btn.classList.add('speaking'); u.onend = u.onerror = function () { btn.classList.remove('speaking'); }; }
    speechSynthesis.speak(u);
  }

  // ------------------------------------------------------------------ countdown & reminders
  var FIRED_KEY = 'tc-reminded-' + (window.TRIP_VERSION || 'x').slice(0, 4);
  function fired() { try { return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}'); } catch (e) { return {}; } }
  function markFired(k) { var f = fired(); f[k] = 1; try { localStorage.setItem(FIRED_KEY, JSON.stringify(f)); } catch (e) { /* private mode */ } }

  function startTicker() {
    tick();
    tickTimer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { tick(); if (route()[0] === 'home') render(); } });
  }
  var REMIND_BEFORE = 15 * 60000; // reminders 15 minutes before each timed item
  var lastReminderCheck = 0;
  function tick() {
    var now = Date.now();
    document.querySelectorAll('[data-countdown]').forEach(function (el) {
      var t = +el.getAttribute('data-countdown');
      if (t - now <= 0) { if (route()[0] === 'home') render(); return; }
      el.textContent = R.durationLabel(t - now);
    });
    if (now - lastReminderCheck > 15000) { lastReminderCheck = now; checkReminders(now); }
  }
  function checkReminders(now) {
    var f = fired();
    R.timedItems(trip).forEach(function (it) {
      var key = it.entry.id + ':' + it.kind + ':' + it.epoch;
      var lead = it.epoch - now;
      if (lead > 0 && lead <= REMIND_BEFORE && !f[key]) {
        markFired(key);
        remind(it, lead);
      }
    });
  }
  function remind(it, lead) {
    var e = it.entry;
    var when = 'In ' + R.durationLabel(lead) + ' (at ' + (it.kind === 'end' ? e.endTime : e.time) + ')';
    var body = when + (e.address ? '\n' + e.address.split('\n')[0] : '');
    // in-app alert
    var div = document.createElement('div');
    div.id = 'alert';
    div.className = 'alert-backdrop';
    div.innerHTML = '<div class="alert-box" role="alertdialog" aria-labelledby="alert-title"><p class="eyebrow">⏰ Reminder</p>' +
      '<h2 id="alert-title">' + R.esc(it.title) + '</h2><p class="when">' + R.esc(when) + '</p>' +
      (e.address ? '<p>' + R.esc(e.address.split('\n')[0]) + '</p>' : '') +
      '<a class="btn btn-wide btn-primary" data-action="dismiss-alert" href="#/entry/' + encodeURIComponent(e.id) + '">Show details</a>' +
      '<button class="btn btn-wide" data-action="dismiss-alert">OK</button></div>';
    var old = document.getElementById('alert'); if (old) old.remove();
    document.body.appendChild(div);
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    // local notification (Android Chrome; iPhone only when installed on the Home Screen)
    if ('Notification' in window && Notification.permission === 'granted') {
      var opts = { body: body, tag: 'tc-' + e.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: '#/entry/' + e.id } };
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(function (reg) { reg.showNotification('⏰ ' + it.title, opts); });
      } else { try { new Notification('⏰ ' + it.title, opts); } catch (err) { /* Android needs the SW path */ } }
    }
  }
  function renderReminderSlot() {
    var slot = document.getElementById('reminder-slot');
    if (!slot) return;
    var canNotify = 'Notification' in window && !isSingle;
    var perm = canNotify ? Notification.permission : 'unsupported';
    var seen = false;
    try { seen = !!localStorage.getItem('tc-reminder-ok'); } catch (e) { /* ignore */ }
    // Shown until a choice is made: Allow/Block where notifications exist, "OK, got it" elsewhere.
    if (perm === 'granted' || perm === 'denied' || (perm === 'unsupported' && seen)) { slot.innerHTML = ''; return; }
    slot.innerHTML = '<div class="card reminder-note"><p><strong>⏰ Reminders</strong> pop up 15 minutes before each booking, <strong>but only while this app is open</strong>.</p>' +
      (perm === 'default' ? '<button class="btn btn-wide btn-primary" data-action="notify-on">Allow reminders</button>'
        : '<button class="btn btn-wide" data-action="reminder-ok">OK, got it</button>') + '</div>';
  }
  function enableNotifications() {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(function () { renderReminderSlot(); });
  }

  // ------------------------------------------------------------------ viewer (documents and maps)
  var viewerState = null;
  function openViewer(r) {
    var overlay = document.getElementById('overlay');
    var pages = [], title = '', focus = null, mapKey = null;
    if (r[0] === 'doc') {
      var a = trip.assets[r[1]];
      if (!a) { location.hash = lastNonViewerHash; return; }
      title = a.label || a.name;
      if (a.type === 'pdf') { pages = (a.pages || []).map(function (p, i) { return { src: src(p), w: a.pageSizes ? a.pageSizes[i][0] : 1000, h: a.pageSizes ? a.pageSizes[i][1] : 1414 }; }); }
      else pages = [{ src: src(a.src), w: a.w || 1000, h: a.h || 1000 }];
    } else {
      var m = (trip.maps || []).filter(function (x) { return x.key === r[1]; })[0];
      if (!m) { location.hash = lastNonViewerHash; return; }
      mapKey = m.key;
      title = m.title;
      pages = [{ src: src(m.src), w: m.w, h: m.h }];
      if (r[2]) {
        var l = (m.legend || []).filter(function (x) { return x.entryId === r[2]; })[0];
        if (l) focus = l;
      }
    }
    var h = '<div class="viewer" role="dialog" aria-label="' + R.esc(title) + '">' +
      '<div class="viewer-top"><button class="vbtn vclose" data-v="close" aria-label="Close">✕ Close</button><span class="vtitle">' + R.esc(title) + '</span></div>' +
      '<div class="viewer-stage"><div class="viewer-content">';
    pages.forEach(function (p, i) {
      h += '<img src="' + R.esc(p.src) + '" alt="' + R.esc(title) + (pages.length > 1 ? ' page ' + (i + 1) : '') + '" draggable="false" data-w="' + p.w + '" data-h="' + p.h + '">';
    });
    if (focus) h += '<span class="focus-ring" style="left:' + (focus.x * 100) + '%;top:' + (focus.y / pages.length * 100) + '%"></span>';
    h += '</div></div><div class="viewer-bottom">';
    if (focus) h += '<p class="vfocus"><span class="num" style="background:' + R.CATEGORIES[focus.cat].color + '">' + R.esc(focus.n) + '</span> ' + R.esc(focus.title) + '</p>';
    h += '<div class="vbtns"><button class="vbtn" data-v="out" aria-label="Zoom out">−</button><button class="vbtn" data-v="fit">Fit</button><button class="vbtn" data-v="in" aria-label="Zoom in">+</button>';
    if (mapKey) h += '<a class="vbtn" href="#/map/' + encodeURIComponent(mapKey) + '">List</a>';
    if (mapKey && trip.interactive) h += '<a class="vbtn" href="#/livemap/' + encodeURIComponent(r[2] || '') + '">Live</a>';
    h += '</div><p class="vhint">Pinch or use + and − to zoom. Drag to move.</p></div></div>';
    overlay.innerHTML = h;
    document.body.classList.add('viewer-open');
    var viewer = overlay.querySelector('.viewer');
    var imgs = viewer.querySelectorAll('img');
    var loaded = 0;
    var start = function () { viewerState = initZoom(viewer, focus, pages.length); };
    imgs.forEach(function (img) {
      if (img.complete) loaded++;
      else img.addEventListener('load', function () { if (++loaded === imgs.length) start(); });
      img.addEventListener('error', function () {
        img.replaceWith(Object.assign(document.createElement('p'), { className: 'viewer-error', textContent: 'This page could not be loaded.' }));
      });
    });
    if (loaded === imgs.length) start();
    viewer.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-v]');
      if (!b || !viewerState) { if (b && b.getAttribute('data-v') === 'close') closeViewerNav(); return; }
      var v = b.getAttribute('data-v');
      if (v === 'close') closeViewerNav();
      if (v === 'in') viewerState.zoomBy(1.6);
      if (v === 'out') viewerState.zoomBy(1 / 1.6);
      if (v === 'fit') viewerState.fit();
    });
  }
  function closeViewerNav() {
    if (history.length > 1) history.back(); else location.hash = lastNonViewerHash;
  }
  function closeViewer() {
    var overlay = document.getElementById('overlay');
    if (overlay && overlay.querySelector('.viewer')) overlay.innerHTML = '';
    if (viewerState) { viewerState.destroy(); viewerState = null; }
    document.body.classList.remove('viewer-open');
  }

  // Pinch-to-zoom / pan with pointer events. Content is laid out fit-to-width, then transformed.
  function initZoom(viewer, focus, pageCount) {
    var stage = viewer.querySelector('.viewer-stage');
    var content = viewer.querySelector('.viewer-content');
    var s = 1, x = 0, y = 0, minS = 1, maxS = 6;
    var pointers = {}, startDist = 0, startS = 1, startMid = null, startXY = null, lastTap = 0, moved = false;
    var cw, ch, sw, sh;
    function measure() {
      sw = stage.clientWidth; sh = stage.clientHeight;
      content.style.width = sw + 'px';
      cw = content.offsetWidth; ch = content.offsetHeight;
      // fit whole page/map if it is taller than the screen (single image), otherwise fit width
      minS = pageCount === 1 && ch > sh ? sh / ch : 1;
    }
    function clamp() {
      var w = cw * s, h = ch * s;
      x = w <= sw ? (sw - w) / 2 : Math.min(0, Math.max(sw - w, x));
      y = h <= sh ? (sh - h) / 2 : Math.min(0, Math.max(sh - h, y));
    }
    function apply(anim) {
      clamp();
      content.style.transition = anim ? 'transform .25s ease-out' : 'none';
      content.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
    }
    function zoomAt(ns, px, py, anim) {
      ns = Math.max(minS, Math.min(maxS, ns));
      x = px - (px - x) * (ns / s);
      y = py - (py - y) * (ns / s);
      s = ns;
      apply(anim);
    }
    function fit() { s = minS; x = 0; y = 0; apply(true); }
    measure();
    content.style.transformOrigin = '0 0';
    if (focus) {
      s = Math.max(minS, Math.min(maxS, 2.4));
      x = sw / 2 - focus.x * cw * s;
      y = sh / 2 - (focus.y / pageCount) * ch * s;
      apply(false);
    } else { s = minS; apply(false); }

    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    function onDown(e) {
      stage.setPointerCapture && stage.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      moved = false;
      if (ids.length === 2) {
        var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
        startDist = dist(p1, p2); startS = s;
        startMid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        startXY = { x: x, y: y };
      } else {
        startXY = { x: x, y: y, px: e.clientX, py: e.clientY };
      }
    }
    function onMove(e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      var r = stage.getBoundingClientRect();
      if (ids.length >= 2 && startDist) {
        var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
        var ns = Math.max(minS * 0.8, Math.min(maxS, startS * dist(p1, p2) / startDist));
        var mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        x = mid.x - r.left - (startMid.x - r.left - startXY.x) * (ns / startS);
        y = mid.y - r.top - (startMid.y - r.top - startXY.y) * (ns / startS);
        s = ns; moved = true;
        apply(false);
      } else if (ids.length === 1 && startXY && startXY.px != null) {
        var dx = e.clientX - startXY.px, dy = e.clientY - startXY.py;
        if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
        x = startXY.x + dx; y = startXY.y + dy;
        apply(false);
      }
      e.preventDefault();
    }
    function onUp(e) {
      var wasSingle = Object.keys(pointers).length === 1;
      delete pointers[e.pointerId];
      var left = Object.keys(pointers);
      if (left.length === 1) { var p = pointers[left[0]]; startXY = { x: x, y: y, px: p.x, py: p.y }; startDist = 0; }
      if (s < minS) fit();
      if (wasSingle && !moved) {
        var now = Date.now();
        if (now - lastTap < 320) {
          var r = stage.getBoundingClientRect();
          if (s > minS * 1.3) fit(); else zoomAt(s * 2.5, e.clientX - r.left, e.clientY - r.top, true);
          lastTap = 0;
        } else lastTap = now;
      }
    }
    function onWheel(e) {
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) < 40 && e.deltaMode === 0 && e.ctrlKey) zoomAt(s * Math.exp(-e.deltaY / 100), e.clientX - r.left, e.clientY - r.top);
      else if (e.shiftKey) zoomAt(s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top);
      else { x -= e.deltaX; y -= e.deltaY; apply(false); }
    }
    function onResize() { var fx = (sw / 2 - x) / (cw * s), fy = (sh / 2 - y) / (ch * s); measure(); x = sw / 2 - fx * cw * s; y = sh / 2 - fy * ch * s; apply(false); }
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);
    return {
      zoomBy: function (f) { zoomAt(s * f, sw / 2, sh / 2, true); },
      fit: fit,
      destroy: function () { window.removeEventListener('resize', onResize); }
    };
  }

  // ------------------------------------------------------------------ interactive map (optional)
  function openLiveMap(focusId) {
    var view = document.getElementById('view');
    if (!trip.interactive) { location.hash = '#/map'; return; }
    view.className = 'view view-livemap';
    view.innerHTML = backBtn() + '<div id="livemap" class="livemap"><p class="hint" style="padding:16px">Loading map…</p></div>' +
      '<p class="hint">Blue dot = where you are (needs location permission). Tap a numbered pin to see the place.</p>' +
      '<p class="attrib">© OpenStreetMap contributors · Protomaps</p>';
    loadScripts(['map/maplibre-gl.js', 'map/pmtiles.js', 'map/basemaps.js', 'livemap.js'], ['map/maplibre-gl.css']).then(function () {
      window.TripLiveMap.open(document.getElementById('livemap'), trip, focusId || null);
    }).catch(function () {
      document.getElementById('livemap').innerHTML = '<p class="card">The moving map could not start on this phone. Use the picture maps or the address list instead.</p>';
    });
  }
  var loadedScripts = {};
  function loadScripts(js, css) {
    css.forEach(function (href) {
      if (loadedScripts[href]) return; loadedScripts[href] = 1;
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l);
    });
    return js.reduce(function (p, s) {
      return p.then(function () {
        if (loadedScripts[s]) return;
        return new Promise(function (res, rej) {
          var el = document.createElement('script'); el.src = s;
          el.onload = function () { loadedScripts[s] = 1; res(); }; el.onerror = rej;
          document.head.appendChild(el);
        });
      });
    }, Promise.resolve());
  }

  // ------------------------------------------------------------------ offline
  function setStatus() {
    var bar = document.getElementById('statusbar');
    if (!bar) return;
    if (!navigator.onLine) { bar.hidden = false; bar.className = 'statusbar offline'; bar.textContent = 'Offline · everything still works'; }
    else bar.hidden = true;
  }
  function watchConnection() {
    window.addEventListener('online', setStatus);
    window.addEventListener('offline', setStatus);
    setStatus();
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    var hadController = !!navigator.serviceWorker.controller;
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }
      if (reloading) return;
      reloading = true;
      try { sessionStorage.setItem('tc-updated', '1'); } catch (e) { /* ignore */ }
      location.reload();
    });
    navigator.serviceWorker.addEventListener('message', function (ev) {
      var d = ev.data || {};
      if (d.type === 'progress') showProgress(d.done, d.total);
      if (d.type === 'cached') checkReady();
      if (d.type === 'navigate' && d.hash) location.hash = d.hash;
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
      reg.update().catch(function () {});
      checkReady();
    }).catch(function () { /* no SW: still works online */ });
    try {
      if (sessionStorage.getItem('tc-updated')) { sessionStorage.removeItem('tc-updated'); setTimeout(function () { toast('✓ Your trip was updated', 4000); }, 600); }
    } catch (e) { /* ignore */ }
  }
  function showProgress(done, total) {
    var bar = document.getElementById('statusbar');
    if (!bar || !navigator.onLine) return;
    bar.hidden = false; bar.className = 'statusbar saving';
    bar.textContent = 'Saving for offline use… ' + Math.round(done / total * 100) + '%';
  }
  function checkReady() {
    if (!window.caches || !window.TRIP_VERSION) return;
    caches.has('trip-' + window.TRIP_VERSION).then(function (has) {
      if (!has) return;
      return caches.open('trip-' + window.TRIP_VERSION).then(function (c) { return c.match('trip.js'); }).then(function (r) {
        if (!r) return;
        var bar = document.getElementById('statusbar');
        if (bar && bar.classList.contains('saving')) setStatus();
        var key = 'tc-ready-' + window.TRIP_VERSION;
        try {
          if (localStorage.getItem(key)) return;
          localStorage.setItem(key, '1');
        } catch (e) { /* ignore */ }
        toast('✓ Ready for offline. The app now works without internet.', 5000);
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
