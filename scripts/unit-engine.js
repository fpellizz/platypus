#!/usr/bin/env node
'use strict';
// Prove del motore per i casi trovati dal giro di debug: stato dei sottoagenti, lettura dei transcript,
// archivio, mappa, libro. Tutto in memoria o in cartelle temporanee, mai sessioni vere.
// Le richiama smoke-test.js (quindi anche npm test e le GitHub Actions); si possono lanciare anche da sole.

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

function run(ok) {
  console.log('motore: casi del giro di debug');
  quietSubTests(ok);
}

module.exports = { run };

if (require.main === module) {
  let failed = 0;
  run((cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failed++; });
  console.log(failed ? `\n${failed} controlli falliti` : '\nTutto a posto.');
  process.exit(failed ? 1 : 0);
}
