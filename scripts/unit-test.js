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

function ghostTests(ok) {
  const { missingPathsInOutput } = require(path.join(ROOT, 'src', 'core', 'worldmap'));
  const sess = (extra) => ({ id: 'g' + (++seq), cwd: '', kind: 'code', ...extra });

  // fonte 2: output dei comandi (inglese e italiano, POSIX e Windows)
  const outputs = [
    ['cat: src/missing.ts: No such file or directory', 'src/missing.ts'],
    ["ls: cannot access 'docs/old.md': No such file or directory", 'docs/old.md'],
    ["FileNotFoundError: [Errno 2] No such file or directory: 'data/input.csv'", 'data/input.csv'],
    ["Error: ENOENT: no such file or directory, open 'config/app.json'", 'config/app.json'],
    ["Error: Cannot find module './lib/helper'", './lib/helper'],
    ["src/a.ts(3,20): error TS2307: Cannot find module './session' or its corresponding type declarations.", './session'],
    ["Get-Content : Cannot find path 'C:\\proj\\src\\nope.ps1' because it does not exist.", 'C:\\proj\\src\\nope.ps1'],
    ["Get-Content : Impossibile trovare il percorso 'C:\\proj\\docs\\vecchio.md' perché non esiste.", 'C:\\proj\\docs\\vecchio.md'],
    ['cat: appunti/note.txt: File o directory non esistente', 'appunti/note.txt'],
    ["python: can't open file 'C:\\\\proj\\\\run.py': [Errno 2] No such file or directory", 'C:\\proj\\run.py'],
    ["error: pathspec 'src/x.js' did not match any file(s) known to git", 'src/x.js'],
    ["ls: cannot access '/home/max/My Docs/a.md': No such file or directory", '/home/max/My Docs/a.md'],
  ];
  for (const [out, want] of outputs) {
    const got = missingPathsInOutput(out).map(g => g.path);
    ok(got.length === 1 && got[0] === want, `output: ${want}` + (got[0] === want ? '' : ` (trovato: ${JSON.stringify(got)})`));
  }
  const none = ['The system cannot find the path specified.', 'Il sistema non riesce a trovare il percorso specificato.', "src/a.ts(1,1): error TS2304: Cannot find name 'foo'.", '3 passing (12ms)'];
  ok(none.every(o => !missingPathsInOutput(o).length), 'output senza percorsi: nessun fantasma');

  // fonte 3: risposte
  const replies = [
    ['Ho aggiornato `src/auth/session.ts` e il file docs/guida.md.', ['src/auth/session.ts', 'docs/guida.md']],
    ['I read `package.json` and src/app.ts.', ['package.json', 'src/app.ts']],
    ['Ho modificato src\\ui\\Menu.tsx come richiesto', ['src\\ui\\Menu.tsx']],
    ['Usa `Node.js` 20, vedi https://example.com/a/b.js, versione 3.5 o v1.2.3, cioè e.g. i.e.', []],
    ["Esempio:\n```js\nimport x from './foo.ts'\n```\nfine", []],
  ];
  for (const [text, want] of replies) {
    const got = grounding.pathsInReply(text).map(p => p.path);
    ok(JSON.stringify(got) === JSON.stringify(want), `risposta: ${JSON.stringify(want)}` + (JSON.stringify(got) === JSON.stringify(want) ? '' : ` (trovato: ${JSON.stringify(got)})`));
  }

  // fonte 1 e 2 dentro la mappa, e "poi creato"
  {
    const a = agent('a', 'TEST-RUNNER'), b = agent('b', 'CLAUDE');
    act(a.world, 'Read', 'src/auth/oldToken.ts', 1000, { err: true, out: 'File does not exist. Note: your current working directory is /proj.' });
    act(a.world, 'Read', 'src/later.ts', 1000, { err: true, out: '<tool_use_error>File does not exist.</tool_use_error>' });
    act(b.world, 'Write', 'src/later.ts', 2000);
    a.world.start('r1', 'Bash', { command: 'cd tools && cat conf/x.yml' }, 3000, '/proj', 0);
    a.world.end('r1', true, { content: 'cat: conf/x.yml: No such file or directory' }, {}, 3100, '/proj');
    const r = grounding.findGhosts(sess({ kind: 'cowork' }), [a, b], '/proj');
    const by = k => r.ghosts.find(g => g.key === k);
    ok(by('src/auth/oldToken.ts') && by('src/auth/oldToken.ts').source === 'tool' && !by('src/auth/oldToken.ts').createdLater, 'Read fallito: fantasma');
    ok(by('src/later.ts') && by('src/later.ts').createdLater, 'creato dopo da un altro agente: era un\'intenzione');
    ok(by('tools/conf/x.yml') && by('tools/conf/x.yml').source === 'output', 'output del comando, relativo alla cartella della shell');
  }

  // fonte 3 sul disco vero
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'platypus-ghost-'));
    try {
      fs.mkdirSync(path.join(dir, 'src', 'auth'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src', 'auth', 'real.ts'), 'x');
      const a = agent('a', 'CLAUDE'), b = agent('b', 'BUILDER');
      a.world.reply(5000, 'Ho corretto `src/auth/real.ts` (in `auth/real.ts`, cioè `real.ts`), poi src/auth/fake.ts e `src/new.ts`.');
      act(b.world, 'Write', 'src/new.ts', 6000);
      const r = grounding.findGhosts(sess({ cwd: dir }), [a, b], dir);
      ok(r.ghosts.length === 1 && r.ghosts[0].key === 'src/auth/fake.ts' && r.ghosts[0].source === 'reply', 'risposta: solo il file che non c\'è e che nessuno ha creato');
      ok(!grounding.findGhosts(sess({ cwd: dir }), [a, b], dir, { replay: true }).ghosts.length, 'replay: le risposte non si controllano sul disco');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
}

function claimTests(ok) {
  // estrazione: frase → tipi attesi (in ordine)
  const cases = [
    ['Ho corretto il refresh e i test passano.', ['tests', 'fixed']],
    ['All tests pass.', ['tests']],
    ['Tutti i test sono verdi.', ['tests']],
    ['La suite è verde, tutto a posto.', ['tests']],
    ["Ho verificato che l'endpoint risponde 200.", ['verified']],
    ['I verified the fix in the browser.', ['verified']],
    ['Now it works.', ['verified']],
    ['Fixed the bug in `src/auth/refresh.ts`.', ['fixed']],
    ['Ho creato `docs/guida.md` con i passaggi.', ['created']],
    ['Added `src/utils/date.ts` with the helpers.', ['created']],
    ['Completato.', ['done']],
    ['Done!', ['done']],
    ['Confermato: il problema era nel parser.', ['verified']],
    // falsi positivi da evitare
    ['Ora devo verificare che i test passino.', []],
    ['Se i test passano, faccio il commit.', []],
    ["I'll run the tests to verify.", []],
    ['I test non passano ancora.', []],
    ['Do the tests pass?', []],
    ['Make sure all tests pass before merging.', []],
    ['Il fatto è che il token scade.', []],
    ['Once tests pass, we can ship.', []],
    ['It should work now.', []],
    ["Non funziona ancora.", []],
    ['```\n// tests pass, done\n```', []],
  ];
  for (const [text, want] of cases) {
    const got = grounding.extractClaims(text).map(c => c.kind);
    ok(JSON.stringify(got) === JSON.stringify(want), `affermazioni: «${text.replace(/\n/g, ' ')}» → ${want.join(', ') || 'nessuna'}` + (JSON.stringify(got) === JSON.stringify(want) ? '' : ` (trovato: ${got.join(', ') || 'nessuna'})`));
  }
  const f = grounding.extractClaims('Fixed the bug in `src/auth/refresh.ts`.')[0];
  ok(f && f.file === 'src/auth/refresh.ts', 'affermazioni: il file corretto è quello citato');

  // prove nel turno: la mappa dell'agente come la costruisce state.js
  const run = (w, cmd, t, err = false) => { const id = 'c' + (++seq); w.start(id, 'Bash', { command: cmd }, t, '/p', 0); w.end(id, err, { content: err ? 'FAIL' : 'ok' }, {}, t + 100, '/p'); };
  const claimsAt = (a, text, t) => { a.world.reply(t, text); return grounding.checkClaims({}, [a], '/p').claims.filter(c => c.t === t); };
  const a = { id: 'main', name: 'CLAUDE', world: new AgentWorld(), mind: { goals: [{ t: 500 }] } };
  act(a.world, 'Read', 'src/auth/refresh.ts', 1000);
  act(a.world, 'Edit', 'src/auth/refresh.ts', 2000);
  let c = claimsAt(a, 'Ho corretto il refresh in `src/auth/refresh.ts` e i test passano.', 3000);
  const by = k => c.find(x => x.kind === k);
  ok(by('fixed') && by('fixed').status === 'grounded' && by('fixed').evidence.target === 'src/auth/refresh.ts', 'ho corretto X: ancorata dalla modifica a X');
  ok(by('tests') && by('tests').status === 'ungrounded', 'i test passano senza averli lanciati dopo la modifica: non ancorata');
  run(a.world, 'npm test', 4000);
  c = claimsAt(a, 'Tests pass now.', 5000);
  ok(c[0] && c[0].status === 'grounded' && c[0].evidence.act === 'verify', 'dopo npm test riuscito: ancorata');
  act(a.world, 'Edit', 'src/auth/refresh.ts', 5500);
  run(a.world, 'npm test', 6000, true);
  c = claimsAt(a, 'All tests pass.', 7000);
  ok(c[0] && c[0].status === 'contradicted', 'test fallito dopo l\'ultima modifica: smentita');
  c = claimsAt(a, 'Fatto.', 7100);
  ok(c[0] && c[0].kind === 'done' && c[0].status === 'ungrounded', 'fatto con un test rosso nel turno: non ancorata');
  // nuovo turno (nuova richiesta dell'utente): le prove del turno prima non valgono
  a.mind.goals.push({ t: 8000 });
  c = claimsAt(a, 'Ho verificato, funziona.', 9000);
  ok(c[0] && c[0].kind === 'verified' && c[0].status === 'ungrounded', 'nuovo turno: le prove del turno precedente non contano');
  const sc = grounding.checkClaims({}, [a], '/p').score;
  ok(sc && sc.total >= 5 && sc.pct === Math.round(100 * sc.grounded / sc.total), `indice di ancoraggio: ${sc ? sc.pct + '% su ' + sc.total : '-'}`);
}

// avvisi di ancoraggio (facoltativi) costruiti da OfficeState
function alertTests(ok) {
  const { OfficeState } = require(path.join(ROOT, 'src', 'core', 'state'));
  const st = new OfficeState({});
  const s = st.ensureSession('al-1', '/p', Date.now());
  const t0 = Date.now() - 60000;
  const sub = st.ensureSub(s, 'sub-1', { agentType: 'REFACTOR' }, true, t0);
  st.worldStart(s, s.main, 'x1', 'Read', { file_path: '/p/src/a.ts' }, t0);
  st.worldEnd(s, s.main, 'x1', false, { content: 'x' }, {}, t0 + 100);
  st.worldStart(s, sub, 'x2', 'Edit', { file_path: '/p/src/a.ts' }, t0 + 1000);
  st.worldEnd(s, sub, 'x2', false, { content: 'ok' }, {}, t0 + 1100);
  st.worldStart(s, s.main, 'x3', 'Edit', { file_path: '/p/src/a.ts' }, t0 + 2000);
  st.worldEnd(s, s.main, 'x3', false, { content: 'ok' }, {}, t0 + 2100);
  st.updateAlerts(s);
  ok(!s.alerts.some(x => x.kind === 'grounding'), 'avvisi di ancoraggio spenti di base');
  st.setSettings({ groundingAlerts: true });
  st.updateAlerts(s);
  ok(s.alerts.some(x => x.kind === 'grounding' && /src\/a\.ts/.test(x.text)), 'acceso: avviso per la modifica alla cieca');
}

// sorpresa dei fallimenti (B1): tipo deciso quando arriva l'esito, punteggio calcolato su richiesta
function surpriseTests(ok) {
  const sp = require(path.join(ROOT, 'src', 'core', 'surprise'));
  const sh = (w, cmd, t, err, out) => { const id = 's' + (++seq); w.start(id, 'Bash', { command: cmd }, t, '/p', 0); w.end(id, err, { content: out }, {}, t + 100, '/p'); };
  const val = (w) => sp.surpriseAt(w.world.steps, w.world.steps.length - 1);
  // prima funzionava: npm test riusciva, ora fallisce
  const a = agent('a', 'TEST-RUNNER');
  sh(a.world, 'npm test', 1000, false, 'Tests: 12 passed, 12 total');
  sh(a.world, 'npm test', 2000, true, 'FAIL src/auth/refresh.test.ts\n  ● refresh › renews the token\n    at Object.<anonymous> (src/auth/refresh.ts:42:7)\nTests: 1 failed, 11 passed, 12 total');
  let x = val(a);
  ok(x && x.kind === 'test' && x.value === 1 && x.reasons.includes('usedToWork'), `test che prima passava: sorpresa ${x && x.value} (${x && x.reasons.join(', ')})`);
  ok(x && /refresh/.test(x.excerpt), 'estratto dell\'errore: ' + (x && x.excerpt));
  const last = a.world.steps[a.world.steps.length - 1];
  ok(last.refs && last.refs.refs.some(r => r.file === 'src/auth/refresh.ts' && r.line === 42), 'i file citati dall\'errore restano sul passo (per B3)');
  // primo tentativo di un comando nuovo
  const b = agent('b', 'CLAUDE');
  sh(b.world, 'pnpm lint', 1000, true, 'bash: pnpm: command not found');
  x = val(b);
  ok(x && x.kind === 'command' && x.value === 0.3 && x.reasons.includes('firstTry'), `comando nuovo che fallisce al primo colpo: ${x && x.value}`);
  // TDD: ha appena scritto un test che deve fallire
  const c = agent('c', 'CLAUDE');
  act(c.world, 'Write', 'tests/auth.test.ts', 1000);
  sh(c.world, 'npx jest tests/auth.test.ts', 2000, true, 'FAIL tests/auth.test.ts\n  ● login › rejects a wrong password\nTests: 1 failed, 1 total');
  x = val(c);
  ok(x && x.kind === 'test' && x.reasons.includes('tdd') && x.value === 0.3, `TDD (test appena scritto che fallisce): ${x && x.value} (${x && x.reasons.join(', ')})`);
  // Edit senza la stringa, permessi
  const d = agent('d', 'CLAUDE');
  act(d.world, 'Edit', 'src/a.ts', 1000, { err: true, out: 'String to replace not found in file.\nString: foo()' });
  x = val(d);
  ok(x && x.kind === 'edit' && x.value === 0.5, `Edit senza la stringa da sostituire: ${x && x.value}`);
  act(d.world, 'Read', 'src/secret.key', 2000, { err: true, out: "EACCES: permission denied, open 'src/secret.key'" });
  x = val(d);
  ok(x && x.kind === 'permission' && x.value === 0.4, `permesso negato: ${x && x.value}`);
  // un errore senza testo riconoscibile: comando generico
  sh(d.world, 'make deploy', 3000, true, '');
  x = val(d);
  ok(x && x.kind === 'command' && x.value >= 0 && x.value <= 1, 'fallimento senza testo: comando generico');
  const all = sp.surprises([a, b, c, d]).surprises;
  ok(all.length === 6 && all.every((y, i) => !i || all[i - 1].t <= y.t), `elenco della sessione: ${all.length} sorprese in ordine di tempo`);
}

function run(ok) {
  console.log('sorprese');
  surpriseTests(ok);
  console.log('mappa contro territorio');
  groundingTests(ok);
  console.log('percorsi inventati');
  ghostTests(ok);
  console.log('affermazioni');
  claimTests(ok);
  alertTests(ok);
}

module.exports = { run };

if (require.main === module) {
  let failed = 0;
  run((cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failed++; });
  console.log(failed ? `\n${failed} controlli falliti` : '\nTutto a posto.');
  process.exit(failed ? 1 : 0);
}
