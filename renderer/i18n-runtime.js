// Traduzioni nella pagina. Il server prepara window.AO_I18N = { lang, locale, dict, langs } (vedi /i18n.js).
// La chiave è il testo italiano; se manca una traduzione resta l'italiano.
(function () {
  'use strict';
  const I = window.AO_I18N = window.AO_I18N || { lang: 'it', locale: 'it-IT', dict: {}, langs: { it: 'Italiano' } };
  const fill = (s, p) => !p ? s : s.replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined && p[k] !== null ? String(p[k]) : m));
  window.t = function t(s, p) { const v = I.dict[s]; return fill(typeof v === 'string' && v ? v : s, p); };
  window.tn = function tn(one, many, n, p) { return window.t(n === 1 ? one : many, Object.assign({ n }, p || {})); };
  // nel codice si usano tr() e trn(): "t" è spesso il nome della variabile del tempo
  window.tr = window.t; window.trn = window.tn;
  window.aoMoney = function (v, digits = 2) {
    if (v == null || !isFinite(v)) return '—';
    const s = Number(v).toFixed(digits);
    return I.lang === 'it' ? s.replace('.', ',') + ' $' : '$' + s;
  };
  // traduce i testi scritti direttamente nell'HTML (nodi di testo e attributi title/placeholder/aria-label)
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  window.translateDom = function (root) {
    if (I.lang === 'it') return;
    const walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentNode && /^(SCRIPT|STYLE)$/.test(n.parentNode.nodeName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const raw = n.nodeValue, key = raw.replace(/\s+/g, ' ').trim();
      if (!key) continue;
      const v = I.dict[key];
      if (typeof v === 'string' && v) n.nodeValue = raw.replace(/^(\s*)[\s\S]*?(\s*)$/, (m, a, b) => a + v + b);
    }
    for (const el of (root || document.body).querySelectorAll('[title],[placeholder],[aria-label]')) {
      for (const a of ATTRS) { const k = el.getAttribute(a); if (k && I.dict[k]) el.setAttribute(a, I.dict[k]); }
    }
  };
  document.documentElement.lang = I.lang;
  if (document.title && I.dict[document.title]) document.title = I.dict[document.title];
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => window.translateDom(document.body));
  else window.translateDom(document.body);
})();
