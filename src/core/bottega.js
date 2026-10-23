'use strict';
// "Libro della bottega": la memoria storica di un progetto, dedotta dai fatti già calcolati
// (mappa contro territorio e sorprese), non da regole scritte a mano. Le lezioni sono deduzioni:
// chi le mostra deve dirlo. Tutto resta in locale, in ~/.platypus/bottega/<chiave>.json.
//   flaky-command  un comando di verifica che fallisce spesso o a intermittenza
//   fragile-file   un file che compare in molte catene causali, o che dopo una modifica fa fallire le verifiche
//   known-fix      uno schema d'errore seguito più volte dalla correzione dello stesso file
//   loop-trap      dove gli agenti girano in tondo (stessa firma, errori di fila)
//   stale-trap     file che diventano spesso ricordi scaduti (ci lavorano più agenti insieme)
//   ghost-path     percorsi inventati che tornano (es. un file rinominato cercato col vecchio nome)
//   slow-step      comandi che restano appesi a lungo

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { tr, trn } = require('../i18n');
const grounding = require('./grounding');
const surprise = require('./surprise');
const { isTestCommand } = require('./releases');

const HALF_LIFE = 30 * 86400000;   // il peso si dimezza ogni 30 giorni senza nuovi casi
const LESSON_WEIGHT = 1.5;         // sotto questa soglia (o con un caso solo) è un'osservazione
const MAX_LESSONS = 300, MAX_EVIDENCE = 8;
const SLOW_MS = 5 * 60000;         // un comando che ci mette più di così è "lento"
const KINDS = ['flaky-command', 'fragile-file', 'known-fix', 'loop-trap', 'stale-trap', 'ghost-path', 'slow-step'];

// chiave del progetto: la cartella normalizzata (minuscole dove i percorsi non distinguono le maiuscole)
function normDir(cwd) {
  let d = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (process.platform === 'win32' || /^[a-z]:\//i.test(d)) d = d.toLowerCase();
  return d;
}
function projectKey(cwd) { return crypto.createHash('sha1').update(normDir(cwd)).digest('hex').slice(0, 16); }
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
// un comando come "firma" leggibile: spazi compattati, niente percorsi assoluti
const cmdOf = sig => String(sig || '').replace(/^run:/, '').replace(/\s+/g, ' ').trim().slice(0, 120);
// uno schema d'errore: senza numeri di riga, colonne, numeri e contenuti tra virgolette
function errorPattern(excerpt) {
  return String(excerpt || '').replace(/(?:[A-Za-z]:)?[\w.~\-]*[\\/][^\s:'"()]+/g, '<path>').replace(/(['"`]).*?\1/g, '<…>').replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim().slice(0, 100);
}

// ---- dagli eventi già calcolati di una sessione ai casi per il libro (nessuna nuova lettura)
// agents: [{id, name, world, mind}]; ogni caso è {kind, key, sid, t, agent, excerpt}
function digest(session, agents, now = Date.now()) {
  const out = [];
  const add = (kind, key, t, agent, excerpt) => { if (key) out.push({ kind, key: String(key).slice(0, 160), sid: session.id, t, agent, excerpt: String(excerpt || '').slice(0, 160) }); };
  const sp = surprise.surprises(agents, { now }).surprises;
  for (const s of sp) {
    if (s.reaction === 'insists') add('loop-trap', /^run:/.test(s.sig || '') ? cmdOf(s.sig) : s.target, s.t, s.agentName, s.excerpt);
    if (s.refs && s.refs.length) for (const r of s.refs.slice(0, 3)) add('fragile-file', r.file, s.t, s.agentName, s.excerpt);
    if (s.chain && s.chain.complete && s.chain.fix && s.chain.fix.cited) add('known-fix', errorPattern(s.excerpt) + ' → ' + s.chain.fix.target, s.t, s.agentName, s.excerpt);
  }
  for (const a of agents) {
    if (!a.world) continue;
    const st = a.world.steps;
    // comandi di verifica: falliscono spesso, o passano e falliscono senza modifiche in mezzo (instabili)
    const byCmd = new Map(), open = new Set(a.world.open ? a.world.open.values() : []);
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      if (s.act === 'verify' && s.err !== null) {
        const c = cmdOf(s.sig);
        if (!byCmd.has(c)) byCmd.set(c, []);
        byCmd.get(c).push(i);
      }
      if (s.act === 'edit' && s.err === false) { // modificato e subito dopo una verifica che fallisce
        const nx = st.slice(i + 1, i + 4).find(x => x.act === 'verify' && x.err !== null);
        if (nx && nx.err) add('fragile-file', s.target, nx.t, a.name, (nx.fail && nx.fail.excerpt) || cmdOf(nx.sig));
      }
      // lento: finito dopo più di 5 minuti, oppure ancora appeso da più di 5 minuti
      const dur = s.err === null ? (open.has(s) ? now - s.t : 0) : (s.dur || 0);
      if (dur > SLOW_MS && /^(run|verify|look)$/.test(s.act)) add('slow-step', cmdOf(s.sig), s.t, a.name, tr('{min} min', { min: Math.round(dur / 60000) }));
    }
    for (const [c, idx] of byCmd) {
      if (!isTestCommand(c) && !/\b(tsc|lint|build|check)\b/.test(c)) continue;
      const fails = idx.filter(i => st[i].err);
      let flips = 0;
      for (let k = 1; k < idx.length; k++) {
        const p = st[idx[k - 1]], q = st[idx[k]];
        if (p.err !== q.err && !st.slice(idx[k - 1] + 1, idx[k]).some(x => x.act === 'edit')) flips++;
      }
      if (flips || fails.length >= 3) for (const i of fails.slice(-3)) add('flaky-command', c, st[i].t, a.name, (st[i].fail && st[i].fail.excerpt) || '');
    }
    // percorsi inventati (dagli errori e dall'output: quelli delle risposte richiedono il disco)
    for (const [key, nd] of a.world.nodes) if (nd.ghost) add('ghost-path', key, nd.ghostAt, a.name, nd.ghostLine);
  }
  const g = grounding.checkStale(session, agents, session.cwd, { disk: false });
  for (const x of g.stale) add('stale-trap', x.key, x.changedAt || x.readAt, x.agentName, x.changedBy ? tr('cambiato da {who}', { who: x.changedBy }) : '');
  for (const x of g.blindEdits) add('stale-trap', x.key, x.t, x.agentName, x.caught ? tr('modifica fermata da Claude Code') : tr('modifica alla cieca'));
  return out;
}

// ---- il libro di un progetto
class Bottega {
  constructor(dir = path.join(require('../paths').dataDir(), 'bottega')) {
    this.dir = dir;
    this.books = new Map(); // chiave -> {key, name, cwd, lessons: {id: lesson}, learned: {}, dirty}
    this.timer = setInterval(() => this.save(), 30000);
    this.timer.unref && this.timer.unref();
  }
  stop() { clearInterval(this.timer); this.save(); }

  book(cwd) {
    const key = projectKey(cwd);
    let b = this.books.get(key);
    if (!b) {
      b = { key, name: path.basename(normDir(cwd)) || cwd, cwd: String(cwd || ''), lessons: {}, learned: {} };
      try { Object.assign(b, JSON.parse(fs.readFileSync(path.join(this.dir, key + '.json'), 'utf8')), { key }); } catch {}
      b.dirty = false;
      this.books.set(key, b);
    }
    return b;
  }

  save() {
    for (const b of this.books.values()) {
      if (!b.dirty) continue;
      b.dirty = false;
      const { dirty, ...data } = b;
      try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(path.join(this.dir, b.key + '.json'), JSON.stringify(data)); } catch {}
    }
  }

  // aggiunge i casi al libro; lo stesso caso (sessione, momento, agente, tipo, chiave) non conta due volte
  learn(cwd, cases) {
    const b = this.book(cwd);
    let added = 0;
    for (const c of cases) {
      if (!KINDS.includes(c.kind) || !c.key) continue;
      const id = sha(c.kind + '|' + c.key);
      let l = b.lessons[id];
      if (!l) l = b.lessons[id] = { id, kind: c.kind, key: c.key, count: 0, sessions: [], first: c.t, last: c.t, evidence: [], seen: [], pinned: false, ignored: false };
      const ev = c.sid + '|' + c.t + '|' + c.agent;
      if (l.seen.includes(ev)) continue;
      l.seen.push(ev); if (l.seen.length > 200) l.seen.shift();
      l.count++;
      if (!l.sessions.includes(c.sid)) l.sessions.push(c.sid);
      if (l.sessions.length > 50) l.sessions.shift();
      l.first = Math.min(l.first, c.t); l.last = Math.max(l.last, c.t);
      l.evidence.push({ sid: c.sid, t: c.t, agent: c.agent, excerpt: c.excerpt });
      l.evidence.sort((x, y) => y.t - x.t);
      l.evidence.length = Math.min(l.evidence.length, MAX_EVIDENCE);
      added++;
    }
    if (added) { b.dirty = true; this.trim(b); }
    return added;
  }

  trim(b) {
    const ids = Object.keys(b.lessons);
    if (ids.length <= MAX_LESSONS) return;
    const now = Date.now();
    ids.filter(id => !b.lessons[id].pinned).sort((x, y) => weightOf(b.lessons[x], now) - weightOf(b.lessons[y], now))
      .slice(0, ids.length - MAX_LESSONS).forEach(id => delete b.lessons[id]);
  }

  act(cwd, action, id) {
    const b = this.book(cwd), l = b.lessons[id];
    if (!l) return false;
    if (action === 'pin') { l.pinned = !l.pinned; l.ignored = false; }
    else if (action === 'ignore') { l.ignored = true; l.pinned = false; }
    else if (action === 'unignore') l.ignored = false;
    else if (action === 'forget') delete b.lessons[id];
    else return false;
    b.dirty = true;
    return true;
  }

  // le lezioni pronte da mostrare: peso, livello e testi nella lingua di adesso
  view(cwd, now = Date.now()) {
    const b = this.book(cwd);
    const lessons = Object.values(b.lessons).map(l => {
      const weight = weightOf(l, now);
      const { seen, ...rest } = l;
      return { ...rest, weight: Math.round(weight * 100) / 100, level: l.pinned || (l.count > 1 && weight >= LESSON_WEIGHT) ? 'lesson' : 'observation', ...describe(l) };
    }).sort((x, y) => (y.pinned - x.pinned) || (y.weight - x.weight));
    return { key: b.key, name: b.name, cwd: b.cwd, learned: b.learned, lessons };
  }
}

// peso: cresce con i casi e con le sessioni diverse, si dimezza ogni 30 giorni dall'ultimo caso
function weightOf(l, now = Date.now()) {
  const base = (1 + Math.log2(Math.max(1, l.count))) * (1 + 0.5 * (Math.max(1, l.sessions.length) - 1));
  return l.pinned ? base : base * Math.pow(0.5, Math.max(0, now - l.last) / HALF_LIFE);
}

function describe(l) {
  const n = l.count, m = l.sessions.length;
  const seen = trn('visto {n} volta', 'visto {n} volte', n) + ' · ' + trn('in {n} sessione', 'in {n} sessioni', m);
  switch (l.kind) {
    case 'flaky-command': return { title: tr('Comando instabile: {cmd}', { cmd: l.key }), detail: tr('Fallisce spesso o a intermittenza, anche senza modifiche in mezzo: rilancialo una volta prima di indagare.') + ' ' + seen };
    case 'fragile-file': return { title: tr('File fragile: {file}', { file: l.key }), detail: tr('Compare spesso negli errori, o dopo una modifica le verifiche falliscono.') + ' ' + seen };
    case 'known-fix': { const [pat, file] = l.key.split(' → '); return { title: tr('Errore già visto: si sistema in {file}', { file }), detail: tr('Lo schema «{pat}» è stato corretto più volte modificando lo stesso file.', { pat }) + ' ' + seen }; }
    case 'loop-trap': return { title: tr('Trappola: {cmd}', { cmd: l.key }), detail: tr('Gli agenti rilanciano lo stesso comando senza cambiare nulla e girano in tondo.') + ' ' + seen };
    case 'stale-trap': return { title: tr('File conteso: {file}', { file: l.key }), detail: tr('Ci lavorano più agenti insieme: diventa spesso un ricordo scaduto. Rileggerlo prima di modificarlo.') + ' ' + seen };
    case 'ghost-path': return { title: tr('Percorso che non esiste: {file}', { file: l.key }), detail: tr('Gli agenti lo cercano ma non c\'è: forse è stato spostato o rinominato.') + ' ' + seen };
    case 'slow-step': return { title: tr('Passo lento: {cmd}', { cmd: l.key }), detail: tr('Resta appeso a lungo: meglio lanciarlo in background o con un limite di tempo.') + ' ' + seen };
    default: return { title: l.key, detail: seen };
  }
}

module.exports = { Bottega, digest, projectKey, normDir, errorPattern, weightOf, KINDS, HALF_LIFE };
