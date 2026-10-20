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
  console.log(`Agent Office smoke test · ${process.platform} ${process.arch} · Node ${process.versions.node}`);

  console.log('sintassi');
  for (const f of walk(path.join(ROOT, 'src')).concat(walk(path.join(ROOT, 'renderer')), walk(path.join(ROOT, 'scripts')))) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) ok(false, path.relative(ROOT, f) + '\n' + r.stderr);
  }
  ok(true, 'node --check su tutti i file');

  console.log('traduzioni');
  const i = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'i18n-check.js')], { encoding: 'utf8' });
  ok(i.status === 0, i.stdout.trim());

  console.log('motore');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-test-'));
  const base = path.join(tmp, 'claude');
  fs.mkdirSync(path.join(base, 'projects'), { recursive: true });
  const { startCore } = require(path.join(ROOT, 'src', 'core'));
  const port = 47900 + Math.floor(Math.random() * 90);
  const core = startCore({ port, base, settingsPath: path.join(tmp, 'settings.json'), statsPath: path.join(tmp, 'stats.json'), fetch: async () => { throw new Error('offline'); } });
  await core.ready;
  core.demo.start();
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
  const hook = await get(port, '/agent-office-hook', 'POST', JSON.stringify({ session_id: 'smoke-1', hook_event_name: 'PreToolUse', cwd: tmp, tool_name: 'Read', tool_input: { file_path: 'a.txt' } }));
  ok(hook.status === 204, 'hook ricevuto → ' + hook.status);
  const perm = await get(port, '/agent-office-hook/permission', 'POST', JSON.stringify({ session_id: 'smoke-1', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } }));
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

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} controlli falliti` : '\nTutto a posto.');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
