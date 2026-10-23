'use strict';
// "Mappa contro territorio": confronta quello che l'agente sa (la sua mappa, vedi worldmap.js)
// con quello che c'è davvero: il disco e quello che hanno fatto gli altri agenti della sessione.
//  - ricordi scaduti: un file che ha letto è poi cambiato e lui non l'ha più riletto;
//  - modifiche alla cieca: modifica un file cambiato da un altro agente senza averlo riletto
//    (o Claude Code gliela rifiuta perché il file è cambiato: presa in tempo).
// Tutto pigro: si calcola solo quando qualcuno lo chiede, e il disco si guarda al massimo ogni 10 s.

const fs = require('fs');
const path = require('path');
const { isProjectFile } = require('./worldmap');
const { tr } = require('../i18n');

const SLACK = 1500;      // ms di tolleranza tra l'esito di una lettura e l'mtime del file
const DISK_TTL = 10000;  // il disco di una sessione si riguarda al massimo ogni 10 s
const MAX_STAT = 400;    // file controllati sul disco per richiesta
const MAX_ITEMS = 200;

// cache dei controlli sul disco: sid -> {t, cwd, mtimes: Map(key -> mtime | null se non c'è più)}
const diskCache = new Map();

// il disco come lo vede la sessione: una funzione key -> mtime (null: il file non c'è, undefined: non si sa)
function diskOf(session, cwd, { replay } = {}) {
  if (session.demo) {
    const d = session.demoDisk; // il disco finto della demo: key -> {mtime, exists}
    if (!d) return { reason: tr('Demo: i file dei piani non esistono sul disco') };
    return { stat: key => { const e = d instanceof Map ? d.get(key) : d[key]; return !e ? undefined : e.exists === false ? null : e.mtime; } };
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
  return {
    stat: key => {
      if (c.mtimes.has(key)) return c.mtimes.get(key);
      if (budget-- <= 0) return undefined;
      let v;
      try { v = fs.statSync(path.join(root, key)).mtimeMs; } catch (e) { v = e && e.code === 'ENOENT' ? null : undefined; }
      if (v !== undefined) c.mtimes.set(key, v);
      return v;
    },
  };
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

module.exports = { checkStale, SLACK, DISK_TTL };
