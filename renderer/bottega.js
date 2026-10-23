// Libro della bottega: le lezioni di un progetto, dedotte dai fatti (esiti, ripetizioni, correzioni).
// Si apre con openBottega(sid, lessonId) dal tabellone del piano, dal Nonno, o con openBottega(null, null, {key})
// dalla scheda BOTTEGA dell'atrio.
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const LOCALE = (window.AO_I18N && AO_I18N.locale) || 'it-IT';
  const day = t => new Date(t).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
  const when = t => new Date(t).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const LEVEL = { lesson: [tr('LEZIONE'), 'ok'], observation: [tr('OSSERVAZIONE'), ''] };

  const B = { open: false, q: null, focus: null, data: null, showObs: false, showIgnored: false, timer: null, sig: '' };
  function el() { return $('#bottega'); }

  window.openBottega = function (sid, lessonId, opts = {}) {
    B.open = true; B.focus = lessonId || null; B.sig = ''; B.scrolled = false;
    B.q = sid ? { sid } : opts.key ? { key: opts.key } : null;
    if (!B.q) return;
    el().hidden = false;
    el().innerHTML = `<p class="dim">${esc(tr('Carico il libro…'))}</p>`;
    load();
    clearInterval(B.timer);
    B.timer = setInterval(() => { if (B.open && B.data && B.data.learning && B.data.learning.running) load(); }, 1500);
  };
  window.closeBottega = function () { B.open = false; clearInterval(B.timer); const e = el(); if (e) e.hidden = true; };
  window.bottegaOpen = () => B.open;

  async function load() {
    try {
      const d = await (await fetch('/api/bottega?' + new URLSearchParams(B.q))).json();
      if (d && d.ok) { B.data = d; render(); }
      else el().innerHTML = `<span class="x">X</span><p>${esc(tr('Nessun libro per questo progetto.'))}</p>`, bindClose();
    } catch {}
  }
  async function post(path, body) {
    try { return await (await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...B.q, ...body }) })).json(); } catch { return { ok: false }; }
  }
  function bindClose() { const x = el().querySelector('.x'); if (x) x.onclick = closeBottega; }

  function render() {
    const d = B.data;
    const sig = JSON.stringify([d.lessons.map(l => [l.id, l.count, l.pinned, l.ignored, l.level]), d.learning, B.showObs, B.showIgnored, B.focus]);
    if (sig === B.sig) return;
    B.sig = sig;
    const live = window.sessions ? new Set(sessions().filter(s => !s.demo).map(s => s.id)) : new Set();
    const isDemo = window.sessions && sessions().some(s => s.demo && s.cwd === d.cwd);
    const lessons = d.lessons.filter(l => !l.ignored && l.level === 'lesson');
    const obs = d.lessons.filter(l => !l.ignored && l.level !== 'lesson');
    const ign = d.lessons.filter(l => l.ignored);
    const card = l => {
      const [lab, cls] = l.pinned ? [tr('FISSATA'), 'pin'] : l.ignored ? [tr('IGNORATA'), 'off'] : LEVEL[l.level] || LEVEL.observation;
      const period = l.first && l.last ? (day(l.first) === day(l.last) ? tr('il {a}', { a: day(l.first) }) : tr('dal {a} al {b}', { a: day(l.first), b: day(l.last) })) : '';
      const ev = l.evidence.map(e => `<li><span class="w">${esc(when(e.t))}</span> <span class="ag">${esc(e.agent || '')}</span> ${esc(e.excerpt || '')}` +
        (!isDemo && e.sid && !live.has(e.sid) ? ` <button data-replay="${esc(e.sid)}" data-at="${e.t}" title="${esc(tr('Rivedi la sessione da questo momento'))}">${esc(tr('REPLAY'))}</button>` : '') + '</li>').join('');
      return `<div class="lesson ${l.id === B.focus ? 'focus' : ''}" data-id="${esc(l.id)}">` +
        `<div class="lt"><b class="${cls}">${esc(lab)}</b> ${esc(l.title)}</div>` +
        `<div class="ld">${esc(l.detail)}${period ? ' · ' + esc(period) : ''}</div>` +
        (ev ? `<ul class="ev">${ev}</ul>` : '') +
        `<div class="la"><button data-act="pin">${esc(l.pinned ? tr('NON FISSARE') : tr('FISSA'))}</button>` +
        `<button data-act="${l.ignored ? 'unignore' : 'ignore'}">${esc(l.ignored ? tr('RIPRISTINA') : tr('IGNORA'))}</button>` +
        `<button data-act="forget" class="danger">${esc(tr('DIMENTICA'))}</button></div></div>`;
    };
    const lj = d.learning;
    const learn = lj && lj.running ? `<span class="prog">${esc(tr('Leggo l\'archivio: {a} di {b}…', { a: lj.done, b: lj.total }))}</span>`
      : `<button data-do="learn" title="${esc(tr('Rilegge le sessioni passate di questo progetto (non quelle aperte) e ne ricava le lezioni'))}">${esc(tr('IMPARA DALL\'ARCHIVIO'))}</button>` +
        (lj ? ` <span class="dim">${esc(lj.error ? tr('Finito, con un errore: {e}', { e: lj.error }) : trn('{n} caso nuovo', '{n} casi nuovi', lj.cases))}</span>` : '');
    el().innerHTML = `<span class="x" title="${esc(tr('Chiudi'))}">X</span>` +
      `<h3>${esc(tr('LIBRO DELLA BOTTEGA'))} · ${esc(d.name)}</h3>` +
      `<p class="honest">${esc(tr('Lezioni dedotte dai fatti (esiti, ripetizioni, correzioni) delle sessioni di questo progetto: indizi, non regole certe.'))}</p>` +
      `<div class="bar">${isDemo ? `<span class="dim">${esc(tr('Libro della demo: lezioni finte.'))}</span>` : learn}<span class="dim">${esc(trn('{n} sessione letta dall\'archivio', '{n} sessioni lette dall\'archivio', d.learnedSessions || 0))}</span></div>` +
      `<div class="list">` +
      (lessons.length ? lessons.map(card).join('') : `<p class="dim">${esc(tr('Ancora nessuna lezione: servono più casi, in più sessioni.'))}</p>`) +
      (obs.length ? `<button class="tog" data-tog="obs">${esc((B.showObs ? '▾ ' : '▸ ') + trn('{n} osservazione (un caso solo o peso basso)', '{n} osservazioni (un caso solo o peso basso)', obs.length))}</button>` + (B.showObs ? obs.map(card).join('') : '') : '') +
      (ign.length ? `<button class="tog" data-tog="ign">${esc((B.showIgnored ? '▾ ' : '▸ ') + trn('{n} ignorata', '{n} ignorate', ign.length))}</button>` + (B.showIgnored ? ign.map(card).join('') : '') : '') +
      `</div>`;
    bindClose();
    const e = el();
    for (const b of e.querySelectorAll('[data-act]')) b.onclick = async () => {
      const id = b.closest('.lesson').dataset.id, action = b.dataset.act;
      if (action === 'forget' && !confirm(tr('Dimenticare questa lezione? Se i fatti si ripetono, il libro la imparerà di nuovo.'))) return;
      await post('/api/bottega', { action, id });
      load();
    };
    for (const b of e.querySelectorAll('[data-tog]')) b.onclick = () => { if (b.dataset.tog === 'obs') B.showObs = !B.showObs; else B.showIgnored = !B.showIgnored; render(); };
    for (const b of e.querySelectorAll('[data-replay]')) b.onclick = async () => {
      const r = await post('/api/replay', { action: 'start', key: b.dataset.replay, at: Number(b.dataset.at) });
      if (r && r.ok) { closeBottega(); if (window.goTo) goTo('replay'); }
      else if (window.toast) toast((r && r.error) || tr('Sessione non trovata'), false);
    };
    const lb = e.querySelector('[data-do=learn]');
    if (lb) lb.onclick = async () => {
      const r = await post('/api/bottega/learn', {});
      if (!r.ok && window.toast) toast(r.reason || tr('Non riesco a leggere l\'archivio.'), false);
      load();
    };
    if (B.focus && !B.scrolled) { const f = e.querySelector('.lesson.focus'); if (f) { f.scrollIntoView({ block: 'center' }); B.scrolled = true; } }
  }
})();
