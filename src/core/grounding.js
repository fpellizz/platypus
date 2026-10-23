'use strict';
// "Mappa contro territorio": confronta quello che l'agente sa (la sua mappa, vedi worldmap.js)
// con quello che c'è davvero: il disco e quello che hanno fatto gli altri agenti della sessione.
//  - ricordi scaduti: un file che ha letto è poi cambiato e lui non l'ha più riletto;
//  - modifiche alla cieca: modifica un file cambiato da un altro agente senza averlo riletto
//    (o Claude Code gliela rifiuta perché il file è cambiato: presa in tempo);
//  - percorsi inventati ("fantasmi"): file che cerca, apre o cita e che non esistono.
// Tutto pigro: si calcola solo quando qualcuno lo chiede, e il disco si guarda al massimo ogni 10 s.

const fs = require('fs');
const path = require('path');
const { isProjectFile, pathsInCommand, relKey, scanTree, EXT } = require('./worldmap');
const { tr } = require('../i18n');

const SLACK = 1500;      // ms di tolleranza tra l'esito di una lettura e l'mtime del file
const DISK_TTL = 10000;  // il disco di una sessione si riguarda al massimo ogni 10 s
const MAX_STAT = 400;    // file controllati sul disco per richiesta
const MAX_ITEMS = 200;

// cache dei controlli sul disco: sid -> {t, cwd, mtimes: Map(key -> mtime | null se non c'è più)}
const diskCache = new Map();

// un file esiste nell'albero del progetto? Va bene anche citato da una sottocartella ("auth/session.ts")
function treeIndex(files) {
  const byBase = new Map();
  for (const f of files || []) {
    const p = Array.isArray(f) ? f[0] : f;
    const b = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(p.toLowerCase());
  }
  return key => {
    const k = String(key).toLowerCase().replace(/^\.\//, '');
    return (byBase.get(k.slice(k.lastIndexOf('/') + 1)) || []).some(p => p === k || p.endsWith('/' + k));
  };
}

// il disco come lo vede la sessione:
//  stat(key)   -> mtime (null: il file non c'è, undefined: non si sa)
//  exists(key) -> true/false (undefined: non si sa)
function diskOf(session, cwd, { replay } = {}) {
  if (session.demo) {
    const d = session.demoDisk; // il disco finto della demo: key -> {mtime, exists}
    if (!d) return { reason: tr('Demo: i file dei piani non esistono sul disco') };
    const stat = key => { const e = d instanceof Map ? d.get(key) : d[key]; return !e ? undefined : e.exists === false ? null : e.mtime; };
    const inTree = treeIndex(session.demoTree);
    return { stat, exists: key => { const v = stat(key); return v === null ? false : v !== undefined || inTree(key); } };
  }
  if (replay) return { reason: tr('Replay: il disco di oggi non è quello di allora') };
  if (session.kind === 'cowork') return { reason: tr('Sessione Cowork: i suoi file non sono su questo disco') };
  let root;
  try { root = path.resolve(cwd); if (!cwd || !fs.statSync(root).isDirectory()) throw new Error(); }
  catch { return { reason: tr('La cartella della sessione non si legge da qui (WSL non montato, disco esterno o cartella cancellata)') }; }
  let c = diskCache.get(session.id);
  if (!c || c.cwd !== root || Date.now() - c.t > DISK_TTL) {
    c = { t: Date.now(), cwd: root, mtimes: new Map() };
    diskCache.set(session.id, c);
    if (diskCache.size > 50) diskCache.delete(diskCache.keys().next().value);
  }
  let budget = MAX_STAT;
  const stat = key => {
    if (c.mtimes.has(key)) return c.mtimes.get(key);
    if (budget-- <= 0) return undefined;
    let v;
    try { v = fs.statSync(path.join(root, key)).mtimeMs; } catch (e) { v = e && e.code === 'ENOENT' ? null : undefined; }
    if (v !== undefined) c.mtimes.set(key, v);
    return v;
  };
  // prima l'albero del progetto (già in cache per la mappa), poi il disco per le cartelle che l'albero salta
  let inTree = null;
  return {
    stat,
    exists: key => {
      if (!inTree) { const tree = scanTree(root); inTree = tree.available ? treeIndex(tree.files) : () => false; }
      if (inTree(key)) return true;
      const v = stat(key);
      return v === undefined ? undefined : v !== null;
    },
  };
}

// percorsi citati in una risposta: tra backtick anche un nome da solo, nel testo solo "cartella/file.ext".
// I blocchi di codice non contano (dentro ci sono esempi, non affermazioni sul progetto).
const NOT_FILES = /^(node|vue|next|nuxt|express|three|d3|chart|moment|react|angular|ember|backbone|p5|alpine|solid|svelte|socket\.io)\.js$/i;
function pathsInReply(text) {
  const out = [];
  const add = (p, i, s) => { if (!NOT_FILES.test(p) && !out.some(o => o.path === p)) out.push({ path: p, line: lineAt(s, i) }); };
  const s = String(text || '').slice(0, 8000).replace(/```[\s\S]*?(```|$)/g, m => ' '.repeat(m.length));
  const code = /`([^`\n]{1,200})`/g;
  let m;
  while ((m = code.exec(s))) for (const p of pathsInCommand(m[1])) add(p, m.index, s);
  const plain = s.replace(/`[^`\n]*`/g, m => ' '.repeat(m.length));
  let at = 0;
  for (const line of plain.split('\n')) {
    for (const p of pathsInCommand(line.replace(/[.,;:!?)\]]+(?=\s|$)/g, ''))) if (/[\/\\]/.test(p) && EXT.test(p)) add(p, at, s);
    at += line.length + 1;
  }
  return out.slice(0, 40);
}
function lineAt(s, i) {
  const a = s.lastIndexOf('\n', i) + 1, b = s.indexOf('\n', i);
  return s.slice(a, b < 0 ? s.length : b).trim().slice(0, 160);
}

// percorsi inventati: dagli errori e dall'output (registrati nella mappa) e dalle risposte (controllati qui, sul disco)
function findGhosts(session, agents, cwd, { only = null, replay = false } = {}) {
  const ghosts = [];
  // quando un file è apparso nella sessione: creato o modificato da qualcuno, o letto con successo
  const appeared = new Map();
  for (const a of agents) {
    if (!a.world) continue;
    for (const [key, nd] of a.world.nodes) {
      const t = Math.max(nd.lastSync || 0, nd.edits && nd.edits.length ? nd.edits[nd.edits.length - 1] : 0, nd.created ? nd.edit || 0 : 0);
      if (t && t > (appeared.get(key) || 0)) appeared.set(key, t);
    }
  }
  const disk = diskOf(session, cwd, { replay });
  for (const a of agents) {
    if (!a.world || (only && !only.has(a.id))) continue;
    const seen = new Set();
    for (const [key, nd] of a.world.nodes) {
      if (!nd.ghost) continue;
      seen.add(key);
      // poi è stato creato: non era un'allucinazione, era un'intenzione
      // (sul disco conta il percorso esatto: un percorso sbagliato non diventa "creato" perché il file sta altrove)
      const later = (appeared.get(key) || 0) > nd.ghostAt || (disk.stat && isProjectFile(key) && typeof disk.stat(key) === 'number');
      ghosts.push({ key, agent: a.id, agentName: a.name, t: nd.ghostAt, source: nd.ghostSrc, excerpt: nd.ghostLine || '', createdLater: !!later });
    }
    if (!disk.exists) continue; // senza disco non si può dire se un file citato esiste
    for (const r of a.world.replies) {
      for (const p of pathsInReply(r.text)) {
        const key = relKey(p.path, cwd);
        if (!isProjectFile(key) || seen.has(key) || appeared.has(key)) continue;
        seen.add(key);
        if (disk.exists(key) !== false) continue;
        ghosts.push({ key, agent: a.id, agentName: a.name, t: r.t, source: 'reply', excerpt: p.line, createdLater: false });
      }
    }
  }
  ghosts.sort((x, y) => y.t - x.t);
  return { ghosts: ghosts.slice(0, MAX_ITEMS) };
}

// agents: tutti gli agenti della sessione [{id, name, world}]; only: Set degli id da esaminare (null = tutti)
function checkStale(session, agents, cwd, { only = null, replay = false } = {}) {
  const stale = [], blindEdits = [];
  // chi ha modificato cosa, e quando (solo modifiche riuscite)
  const editsByKey = new Map();
  for (const a of agents) {
    if (!a.world) continue;
    for (const [key, nd] of a.world.nodes) {
      if (!nd.edits || !nd.edits.length || !isProjectFile(key)) continue;
      let l = editsByKey.get(key);
      if (!l) editsByKey.set(key, (l = []));
      for (const t of nd.edits) l.push({ t, id: a.id, name: a.name });
    }
  }
  // l'ultima modifica di un altro agente nell'intervallo (from, to]
  const otherEdit = (key, id, from, to) => {
    let best = null;
    for (const e of editsByKey.get(key) || []) if (e.id !== id && e.t > from && e.t <= to && (!best || e.t > best.t)) best = e;
    return best;
  };
  const disk = diskOf(session, cwd, { replay });
  for (const a of agents) {
    if (!a.world || (only && !only.has(a.id))) continue;
    for (const [key, nd] of a.world.nodes) {
      if (!nd.lastSync || !isProjectFile(key)) continue;
      const by = otherEdit(key, a.id, nd.lastSync, Infinity);
      const mtime = disk.stat ? disk.stat(key) : undefined;
      const changedOnDisk = typeof mtime === 'number' && mtime > nd.lastSync + SLACK;
      const gone = mtime === null;
      if (!by && !changedOnDisk && !gone) continue;
      stale.push({
        key, agent: a.id, agentName: a.name,
        readAt: nd.lastSync,
        mtime: typeof mtime === 'number' ? mtime : null,
        changedAt: by ? by.t : changedOnDisk ? mtime : null,
        changedBy: by ? by.name : null, changedById: by ? by.id : null,
        outside: !by, gone,
      });
    }
    for (const st of a.world.steps) {
      if (st.act !== 'edit' || !isProjectFile(st.target)) continue;
      const by = st.prevSync ? otherEdit(st.target, a.id, st.prevSync, st.t) : null;
      if (!by && !st.staleErr) continue;
      blindEdits.push({ key: st.target, agent: a.id, agentName: a.name, t: st.t, changedBy: by ? by.name : null, changedById: by ? by.id : null, caught: !!st.staleErr });
    }
  }
  stale.sort((x, y) => (y.changedAt || 0) - (x.changedAt || 0));
  blindEdits.sort((x, y) => y.t - x.t);
  return { stale: stale.slice(0, MAX_ITEMS), blindEdits: blindEdits.slice(0, MAX_ITEMS), disk: { checked: !!disk.stat, reason: disk.reason || '' } };
}

module.exports = { checkStale, findGhosts, pathsInReply, SLACK, DISK_TTL };
