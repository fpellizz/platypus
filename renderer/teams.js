// Squadre di agenti di una sessione: i Workflow (esecuzioni, fasi, avanzamento, costi, analisi a fine lavoro),
// le squadre e i reparti (chi lavora, chi aspetta, chi ha finito) e i messaggi tra agenti (SendMessage).
// Si apre con openTeams(sid) dalla bacheca del piano (SQUADRE) o con il tasto W; legge solo l'istantanea della sessione.
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  const LOCALE = (window.AO_I18N && AO_I18N.locale) || 'it-IT';
  const hhmm = t => (t ? new Date(t).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) : '');
  const dur = ms => { if (!(ms > 0)) return '—'; const s = Math.round(ms / 1000); return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's' : Math.floor(s / 3600) + 'h ' + String(Math.floor(s % 3600 / 60)).padStart(2, '0') + 'm'; };
  const cash = v => (window.money ? money(v) : '$' + (v || 0).toFixed(2));
  const toks = n => (window.tokText ? tokText(n) : String(n || 0));
  const STATUS = {
    running: [tr('IN CORSO'), 'run'], done: [tr('FINITO'), 'ok'], completed: [tr('FINITO'), 'ok'], success: [tr('FINITO'), 'ok'],
    failed: [tr('FALLITO'), 'ko'], error: [tr('FALLITO'), 'ko'], cancelled: [tr('ANNULLATO'), 'off'], canceled: [tr('ANNULLATO'), 'off'], killed: [tr('FERMATO'), 'off'], stopped: [tr('FERMATO'), 'off'],
  };
  const FINAL = st => !!STATUS[st] && st !== 'running';

  const T = { open: false, sid: null, timer: null, sig: '' };
  function el() { return $('#teams'); }

  window.openTeams = function (sid) {
    T.open = true; T.sid = sid; T.sig = '';
    el().hidden = false;
    render();
    clearInterval(T.timer);
    T.timer = setInterval(() => { if (T.open) render(); }, 1000);
  };
  window.closeTeams = function () { T.open = false; clearInterval(T.timer); const e = el(); if (e) e.hidden = true; };
  window.teamsOpen = () => T.open;

  // c'è qualcosa da mostrare? (la bacheca mostra il pulsante SQUADRE solo allora)
  window.teamsInfo = function (s) {
    if (!s) return { workflows: 0, teams: 0, messages: 0, any: false };
    const g = groupsOf(s);
    const r = { workflows: (s.workflows || []).length, teams: g.length, messages: (s.messages || []).length };
    r.any = !!(r.workflows || r.teams || r.messages);
    return r;
  };

  // squadre (teamName) e reparti (un sottoagente che ha lanciato altri agenti); i Workflow hanno la loro sezione
  function groupsOf(s) {
    const subs = s.subs || [], out = [];
    const teams = new Map();
    for (const a of subs) if (a.team && !a.workflow) { if (!teams.has(a.team)) teams.set(a.team, []); teams.get(a.team).push(a); }
    for (const [name, members] of teams) out.push({ kind: 'team', title: tr('SQUADRA {name}', { name: name.toUpperCase() }), members });
    const kids = new Map();
    for (const a of subs) if (a.parentId && !a.workflow) { if (!kids.has(a.parentId)) kids.set(a.parentId, []); kids.get(a.parentId).push(a); }
    for (const [pid, members] of kids) {
      const boss = subs.find(a => a.id === pid);
      if (boss) out.push({ kind: 'dept', title: tr('REPARTO DI {name}', { name: agentName(boss) }), boss, members });
    }
    return out;
  }

  const stateOf = a => (a.finished || a.status === 'done' ? 'done' : a.status === 'waiting' ? 'wait' : a.status === 'idle' ? 'idle' : 'run');

  function runCard(r, now) {
    const [lab, cls] = STATUS[r.status] || STATUS.running;
    const elapsed = r.durationMs || (r.startedAt ? (FINAL(r.status) ? (r.endedAt || now) - r.startedAt : now - r.startedAt) : 0);
    const phases = (r.phases || []).filter(p => p.total || p.title);
    const bar = p => {
      const n = Math.max(1, p.total), w = x => (100 * x / n).toFixed(1) + '%';
      return `<span class="pbar" title="${esc(tr('{done} fatti, {running} in corso, {failed} falliti, {stopped} fermati', p))}"><i class="d" style="width:${w(p.done)}"></i><i class="r" style="width:${w(p.running)}"></i><i class="f" style="width:${w(p.failed)}"></i><i class="s" style="width:${w(p.stopped)}"></i></span>`;
    };
    const rows = phases.map(p => `<div class="ph${p.running ? ' now' : ''}"><span class="pt" title="${esc(p.detail || p.title)}">${esc(p.title || tr('senza fase'))}</span>${p.total ? bar(p) : '<span class="pbar empty"></span>'}` +
      `<span class="pn">${p.total ? `${p.done}/${p.total}` : tr('in attesa')}${p.failed ? ` · <b class="ko">${p.failed} ✗</b>` : ''}</span>` +
      `<span class="pc">${p.total ? cash(p.cost) + ' · ' + dur(p.t1 && p.t0 ? p.t1 - p.t0 : 0) : ''}</span></div>`).join('');
    const failed = (r.agents || []).filter(a => a.state === 'failed');
    const live = (r.agents || []).filter(a => a.state === 'running');
    let analysis = '';
    if (FINAL(r.status) || (!live.length && (r.agents || []).length)) {
      const withT = phases.filter(p => p.total && p.t1 > p.t0);
      const longest = withT.slice().sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0))[0];
      const priciest = phases.filter(p => p.total).sort((a, b) => b.cost - a.cost)[0];
      const slowest = (r.agents || []).filter(a => a.t1 > a.t0).sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0))[0];
      const keys = new Map(); for (const a of r.agents || []) if (a.key) keys.set(a.key, (keys.get(a.key) || 0) + 1);
      const retried = [...keys.values()].filter(n => n > 1).length;
      const total = (r.agents || []).length;
      const bits = [
        longest && tr('fase più lunga: {p} ({d})', { p: longest.title || tr('senza fase'), d: dur(longest.t1 - longest.t0) }),
        priciest && priciest !== longest && tr('più costosa: {p} ({c})', { p: priciest.title || tr('senza fase'), c: cash(priciest.cost) }),
        slowest && tr('agente più lento: {a} ({d})', { a: slowest.label || slowest.type || slowest.id, d: dur(slowest.t1 - slowest.t0) }),
        total && tr('falliti {n} su {t}', { n: failed.length, t: total }),
        retried && tr('{n} compiti rifatti', { n: retried }),
      ].filter(Boolean);
      if (bits.length) analysis = `<div class="an"><b>${esc(tr('ANALISI'))}</b> ${bits.map(esc).join(' · ')}</div>`;
    }
    return `<div class="wf ${cls}">` +
      `<div class="rh"><b class="chip ${cls}">${esc(lab)}</b> <span class="rn">${esc(r.name || tr('workflow'))}</span>${r.description ? ` <span class="dim">${esc(r.description)}</span>` : ''}</div>` +
      `<div class="rm">${esc(tr('{n} agenti', { n: r.agentCount || (r.agents || []).length }))}${live.length ? ' · <span class="live">' + esc(tr('{n} al lavoro', { n: live.length })) + '</span>' : ''} · ${hhmm(r.startedAt)} · ${dur(elapsed)} · ${cash(r.cost)} · ${esc(toks(r.totalTokens))} ${esc(tr('token'))}${r.totalToolCalls ? ' · ' + esc(tr('{n} strumenti', { n: r.totalToolCalls })) : ''}</div>` +
      (rows || `<div class="dim">${esc(tr('Ancora nessun agente avviato.'))}</div>`) +
      (failed.length ? `<div class="fl">${esc(tr('Falliti:'))} ${failed.slice(0, 8).map(a => `<span>${esc(a.label || a.type || a.id)}</span>`).join(' ')}${failed.length > 8 ? ' …' : ''}</div>` : '') +
      analysis + (r.summary ? `<div class="sm">${esc(r.summary)}</div>` : '') + '</div>';
  }

  function groupCard(g) {
    const c = { run: 0, wait: 0, idle: 0, done: 0 };
    for (const a of g.members) c[stateOf(a)]++;
    const counts = [c.run && tr('{n} al lavoro', { n: c.run }), c.wait && tr('{n} aspettano te', { n: c.wait }), c.idle && tr('{n} fermi', { n: c.idle }), c.done && tr('{n} hanno finito', { n: c.done })].filter(Boolean).join(' · ');
    return `<div class="grp"><div class="rh"><span class="rn">${esc(g.title)}</span> <span class="dim">${esc(tr('{n} membri', { n: g.members.length }))}${counts ? ' · ' + esc(counts) : ''}</span></div>` +
      `<div class="mem">${g.members.slice(0, 24).map(a => `<span class="m ${stateOf(a)}" title="${esc(a.action || '')}">${esc(agentName(a))}</span>`).join('')}${g.members.length > 24 ? ' …' : ''}</div></div>`;
  }

  function render() {
    const s = window.getSession ? getSession(T.sid) : null;
    const box = el();
    if (!s) { box.innerHTML = `<span class="x">X</span><p class="dim">${esc(tr('La sessione non c\'è più.'))}</p>`; bindClose(); return; }
    const now = s._replay && typeof replayFrame !== 'undefined' && replayFrame ? replayFrame.vt : Date.now(); // replayFrame è un let di game.js
    const runs = (s.workflows || []).slice().sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    const groups = groupsOf(s);
    const msgs = (s.messages || []).slice().reverse();
    const sig = JSON.stringify([runs, groups.map(g => [g.title, g.members.map(a => [a.id, a.status, a.finished])]), msgs.length, Math.floor(now / 1000)]);
    if (sig === T.sig) return;
    T.sig = sig;
    const scroll = box.querySelector('.list') ? box.querySelector('.list').scrollTop : 0;
    const name = id => { const a = (s.subs || []).find(x => x.id === id) || (s.main && s.main.id === id ? s.main : null); return a ? agentName(a) : ''; };
    box.innerHTML = `<span class="x" title="${esc(tr('Chiudi'))}">X</span><h3>${esc(tr('SQUADRE · {name}', { name: (window.projName ? projName(s) : s.project) || '' }))}</h3>` +
      `<p class="honest">${esc(tr('Workflow, squadre e messaggi tra agenti di questa sessione, ricostruiti dai transcript.'))}</p><div class="list">` +
      `<h4>${esc(tr('WORKFLOW'))} <span class="dim">${runs.length}</span></h4>` + (runs.length ? runs.map(r => runCard(r, now)).join('') : `<p class="dim">${esc(tr('Nessun workflow in questa sessione.'))}</p>`) +
      `<h4>${esc(tr('SQUADRE E REPARTI'))} <span class="dim">${groups.length}</span></h4>` + (groups.length ? groups.map(groupCard).join('') : `<p class="dim">${esc(tr('Nessuna squadra: i sottoagenti lavorano ognuno per conto suo.'))}</p>`) +
      `<h4>${esc(tr('MESSAGGI TRA AGENTI'))} <span class="dim">${msgs.length}</span></h4>` + (msgs.length ? `<ul class="msgs">${msgs.slice(0, 20).map(m => `<li><span class="t">${hhmm(m.t)}</span> <b>${esc(m.from)}</b> → <b>${esc(name(m.toId) || m.to)}</b>${m.summary ? ': ' + esc(m.summary) : ''}</li>`).join('')}</ul>` : `<p class="dim">${esc(tr('Nessun messaggio (SendMessage) tra agenti.'))}</p>`) +
      '</div>';
    box.querySelector('.list').scrollTop = scroll;
    bindClose();
  }
  function bindClose() { const x = el().querySelector('.x'); if (x) x.onclick = closeTeams; }
})();
