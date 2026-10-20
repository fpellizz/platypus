'use strict';
// Progetti e lavoro finti per la demo della "mappa della realtà": alberi di file credibili
// e agenti che esplorano, costruiscono e verificano (a volte si incastrano).

function seeded(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }
function pickR(rnd, a) { return a[Math.floor(rnd() * a.length)]; }

function treeFor(cwd) {
  const f = [];
  const add = (dir, names, size = 3000) => { for (const n of names) f.push([dir ? dir + '/' + n : n, Math.round(size * (0.4 + (n.length % 7) / 4))]); };
  if (/portale-clienti/.test(cwd)) {
    add('', ['package.json', 'tsconfig.json', 'README.md', '.env.example'], 800);
    add('.github/workflows', ['ci.yml', 'deploy.yml'], 900);
    add('src/auth', ['login.ts', 'session.ts', 'token.ts', 'refresh.ts', 'logout.ts', 'index.ts', 'middleware.ts']);
    add('src/api', ['users.ts', 'orders.ts', 'invoices.ts', 'client.ts', 'errors.ts']);
    add('src/ui', ['App.tsx', 'LoginForm.tsx', 'Dashboard.tsx', 'Header.tsx', 'Profile.tsx', 'Orders.tsx', 'Invoices.tsx']);
    add('src/ui/components', ['Button.tsx', 'Modal.tsx', 'Table.tsx', 'Form.tsx', 'Toast.tsx', 'Menu.tsx', 'Avatar.tsx', 'Badge.tsx']);
    add('src/db', ['schema.sql', 'migrate.ts', 'seed.ts', 'pool.ts']);
    add('src/utils', ['dates.ts', 'money.ts', 'logger.ts', 'config.ts', 'crypto.ts', 'validate.ts']);
    add('tests', ['auth.test.ts', 'api.test.ts', 'utils.test.ts', 'db.test.ts']);
    add('tests/e2e', ['login.spec.ts', 'checkout.spec.ts', 'profile.spec.ts']);
    add('docs', ['ARCHITETTURA.md', 'api.md', 'sessioni.md', 'deploy.md'], 5000);
  } else if (/mes-clone/.test(cwd)) {
    add('', ['package.json', 'README.md', 'docker-compose.yml'], 900);
    const mods = ['orders', 'warehouse', 'plc', 'shifts', 'sap', 'alarms', 'recipes', 'lots', 'oee', 'operators'];
    for (const m of mods) { add('src/' + m, ['index.ts', 'service.ts', 'model.ts', 'api.ts']); add('tests/' + m, ['service.test.ts']); }
    const reqs = []; for (let i = 1; i <= 48; i++) reqs.push('REQ-' + String(i).padStart(3, '0') + '.md');
    add('specs', reqs, 2500);
    add('docs', ['glossario.md', 'tracciabilita.md', 'integrazione-sap.md'], 6000);
  } else if (/isms-docs/.test(cwd)) {
    add('', ['README.md', 'indice.md'], 1500);
    add('policy', ['sicurezza-informazioni.md', 'controllo-accessi.md', 'backup.md', 'crittografia.md', 'fornitori.md', 'smart-working.md', 'incidenti.md', 'classificazione.md', 'sviluppo-sicuro.md', 'continuita.md'], 7000);
    add('procedure', ['gestione-incidenti.md', 'onboarding.md', 'offboarding.md', 'change-management.md', 'vulnerabilita.md', 'log-monitoring.md'], 5000);
    add('registri', ['asset.xlsx', 'rischi.xlsx', 'fornitori.xlsx', 'formazione.xlsx'], 40000);
    add('audit', ['audit-interno-2026.md', 'non-conformita.md', 'soa.md'], 8000);
  } else {
    add('dati', ['vendite-q1.xlsx', 'vendite-q2.xlsx', 'vendite-q3.xlsx', 'clienti.csv', 'listino.xlsx'], 60000);
    add('report', ['report-q1.pdf', 'report-q2.pdf', 'note-direzione.docx'], 120000);
    add('grafici', ['fatturato.png', 'margini.png', 'regioni.png'], 50000);
    add('', ['bozza-report-q3.docx', 'istruzioni.md'], 20000);
  }
  return f;
}

// cosa "studia" ogni agente: dove guarda, cosa tocca, come verifica
function profileFor(a, files, rnd) {
  const dirs = [...new Set(files.map(([p]) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''))];
  const desc = String(a.description || '').toLowerCase();
  const byWord = dirs.filter(d => d && desc.split(/\W+/).some(w => w.length > 3 && d.toLowerCase().includes(w.slice(0, 5))));
  const type = String(a.type || '');
  let focus;
  if (byWord.length) focus = byWord;
  else if (/test/.test(type)) focus = dirs.filter(d => /test/.test(d));
  else if (/review|spec/.test(type)) focus = [pickR(rnd, dirs.filter(d => /^src\//.test(d)) || dirs), 'specs'].filter(Boolean);
  else if (/architect|plan/i.test(type)) focus = dirs.filter(d => /docs|src\/auth|src\/db/.test(d));
  else focus = [pickR(rnd, dirs)];
  if (!focus.length) focus = [pickR(rnd, dirs)];
  const builder = /test|general|architect/.test(type) || a.kind === 'main';
  return { focus, builder, reviewer: /review|spec|Explore|Plan/.test(type) };
}

class DemoWorld {
  constructor(state) { this.state = state; this.seq = 0; this.timers = new Set(); }
  stop() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); }

  ensure(s, a) {
    if (!s.demoTree) s.demoTree = treeFor(s.cwd);
    if (!a._dw) {
      const rnd = seeded(String(a.id).split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
      a._dw = { ...profileFor(a, s.demoTree, rnd), rnd, phase: 'explore', k: 0, edited: [], total: 0 };
      if (a._demoDrift) a._dw.focus = ['src/db', 'docs'];
      if (a.kind === 'main') { // il capo resta vicino al suo compito
        const f = /portale/.test(s.cwd) ? ['src/auth', 'docs'] : /mes-clone/.test(s.cwd) ? ['specs', 'docs'] : /isms/.test(s.cwd) ? ['policy', 'audit'] : ['dati', 'report'];
        a._dw.focus = f;
      }
    }
    return a._dw;
  }

  // prossima azione dell'agente in base alla fase
  next(s, a) {
    const w = this.ensure(s, a), rnd = w.rnd, files = s.demoTree;
    const inFocus = files.filter(([p]) => w.focus.some(d => p.startsWith(d + '/') || (!d && !p.includes('/'))));
    const near = inFocus.length ? inFocus : files;
    const anyFile = () => pickR(rnd, rnd() < 0.8 ? near : files)[0];
    w.k++;
    if (a._demoDrift && ++w.total === 12) { w.focus = [a._demoDrift]; w.phase = 'explore'; w.k = 0; w.builder = true; } // si perde per strada
    // cambi di fase
    if (w.phase === 'explore' && w.k > 4 + rnd() * 6) { w.phase = w.builder ? 'build' : 'study'; w.k = 0; }
    else if (w.phase === 'study' && w.k > 5 + rnd() * 6) { w.phase = 'explore'; w.k = 0; w.focus = [pickR(rnd, [...new Set(files.map(([p]) => p.slice(0, p.lastIndexOf('/'))))])]; }
    else if (w.phase === 'build' && w.k > 3 + rnd() * 4) { w.phase = 'verify'; w.k = 0; }
    else if (w.phase === 'verify' && w.k > 1 + rnd() * 2) { w.phase = rnd() < 0.3 ? 'explore' : 'build'; w.k = 0; }
    const id = 'demo-tu-' + (++this.seq);
    const isMd = files.some(([p]) => /\.md$/.test(p)) && !files.some(([p]) => /\.ts$/.test(p));
    switch (w.phase) {
      case 'explore': {
        const r = rnd();
        if (r < 0.3) { const dir = pickR(rnd, w.focus) || '.'; return { id, tool: 'Grep', input: { pattern: pickR(rnd, ['token', 'session', 'TODO', 'export', 'accessi', 'lotto', 'fatturato']), path: dir }, result: near.filter(() => rnd() < 0.5).slice(0, 6).map(f => f[0]).join('\n') }; }
        if (r < 0.4) return { id, tool: 'Glob', input: { pattern: '**/*', path: pickR(rnd, w.focus) }, result: near.slice(0, 8).map(f => f[0]).join('\n') };
        if (r < 0.47 && /Cowork/.test(s.cwd)) return { id, tool: 'WebSearch', input: { query: pickR(rnd, ['benchmark margini retail 2026', 'crescita mercato Q3 2026']) }, result: '' };
        return this.readOf(id, anyFile(), files, rnd);
      }
      case 'study': return this.readOf(id, rnd() < 0.5 && w.edited.length ? pickR(rnd, w.edited) : anyFile(), files, rnd);
      case 'build': {
        const f = rnd() < 0.15 ? (pickR(rnd, w.focus) || 'src') + '/' + pickR(rnd, ['nuovo', 'helper', 'refresh-v2', 'note']) + (isMd ? '.md' : '.ts') : anyFile();
        w.edited.push(f);
        if (rnd() < 0.15) return { id, tool: 'Read', input: { file_path: f }, result: '' };
        return { id, tool: rnd() < 0.15 ? 'Write' : 'Edit', input: { file_path: f }, result: 'ok' };
      }
      case 'verify': {
        const cmd = /Cowork/.test(s.cwd) ? 'python grafici.py' : isMd ? 'npx markdownlint policy procedure' : pickR(rnd, ['npm test', 'npm test -- ' + (pickR(rnd, w.focus) || ''), 'npx tsc --noEmit']);
        return { id, tool: 'Bash', input: { command: cmd }, result: '', err: rnd() < 0.35 };
      }
    }
    return this.readOf(id, anyFile(), files, rnd);
  }

  readOf(id, file, files, rnd) {
    // il contenuto "importa" qualche file vicino: diventa frontiera sulla mappa
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    const sib = files.filter(([p]) => p !== file && p.startsWith(dir)).slice(0, 12);
    const imports = [];
    for (let i = 0; i < 3 && sib.length; i++) {
      const p = pickR(rnd, sib)[0];
      const relp = './' + p.slice(dir ? dir.length + 1 : 0).replace(/\.tsx?$/, '');
      imports.push(/\.md$/.test(file) ? `[vedi](${relp})` : `import x${i} from '${relp}';`);
    }
    return { id, tool: 'Read', input: { file_path: file }, result: imports.join('\n') };
  }

  // esegue un'azione: fumetto (hook), mappa e, poco dopo, l'esito
  act(s, a, hookFn) {
    const step = this.next(s, a);
    hookFn('PreToolUse', { agent_id: a.kind === 'main' ? undefined : a.id, agent_type: a.kind === 'main' ? undefined : a.type, tool_name: step.tool, tool_input: step.input });
    this.state.worldStart(s, a, step.id, step.tool, step.input, Date.now());
    const tm = setTimeout(() => {
      this.timers.delete(tm);
      this.state.worldEnd(s, a, step.id, !!step.err, { content: step.result || '' }, { toolUseResult: {} }, Date.now());
    }, 400 + Math.random() * 1800);
    this.timers.add(tm);
  }

  // un po' di storia già fatta, così le mappe non partono vuote
  seed(s, a, steps, stuckCmd) {
    const t0 = Date.now() - steps * 25000;
    for (let i = 0; i < steps; i++) {
      const st = this.next(s, a);
      const t = t0 + i * 25000;
      this.state.worldStart(s, a, st.id, st.tool, st.input, t);
      this.state.worldEnd(s, a, st.id, !!st.err, { content: st.result || '' }, { toolUseResult: {} }, t + 3000);
    }
    if (stuckCmd) { // si incastra: lo stesso comando che fallisce, ancora e ancora
      for (let i = 0; i < 6; i++) {
        const id = 'demo-tu-' + (++this.seq), t = Date.now() - (14 - i * 2) * 60000;
        this.state.worldStart(s, a, id, 'Bash', { command: stuckCmd }, t);
        if (i < 5) this.state.worldEnd(s, a, id, true, { content: 'FAIL' }, {}, t + 30000);
      }
    }
  }
}

module.exports = { DemoWorld, treeFor };
