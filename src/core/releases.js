'use strict';
// Riconosce dai comandi Bash degli agenti i momenti da festeggiare:
// commit, push, PR aperte o unite, tag, e suite di test passate.

const { clip } = require('./describe');
const { tr } = require('../i18n');

const RE = {
  commit: /\bgit\s+(?:-C\s+\S+\s+)?commit\b/,
  push: /\bgit\s+(?:-C\s+\S+\s+)?push\b/,
  prCreate: /\bgh\s+pr\s+create\b/,
  prMerge: /\bgh\s+pr\s+merge\b/,
  tag: /\bgit\s+tag\s+(?:-a\s+)?(?!-l\b|--list\b)([\w.\-/]+)/,
  test: /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|npx\s+(?:jest|vitest|playwright\s+test)\b|pytest\b|python\s+-m\s+(?:pytest|unittest)\b|go\s+test\b|cargo\s+test\b|dotnet\s+test\b|mvn\b.*\btest\b|gradlew?\b.*\btest\b|jest\b|vitest\b|rspec\b|phpunit\b)/,
};

function resultText(block, line) {
  let t = '';
  const c = block && block.content;
  if (typeof c === 'string') t = c;
  else if (Array.isArray(c)) t = c.map(x => (x && x.text) || '').join('\n');
  const r = line && line.toolUseResult;
  if (r && typeof r === 'object') t += '\n' + (r.stdout || '') + '\n' + (r.stderr || '');
  else if (typeof r === 'string') t += '\n' + r;
  return t;
}

// messaggio di commit: -m "…", -m '…' o heredoc $(cat <<'EOF' … EOF)
function commitMessage(cmd) {
  const h = /<<\s*'?(\w+)'?\s*\n([\s\S]*?)\n\s*\1/.exec(cmd);
  if (h) return h[2].split('\n').map(l => l.trim()).find(Boolean) || '';
  const m = /-m\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(cmd);
  return m ? (m[1] || m[2] || '').split('\n')[0] : '';
}

// ritorna un evento {kind, text, url} o null
function detect(command, block, line) {
  if (!command || typeof command !== 'string') return null;
  const isErr = !!(block && block.is_error);
  const out = resultText(block, line);
  if (RE.prCreate.test(command)) {
    if (isErr) return null;
    const url = (/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/.exec(out) || [])[0] || '';
    const title = (/--title\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(command) || []);
    const n = (/\/pull\/(\d+)/.exec(url) || [])[1];
    const tt = title[1] || title[2];
    const pr = n ? tr('PR #{n} aperta', { n }) : tr('PR aperta');
    return { kind: 'pr', text: tt ? pr + ': ' + clip(tt, 50) : pr, url };
  }
  if (RE.prMerge.test(command)) {
    if (isErr) return null;
    const n = (/gh\s+pr\s+merge\s+(\d+)/.exec(command) || [])[1];
    return { kind: 'merge', text: n ? tr('PR #{n} unita', { n }) : tr('PR unita'), url: '' };
  }
  if (RE.commit.test(command)) {
    if (isErr || /nothing to commit|nothing added to commit/i.test(out)) return null;
    const m = /\[([^\]\s]+)(?:\s+\(root-commit\))?\s+([0-9a-f]{7,40})\]\s*(.*)/.exec(out);
    if (!m && !/\bcommit\b/i.test(out) && out.trim()) return null;
    const msg = (m && m[3]) || commitMessage(command);
    const head = m ? tr('Commit {hash}', { hash: m[2].slice(0, 7) }) : tr('Commit');
    return { kind: 'commit', text: head + (msg ? ': ' + clip(msg, 60) : ''), url: '', branch: m ? m[1] : '' };
  }
  if (RE.tag.test(command)) {
    if (isErr) return null;
    return { kind: 'tag', text: tr('Tag {name}', { name: RE.tag.exec(command)[1] }), url: '' };
  }
  if (RE.push.test(command)) {
    if (isErr || /rejected|error:/i.test(out)) return null;
    const br = (/\s(\S+)\s*->\s*(\S+)/.exec(out) || [])[2] || '';
    return { kind: 'push', text: br ? tr('Push su {branch}', { branch: br }) : tr('Push'), url: '' };
  }
  if (RE.test.test(command)) {
    if (isErr) return null;
    if (/\b[1-9]\d*\s+(?:failed|failing|failures?|errors?)\b|\bFAIL(?:ED)?\b/.test(out)) return null;
    const passed = (/(\d+)\s+(?:passed|passing|tests? passed)/i.exec(out) || [])[1];
    return { kind: 'tests', text: passed ? tr('Test verdi: {n} passati', { n: passed }) : tr('Test verdi'), url: '' };
  }
  return null;
}

function isTestCommand(cmd) { return typeof cmd === 'string' && RE.test.test(cmd); }

module.exports = { detect, commitMessage, isTestCommand };
