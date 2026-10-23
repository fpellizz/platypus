#!/usr/bin/env node
'use strict';
// Prova veloce che gira uguale su Windows, macOS e Linux (anche nelle GitHub Actions):
// sintassi di tutti i file, traduzioni, motore con la demo, API principali, hook.
// Non tocca la tua configurazione: usa cartelle temporanee.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failed++; };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|dist|\.git|locales)$/.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
function get(port, p, method = 'GET', body) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json' } }, res => {
      let d = ''; res.on('data', c => { d += c; }); res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', e => resolve({ status: 0, body: e.message }));
    if (body) req.write(body);
    req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log(`Platypus smoke test · ${process.platform} ${process.arch} · Node ${process.versions.node}`);

  console.log('sintassi');
  for (const f of walk(path.join(ROOT, 'src')).concat(walk(path.join(ROOT, 'renderer')), walk(path.join(ROOT, 'scripts')))) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) ok(false, path.relative(ROOT, f) + '\n' + r.stderr);
  }
  ok(true, 'node --check su tutti i file');

  console.log('traduzioni');
  const i = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'i18n-check.js')], { encoding: 'utf8' });
  ok(i.status === 0, i.stdout.trim());

  require('./unit-test').run(ok);
  require('./unit-claudemd').run(ok);
  require('./unit-surprise').run(ok);

  console.log('motore');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'platypus-test-'));
  const base = path.join(tmp, 'claude');
  fs.mkdirSync(path.join(base, 'projects'), { recursive: true });
  // una sessione finta di Claude Code nella cartella di prova: il libro della bottega deve impararci qualcosa
  const fakeCwd = path.join(tmp, 'progetto');
  const fakeDir = path.join(base, 'projects', 'progetto-finto');
  fs.mkdirSync(fakeDir, { recursive: true });
  const T0 = Date.now() - 60000, at = k => new Date(T0 + k * 1000).toISOString();
  const asst = (k, id, name, input) => ({ type: 'assistant', timestamp: at(k), sessionId: 'bottega-smoke-0001', cwd: fakeCwd, message: { id: 'm' + k, role: 'assistant', content: [{ type: 'tool_use', id, name, input }], usage: { input_tokens: 10, output_tokens: 10 } } });
  const res = (k, id, err, content) => ({ type: 'user', timestamp: at(k), sessionId: 'bottega-smoke-0001', cwd: fakeCwd, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: err, content }] } });
  fs.writeFileSync(path.join(fakeDir, 'bottega-smoke-0001.jsonl'), [
    { type: 'user', timestamp: at(0), sessionId: 'bottega-smoke-0001', cwd: fakeCwd, message: { role: 'user', content: 'Sistema il login' } },
    asst(1, 't1', 'Read', { file_path: path.join(fakeCwd, 'src', 'vecchio.ts') }), res(2, 't1', true, 'File does not exist.'),
    asst(3, 't2', 'Bash', { command: 'npm test' }), res(4, 't2', true, 'FAIL src/a.test.ts\nTests: 1 failed'),
    asst(5, 't3', 'Bash', { command: 'npm test' }), res(6, 't3', true, 'FAIL src/a.test.ts\nTests: 1 failed'),
    asst(7, 't4', 'Bash', { command: 'npm test' }), res(8, 't4', true, 'FAIL src/a.test.ts\nTests: 1 failed'),
  ].map(o => JSON.stringify(o)).join('\n') + '\n');
  // una sessione passata dello stesso progetto (file di tre giorni fa: è in archivio, non aperta)
  const oldFile = path.join(fakeDir, 'bottega-smoke-0000.jsonl');
  const T1 = Date.now() - 3 * 86400000, at1 = k => new Date(T1 + k * 1000).toISOString();
  fs.writeFileSync(oldFile, [
    { type: 'user', timestamp: at1(0), sessionId: 'bottega-smoke-0000', cwd: fakeCwd, message: { role: 'user', content: 'Aggiorna i test' } },
    { type: 'assistant', timestamp: at1(1), sessionId: 'bottega-smoke-0000', cwd: fakeCwd, message: { id: 'o1', role: 'assistant', content: [{ type: 'tool_use', id: 'o1', name: 'Read', input: { file_path: path.join(fakeCwd, 'src', 'vecchio.ts') } }], usage: { input_tokens: 10, output_tokens: 10 } } },
    { type: 'user', timestamp: at1(2), sessionId: 'bottega-smoke-0000', cwd: fakeCwd, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'o1', is_error: true, content: 'File does not exist.' }] } },
  ].map(o => JSON.stringify(o)).join('\n') + '\n');
  fs.utimesSync(oldFile, new Date(T1), new Date(T1));
  const { startCore } = require(path.join(ROOT, 'src', 'core'));
  const port = 47900 + Math.floor(Math.random() * 90);
  const core = startCore({ port, base, settingsPath: path.join(tmp, 'settings.json'), statsPath: path.join(tmp, 'stats.json'), fetch: async () => { throw new Error('offline'); } });
  await core.ready;
  core.demo.start({ scale: 0.02 }); // gli scenari costruiti apposta, in velocità
  await sleep(2500);
  const st = JSON.parse((await get(port, '/api/state')).body);
  ok(st.sessions.length >= 4, `demo: ${st.sessions.length} piani, ${st.sessions.reduce((a, s) => a + s.subs.length, 0)} sottoagenti`);
  const sid = st.sessions[0].id;
  for (const p of ['/', '/i18n.js', '/i18n-runtime.js', '/game.js', '/worldmap.js', '/bottega.js', '/report', '/api/settings', '/api/stats/costs', '/api/report']) {
    const r = await get(port, p);
    ok(r.status === 200, `GET ${p} → ${r.status}`);
  }
  const map = JSON.parse((await get(port, `/api/agentmap?sid=${sid}&aid=all`)).body);
  ok(map.ok && map.nodes.length > 0 && map.trajectories.length > 0, `mappa della realtà: ${map.nodes.length} luoghi, ${map.trajectories.length} traiettorie`);
  const mind = JSON.parse((await get(port, `/api/agentmind?sid=${sid}&aid=main`)).body);
  ok(mind.ok && mind.pieces && mind.pieces.length > 0, `bolla del contesto: ${mind.pieces ? mind.pieces.length : 0} pezzi`);
  const gr = JSON.parse((await get(port, `/api/grounding?sid=${sid}&aid=all`)).body);
  ok(gr.ok && Array.isArray(gr.stale) && Array.isArray(gr.blindEdits) && Array.isArray(gr.ghosts) && Array.isArray(gr.claims) && gr.disk, `mappa contro territorio: ${gr.stale ? gr.stale.length : 0} ricordi scaduti, ${gr.blindEdits ? gr.blindEdits.length : 0} modifiche alla cieca, ${gr.ghosts ? gr.ghosts.length : 0} percorsi inventati, ${gr.claims ? gr.claims.length : 0} affermazioni`);
  // lo scenario della demo sul piano 1 (portale-clienti)
  const p1 = st.sessions.find(s => /portale-clienti/.test(s.cwd));
  const sc = p1 ? JSON.parse((await get(port, `/api/grounding?sid=${p1.id}&aid=all`)).body) : {};
  ok(sc.ok && sc.disk && sc.disk.checked, 'scenario: disco finto della demo');
  ok(sc.ok && sc.stale.some(x => x.key === 'src/auth/session.ts' && /EXPLORE/.test(x.agentName) && /ARCHITECT/.test(x.changedBy || '')), 'scenario: ricordo scaduto di EXPLORE, cambiato da ARCHITECT');
  ok(sc.ok && sc.ghosts.some(x => x.key === 'src/auth/oldToken.ts' && x.source === 'tool'), 'scenario: percorso inventato src/auth/oldToken.ts');
  const tc = sc.ok ? sc.claims.filter(c => c.agent === 'main' && c.kind === 'tests').sort((a, b) => a.t - b.t) : [];
  ok(tc.length >= 2 && tc[0].status === 'ungrounded' && tc[tc.length - 1].status === 'grounded', `scenario: «i test passano» prima senza prove, poi ancorata (${tc.map(c => c.status).join(' → ')})`);
  ok(sc.ok && sc.claims.some(c => c.agent === 'main' && c.kind === 'fixed' && c.status === 'grounded'), 'scenario: «ho corretto il refresh» ancorata dalla modifica');
  ok(sc.ok && !sc.blindEdits.some(b => b.agent === 'main' && b.key === 'src/auth/refresh.ts'), 'scenario: CLAUDE rilegge refresh.ts prima di modificarlo (niente modifica alla cieca)');
  ok(sc.ok && Array.isArray(sc.surprises) && sc.surprises.some(x => x.value >= 0.5 && x.kind === 'test'), `sorprese sul piano 1: ${sc.surprises ? sc.surprises.length : 0} (anche il test e2e che si incastra)`);
  ok(sc.ok && sc.surprises.some(x => x.kind === 'test' && x.reaction === 'insists') && Array.isArray(sc.reactions), 'il test-runner bloccato insiste sullo stesso comando');
  const bk = p1 ? JSON.parse((await get(port, `/api/bottega?sid=${p1.id}`)).body) : {};
  ok(bk.ok && Array.isArray(bk.lessons) && /^[0-9a-f]{16}$/.test(bk.key), `libro della bottega del piano 1: ${bk.lessons ? bk.lessons.length : '-'} lezioni`);
  const bk404 = p1 ? await get(port, '/api/bottega', 'POST', JSON.stringify({ sid: p1.id, action: 'pin', id: 'nessuna' })) : { status: 0 };
  ok(bk404.status === 404, 'azione su una lezione che non c\'è → ' + bk404.status);
  const learned = core.learnLive();
  const fk = JSON.parse((await get(port, '/api/bottega?cwd=' + encodeURIComponent(fakeCwd))).body);
  const kindsFk = new Set((fk.lessons || []).map(l => l.kind));
  ok(learned > 0 && kindsFk.has('ghost-path') && kindsFk.has('loop-trap') && kindsFk.has('flaky-command'), `il libro impara da una sessione aperta: ${learned} casi, ${[...kindsFk].join(', ')}`);
  ok(core.learnLive() === 0, 'imparare di nuovo dalla stessa sessione non aggiunge nulla');
  // dall'archivio, in background: la sessione aperta si salta, quella passata si legge una volta sola
  const lr = JSON.parse((await get(port, '/api/bottega/learn', 'POST', JSON.stringify({ cwd: fakeCwd }))).body);
  let fk2 = {};
  for (let k = 0; k < 40; k++) { await sleep(100); fk2 = JSON.parse((await get(port, '/api/bottega?cwd=' + encodeURIComponent(fakeCwd))).body); if (fk2.learning && !fk2.learning.running) break; }
  const gl = (fk2.lessons || []).find(l => l.kind === 'ghost-path');
  ok(lr.ok && lr.learning.total === 1 && fk2.learnedSessions === 1 && gl && gl.sessions.length === 2 && gl.level === 'lesson', `imparare dall'archivio: ${fk2.learnedSessions} sessione letta, il percorso inventato ora è una lezione (${gl ? gl.sessions.length : 0} sessioni)`);
  const lr2 = JSON.parse((await get(port, '/api/bottega/learn', 'POST', JSON.stringify({ cwd: fakeCwd }))).body);
  ok(lr2.ok && lr2.learning.total === 0, 'una sessione già letta e non cambiata non si rilegge');
  core.bottega.save();
  const books = JSON.parse((await get(port, '/api/bottega/list')).body);
  const fb = (books.books || []).find(b => b.cwd === fakeCwd);
  ok(fb && fb.strong >= 1 && fb.name === 'progetto', `scheda BOTTEGA: ${books.books ? books.books.length : 0} libri, «${fb && fb.name}» con ${fb && fb.strong} lezioni`);
  const byKey = fb ? JSON.parse((await get(port, '/api/bottega?key=' + fb.key)).body) : {};
  ok(byKey.ok && byKey.lessons.length === fk2.lessons.length, 'il libro si apre anche dalla sua chiave');
  const ev = gl && gl.evidence.find(e => e.sid === 'bottega-smoke-0000');
  const rp = ev ? JSON.parse((await get(port, '/api/replay', 'POST', JSON.stringify({ action: 'start', key: ev.sid, at: ev.t }))).body) : {};
  ok(rp.ok, 'dalla prova al replay della sessione, da quel momento');
  await get(port, '/api/replay', 'POST', JSON.stringify({ action: 'stop' }));
  const hn = JSON.parse((await get(port, '/api/bottega/hints?sid=bottega-smoke-0001')).body);
  ok(hn.ok && Array.isArray(hn.hints), `il Nonno risponde: ${hn.hints ? hn.hints.length : '-'} cose da dire`);
  core.state.setSettings({ bottegaLearn: false });
  const off = await get(port, '/api/bottega/learn', 'POST', JSON.stringify({ cwd: fakeCwd }));
  ok(off.status === 409 && core.learnLive() === 0, 'apprendimento spento: niente dal vivo né dall\'archivio → ' + off.status);
  core.state.setSettings({ bottegaLearn: true });
  const bkDemo = JSON.parse((await get(port, `/api/bottega?sid=${p1.id}`)).body);
  ok(bkDemo.ok && bkDemo.lessons.length === 0, 'la demo non scrive nel libro');
  // scenario della sorpresa: catena completa e un agente che cerca altrove
  const chain = sc.ok ? sc.surprises.find(x => x.refs && x.refs.some(r => r.file === 'src/auth/refresh.ts' && r.line === 42)) : null;
  ok(chain && chain.value === 1 && chain.reasons.includes('usedToWork') && !chain.reasons.includes('tdd'), `scenario: il test che prima passava fallisce, sorpresa forte (${chain ? Math.round(chain.value * 100) + '%' : '-'})`);
  ok(chain && chain.cause === 'follows' && chain.reaction === 'corrects' && chain.chain.complete, 'scenario: segue la traccia fino a refresh.ts e la catena si chiude con i test di nuovo verdi');
  const away = sc.ok ? sc.surprises.find(x => x.refs && x.refs.some(r => r.file === 'src/db/migrate.ts')) : null;
  ok(away && away.cause === 'elsewhere' && away.chain.fix && /Menu\.tsx$/.test(away.chain.fix.target), 'scenario: l\'errore cita migrate.ts, il PLAN modifica Menu.tsx (cerca altrove)');
  const hook = await get(port, '/platypus-hook', 'POST', JSON.stringify({ session_id: 'smoke-1', hook_event_name: 'PreToolUse', cwd: tmp, tool_name: 'Read', tool_input: { file_path: 'a.txt' } }));
  ok(hook.status === 204, 'hook ricevuto → ' + hook.status);
  const perm = await get(port, '/platypus-hook/permission', 'POST', JSON.stringify({ session_id: 'smoke-1', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } }));
  ok(perm.status === 204, 'permesso senza finestre aperte: decide il terminale → ' + perm.status);
  const bad = await new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/state', headers: { Host: 'evil.example' } }, res => resolve(res.statusCode));
    req.on('error', () => resolve(0)); req.end();
  });
  ok(bad === 403, 'richieste da altri host rifiutate → ' + bad);
  core.stop();

  console.log('hook di Claude Code');
  const hooks = require(path.join(ROOT, 'src', 'core', 'hooks'));
  hooks.install({ port: 47800, base });
  ok(hooks.status({ base }) && !hooks.outdated({ base }), 'installati in una configurazione di prova');
  hooks.uninstall({ base });
  ok(!hooks.status({ base }), 'rimossi');

  console.log('finestra della sessione (Windows)');
  const osint = require(path.join(ROOT, 'src', 'core', 'osint'));
  const script = osint.focusScriptWin(1234, ['idea64'], { name: 'dsg', path: 'c:\\users\\x\\dsg' });
  ok(script.includes("$PROJ = 'dsg'") && script.includes("$PROJPATH = 'c:\\users\\x\\dsg'"), 'il progetto della sessione finisce nello script');
  ok(/\[AOW\]::Windows/.test(script), 'sceglie tra tutte le finestre del processo, non solo la principale');
  // un apice nel nome della cartella non deve poter chiudere la stringa PowerShell
  const quoted = osint.focusScriptWin(1, ['x'], { name: "o'brien", path: "c:\\o'brien" });
  const projLine = quoted.split('\n').find(l => l.startsWith('$PROJ '));
  ok(projLine === "$PROJ = 'o''brien'", 'apici raddoppiati: ' + projLine);
  // senza cartella valida si torna al comportamento di sempre
  ok(osint.focusScriptWin(1, ['x'], null).includes("$PROJ = ''"), 'senza progetto non si filtra per titolo');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} controlli falliti` : '\nTutto a posto.');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
