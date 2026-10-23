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
  const { startCore } = require(path.join(ROOT, 'src', 'core'));
  const port = 47900 + Math.floor(Math.random() * 90);
  const core = startCore({ port, base, settingsPath: path.join(tmp, 'settings.json'), statsPath: path.join(tmp, 'stats.json'), fetch: async () => { throw new Error('offline'); } });
  await core.ready;
  core.demo.start({ scale: 0.02 }); // gli scenari costruiti apposta, in velocità
  await sleep(2500);
  const st = JSON.parse((await get(port, '/api/state')).body);
  ok(st.sessions.length >= 4, `demo: ${st.sessions.length} piani, ${st.sessions.reduce((a, s) => a + s.subs.length, 0)} sottoagenti`);
  const sid = st.sessions[0].id;
  for (const p of ['/', '/i18n.js', '/i18n-runtime.js', '/game.js', '/worldmap.js', '/report', '/api/settings', '/api/stats/costs', '/api/report']) {
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
