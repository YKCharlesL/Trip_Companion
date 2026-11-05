/* Trip Companion - shared renderer.
 * Pure functions: trip data in, HTML strings out. Used by the parents' app,
 * the builder's live preview and the no-JavaScript single-file export. */
(function (global) {
  'use strict';

  var SECTION_META = {
    accommodation: { title: 'Accommodation', icon: '🏨', cat: 'accommodation' },
    tours:         { title: 'Tours', icon: '🎟️', cat: 'tours' },
    travel:        { title: 'Travel details', icon: '✈️', cat: 'travel' },
    restaurants:   { title: 'Restaurants', icon: '🍽️', cat: 'restaurants' },
    sightseeing:   { title: 'Sightseeing', icon: '🏛️', cat: 'sightseeing' },
    documents:     { title: 'Important documents', icon: '📄', cat: 'other' },
    tips:          { title: 'Tips', icon: '💡', cat: 'other' },
    contacts:      { title: 'Contacts', icon: '📞', cat: 'other' }
  };
  var SECTION_ORDER = ['accommodation', 'tours', 'travel', 'restaurants', 'sightseeing', 'documents', 'tips', 'contacts'];

  // Pin colours on maps. Chosen to stay distinguishable with common colour-vision deficiencies
  // when combined with the number labels.
  var CATEGORIES = {
    accommodation: { label: 'Where you sleep', color: '#1d4ed8' },
    tours:         { label: 'Tours & pickup points', color: '#7e22ce' },
    travel:        { label: 'Stations & airport', color: '#0f766e' },
    restaurants:   { label: 'Restaurants', color: '#c2410c' },
    sightseeing:   { label: 'Sightseeing', color: '#15803d' },
    hospital:      { label: 'Hospital', color: '#dc2626' },
    other:         { label: 'Other places', color: '#475569' }
  };

  var ROLE_LABEL = { emergency: 'Emergency service', hospital: 'Hospital', embassy: 'Embassy', insurance: 'Travel insurance', pharmacy: 'Pharmacy', other: '' };
  // Contacts shown on the Help screen: ticked in the Builder, or (if never set) the usual help roles.
  var HELP_ROLES = ['emergency', 'hospital', 'embassy', 'insurance', 'pharmacy'];
  function onHelpScreen(e) { return e.help === true || (e.help !== false && HELP_ROLES.indexOf(e.role) >= 0); }
  // Order on the Help screen: emergency services (e.g. ski patrol) first, then the rest in Contacts order.
  function helpCards(trip) {
    var contacts = (trip.sections.filter(function (x) { return x.key === 'contacts'; })[0] || { entries: [] }).entries;
    var cards = contacts.filter(onHelpScreen);
    return cards.filter(function (e) { return e.role === 'emergency'; }).concat(cards.filter(function (e) { return e.role !== 'emergency'; }));
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
  function linkify(s) {
    return nl2br(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }

  function entryCategory(sectionKey, e) {
    if (sectionKey === 'contacts' && e.role === 'hospital') return 'hospital';
    var c = (SECTION_META[sectionKey] || {}).cat || 'other';
    return CATEGORIES[c] ? c : 'other';
  }

  // ---------------------------------------------------------------- time zones
  function tzOffsetMs(epoch, tz) {
    try {
      var f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      var p = {};
      f.formatToParts(new Date(epoch)).forEach(function (x) { p[x.type] = x.value; });
      var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
      return asUtc - Math.floor(epoch / 1000) * 1000;
    } catch (err) { return -new Date(epoch).getTimezoneOffset() * 60000; }
  }
  // Wall-clock date+time in a time zone -> epoch ms.
  function zonedEpoch(date, time, tz) {
    if (!date) return null;
    var d = date.split('-'), t = (time || '00:00').split(':');
    var guess = Date.UTC(+d[0], +d[1] - 1, +d[2], +t[0], +t[1] || 0);
    var epoch = guess - tzOffsetMs(guess, tz);
    var off2 = tzOffsetMs(epoch, tz);
    return guess - off2;
  }
  function todayIn(tz) {
    try {
      var p = {};
      new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      return p.year + '-' + p.month + '-' + p.day;
    } catch (err) { return new Date().toISOString().slice(0, 10); }
  }
  function addDays(dateStr, n) {
    var d = dateStr.split('-');
    var x = new Date(Date.UTC(+d[0], +d[1] - 1, +d[2] + n, 12));
    return x.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    var x = a.split('-'), y = b.split('-');
    return Math.round((Date.UTC(+y[0], +y[1] - 1, +y[2]) - Date.UTC(+x[0], +x[1] - 1, +x[2])) / 86400000);
  }
  function fmtDate(dateStr, opts) {
    if (!dateStr) return '';
    var d = dateStr.split('-');
    var x = new Date(Date.UTC(+d[0], +d[1] - 1, +d[2], 12));
    return x.toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }, opts || {}));
  }
  function relDay(dateStr, tz) {
    var today = todayIn(tz);
    if (dateStr === today) return 'Today';
    if (dateStr === addDays(today, 1)) return 'Tomorrow';
    if (dateStr === addDays(today, -1)) return 'Yesterday';
    return '';
  }
  function tzCity(tz) { return (tz || '').split('/').pop().replace(/_/g, ' '); }
  function timeLabel(trip, e, which) {
    var t = which === 'end' ? e.endTime : e.time;
    if (!t) return '';
    var tz = e.tz && e.tz !== trip.settings.timeZone ? ' (' + tzCity(e.tz) + ' time)' : '';
    return t + tz;
  }
  function whenLabel(trip, e) {
    var parts = [];
    if (e.date) {
      var rel = relDay(e.date, trip.settings.timeZone);
      parts.push((rel ? rel + ', ' : '') + fmtDate(e.date));
    }
    if (e.time) parts.push('at ' + timeLabel(trip, e));
    var s = parts.join(' ');
    if (e.endDate || e.endTime) {
      var end = [];
      if (e.endDate && e.endDate !== e.date) end.push(fmtDate(e.endDate));
      if (e.endTime) end.push(timeLabel(trip, e, 'end'));
      if (end.length) s += (s ? ' → ' : 'Until ') + end.join(' at ');
    }
    return s;
  }
  function durationLabel(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (ms < 10 * 60000) {
      var s = Math.max(0, Math.floor(ms / 1000));
      return Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
    }
    var d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    if (d > 0) return d + (d === 1 ? ' day ' : ' days ') + h + ' h';
    if (h > 0) return h + ' h ' + mm + ' min';
    return mm + ' min';
  }

  // ---------------------------------------------------------------- data helpers
  function allEntries(trip) {
    var out = [];
    trip.sections.forEach(function (s) {
      s.entries.forEach(function (e) { out.push({ section: s.key, entry: e }); });
    });
    return out;
  }
  function findEntry(trip, id) {
    var hit = null;
    trip.sections.forEach(function (s) {
      s.entries.forEach(function (e) { if (e.id === id) hit = { section: s.key, entry: e }; });
    });
    return hit;
  }
  function hasPin(e) { return typeof e.lat === 'number' && typeof e.lng === 'number' && !isNaN(e.lat) && !isNaN(e.lng); }

  // Plan items: every dated entry, plus check-out items for accommodation.
  function planItems(trip) {
    var tz = trip.settings.timeZone, items = [];
    allEntries(trip).forEach(function (x) {
      var e = x.entry;
      if (e.date) {
        items.push({ kind: 'start', section: x.section, entry: e, date: e.date, time: e.time || '',
          epoch: e.time ? zonedEpoch(e.date, e.time, e.tz || tz) : null,
          title: (x.section === 'accommodation' ? 'Check in: ' : '') + e.title });
      }
      if (x.section === 'accommodation' && e.endDate) {
        items.push({ kind: 'end', section: x.section, entry: e, date: e.endDate, time: e.endTime || '',
          epoch: e.endTime ? zonedEpoch(e.endDate, e.endTime, e.tz || tz) : null,
          title: 'Check out: ' + e.title });
      }
    });
    items.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (!a.time !== !b.time) return a.time ? 1 : -1;
      if (a.epoch != null && b.epoch != null && a.epoch !== b.epoch) return a.epoch - b.epoch;
      return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
    });
    return items;
  }
  function planDays(trip) {
    var days = [], byDate = {};
    planItems(trip).forEach(function (it) {
      if (!byDate[it.date]) { byDate[it.date] = { date: it.date, items: [] }; days.push(byDate[it.date]); }
      byDate[it.date].items.push(it);
    });
    // day numbers follow the calendar, so days without bookings still count
    days.forEach(function (d) { d.n = daysBetween(days[0].date, d.date) + 1; });
    return days;
  }
  function timedItems(trip) {
    return planItems(trip).filter(function (it) { return it.epoch != null; });
  }
  function nextItem(trip, now) {
    var list = timedItems(trip);
    for (var i = 0; i < list.length; i++) if (list[i].epoch > now) return list[i];
    return null;
  }

  function mapsUrl(e) {
    var q = hasPin(e) ? e.lat.toFixed(6) + ',' + e.lng.toFixed(6) : e.address;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q || '');
  }
  function telHref(phone) { return 'tel:' + String(phone || '').replace(/[^\d+*#]/g, ''); }

  function mapForEntry(trip, id) {
    var maps = trip.maps || [], hit = null;
    var found = findEntry(trip, id);
    var date = found && found.entry.date;
    maps.forEach(function (m) {
      var inMap = (m.legend || []).some(function (l) { return l.entryId === id; });
      if (!inMap) return;
      if (!hit) hit = m;
      if (date && m.date === date) hit = m;
    });
    // prefer the overview for undated entries
    if (found && !date) maps.forEach(function (m) {
      if (m.key === 'overview' && (m.legend || []).some(function (l) { return l.entryId === id; })) hit = m;
    });
    return hit;
  }

  // ---------------------------------------------------------------- icons (inline SVG)
  var ICON = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5M5.5 9.8V20h5v-5.5h3V20h5V9.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>',
    plan: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h3M13.5 14h3M7.5 17.5h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Zm0 0v14m6-12v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    say: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v10H11l-4.5 4v-4H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 10.5h.01M12 10.5h.01M16 10.5h.01" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5v9M7.5 12h9" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5 9 3l1.6 4.2-2 1.4a11 11 0 0 0 6.8 6.8l1.4-2L21 15l-.5 2.4A2.5 2.5 0 0 1 18 19.5 15.5 15.5 0 0 1 4.5 6 2.5 2.5 0 0 1 6.6 3.5Z" fill="currentColor"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.4" fill="currentColor"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M14 3v4h4M9 12h6M9 16h6" stroke="currentColor" stroke-width="2" fill="none"/></svg>'
  };

  // ---------------------------------------------------------------- pieces
  function assetSrc(trip, path) {
    var base = trip._assetBase || '';
    return base + path;
  }

  function docButtonsHtml(trip, e, mode) {
    if (!e.files || !e.files.length) return '';
    var out = '<div class="docs"><h4>Documents</h4><div class="doc-grid">';
    e.files.forEach(function (id) {
      var a = trip.assets[id];
      if (!a) return;
      var thumb = a.type === 'pdf' ? (a.pages && a.pages[0]) : a.src;
      var label = esc(a.label || a.name);
      if (mode === 'static') {
        out += '<div class="doc-static"><p class="doc-name">' + label + '</p>';
        (a.type === 'pdf' ? (a.pages || []) : [a.src]).forEach(function (p, i) {
          out += '<img loading="lazy" src="' + esc(assetSrc(trip, p)) + '" alt="' + label + ' page ' + (i + 1) + '">';
        });
        out += '</div>';
      } else {
        out += '<a class="doc-tile" href="#/doc/' + encodeURIComponent(id) + '">' +
          (thumb ? '<img loading="lazy" src="' + esc(assetSrc(trip, thumb)) + '" alt="">' : '<span class="doc-ph">' + ICON.doc + '</span>') +
          '<span>' + label + (a.type === 'pdf' && a.pages && a.pages.length > 1 ? ' · ' + a.pages.length + ' pages' : '') + '</span></a>';
      }
    });
    return out + '</div></div>';
  }

  function entryCardHtml(trip, sectionKey, e, mode) {
    mode = mode || 'app';
    var cat = entryCategory(sectionKey, e);
    var meta = SECTION_META[sectionKey] || {};
    var h = '<article class="card entry cat-' + cat + (e.role === 'emergency' ? ' role-emergency' : '') + '" id="entry-' + esc(e.id) + '">';
    h += '<p class="eyebrow">' + (meta.icon || '') + ' ' + esc(ROLE_LABEL[e.role] || meta.title || '') + '</p>';
    h += '<h3>' + esc(e.title || 'Untitled') + '</h3>';
    var when = whenLabel(trip, e);
    if (when) h += '<p class="when">' + esc(when) + '</p>';
    if (e.details) h += '<p class="details">' + linkify(e.details) + '</p>';
    if (e.address) {
      h += '<div class="address-block">' +
        (mode === 'static' ? '<p class="label"' + (takeMeTo(trip) ? ' lang="' + esc(trip.settings.speechLang) + '">' + esc(takeMeTo(trip)) : '>Address') + '</p><p class="address">' + nl2br(e.address) + '</p>'
          : '<button class="address" data-copy="' + esc(e.address) + '" aria-label="Copy address">' +
            '<span class="label">Address · tap to copy</span>' + nl2br(e.address) + '</button>') +
        (hasPin(e) ? '<p class="coords">GPS ' + e.lat.toFixed(5) + ', ' + e.lng.toFixed(5) + '</p>' : '') + '</div>';
    }
    var btns = '';
    if (e.address || hasPin(e)) {
      btns += '<a class="btn" href="' + esc(mapsUrl(e)) + '" target="_blank" rel="noopener">' + ICON.pin + ' Open in Maps</a>';
      if (mode !== 'static' && e.address) btns += '<a class="btn" href="#/say/place/' + encodeURIComponent(e.id) + '">' + ICON.say + ' Say it</a>';
    }
    if (e.phone) btns += '<a class="btn ' + (e.role === 'emergency' ? 'btn-sos' : 'btn-call') + '" href="' + esc(telHref(e.phone)) + '">' + ICON.phone + ' Call ' + esc(e.phone) + '</a>';
    if (btns) h += '<div class="btn-row">' + btns + '</div>';
    if (e.ref) {
      var refLabel = e.role === 'insurance' ? 'Policy number' : 'Booking reference';
      h += mode === 'static'
        ? '<div class="ref"><span class="label">' + refLabel + '</span><span class="ref-code">' + esc(e.ref) + '</span></div>'
        : '<button class="ref" data-copy="' + esc(e.ref) + '"><span class="label">' + refLabel + ' · tap to copy</span><span class="ref-code">' + esc(e.ref) + '</span></button>';
    }
    if (e.notes) h += '<div class="notes"><span class="label">Notes</span><p>' + linkify(e.notes) + '</p></div>';
    h += docButtonsHtml(trip, e, mode);
    return h + '</article>';
  }

  function sectionsWithContent(trip) {
    return trip.sections.filter(function (s) { return s.entries.length; });
  }

  function countdownHtml(trip, now) {
    var it = nextItem(trip, now);
    if (!it) {
      var any = timedItems(trip).length;
      return '<div class="countdown done"><p class="eyebrow">Next booking</p><p class="cd-title">' +
        (any ? 'No more bookings. Have a good trip home!' : 'No timed bookings yet.') + '</p></div>';
    }
    var rel = relDay(it.date, trip.settings.timeZone);
    return '<a class="countdown" href="#/entry/' + encodeURIComponent(it.entry.id) + '">' +
      '<p class="eyebrow">Next: ' + (SECTION_META[it.section] || {}).icon + ' ' + esc((SECTION_META[it.section] || {}).title) + '</p>' +
      '<p class="cd-title">' + esc(it.title) + '</p>' +
      '<p class="cd-when">' + esc((rel || fmtDate(it.date)) + ' at ' + timeLabel(trip, it.kind === 'end' ? { time: it.entry.endTime, tz: it.entry.tz } : it.entry)) + '</p>' +
      '<p class="cd-in">in <strong data-countdown="' + it.epoch + '">' + esc(durationLabel(it.epoch - now)) + '</strong></p></a>';
  }

  function homeHtml(trip, now) {
    var s = trip.settings;
    var h = '<header class="hero"><h1>' + esc(s.tripName) + '</h1>' +
      (s.destination ? '<p>' + esc(s.destination) + '</p>' : '') + '</header>';
    h += countdownHtml(trip, now);
    h += '<div id="reminder-slot"></div>';
    h += '<nav class="tiles" aria-label="Sections">';
    trip.sections.forEach(function (sec) {
      if (!sec.entries.length) return;
      var meta = SECTION_META[sec.key];
      h += '<a class="tile" href="#/section/' + sec.key + '"><span class="tile-icon">' + meta.icon + '</span>' +
        '<span class="tile-label">' + esc(meta.title) + '</span><span class="tile-count">' + sec.entries.length + '</span></a>';
    });
    h += '</nav>';
    return h;
  }

  function sectionHtml(trip, key) {
    var sec = trip.sections.filter(function (s) { return s.key === key; })[0];
    if (!sec) return '<p>Not found.</p>';
    var meta = SECTION_META[key];
    var h = '<h2 class="page-title">' + meta.icon + ' ' + esc(meta.title) + '</h2>';
    sec.entries.forEach(function (e) { h += entryCardHtml(trip, key, e); });
    return h;
  }

  function planHtml(trip, mode) {
    var days = planDays(trip), tz = trip.settings.timeZone;
    var h = '<h2 class="page-title">' + (mode === 'static' ? '🗓️ ' : '') + 'Day by day</h2>';
    if (!days.length) return h + '<p class="card">No dated bookings yet.</p>';
    var today = todayIn(tz);
    days.forEach(function (d, i) {
      var gap = i ? daysBetween(days[i - 1].date, d.date) - 1 : 0;
      if (gap > 0) {
        var from = addDays(days[i - 1].date, 1), to = addDays(d.date, -1);
        h += '<p class="day-free">' + (gap === 1 ? 'Day ' + (d.n - 1) + ' · ' + esc(fmtDate(from))
          : 'Days ' + (d.n - gap) + '–' + (d.n - 1) + ' · ' + esc(from.slice(0, 7) === to.slice(0, 7) ? +from.slice(8) + '–' + fmtDate(to, { weekday: undefined }) : fmtDate(from, { weekday: undefined }) + ' – ' + fmtDate(to, { weekday: undefined }))) +
          '<br>Nothing booked</p>';
      }
      var rel = relDay(d.date, tz);
      var dayMap = (trip.maps || []).filter(function (m) { return m.date === d.date; })[0];
      h += '<section class="day' + (d.date === today ? ' is-today' : '') + (d.date < today ? ' is-past' : '') + '" id="day-' + d.date + '">';
      h += '<h3 class="day-title"><span>Day ' + d.n + (rel ? ' · ' + rel : '') + '</span>' + esc(fmtDate(d.date)) + '</h3>';
      d.items.forEach(function (it) {
        var e = it.entry, meta = SECTION_META[it.section];
        var t = it.kind === 'end' ? timeLabel(trip, { time: e.endTime, tz: e.tz }) : timeLabel(trip, e);
        var inner = '<span class="pi-time">' + esc(t || '—') + '</span><span class="pi-body"><span class="pi-title">' + meta.icon + ' ' + esc(it.title) + '</span>' +
          (e.address && it.kind !== 'end' ? '<span class="pi-addr">' + esc(e.address.split('\n')[0]) + '</span>' : '') + '</span>';
        h += mode === 'static'
          ? '<a class="plan-item" href="#entry-' + esc(e.id) + '">' + inner + '</a>'
          : '<a class="plan-item" href="#/entry/' + encodeURIComponent(e.id) + '">' + inner + '</a>';
      });
      if (dayMap) h += '<a class="btn btn-wide" href="' + (mode === 'static' ? '#map-' + esc(dayMap.key) : '#/map/' + encodeURIComponent(dayMap.key)) + '">' + ICON.map + ' Map of this day</a>';
      h += '</section>';
    });
    return h;
  }

  function legendHtml(trip, m, mode) {
    var h = '<ol class="legend">';
    (m.legend || []).forEach(function (l) {
      var href = mode === 'static' ? '#entry-' + esc(l.entryId) : '#/entry/' + encodeURIComponent(l.entryId);
      h += '<li><a href="' + href + '"><span class="num" style="background:' + CATEGORIES[l.cat].color + '">' + esc(l.n) + '</span>' +
        '<span class="lg-body"><span class="lg-title">' + esc(l.title) + '</span>' + (l.time ? '<span class="lg-sub">' + esc(l.time) + '</span>' : '') + '</span></a></li>';
    });
    return h + '</ol>';
  }

  function mapsHtml(trip, mode) {
    var h = '<h2 class="page-title">' + (mode === 'static' ? '🗺️ ' : '') + 'Maps</h2>';
    // day maps first, the overview last
    var maps = (trip.maps || []).slice().sort(function (a, b) { return (a.key === 'overview') - (b.key === 'overview'); });
    if (trip.interactive && mode !== 'static') {
      h += '<a class="btn btn-wide btn-primary" href="#/livemap">' + ICON.map + ' Moving map with “You are here”</a>';
    }
    if (!maps.length) h += '<p class="card">No maps in this trip yet. The address list below always works.</p>';
    maps.forEach(function (m) {
      h += '<section class="card map-card" id="map-' + esc(m.key) + '"><h3>' + esc(m.title) + '</h3>' + (m.subtitle ? '<p class="when">' + esc(m.subtitle) + '</p>' : '');
      var img = '<img class="map-img" loading="lazy" src="' + esc(assetSrc(trip, m.src)) + '" alt="Map: ' + esc(m.title) + '" width="' + m.w + '" height="' + m.h + '">';
      h += mode === 'static' ? img : '<a href="#/mapview/' + encodeURIComponent(m.key) + '" aria-label="Open map full screen">' + img + '</a><a class="btn btn-wide" href="#/mapview/' + encodeURIComponent(m.key) + '">Open full screen</a>';
      h += '<p class="hint">Tap a name to see its details.</p>' + legendHtml(trip, m, mode) + '</section>';
    });
    h += mode === 'static' ? addressListHtml(trip, mode) : '<a class="btn btn-wide" href="#/addresses">' + ICON.pin + ' All addresses with GPS (plain list)</a>';
    return h;
  }

  function mapPageHtml(trip, key) {
    var m = (trip.maps || []).filter(function (x) { return x.key === key; })[0];
    if (!m) return '<p class="card">Map not found.</p>';
    return '<h2 class="page-title">' + esc(m.title) + '</h2>' + (m.subtitle ? '<p class="when">' + esc(m.subtitle) + '</p>' : '') +
      '<a href="#/mapview/' + encodeURIComponent(m.key) + '"><img class="map-img" src="' + esc(assetSrc(trip, m.src)) + '" alt="Map" width="' + m.w + '" height="' + m.h + '"></a>' +
      '<a class="btn btn-wide" href="#/mapview/' + encodeURIComponent(m.key) + '">Open full screen</a>' +
      '<p class="hint">Tap a name to see its details.</p>' + legendHtml(trip, m, 'app');
  }

  function addressListHtml(trip, mode) {
    var h = '<section id="addresses"><h2 class="page-title">All addresses</h2><p class="hint">This list works even without maps or internet. Show it to a taxi driver, or copy the GPS numbers into any map app.</p>';
    allEntries(trip).forEach(function (x) {
      var e = x.entry;
      if (!e.address && !hasPin(e)) return;
      var cat = entryCategory(x.section, e);
      h += '<div class="card addr-item"><h3><span class="dot" style="background:' + CATEGORIES[cat].color + '"></span>' + esc(e.title) + '</h3>' +
        (e.address ? '<p class="address">' + nl2br(e.address) + '</p>' : '') +
        (hasPin(e) ? (mode === 'static' ? '<p class="coords">GPS ' + e.lat.toFixed(5) + ', ' + e.lng.toFixed(5) + '</p>'
          : '<button class="coords" data-copy="' + e.lat.toFixed(6) + ', ' + e.lng.toFixed(6) + '">GPS ' + e.lat.toFixed(5) + ', ' + e.lng.toFixed(5) + ' · tap to copy</button>') : '') +
        '<div class="btn-row"><a class="btn" href="' + esc(mapsUrl(e)) + '" target="_blank" rel="noopener">' + ICON.pin + ' Open in Maps</a>' +
        (mode !== 'static' ? '<a class="btn" href="#/entry/' + encodeURIComponent(e.id) + '">Details</a>' : '') + '</div></div>';
    });
    return h + '</section>';
  }

  // ---------------------------------------------------------------- phrases
  function fill(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, function (_, k) { return vars[k] != null ? vars[k] : ''; });
  }
  function takeMeTo(trip) { return String((trip.settings.phraseTemplates || {}).takeMeTo || '').trim(); }
  // The two phrases for one place: "Please take me to …" (+ address) and, if translated, "Where is …?".
  function placePhrases(trip, e) {
    if (!e.address) return [];
    var t = trip.settings.phraseTemplates || {};
    var vars = { place: e.localName || e.title, address: e.address.replace(/\n/g, ', ') };
    var take = takeMeTo(trip);
    var out = [{ kind: 'take', en: 'Please take me to this address',
      // without a translation, show English and speak only the address
      heading: take ? fill(take, vars) : 'Please take me to this address:', local: e.address,
      extra: e.address.toLowerCase().indexOf(String(vars.place).toLowerCase()) === 0 ? '' : vars.place, // skip if the address already starts with it
      speak: take ? fill(take, vars) + (/\{address\}/.test(take) ? '' : ' ' + vars.address) : vars.address }];
    if (t.whereIs) out.push({ kind: 'where', en: 'Where is ' + e.title + '?', heading: '', local: fill(t.whereIs, vars), extra: '', speak: fill(t.whereIs, vars) });
    return out;
  }
  function addressCards(trip) {
    var out = [];
    allEntries(trip).forEach(function (x) {
      placePhrases(trip, x.entry).forEach(function (c) { c.id = c.kind + '/' + x.entry.id; c.entry = x.entry; out.push(c); });
    });
    return out;
  }
  function sayHtml(trip) {
    var s = trip.settings;
    var h = '<h2 class="page-title">Say it in ' + esc(s.langName || 'the local language') + '</h2>';
    h += '<div class="phrase-grid">';
    (trip.phrases || []).forEach(function (p) {
      h += '<a class="phrase" href="#/say/p/' + encodeURIComponent(p.id) + '"><span class="ph-en">' + esc(p.en) + '</span><span class="ph-local" lang="' + esc(s.speechLang) + '">' + esc(p.local) + '</span></a>';
    });
    return h + '</div>';
  }
  function phraseById(trip, kind, id) {
    var p = (trip.phrases || []).filter(function (x) { return x.id === id; })[0];
    return p ? { en: p.en, heading: '', local: p.local, extra: p.hint || '', speak: p.local } : null;
  }
  function phraseBlockHtml(trip, c) {
    return '<p class="pb-en">' + esc(c.en) + '</p>' +
      (c.heading ? '<p class="pb-heading">' + esc(c.heading) + '</p>' : '') +
      '<p class="pb-local">' + nl2br(c.local) + '</p>' +
      (c.extra ? '<p class="pb-extra">' + esc(c.extra) + '</p>' : '') +
      '<button class="btn btn-primary btn-play" data-speak="' + esc(c.speak) + '">' + ICON.play + ' Play</button>';
  }
  var PLAY_HINT = '<p class="hint">Turn up the volume. If nothing is heard, just show the screen.</p>';
  function phraseBigHtml(trip, c) {
    return '<div class="phrase-big" lang="' + esc(trip.settings.speechLang) + '">' + phraseBlockHtml(trip, c) + PLAY_HINT + '</div>';
  }
  function placeSayHtml(trip, e) {
    var h = '<h2 class="page-title">' + esc(e.title) + '</h2>';
    placePhrases(trip, e).forEach(function (c) {
      h += '<section class="card phrase-big place-phrase" lang="' + esc(trip.settings.speechLang) + '">' + phraseBlockHtml(trip, c) + '</section>';
    });
    return h + PLAY_HINT;
  }

  // ---------------------------------------------------------------- help
  function helpHtml(trip, mode) {
    var s = trip.settings;
    var h = '<h2 class="page-title">' + (mode === 'static' ? '🆘 ' : '') + 'Help</h2>';
    h += '<a class="sos" href="' + esc(telHref(s.emergencyNumber)) + '"><span class="sos-big">' + ICON.phone + ' ' + esc(s.emergencyNumber) + '</span><span class="sos-label">Emergency</span></a>';
    if (s.myPhone) h += '<a class="btn btn-wide btn-call btn-big" href="' + esc(telHref(s.myPhone)) + '">' + ICON.phone + ' Call ' + esc(s.myName || 'family') + '<small>' + esc(s.myPhone) + '</small></a>';
    var contacts = (trip.sections.filter(function (x) { return x.key === 'contacts'; })[0] || { entries: [] }).entries;
    helpCards(trip).forEach(function (e) { h += entryCardHtml(trip, 'contacts', e, mode); });
    if (contacts.some(function (e) { return !onHelpScreen(e); }) && mode !== 'static') h += '<a class="btn btn-wide" href="#/section/contacts">' + ICON.phone + ' All contacts</a>';
    return h;
  }

  // ---------------------------------------------------------------- whole document (no-JS single file)
  function staticDocumentHtml(trip) {
    var s = trip.settings;
    var h = '<div id="static-doc" class="static-doc"><a id="top"></a>';
    h += '<header class="hero"><h1>' + esc(s.tripName) + '</h1>' + (s.destination ? '<p>' + esc(s.destination) + '</p>' : '') + '</header>';
    h += '<p class="card static-note">This is the backup copy of your trip. Everything is in this one page: scroll down, or tap a heading below.</p>';
    h += '<nav class="tiles static-toc"><a class="tile" href="#help"><span class="tile-icon">🆘</span><span class="tile-label">Help</span></a>' +
      '<a class="tile" href="#plan"><span class="tile-icon">🗓️</span><span class="tile-label">Day by day</span></a>';
    sectionsWithContent(trip).forEach(function (sec) {
      var meta = SECTION_META[sec.key];
      h += '<a class="tile" href="#section-' + sec.key + '"><span class="tile-icon">' + meta.icon + '</span><span class="tile-label">' + esc(meta.title) + '</span></a>';
    });
    h += '<a class="tile" href="#maps"><span class="tile-icon">🗺️</span><span class="tile-label">Maps</span></a>' +
      '<a class="tile" href="#say"><span class="tile-icon">💬</span><span class="tile-label">Phrases</span></a></nav>';
    h += '<section id="help">' + helpHtml(trip, 'static') + '</section>';
    h += '<section id="plan">' + planHtml(trip, 'static') + '</section>';
    sectionsWithContent(trip).forEach(function (sec) {
      var meta = SECTION_META[sec.key];
      h += '<section id="section-' + sec.key + '"><h2 class="page-title">' + meta.icon + ' ' + esc(meta.title) + '</h2>';
      sec.entries.forEach(function (e) { h += entryCardHtml(trip, sec.key, e, 'static'); });
      h += '<p><a href="#top">↑ Back to top</a></p></section>';
    });
    h += '<section id="maps">' + mapsHtml(trip, 'static') + '</section>';
    h += '<section id="say"><h2 class="page-title">💬 Phrases in ' + esc(s.langName || 'the local language') + '</h2><p class="hint">Show these to people.</p>';
    (trip.phrases || []).forEach(function (p) {
      h += '<div class="card phrase-static"><p class="ph-en">' + esc(p.en) + '</p><p class="ph-local" lang="' + esc(s.speechLang) + '">' + esc(p.local) + '</p></div>';
    });
    h += '</section><p class="attrib">Maps © OpenStreetMap contributors · Protomaps</p></div>';
    return h;
  }

  // ---------------------------------------------------------------- colour palette
  // Builds the app palette around one brand colour (default amber #FCB300) and white.
  // The brand colour is only used as a fill; text on it is near-black or white, whichever
  // contrasts more, and brand-coloured text on white is darkened until it reaches 7:1 (WCAG AAA).
  var DEFAULT_BRAND = '#FCB300', INK = '#1A1A1A', WHITE = '#FFFFFF', DARK_BG = '#121212', DARK_CARD = '#1E1E1E';
  function hexRgb(h) { h = String(h || DEFAULT_BRAND).replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); return [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16) || 0; }); }
  function rgbHex(c) { return '#' + c.map(function (v) { return ('0' + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2); }).join('').toUpperCase(); }
  function luminance(h) {
    var c = hexRgb(h).map(function (v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { var x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(a, b, t) { var x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map(function (v, i) { return v + (y[i] - v) * t; })); }
  function towards(c, target, bg, ratio) { // mix c towards target until it contrasts enough with bg
    for (var t = 0; t <= 1.0001; t += 0.02) { var m = mix(c, target, t); if (contrast(m, bg) >= ratio) return m; }
    return target;
  }
  function palette(color) {
    var b = /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color || '') ? rgbHex(hexRgb(color)) : DEFAULT_BRAND;
    return {
      brand: b,
      onBrand: contrast(INK, b) >= contrast(WHITE, b) ? INK : WHITE,
      ink: towards(b, '#000000', WHITE, 7),          // brand-toned text on white
      line: towards(b, '#000000', WHITE, 3),         // brand-toned borders (non-text 3:1)
      tint: mix(b, WHITE, 0.86),                     // light brand wash for buttons and notes
      tint2: mix(b, WHITE, 0.66),
      inkDark: towards(b, WHITE, DARK_BG, 7),        // dark mode
      tintDark: mix(b, DARK_CARD, 0.82),
      onTintDark: towards(mix(b, WHITE, 0.6), WHITE, mix(b, DARK_CARD, 0.82), 7)
    };
  }

  // Best voice for a language: exact match (pt-PT), then same language (pt-*); prefer the higher-quality
  // voices (Premium/Enhanced/Natural/Neural/Google/Siri), then voices installed on the device.
  function pickVoice(voices, lang) {
    var l = String(lang || '').toLowerCase().replace('_', '-'), base = l.split('-')[0];
    var norm = function (v) { return v.lang.toLowerCase().replace('_', '-'); };
    var list = voices.filter(function (v) { return norm(v) === l; });
    if (!list.length) list = voices.filter(function (v) { return norm(v).split('-')[0] === base; });
    var score = function (v) { return (/premium|enhanced|natural|neural|google|siri/i.test(v.name) ? 2 : 0) + (v.localService ? 1 : 0); };
    return list.sort(function (a, b) { return score(b) - score(a); })[0] || null;
  }

  global.TripRender = {
    palette: palette, contrast: contrast, pickVoice: pickVoice, onHelpScreen: onHelpScreen, helpCards: helpCards, ROLE_LABEL: ROLE_LABEL, DEFAULT_BRAND: DEFAULT_BRAND,
    SECTION_META: SECTION_META, SECTION_ORDER: SECTION_ORDER, CATEGORIES: CATEGORIES, ICON: ICON,
    esc: esc, entryCategory: entryCategory, zonedEpoch: zonedEpoch, todayIn: todayIn, fmtDate: fmtDate,
    relDay: relDay, durationLabel: durationLabel, timeLabel: timeLabel, whenLabel: whenLabel,
    allEntries: allEntries, findEntry: findEntry, hasPin: hasPin, planItems: planItems, planDays: planDays,
    timedItems: timedItems, nextItem: nextItem, mapsUrl: mapsUrl, telHref: telHref, mapForEntry: mapForEntry,
    entryCardHtml: entryCardHtml, homeHtml: homeHtml, countdownHtml: countdownHtml, sectionHtml: sectionHtml,
    planHtml: planHtml, mapsHtml: mapsHtml, mapPageHtml: mapPageHtml, addressListHtml: addressListHtml,
    sayHtml: sayHtml, phraseById: phraseById, phraseBigHtml: phraseBigHtml, helpHtml: helpHtml,
    staticDocumentHtml: staticDocumentHtml, addressCards: addressCards, placePhrases: placePhrases, placeSayHtml: placeSayHtml, legendHtml: legendHtml
  };
})(typeof window !== 'undefined' ? window : this);
