'use strict';
// "Sismografo delle sorprese": quando il mondo dà torto all'agente. Qui solo i parser puri, senza stato:
//  - classifyFailure: che tipo di fallimento è un output (test, comando, file mancante, permessi, timeout,
//    Edit senza la stringa da sostituire, sintassi) e chi l'ha prodotto (jest, pytest, go, tsc, ...);
//  - errorExcerpt: la prima riga che dice davvero qual è l'errore (max 160 caratteri), senza il rumore;
//  - extractErrorRefs: i file (e le righe) citati da un errore, normalizzati come nella mappa (relKey).
// Euristiche sul testo: sbagliano ogni tanto, e chi le usa deve dirlo ("probabile").

const path = require('path');
const { relKey } = require('./worldmap');
const { isTestCommand } = require('./releases');

const MAX_SCAN = 60000, MAX_EXCERPT = 160, MAX_REFS = 30;

// ---- pulizia del testo ----
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
const STAMP = [
  /^\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s*/, // 2026-10-23T10:15:30.123Z
  /^\[?\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]?\s+/,                                                   // [10:15:30]
];
function stripAnsi(s) { return String(s || '').replace(ANSI, ''); }
function prepare(output) {
  return stripAnsi(String(output || '').slice(0, MAX_SCAN)).replace(/\r\n?/g, '\n').replace(/<\/?tool_use_error>/g, '');
}
// una riga senza colori, orari, prefissi ripetuti di npm e la "E" di pytest
function cleanLine(l) {
  let x = l.replace(/^E {2,}/, '');
  x = x.trim();
  for (const re of STAMP) x = x.replace(re, '');
  x = x.replace(/^(?:npm (?:ERR!|error)\s*)+/i, '');
  return x.trim();
}
// righe che non dicono qual è l'errore: cornici, eco degli script, frame di stack, riepiloghi, avvisi
const NOISE = [
  /^[-=_~^*#.+|:\s]*$/,                                  // vuote, cornici, cursori ^^^
  /^[=_\-]{3,}.*[=_\-]{3,}$/,                            // ==== FAILURES ====, ____ test_x ____
  /^> \S/,                                               // > progetto@1.0 test (eco di npm)
  /^>?\s*\d+\s*\|/, /^\|\s*[~^]/,                        // cornice di codice di jest/babel
  /^at\s/, /^\.\.\. \d+ more/,                           // frame di stack
  /^(?:Exit code|Exit status) \d+$/i, /^Node\.js v\d/,
  /^(?:code|errno|syscall|path|dest)\s+\S+$/,            // npm ERR! code ELIFECYCLE
  /^(?:A complete log of this run|This is (?:probably|likely) not a problem|Lifecycle script|Error: command failed$|in workspace:|at location:|command (?:sh|cmd|failed)\b|signal\s|Run with --|For more information|To rerun|note: run with|\(Use `node --trace|Ran all test suites|Test Suites:|Tests:|Snapshots:|Time:|Duration\b|Start at\b|Traceback \(most recent call last\))/i,
  /^(?:npm )?warn(?:ing)?\b/i, /\b\w*Warning:/,            // avvisi, non errori
  /^(?:At line:\d+|At \S.*:\d+ char:\d+|In riga:\d+|In \S.*:\d+ car:\d+|\+ )/, // eco di PowerShell
  /^# \S/,                                               // # pacchetto (go)
  /^(?:running \d+ tests?|collected \d+ items?|platform \w+ -- Python|rootdir:|plugins:|cachedir:|RUN\s+v\d)/i,
];
const isNoise = x => NOISE.some(re => re.test(x));
// righe che cominciano come un messaggio d'errore ("TypeError: …", "error TS…", "bash: x: command not found")
const ERRSTART = /^(?:\w+\.)*\w*(?:Error|Exception)\b|^(?:error|fatal|panic)\b|^thread '.*' panicked|\berror(?: TS\d+|\[E\d+\])?:|^\S[^:\n]*?: (?:\S[^:\n]*?: )?(?:No such file|Permission denied|Permesso negato|command not found|comando non trovato|File o directory non esistente|not found)|^[A-Z][a-z]+-[A-Z]\w+ : |^Missing script/;
// righe che contengono un messaggio d'errore
const ERRLINE = /\b(?:\w+\.)*\w*(?:Error|Exception)\b|^(?:error|fatal|panic)\b|\berror(?: TS\d+|\[E\d+\])?:|panicked at|\bE[A-Z]{3,}\b|No such file|not found|denied|negato|not recognized|non (?:è )?riconosciuto|Impossibile|[Cc]annot |can't |Missing script|timed out|does not exist|non esiste|non trovato|Errore|errore|Failed at the/;
const TESTLINE = /^(?:●|--- FAIL:|FAILED\s|×|✕|✗)/;
const PYEXC = /^(?:\w+\.)*\w*(?:Error|Exception|Exit|Interrupt)\b(?::|$)/;

// la prima riga significativa dell'errore (max 160 caratteri); '' se non ce n'è
function errorExcerpt(output) {
  // righe lunghissime (minificati, base64): ne basta l'inizio
  const lines = prepare(output).split('\n').map(l => cleanLine(l.slice(0, 2000))).filter(x => x && !isNoise(x));
  if (!lines.length) return '';
  let pick = null;
  // traceback di Python: conta l'ultima riga, l'eccezione
  if (/Traceback \(most recent call last\)/.test(String(output))) for (let i = lines.length - 1; i >= 0 && !pick; i--) if (PYEXC.test(lines[i])) pick = lines[i];
  pick = pick || lines.find(x => ERRSTART.test(x)) || lines.find(x => ERRLINE.test(x)) || lines.find(x => TESTLINE.test(x)) || lines.find(x => /^FAIL\b/.test(x)) || lines[0];
  return pick.length > MAX_EXCERPT ? pick.slice(0, MAX_EXCERPT - 1) + '…' : pick;
}

// ---- classificazione ----
// chi ha prodotto l'output: prima i segni nell'output (i più specifici prima), poi il comando
const FW_OUT = [
  ['vitest', /\bvitest\b|^\s*Test Files\s+\d|⎯{3,}|^\s*❯\s|^\s*RUN\s+v\d/m],
  ['jest', /^\s*(?:PASS|FAIL)\s+\S+\.(?:test|spec)\.\w+|^\s*Test Suites:|^\s*Tests:\s+\d|^\s*●\s/m],
  ['cargo', /test result: |^error\[E\d+\]|-->\s+\S+\.rs:\d+|panicked at|^error: could not compile|^\s*Compiling \S+ v\d/m],
  ['pytest', /=+ (?:test session starts|FAILURES|ERRORS|short test summary info) =+|^FAILED \S+::|^E {2,}\S|^platform \w+ -- Python|\b\d+ (?:passed|failed)\b[^;\n]* in [\d.]+s\b/m],
  ['go', /^--- FAIL:|^(?:ok|FAIL)\s+\S+\s+(?:[\d.]+s|\[build failed\])|^panic: |\.go:\d+:\d+: |^\s+\S+_test\.go:\d+: /m],
  ['tsc', /\berror TS\d+:/],
  ['python', /Traceback \(most recent call last\)|^\s*File ".+", line \d+/m],
  ['node', /^\s+at .+:\d+:\d+\)?\s*$|\bnode:internal\/|^Node\.js v\d/m],
  ['powershell', /CategoryInfo\s*:|FullyQualifiedErrorId|^At line:\d+ char:\d+|^In riga:\d+ car:\d+|^[A-Z][a-z]+-[A-Z]\w+ : |is not recognized as the name of a cmdlet|non riconosciuto come nome di cmdlet|Impossibile trovare il percorso '/m],
  ['shell', /command not found|comando non trovato|is not recognized as an internal or external command|non è riconosciuto come comando interno o esterno|^(?:\/bin\/)?(?:ba|z|da|k)?sh: |^\w[\w.\-]*: (?:cannot (?:access|open) )?\S.*: (?:No such file or directory|Permission denied|Permesso negato|File o directory non esistente)$/m],
  ['npm', /npm ERR!|^npm error\b/m],
];
const FW_CMD = [
  ['vitest', /\bvitest\b/], ['jest', /\bjest\b/], ['pytest', /\bpytest\b/], ['go', /\bgo\s+(?:test|build|run|vet)\b/],
  ['cargo', /\bcargo\b/], ['tsc', /\btsc\b/], ['python', /\bpython[\d.]*\b|\.py\b/], ['node', /^\s*node\b/],
  ['powershell', /^\s*(?:powershell|pwsh)\b|^\s*[A-Z][a-z]+-[A-Z][a-z]\w*\b/], ['npm', /^\s*npm\b/],
];
const TEST_FW = new Set(['jest', 'vitest', 'pytest', 'go', 'cargo']);
function frameworkOf(s, cmd) {
  for (const [name, re] of FW_OUT) if (re.test(s)) return name;
  for (const [name, re] of FW_CMD) if (re.test(cmd)) return name;
  return '';
}

const EDIT_ERR = /String to replace not found|old_string (?:was )?not found|stringa da sostituire non trovata/i;
// timeout del comando intero (Claude Code, go test): vince anche sui test
const TIMEOUT_HARD = /Command timed out after|timed out after \d|^panic: test timed out/im;
const TIMEOUT = /\btimed out\b|\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|deadline exceeded|\bTimeout(?:Error|Expired)\b|tempo (?:di attesa )?scaduto|timeout scaduto/i;
const TEST_FAIL = /^\s*(?:FAIL|FAILED|--- FAIL:|×|✕|✗)\s|^FAIL$|●\s.+›|Tests?:?\s+[1-9]\d* failed|Test Files\s+[1-9]\d* failed|test result: FAILED|=+ (?:FAILURES|ERRORS) =+|\b[1-9]\d* (?:failed|failing)\b|Test Run Failed|AssertionError|Assertion failed/m;
const SYNTAX = /SyntaxError|IndentationError|TabError|\berror TS\d+|syntax error|errore di sintassi|Unexpected token|Unexpected end of (?:input|file)|ParserError|ParseException|Parsing error|error\[E\d+\]|could not compile|compilation (?:failed|terminated)|cannot find symbol|^\S+:\d+:\d+: (?:fatal )?error\b|\.go:\d+:\d+: |undefined reference to/im;
// il test non è nemmeno partito: il codice non compila
const BUILD_IN_TEST = /\[build failed\]|could not compile|Test suite failed to run|ERROR collecting|errors? during collection/;
const NOT_FOUND_CMD = /command not found|comando non trovato|is not recognized as (?:an internal or external command|the name of a cmdlet)|non è riconosciuto come comando interno o esterno|non riconosciuto come nome di cmdlet|CommandNotFoundException|^(?:\S+: )?\d+: \S+: not found$/im;
const MISSING = /No such file or directory|File o directory non esistente|\bENOENT\b|Cannot find module|Cannot find path|cannot find the (?:path|file) specified|Impossibile trovare (?:il percorso|il file|il modulo|una parte del percorso)|FileNotFoundError|ModuleNotFoundError|ItemNotFoundException|can't open file|pathspec .* did not match|\b(?:file|path|directory|folder|percorso|cartella)\b[^\n]{0,120}\b(?:does not exist|non esiste)/i;
const PERMISSION = /Permission denied|Permesso negato|\bEACCES\b|\bEPERM\b|Access is denied|Accesso negato|Accesso al percorso .* negato|operation not permitted|Operazione non permessa|PermissionError|UnauthorizedAccess|PermissionDenied/i;
const GENERIC = /^Exit code [1-9]\d*|ERR!|^npm error\b|\bexit(?:ed)? (?:with )?(?:code|status) [1-9]|returned non-zero exit status|non-zero exit|Command failed|^(?:\S+: )?(?:error|fatal)\b|\b\w*(?:Error|Exception)\b: |^panic: |Traceback \(most recent call last\)|CategoryInfo|FullyQualifiedErrorId|\bfailed\b|\b[1-9]\d* errors?\b|^Errore\b|\berrore:|non riuscit[oa]|^Impossibile\b/im;
// "0 errors", "0 failed", "no errors": non sono fallimenti
const ZERO = /\b(?:0|no|zero|without) (?:errors?|failures?|failed|failing)\b|\b(?:errors?|failures?|failed):? 0\b|\bFound 0 errors?\b/gi;

// che tipo di fallimento è; null se l'output non sembra un fallimento
function classifyFailure(output, cmd) {
  const s = prepare(output);
  const c = String(cmd || '');
  if (!s.trim()) return null;
  const framework = frameworkOf(s, c);
  const t = s.replace(ZERO, '');
  let kind = null;
  if (EDIT_ERR.test(t)) kind = 'edit';
  else if (TIMEOUT_HARD.test(t)) kind = 'timeout';
  else if (SYNTAX.test(t) && BUILD_IN_TEST.test(t)) kind = 'syntax';
  else if (TEST_FAIL.test(t) && (TEST_FW.has(framework) || isTestCommand(c))) kind = 'test';
  else if (SYNTAX.test(t)) kind = 'syntax';
  else if (NOT_FOUND_CMD.test(t)) kind = 'command';
  else if (MISSING.test(t)) kind = 'missing';
  else if (PERMISSION.test(t)) kind = 'permission';
  else if (TIMEOUT.test(t)) kind = 'timeout';
  else if (GENERIC.test(t)) kind = 'command';
  if (!kind) return null;
  return { kind, framework: kind === 'edit' ? '' : framework, excerpt: errorExcerpt(s) };
}

// ---- riferimenti ai file nell'errore ----
const DRV = '(?:[A-Za-z]:[\\\\/])?';
const P = DRV + '[^\\s:"\'()<>]+';   // percorso senza spazi (con lettera di unità opzionale)
const REF_RES = [
  /\bat (?:async )?[^\n()]*?\(([^\n()]+?):(\d+):\d+\)/g,                     // Node: at fn (percorso:riga:col)
  /^\s*at (?:async )?([^()\n]+?):(\d+):\d+\s*$/gm,                          // Node: at percorso:riga:col
  /File "([^"\n]+)", line (\d+)/g,                                          // Python
  /^\s*([A-Za-z]:[\\/][^\n():"']*?|[^\s():"'][^\n():"']*?)\((\d+),\d+\)\s*:\s*error\b/gm, // tsc, MSBuild: percorso(riga,col): error
  new RegExp('^\\s*(' + P + '):(\\d+):\\d+(?::| -)\\s*(?:(?:fatal )?error\\b|.*\\[Error\\b)', 'gm'), // gcc, clang, eslint, tsc --pretty
  new RegExp('^\\s*(' + DRV + '[^\\s:"\'()<>]+\\.go):(\\d+)(?::\\d+)?(?=[:\\s]|$)', 'gm'),          // Go
  new RegExp('-->\\s*(' + P + '):(\\d+):\\d+', 'g'),                         // Rust: --> percorso:riga:col
  new RegExp('panicked at (?:\'[^\\n]*?\', )?(' + P + '):(\\d+):\\d+', 'g'),  // Rust: panic
  new RegExp('❯\\s+(' + P + '):(\\d+):\\d+', 'g'),                           // Vitest
  new RegExp('^(' + P + '\\.py):(\\d+): \\w', 'gm'),                          // pytest: percorso.py:riga: AssertionError
];
const ANON = /\(<anonymous>\)|\bat <anonymous>\s*$|\(native\)/gm;
// librerie, runtime e file di sistema: non sono la causa, ma ricordiamo di averli scartati
const SYSTEM = [
  /(^|\/)node_modules\//i, /^node:/, /^internal\//, /<anonymous>|^\[eval|^evalmachine|^<[^>]*>$/,
  /^\/usr\/(?:lib|lib64|libexec|local\/lib|local\/go|local\/Cellar|share|include)\//, /^\/(?:lib|lib64|opt\/homebrew|System|Library|nix\/store|rustc)\//,
  /^[A-Za-z]:\/(?:Program Files(?: \(x86\))?|Windows|ProgramData)\//i, /\/AppData\/(?:Roaming\/npm|Local\/Programs\/Python)\//i,
  /(^|\/)lib\/python\d+(?:\.\d+)?\//i, /(^|\/)python\d+\/lib\//i, /(^|\/)(?:site|dist)-packages\//i,
  /\/\.cargo\/registry\/|\/\.rustup\//, /\/pkg\/mod\//, /(^|\/)go\/src\/runtime\//,
];
function rawPath(raw) {
  let p = String(raw).trim().replace(/\\\\/g, '\\').replace(/^["'`]|["'`]$/g, '');
  if (/^file:\/\//i.test(p)) {
    p = p.replace(/^file:\/\//i, '');
    try { p = decodeURIComponent(p); } catch { /* lasciamo com'è */ }
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
  }
  return p;
}

// file e righe citati da un errore, in ordine di apparizione e senza doppioni (max 30)
function extractErrorRefs(output, cwd, shellCwd) {
  const s = prepare(output);
  const hits = [];
  for (const re of REF_RES) {
    re.lastIndex = 0;
    let m, guard = 0;
    while ((m = re.exec(s)) && guard++ < 500) hits.push({ i: m.index, raw: m[1], line: +m[2] });
  }
  hits.sort((a, b) => a.i - b.i);
  const refs = [], seen = new Set(), dropped = new Set();
  ANON.lastIndex = 0;
  let a, guard = 0;
  while ((a = ANON.exec(s)) && guard++ < 500) dropped.add('anon@' + a.index);
  // come in AgentWorld.start: i percorsi relativi partono dalla cartella corrente della shell
  const base = shellCwd ? String(shellCwd).replace(/\\/g, '/').replace(/\/+$/, '') : null;
  for (const h of hits) {
    const p = rawPath(h.raw);
    if (!p || !(h.line > 0)) continue;
    if (SYSTEM.some(re => re.test(p.replace(/\\/g, '/')))) { dropped.add(p + ':' + h.line); continue; }
    const full = base && !/^([A-Za-z]:[\\/]|\/|~)/.test(p) ? base + '/' + p : p;
    const file = relKey(path.posix.normalize(full.replace(/\\/g, '/')), cwd);
    if (!file || file === '.') continue;
    const k = file + ':' + h.line;
    if (seen.has(k)) continue;
    seen.add(k);
    if (refs.length < MAX_REFS) refs.push({ file, line: h.line });
  }
  return { refs, discarded: dropped.size };
}

// ---- la sorpresa di ogni fallimento, tra 0 e 1, calcolata quando qualcuno la chiede ----
// i passi sono quelli di AgentWorld: il tipo di fallimento (step.fail) lo scrive end() quando arriva l'esito
const BASE = { test: 0.7, command: 0.5, missing: 0.6, permission: 0.4, timeout: 0.6, edit: 0.5, syntax: 0.6 };
const TEST_FILE = /(^|\/)(?:tests?|__tests__|specs?)\/|\.(?:test|spec)\.\w+$/i;
const RUNS = new Set(['run', 'verify', 'look']);
function surpriseAt(steps, i) {
  const s = steps[i];
  if (!s || !s.err) return null;
  const f = s.fail || { kind: 'command', framework: '', excerpt: '' };
  let v = BASE[f.kind] != null ? BASE[f.kind] : 0.5;
  const reasons = ['base'];
  // lo stesso comando (o la stessa firma) prima riusciva: "prima funzionava"
  const same = x => x.sig === s.sig || (RUNS.has(s.act) && s.target && x.target === s.target);
  const before = steps.slice(0, i);
  if (before.some(x => same(x) && x.err === false)) { v += 0.3; reasons.push('usedToWork'); }
  else if (RUNS.has(s.act) && !before.some(same)) { v -= 0.2; reasons.push('firstTry'); }
  // TDD: ha appena scritto un test che deve fallire
  if (f.kind === 'test' && steps.slice(Math.max(0, i - 3), i).some(x => x.act === 'edit' && x.err === false && TEST_FILE.test(x.target || ''))) { v -= 0.2; reasons.push('tdd'); }
  return { t: s.t, value: Math.round(Math.max(0, Math.min(1, v)) * 100) / 100, kind: f.kind, framework: f.framework || '', excerpt: f.excerpt || '', reasons, tool: s.tool, target: s.target };
}

// ---- dopo la sorpresa: si corregge, insiste o si ferma? (i 3 passi successivi dello stesso agente)
const ASK_USER = new Set(['AskUserQuestion', 'ExitPlanMode']);
const UNDECIDED_MS = 60000; // una sorpresa più recente di così, senza passi dopo, è ancora "in corso"
function reactionAt(steps, i, { replies = [], goals = [], now = Date.now() } = {}) {
  const s = steps[i];
  const same = x => x.sig === s.sig || (RUNS.has(s.act) && s.target && x.target === s.target);
  const next = steps.slice(i + 1, i + 4);
  // fine del turno: ha risposto e poi è arrivata una nuova richiesta, prima del passo successivo
  const until = next.length ? next[0].t : Infinity;
  const reply = replies.find(r => r.t > s.t && r.t < until);
  const turnEnded = reply && goals.some(g => g.t > reply.t && g.t <= until);
  let reaction;
  if (!next.length) reaction = reply || now - s.t > UNDECIDED_MS ? 'stops' : 'undecided';
  else if (turnEnded || ASK_USER.has(next[0].tool)) reaction = 'stops';
  else {
    // insiste: ripete la stessa firma senza modifiche in mezzo
    const k = next.findIndex(x => x.sig === s.sig);
    reaction = k >= 0 && !next.slice(0, k).some(x => x.act === 'edit') ? 'insists' : 'corrects';
  }
  // tempo di recupero: fino al prossimo successo della stessa firma (o dello stesso comando di verifica)
  let recovery = null;
  for (let j = i + 1; j < steps.length; j++) if (same(steps[j]) && steps[j].err === false) { recovery = { steps: j - i, ms: steps[j].t - s.t }; break; }
  return { reaction, recovery };
}

// ---- ha capito la causa? Le prime modifiche dopo la sorpresa (entro 6 passi) contro i file citati dall'errore
const CAUSE_WINDOW = 6;
// un file citato e un luogo della mappa sono lo stesso file? (l'errore può citarlo da un'altra cartella)
function sameFile(a, b) {
  if (!a || !b) return false;
  const x = String(a).toLowerCase(), y = String(b).toLowerCase();
  return x === y || x.endsWith('/' + y) || y.endsWith('/' + x);
}
function causeAt(steps, i, { now = Date.now() } = {}) {
  const s = steps[i];
  const refs = (s.refs && s.refs.refs) || [], discarded = (s.refs && s.refs.discarded) || 0;
  const next = steps.slice(i + 1, i + 1 + CAUSE_WINDOW);
  const edits = next.filter(x => x.act === 'edit' && x.err === false);
  const cited = x => refs.some(r => sameFile(r.file, x.target));
  let cause;
  if (!refs.length) cause = 'notrail';
  else if (edits.some(cited)) cause = 'follows';
  else if (edits.length) cause = 'elsewhere';
  else cause = next.length < CAUSE_WINDOW && now - s.t < UNDECIDED_MS ? 'undecided' : 'thinking';
  // la catena: sorpresa → file citati → modifica → conferma (la stessa verifica che torna a riuscire)
  const fix = edits.find(cited) || edits[0] || null;
  const same = x => x.sig === s.sig || (RUNS.has(s.act) && s.target && x.target === s.target);
  let confirm = null;
  for (let j = i + 1; j < steps.length; j++) if (same(steps[j]) && steps[j].err === false) { confirm = steps[j]; break; }
  return {
    cause, refs: refs.slice(0, 5), discarded,
    readCited: next.some(x => x.act === 'read' && x.err === false && cited(x)),
    chain: { fix: fix ? { t: fix.t, target: fix.target, cited: cited(fix) } : null, confirm: confirm ? { t: confirm.t } : null, complete: !!(fix && confirm && confirm.t > fix.t) },
  };
}

// agents: [{id, name, world, mind}]; only: Set degli id da esaminare (null = tutti)
function surprises(agents, { only = null, now = Date.now() } = {}) {
  const out = [], byAgent = [];
  for (const a of agents) {
    if (!a.world || (only && !only.has(a.id))) continue;
    const st = a.world.steps, ctx = { replies: a.world.replies || [], goals: (a.mind && a.mind.goals) || [], now };
    let corrects = 0, total = 0, follows = 0, judged = 0, complete = 0, chains = 0;
    for (let i = 0; i < st.length; i++) {
      if (!st[i].err) continue;
      const x = surpriseAt(st, i);
      if (!x) continue;
      const r = reactionAt(st, i, ctx), c = causeAt(st, i, ctx);
      if (r.reaction !== 'undecided') { total++; if (r.reaction === 'corrects') corrects++; }
      if (c.cause !== 'notrail' && c.cause !== 'undecided') { judged++; if (c.cause === 'follows') follows++; }
      if (c.refs.length) { chains++; if (c.chain.complete) complete++; }
      out.push({ agent: a.id, agentName: a.name, ...x, ...r, ...c });
    }
    if (total || chains) byAgent.push({ id: a.id, name: a.name, corrects, total, follows, judged, complete, chains });
  }
  out.sort((x, y) => x.t - y.t);
  return { surprises: out.slice(-300), reactions: byAgent };
}

module.exports = { classifyFailure, errorExcerpt, extractErrorRefs, surpriseAt, reactionAt, causeAt, surprises, BASE };
