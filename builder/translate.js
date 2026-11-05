/* Trip Builder - automatic translation with the browser's built-in, on-device translator
 * (Chrome and Edge on a computer). Nothing is sent to a server and no account is needed.
 * Where it is not available, the user types the translation. */
window.BuilderTranslate = (function () {
  'use strict';
  // Speech codes that the translator knows under another code.
  var ALIAS = { nb: 'no', nn: 'no', he: 'iw' };
  var cache = {};

  function supported() { return typeof self !== 'undefined' && 'Translator' in self; }

  // e.g. 'pt-PT' -> ['pt-PT', 'pt'];  'nb-NO' -> ['nb-NO', 'nb', 'no']
  function candidates(code) {
    code = String(code || '').trim();
    if (!code) return [];
    var base = code.split('-')[0].toLowerCase(), out = [];
    if (code.toLowerCase() !== base) out.push(code);
    out.push(base);
    if (ALIAS[base]) out.push(ALIAS[base]);
    return out;
  }
  function options(target) { return { sourceLanguage: 'en', targetLanguage: target }; }

  // 'unsupported' (browser has no translator) | 'unavailable' (no such language) |
  // 'downloadable' (language pack downloaded on first use) | 'available'
  function status(code) {
    if (!supported()) return Promise.resolve('unsupported');
    var list = candidates(code);
    if (!list.length) return Promise.resolve('unavailable');
    return list.reduce(function (p, target) {
      return p.then(function (found) {
        if (found !== 'unavailable') return found;
        return Translator.availability(options(target)).catch(function () { return 'unavailable'; });
      });
    }, Promise.resolve('unavailable')).then(function (s) { return s === 'downloading' ? 'downloadable' : s; });
  }

  function translator(code) {
    if (!supported()) return Promise.reject(new Error('unsupported'));
    if (cache[code]) return cache[code];
    var list = candidates(code);
    cache[code] = list.reduce(function (p, target) {
      return p.catch(function () {
        return Translator.availability(options(target)).then(function (a) {
          if (a === 'unavailable') throw new Error('unavailable');
          // creating may download the language pack; Chrome requires a click or key press shortly before
          return Translator.create(options(target));
        });
      });
    }, Promise.reject(new Error('start'))).catch(function (e) { delete cache[code]; throw e; });
    return cache[code];
  }

  function translate(text, code) {
    if (!String(text || '').trim()) return Promise.resolve('');
    return translator(code).then(function (t) { return t.translate(text); }).then(function (r) { return String(r || '').trim(); });
  }

  return { supported: supported, status: status, translate: translate };
})();
