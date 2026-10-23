#!/usr/bin/env node
'use strict';
// Prove del motore per i casi trovati dal giro di debug: stato dei sottoagenti, lettura dei transcript,
// archivio, mappa, libro. Tutto in memoria o in cartelle temporanee, mai sessioni vere.
// Le richiama smoke-test.js (quindi anche npm test e le GitHub Actions); si possono lanciare anche da sole.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const iso = t => new Date(t).toISOString();

// un sottoagente che scrive una frase e poi pensa più di 25 s (es. il contenuto di un Write lungo)
// non va dato per finito e poi contato di nuovo come agente nuovo
function quietSubTests(ok) {
  const { OfficeState } = require(path.join(ROOT, 'src', 'core', 'state'));
  let now = Date.parse('2026-10-23T10:00:00Z');
  const st = new OfficeState({ clock: () => now, settings: {} });
  const S = 'sess-quiet-0001';
  const line = (t, type, content, extra = {}) => ({ type, timestamp: iso(t), cwd: '/p', message: { role: type, content, ...(type === 'assistant' ? { id: 'm' + t, usage: { input_tokens: 1, output_tokens: 1 } } : {}) }, ...extra });
  const t0 = now;
  st.applyTranscriptLine(S, null, line(t0, 'assistant', [{ type: 'tool_use', id: 'spawn1', name: 'Agent', input: { subagent_type: 'Explore', description: 'Scrive il modulo' } }]));
  st.applyTranscriptLine(S, 'ag1', line(t0 + 1000, 'user', 'Scrivi il modulo'));
  st.applyTranscriptLine(S, 'ag1', line(t0 + 2000, 'assistant', [{ type: 'text', text: 'Ora creo il file del modulo.' }]));
  const s = st.sessions.get(S);
  const a1 = s.subs.get('ag1');
  for (let k = 1; k <= 8; k++) { now = t0 + 2000 + k * 5000; st.tick(); } // 40 s senza righe
  now = t0 + 42000;
  st.applyTranscriptLine(S, 'ag1', line(now, 'assistant', [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: '/p/src/mod.ts', content: '…' } }]));
  const a2 = s.subs.get('ag1');
  ok(a2 === a1 && !a2.finished && a2.status === 'working', 'sottoagente zitto per 40 s che riscrive: è lo stesso agente, di nuovo al lavoro');
  st.applyTranscriptLine(S, 'ag1', line(now + 1000, 'user', [{ type: 'tool_result', tool_use_id: 'w1', content: 'ok' }]));
  st.applyTranscriptLine(S, null, line(now + 2000, 'user', [{ type: 'tool_result', tool_use_id: 'spawn1', content: 'fatto' }], { toolUseResult: { status: 'completed', agentId: 'ag1' } }));
  ok(s.completed === 1 && Object.values(s.completedByType).reduce((x, y) => x + y, 0) === 1, `quando finisce davvero il compito si conta una volta sola (fatti: ${s.completed}, per tipo: ${JSON.stringify(s.completedByType)})`);
  st.stop && st.stop();
}

// un sottoagente vecchio (o già concluso all'avvio) che viene ripreso, es. con SendMessage:
// le righe nuove nello stesso file vanno lette, non ignorate per sempre
function resumedSubTests(ok) {
  const { OfficeState } = require(path.join(ROOT, 'src', 'core', 'state'));
  const { TranscriptWatcher } = require(path.join(ROOT, 'src', 'core', 'sources'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'platypus-test-'));
  try {
    const pdir = path.join(tmp, 'projects', 'proj');
    const now = Date.now();
    const L = (sid, t, type, content) => JSON.stringify({ type, timestamp: iso(t), sessionId: sid, cwd: '/p', message: { role: type, content, ...(type === 'assistant' ? { id: 'm' + t + Math.random(), usage: { input_tokens: 1, output_tokens: 1 } } : {}) } }) + '\n';
    const setup = (sid, { finished = false } = {}) => {
      fs.mkdirSync(path.join(pdir, sid, 'subagents'), { recursive: true });
      const main = path.join(pdir, sid + '.jsonl');
      fs.writeFileSync(main, L(sid, now - 60000, 'user', 'ciao'));
      const sub = path.join(pdir, sid, 'subagents', 'agent-ag1.jsonl');
      fs.writeFileSync(sub, L(sid, now - 3600000, 'user', 'Analizza i moduli') + L(sid, now - 3599000, 'assistant', [{ type: 'text', text: 'Fatto.' }]));
      fs.writeFileSync(sub.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Analizza i moduli', finished }));
      if (!finished) { const old = new Date(now - 3600000); fs.utimesSync(sub, old, old); }
      return { main, sub, resume: () => fs.appendFileSync(sub, L(sid, now + 1000, 'user', 'Riprendi: controlla anche api/') + L(sid, now + 2000, 'assistant', [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/p/api/a.ts' } }])) };
    };
    // 1) la sessione è già seguita quando si trova il file vecchio del sottoagente (l'ordine dipende dal sistema)
    {
      const st = new OfficeState({});
      const w = new TranscriptWatcher(st, { base: tmp });
      const f = setup('sess-old-0001');
      w.maybeTrack(f.main, true);
      w.scan(true);
      const tokBefore = st.sessions.get('sess-old-0001').tok.out;
      f.resume();
      w.pollTracked();
      const s = st.sessions.get('sess-old-0001'), a = s && s.subs.get('ag1');
      ok(a && !a.finished && a.status === 'working' && !w.files.get(f.sub).ignored, 'sottoagente vecchio ripreso: torna nel piano e lo seguiamo dal vivo');
      ok(s.tok.out === tokBefore + 1, `i suoi token vecchi non si contano due volte (${tokBefore} → ${s.tok.out})`);
      w.stop();
    }
    // 2) sottoagente già concluso quando si apre l'ufficio, poi ripreso
    {
      const st = new OfficeState({});
      const w = new TranscriptWatcher(st, { base: tmp });
      const f = setup('sess-fin-0001', { finished: true });
      w.maybeTrack(f.main, true);
      w.maybeTrack(f.sub, true);
      f.resume();
      w.pollTracked();
      w.refreshMeta(); // il meta.json dice ancora "finished" (scritto prima della ripresa)
      const a = st.sessions.get('sess-fin-0001').subs.get('ag1');
      ok(a && !a.finished && a.status === 'working', 'sottoagente concluso all\'avvio e poi ripreso: di nuovo al lavoro, nonostante il vecchio «finished»');
      w.stop();
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// archivio: durata e titolo di una sessione il cui file sta fra 64 e 256 KB
function archiveTests(ok) {
  const { listArchive } = require(path.join(ROOT, 'src', 'core', 'archive'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'platypus-test-'));
  try {
    const pdir = path.join(tmp, 'projects', 'proj');
    fs.mkdirSync(pdir, { recursive: true });
    const t0 = Date.parse('2026-10-20T09:00:00Z'), pad = 'x'.repeat(900);
    let body = '';
    for (let i = 0; i < 200; i++) body += JSON.stringify({ type: i % 2 ? 'assistant' : 'user', timestamp: iso(t0 + i * 60000), sessionId: 'sess-arch-0001', cwd: '/p/app', message: { role: i % 2 ? 'assistant' : 'user', content: i === 0 ? 'Rifai la pagina di login' : [{ type: 'text', text: pad }] } }) + '\n';
    body += JSON.stringify({ type: 'ai-title', aiTitle: 'Nuova pagina di login', sessionId: 'sess-arch-0001' }) + '\n';
    fs.writeFileSync(path.join(pdir, 'sess-arch-0001.jsonl'), body);
    const x = listArchive({ base: tmp }).find(r => r.id === 'sess-arch-0001');
    const kb = Math.round(body.length / 1024), min = x ? Math.round((x.end - x.start) / 60000) : -1;
    ok(x && min === 199 && x.title === 'Nuova pagina di login' && x.start === t0, `archivio, file da ${kb} KB: durata ${min} min (vera 199) e titolo «${x && x.title}»`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// mappa: percorsi dei comandi Git Bash su Windows (/d/dev/... è D:\dev\...)
function gitBashPathTests(ok) {
  const { AgentWorld, relKey } = require(path.join(ROOT, 'src', 'core', 'worldmap'));
  const cwd = 'D:\\dev\\shop';
  const w = new AgentWorld();
  w.start('a', 'Bash', { command: 'cd /d/dev/shop && cat src/cart.ts' }, 1000, cwd);
  w.end('a', false, { content: 'ok' }, null, 1100, cwd);
  w.start('b', 'Read', { file_path: 'D:\\dev\\shop\\src\\cart.ts' }, 1200, cwd);
  w.end('b', false, { content: 'export const cart = 1' }, null, 1300, cwd);
  const keys = [...w.nodes.keys()].filter(k => !/^cmd:/.test(k) && k !== '.'); // "." è la cartella del cd
  ok(keys.length === 1 && keys[0] === 'src/cart.ts', 'Git Bash «cd /d/dev/shop && cat src/cart.ts»: lo stesso luogo del Read, nel progetto (' + keys.join(', ') + ')');
  ok(relKey('/d/dev/other/x.ts', cwd) === 'abs:D:/dev/other/x.ts' && relKey('/cygdrive/d/dev/shop/a.ts', cwd) === 'a.ts', 'Git Bash: fuori dal progetto resta assoluto, /cygdrive/d vale come /d');
  ok(relKey('/d/dev/shop/a.ts', '/home/u/shop') === 'abs:/d/dev/shop/a.ts', 'su Linux e macOS /d/... resta un percorso normale');
}

function run(ok) {
  console.log('motore: casi del giro di debug');
  quietSubTests(ok);
  resumedSubTests(ok);
  archiveTests(ok);
  gitBashPathTests(ok);
}

module.exports = { run };

if (require.main === module) {
  let failed = 0;
  run((cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failed++; });
  console.log(failed ? `\n${failed} controlli falliti` : '\nTutto a posto.');
  process.exit(failed ? 1 : 0);
}
