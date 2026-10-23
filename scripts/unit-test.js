#!/usr/bin/env node
'use strict';
// Prove dei pezzi del motore che non hanno bisogno del server: mappa contro territorio, parser.
// Le richiama smoke-test.js (quindi anche npm test e le GitHub Actions); si possono lanciare anche da sole.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { AgentWorld } = require(path.join(ROOT, 'src', 'core', 'worldmap'));
const grounding = require(path.join(ROOT, 'src', 'core', 'grounding'));

// un agente finto: read/edit con esito, agli istanti indicati (ms)
let seq = 0;
function act(w, tool, file, t, { err = false, out = '', cwd = '' } = {}) {
  const id = 'u' + (++seq);
  w.start(id, tool, { file_path: file }, t, cwd, 0);
  w.end(id, err, { content: out }, {}, t + 100, cwd);
}
const agent = (id, name) => ({ id, name, world: new AgentWorld() });

function groundingTests(ok) {
  const sess = (extra) => ({ id: 's' + (++seq), cwd: '', kind: 'code', ...extra });

  // EXPLORE legge, ARCHITECT modifica dopo: ricordo scaduto di EXPLORE, "cambiato da ARCHITECT"
  {
    const ex = agent('a1', 'EXPLORE'), ar = agent('a2', 'ARCHITECT');
    act(ex.world, 'Read', 'src/auth/session.ts', 1000);
    act(ar.world, 'Edit', 'src/auth/session.ts', 5000);
    const r = grounding.checkStale(sess({ kind: 'cowork' }), [ex, ar], '');
    const s = r.stale.find(x => x.agent === 'a1');
    ok(s && s.changedBy === 'ARCHITECT' && !s.outside && s.readAt === 1100, 'ricordo scaduto: letto da EXPLORE, cambiato da ARCHITECT');
    ok(!r.stale.some(x => x.agent === 'a2'), 'chi ha modificato il file non ha un ricordo scaduto');
    ok(!r.disk.checked && /Cowork/.test(r.disk.reason), 'Cowork: niente disco, con il motivo');
    // rilegge: non è più scaduto
    act(ex.world, 'Read', 'src/auth/session.ts', 7000);
    ok(!grounding.checkStale(sess({ kind: 'cowork' }), [ex, ar], '').stale.length, 'dopo una nuova lettura il ricordo non è più scaduto');
  }

  // una lettura fallita non allinea la mappa; una modifica fallita nemmeno
  {
    const w = new AgentWorld();
    act(w, 'Read', 'a.js', 1000, { err: true, out: 'File does not exist.' });
    act(w, 'Edit', 'b.js', 1000, { err: true, out: 'String to replace not found' });
    ok(!w.nodes.get('a.js').lastSync && !w.nodes.get('b.js').lastSync, 'esiti falliti: nessun ultimo contatto');
  }

  // modifica alla cieca: B cambia il file, A lo modifica senza rileggerlo
  {
    const a = agent('a', 'CLAUDE'), b = agent('b', 'REFACTOR');
    act(a.world, 'Read', 'src/x.ts', 1000);
    act(b.world, 'Edit', 'src/x.ts', 2000);
    act(a.world, 'Edit', 'src/x.ts', 3000);
    const r = grounding.checkStale(sess({ kind: 'cowork' }), [a, b], '');
    const be = r.blindEdits.find(x => x.agent === 'a');
    ok(be && be.changedBy === 'REFACTOR' && !be.caught, 'modifica alla cieca su un file cambiato da un altro agente');
    // se invece rilegge prima di modificare, niente modifica alla cieca
    const c = agent('c', 'CLAUDE'), d = agent('d', 'REFACTOR');
    act(c.world, 'Read', 'src/x.ts', 1000);
    act(d.world, 'Edit', 'src/x.ts', 2000);
    act(c.world, 'Read', 'src/x.ts', 2500);
    act(c.world, 'Edit', 'src/x.ts', 3000);
    ok(!grounding.checkStale(sess({ kind: 'cowork' }), [c, d], '').blindEdits.length, 'rilegge prima di modificare: nessuna modifica alla cieca');
  }

  // Claude Code rifiuta la modifica: presa in tempo
  {
    const a = agent('a', 'CLAUDE');
    act(a.world, 'Read', 'src/y.ts', 1000);
    act(a.world, 'Edit', 'src/y.ts', 4000, { err: true, out: 'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.' });
    const r = grounding.checkStale(sess({ kind: 'cowork' }), [a], '');
    ok(r.blindEdits.length === 1 && r.blindEdits[0].caught, 'modifica rifiutata da Claude Code: presa in tempo');
  }

  // disco vero: cartella temporanea con mtime controllati
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'platypus-ground-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'));
      const f = path.join(dir, 'src', 'a.js'), g = path.join(dir, 'src', 'b.js'), h = path.join(dir, 'src', 'c.js');
      for (const p of [f, g, h]) fs.writeFileSync(p, 'x');
      const T = Date.now();
      fs.utimesSync(f, new Date(T), new Date(T));
      fs.utimesSync(g, new Date(T), new Date(T));
      const a = agent('a', 'CLAUDE');
      act(a.world, 'Read', path.join(dir, 'src', 'a.js'), T - 60000, { cwd: dir }); // letto un minuto prima dell'ultima modifica
      act(a.world, 'Read', 'src/b.js', T - 1000, { cwd: dir });                      // dentro la tolleranza
      act(a.world, 'Read', 'src/c.js', T, { cwd: dir });
      fs.rmSync(h);                                                                  // poi cancellato
      const s = sess({ cwd: dir });
      const r = grounding.checkStale(s, [a], dir);
      const by = k => r.stale.find(x => x.key === k);
      ok(r.disk.checked, 'disco controllato');
      ok(by('src/a.js') && by('src/a.js').outside && by('src/a.js').changedBy === null, 'cambiato fuori dalla sessione (percorso assoluto ricondotto alla cartella)');
      ok(!by('src/b.js'), `entro ${grounding.SLACK} ms non è scaduto`);
      ok(by('src/c.js') && by('src/c.js').gone, 'file cancellato dopo la lettura');
      // la cache: per 10 s il disco non si riguarda
      fs.utimesSync(g, new Date(T + 60000), new Date(T + 60000));
      ok(!grounding.checkStale(s, [a], dir).stale.some(x => x.key === 'src/b.js'), `il disco si riguarda al massimo ogni ${grounding.DISK_TTL / 1000} s`);
      ok(grounding.checkStale(sess({ cwd: dir }), [a], dir).stale.some(x => x.key === 'src/b.js'), 'con la cache scaduta il cambiamento si vede');
      // in replay il disco non si usa
      ok(!grounding.checkStale(sess({ cwd: dir }), [a], dir, { replay: true }).disk.checked, 'replay: niente disco');
      // cartella che non si legge (es. WSL non montato)
      ok(!grounding.checkStale(sess({ cwd: path.join(dir, 'non-esiste') }), [a], path.join(dir, 'non-esiste')).disk.checked, 'cartella non leggibile: niente disco');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  // demo: disco finto
  {
    const a = agent('a', 'EXPLORE');
    act(a.world, 'Read', 'src/auth/session.ts', 1000);
    act(a.world, 'Read', 'src/auth/token.ts', 1000);
    const demoDisk = new Map([['src/auth/session.ts', { mtime: 9000 }], ['src/auth/token.ts', { mtime: 500 }]]);
    const r = grounding.checkStale(sess({ demo: true, demoDisk }), [a], '/demo');
    ok(r.disk.checked && r.stale.length === 1 && r.stale[0].key === 'src/auth/session.ts', 'demo: disco finto (s.demoDisk)');
    ok(!grounding.checkStale(sess({ demo: true }), [a], '/demo').disk.checked, 'demo senza disco finto: niente disco');
  }
}

function run(ok) {
  console.log('mappa contro territorio');
  groundingTests(ok);
}

module.exports = { run };

if (require.main === module) {
  let failed = 0;
  run((cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failed++; });
  console.log(failed ? `\n${failed} controlli falliti` : '\nTutto a posto.');
  process.exit(failed ? 1 : 0);
}
