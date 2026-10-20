'use strict';
// Modalità demo: sessioni finte per vedere il palazzo in azione senza Claude Code.
// Tre piani: un progetto con un capo reparto e la sua squadra, una revisione "di massa"
// con decine di agenti in background, e un progetto piccolo con richieste di permesso.

const { tr } = require('../i18n');

// funzioni, così i testi escono nella lingua del momento
const REVIEW_TARGETS = () => [tr('modulo ordini'), tr('API magazzino'), tr('scheduler PLC'), tr('report turni'), tr('login operatori'), tr('export SAP'), tr('allarmi linea 3'), tr('ricette prodotto'), tr('tracciabilità lotti'), tr('dashboard OEE')];

const { DemoWorld, treeFor } = require('./demoworld');

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

class Demo {
  constructor(state) {
    this.state = state;
    this.timer = null;
    this.n = 0;
    this.ids = {};
    this.world = new DemoWorld(state);
  }
  get on() { return !!this.timer; }

  start() {
    if (this.timer) return;
    this.state.demo = true;
    this.ids.a = this.open('C:/Progetti/portale-clienti', tr('Refactoring login e sessioni'), 'cli');
    this.ids.b = this.open('D:/dev/mes-clone', tr('Revisione completa delle specifiche'), 'claude-desktop');
    this.ids.c = this.open('C:/Progetti/isms-docs', tr('Revisione policy ISO 27001'), 'claude-vscode');
    this.ids.d = this.open('C:/Users/max/Documents/Cowork', tr('Report trimestrale per il cliente'), 'local-agent');
    for (const d of [tr('Raccogli i dati di vendita Q3'), tr('Cerca i benchmark di settore'), tr('Prepara i grafici')]) this.spawn(this.ids.d, 'general-purpose', d);
    this.spawn(this.ids.d, 'Explore', tr('Leggi i report dei trimestri precedenti'));
    // capo reparto con la sua squadra
    const arch = this.spawn(this.ids.a, 'architect', tr('Progetta il nuovo modulo sessioni'));
    for (const [t, d] of [['Explore', tr('Mappa i moduli di autenticazione')], ['Explore', tr('Trova dove scadono i token')], ['test-runner', tr('Esegui la suite di test')]]) this.spawn(this.ids.a, t, d, arch);
    const planId = this.spawn(this.ids.a, 'Plan', tr('Piano di migrazione al nuovo DB'));
    // questo a un certo punto si perde tra i componenti grafici: si vede la deriva dalla stella polare
    const planA = this.state.sessions.get(this.ids.a).subs.get(planId);
    if (planA) planA._demoDrift = 'src/ui/components';
    // folla di revisori
    for (let i = 0; i < 26; i++) this.spawnReviewer();
    this.spawn(this.ids.c, 'general-purpose', tr('Confronta le versioni delle policy'));
    // un agente "bloccato" su un comando lungo, per vedere gli avvisi
    const stuckId = this.spawn(this.ids.a, 'test-runner', tr('Esegui i test end-to-end'));
    const sa = this.state.sessions.get(this.ids.a).subs.get(stuckId);
    const ago = Date.now() - 13 * 60000;
    Object.assign(sa, { _demoStuck: true, pending: 1, pendingSince: ago, lastActivity: ago, pendingDesc: tr('Esegue: {cmd}', { cmd: 'npm run test:e2e' }), pendingName: 'Bash', status: 'working', action: tr('Esegue: {cmd}', { cmd: 'npm run test:e2e' }) });
    // costi finti: tariffa realistica e un po' di token già spesi
    for (const id of [this.ids.a, this.ids.b, this.ids.c, this.ids.d]) {
      const x = this.state.sessions.get(id);
      x.rate = 3.8e-6;
      x.costState = { total: id === this.ids.b ? 9.2 : 1 + Math.random() * 3, weightedAt: 0 };
    }
    // lavagne: lista delle cose da fare e un piano
    this.todoStep = 0;
    this.writeTodos(this.ids.a);
    this.writeTodos(this.ids.b);
    this.state.trackBoards(this.state.sessions.get(this.ids.a), 'ExitPlanMode', { plan: tr('# Nuovo modulo sessioni\n## Analisi dei token\n## Refresh automatico\n## Logout ovunque\n## Test end-to-end') }, Date.now());
    // mappe della realtà: un po' di lavoro già fatto per ogni agente
    for (const id of [this.ids.a, this.ids.b, this.ids.c, this.ids.d]) {
      const x = this.state.sessions.get(id);
      this.world.seed(x, x.main, 14);
      for (const a of x.subs.values()) this.world.seed(x, a, a._demoStuck ? 10 : a._demoDrift ? 24 : 5 + Math.floor(Math.random() * 14), a._demoStuck ? 'npm run test:e2e' : null);
    }
    this.timer = setInterval(() => this.step(), 900);
    this.state.touch();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.world.stop();
    this.state.demo = false;
    this.state.removeDemo();
  }

  open(cwd, title, ep) {
    const id = 'demo-' + (++this.n);
    const s = this.state.ensureSession(id, cwd);
    s.demo = true;
    s.alive = true;
    s.demoTree = treeFor(cwd);
    s.title = title;
    this.state.setEntrypoint(s, ep);
    // un po' di passato finto, così il grafico dell'ultima ora non parte vuoto
    const minute = Math.floor(Date.now() / 60000);
    const big = /mes-clone/.test(cwd);
    const len = big ? 50 : 25 + Math.floor(Math.random() * 15);
    for (let i = len; i >= 1; i--) {
      const ramp = Math.min(1, (len - i) / 12);
      const a = Math.round((big ? 30 : 5) * ramp * (0.7 + Math.random() * 0.3)) + 1;
      const b = Math.max(0, a - Math.floor(Math.random() * 3));
      s.hist.push({ m: minute - i, a, b, w: Math.random() < 0.06 ? 1 : 0, d: Math.floor(Math.random() * (big ? 5 : 2)) });
    }
    s.main.model = pick(['claude-opus-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-4-1']);
    s.main.effort = pick(['high', 'xhigh', 'max', 'medium']);
    this.hook(id, 'UserPromptSubmit', { prompt: title });
    const g = s.main.mind && s.main.mind.goals[0];
    if (g) { g.t = Date.now() - 16 * 60000; const p = s.main.mind.pieces.find(x => x.kind === 'prompt'); if (p) p.t = g.t; }
    return id;
  }

  spawn(sid, type, desc, parent) {
    const s = this.state.sessions.get(sid);
    if (!s) return null;
    const aid = 'demo-sub-' + (++this.n);
    this.hook(sid, 'PreToolUse', { agent_id: parent || undefined, tool_name: 'Agent', tool_input: { subagent_type: type, description: desc } });
    this.state.ensureSub(s, aid, { agentType: type, description: desc, parentAgentId: parent || undefined, background: type === 'reviewer' || type === 'spec-checker' });
    const a = s.subs.get(aid);
    if (a) this.state.mindOf(s, a).setGoal(Date.now() - 16 * 60000, desc); // il suo compito: la stella polare
    if (a) { // modelli ed effort finti: età e costumi diversi in ufficio
      a.model = pick(['claude-sonnet-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-4-5', 'claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-20241022']);
      a.effort = pick(['low', 'medium', 'medium', 'high', 'xhigh', 'max']);
    }
    this.hook(sid, 'SubagentStart', { agent_id: aid, agent_type: type });
    return aid;
  }

  spawnReviewer() {
    const type = Math.random() < 0.7 ? 'reviewer' : 'spec-checker';
    const what = pick(REVIEW_TARGETS());
    return this.spawn(this.ids.b, type, type === 'reviewer' ? tr('Rivedi {what}', { what }) : tr('Verifica le specifiche: {what}', { what }));
  }

  writeTodos(sid) {
    const s = this.state.sessions.get(sid);
    if (!s) return;
    const items = sid === this.ids.b
      ? [tr('Raccogli le specifiche'), tr('Lancia i revisori'), tr('Lancia gli spec-checker'), tr('Unisci i verdetti'), tr('Scrivi il report finale')]
      : [tr('Mappa i moduli auth'), tr('Progetta il refresh token'), tr('Riscrivi il login'), tr('Aggiorna i test'), tr('Prepara la PR')];
    const k = this.todoStep % (items.length + 1);
    this.state.trackBoards(s, 'TodoWrite', { todos: items.map((c, i) => ({ content: c, status: i < k ? 'completed' : i === k ? 'in_progress' : 'pending' })) }, Date.now());
  }

  hook(id, name, extra) {
    this.state.applyHook({ session_id: id, hook_event_name: name, _demo: true, ...extra });
  }

  step() {
    for (const s of [...this.state.sessions.values()].filter(x => x.demo && !x.ended)) {
      const subs = [...s.subs.values()].filter(a => !a.finished);
      const r = Math.random();
      // capo
      if (r < 0.4) this.state.addTokens(s, s.main, { input_tokens: 30, output_tokens: 200 + Math.random() * 500, cache_read_input_tokens: 40000, cache_creation_input_tokens: 1500 }, null);
      if (s.main.status === 'waiting') { if (r < 0.2) this.hook(s.id, 'PostToolUse', {}); }
      else if (s.main.status === 'idle') { if (r < 0.05) this.hook(s.id, 'UserPromptSubmit', { prompt: pick([tr('Ok, procedi'), tr('Aggiungi anche i test'), tr('Ora scrivi il README')]) }); }
      else if (s.id === this.ids.c && r < 0.05) this.hook(s.id, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'git push origin main' } });
      else if (r < 0.03 && !subs.length) this.hook(s.id, 'Stop', {});
      else if (r < 0.35) this.world.act(s, s.main, (name, extra) => this.hook(s.id, name, extra));
      else if (r < 0.45) this.hook(s.id, 'PostToolUse', {});
      // squadre
      for (const a of subs) {
        if (a._demoStuck) continue;
        const q = Math.random();
        // token: ogni agente consuma un po' a ogni passo
        if (q < 0.5) this.state.addTokens(s, a, { input_tokens: 40, output_tokens: 300 + Math.random() * 600, cache_read_input_tokens: 20000 + Math.random() * 30000, cache_creation_input_tokens: Math.random() * 3000 }, null);
        if (q > 0.996 && a.type !== 'reviewer') { for (let k = 0; k < 3; k++) this.hook(s.id, 'PostToolUseFailure', { agent_id: a.id, agent_type: a.type, tool_name: 'Bash' }); }
        const kids = subs.filter(k => k.parentId === a.id).length;
        const endP = s.id === this.ids.b ? 0.025 : (kids ? 0 : 0.012);
        if (q < endP) this.hook(s.id, 'SubagentStop', { agent_id: a.id, agent_type: a.type });
        else if (q < 0.004 + endP && a.type !== 'reviewer') this.hook(s.id, 'PermissionRequest', { agent_id: a.id, agent_type: a.type, tool_name: 'Bash', tool_input: { command: 'npm run migrate' } });
        else if (q < 0.45) this.world.act(s, a, (name, extra) => this.hook(s.id, name, extra));
        else if (q < 0.55) this.hook(s.id, 'PostToolUse', { agent_id: a.id, agent_type: a.type });
        else if (q < 0.6 && a.status === 'waiting') this.hook(s.id, 'PostToolUse', { agent_id: a.id, agent_type: a.type });
      }
      // rilasci finti: commit, PR, test verdi
      if (Math.random() < 0.008) {
        const evs = [
          { kind: 'commit', text: tr('Commit {hash}', { hash: Math.random().toString(16).slice(2, 9) }) + ': ' + pick([tr('Fix refresh token'), tr('Aggiunge test e2e'), tr('Pulizia moduli auth'), tr('Nuova policy accessi')]) },
          { kind: 'tests', text: tr('Test verdi: {n} passati', { n: 30 + Math.floor(Math.random() * 90) }) },
          { kind: 'pr', text: tr('PR #{n} aperta', { n: 40 + Math.floor(Math.random() * 30) }) + ': ' + pick([tr('Nuovo modulo sessioni'), tr('Report CSV notturno'), tr('Policy ISO aggiornate')]), url: 'https://github.com/esempio/demo/pull/42' },
          { kind: 'push', text: tr('Push su {branch}', { branch: 'main' }) },
        ];
        if (s.id === this.ids.c || s.id === this.ids.a) { s.testsRed = Math.random() < 0.5; this.state.addRelease(s, s.main, pick(evs), Date.now()); }
      }
      // lavagne: ogni tanto il capo aggiorna la lista; ogni tanto lo interrompi tu
      if (Math.random() < 0.012) { this.todoStep++; this.writeTodos(s.id); }
      if (Math.random() < 0.003 && s.id === this.ids.c) { s.main.interruptedAt = Date.now(); this.state.setAgent(s.main, 'idle', tr('Interrotto da te')); }
      // ricambio
      if (s.id === this.ids.b && subs.length < 30 && Math.random() < 0.5) this.spawnReviewer();
      if (s.id === this.ids.a) {
        const arch = subs.find(a => a.type === 'architect');
        if (arch && subs.filter(a => a.parentId === arch.id).length < 2 && Math.random() < 0.1) this.spawn(s.id, pick(['Explore', 'test-runner', 'code-reviewer']), pick([tr('Controlla i cookie di sessione'), tr('Rivedi le modifiche al login'), tr('Esegui i test di integrazione')]), arch.id);
        if (!arch && Math.random() < 0.02) this.spawn(s.id, 'architect', tr('Progetta il nuovo modulo sessioni'));
        if (subs.length < 3 && Math.random() < 0.05) this.spawn(s.id, pick(['Explore', 'Plan']), pick([tr('Trova dove si leggono i CSV'), tr('Piano per i test end-to-end')]));
      }
      if (s.id === this.ids.c && !subs.length && Math.random() < 0.03) this.spawn(s.id, 'general-purpose', tr('Ricerca requisiti Annex A'));
      if (s.id === this.ids.d && subs.length < 3 && Math.random() < 0.06) this.spawn(s.id, pick(['general-purpose', 'Explore']), pick([tr('Controlla le fonti del report'), tr('Riassumi le email del cliente'), tr('Verifica i numeri della slide 4')]));
    }
  }
}

module.exports = { Demo };
