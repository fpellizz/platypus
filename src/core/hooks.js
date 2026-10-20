'use strict';
// Installa / rimuove gli hook di Platypus in <config>/settings.json di Claude Code.
// Gli hook sono "async": non rallentano mai Claude Code. Se l'ufficio è chiuso, curl fallisce in silenzio.

const fs = require('fs');
const path = require('path');
const { claudeDir } = require('./sources');

const MARK = '/platypus-hook';
const LEGACY = '/agent-office-hook'; // hook installati quando l'app si chiamava Agent Office
const EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest',
  'Notification', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact',
];
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest']);

const PERM = MARK + '/permission';
function hookCommand(port, sync) {
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl';
  // "@-" tra virgolette: funziona in Git Bash, cmd e PowerShell.
  // L'hook dei permessi è sincrono: l'ufficio può rispondere "consenti" o "rifiuta" al posto del terminale.
  return sync
    ? `${curl} -s -m 600 -X POST -H "Content-Type: application/json" --data-binary "@-" http://127.0.0.1:${port}${PERM}`
    : `${curl} -s -m 2 -X POST -H "Content-Type: application/json" --data-binary "@-" http://127.0.0.1:${port}${MARK}`;
}

function settingsPath(base) { return path.join(base || claudeDir(), 'settings.json'); }

function load(p) {
  if (!fs.existsSync(p)) return {};
  const raw = fs.readFileSync(p, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw); // se il file è JSON non valido meglio fermarsi che rovinarlo
}

function isOurs(h) { return h && typeof h.command === 'string' && (h.command.includes(MARK) || h.command.includes(LEGACY)); }

function strip(settings) {
  if (!settings.hooks) return settings;
  for (const ev of Object.keys(settings.hooks)) {
    const groups = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
    const kept = [];
    for (const g of groups) {
      const hooks = (g.hooks || []).filter(h => !isOurs(h));
      if (hooks.length) kept.push({ ...g, hooks });
    }
    if (kept.length) settings.hooks[ev] = kept; else delete settings.hooks[ev];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return settings;
}

function backup(p) {
  if (!fs.existsSync(p)) return null;
  const b = p + '.platypus-backup';
  if (fs.existsSync(p + '.agent-office-backup')) return p + '.agent-office-backup'; // copia originale già fatta dalla versione precedente
  if (!fs.existsSync(b)) fs.copyFileSync(p, b);
  return b;
}

function install({ port = 47800, base } = {}) {
  const p = settingsPath(base);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const settings = strip(load(p));
  const bk = backup(p);
  settings.hooks = settings.hooks || {};
  const cmd = hookCommand(port);
  for (const ev of EVENTS) {
    const group = ev === 'PermissionRequest'
      ? { hooks: [{ type: 'command', command: hookCommand(port, true), timeout: 610 }] }
      : { hooks: [{ type: 'command', command: cmd, async: true, timeout: 5 }] };
    if (TOOL_EVENTS.has(ev)) group.matcher = '*';
    settings.hooks[ev] = [...(settings.hooks[ev] || []), group];
  }
  fs.writeFileSync(p, JSON.stringify(settings, null, 2) + '\n');
  return { path: p, backup: bk, events: EVENTS.length };
}

function uninstall({ base } = {}) {
  const p = settingsPath(base);
  if (!fs.existsSync(p)) return { path: p, removed: false };
  const settings = strip(load(p));
  fs.writeFileSync(p, JSON.stringify(settings, null, 2) + '\n');
  return { path: p, removed: true };
}

function status({ base } = {}) {
  try {
    const s = load(settingsPath(base));
    return !!(s.hooks && Object.values(s.hooks).some(gs => (gs || []).some(g => (g.hooks || []).some(isOurs))));
  } catch { return false; }
}

// installati da una versione precedente, senza l'hook sincrono dei permessi
function outdated({ base } = {}) {
  try {
    const s = load(settingsPath(base));
    const groups = (s.hooks && s.hooks.PermissionRequest) || [];
    const legacy = Object.values(s.hooks || {}).some(gs => (gs || []).some(g => (g.hooks || []).some(h => typeof h.command === 'string' && h.command.includes(LEGACY))));
    return legacy || !groups.some(g => (g.hooks || []).some(h => isOurs(h) && h.command.includes(PERM)));
  } catch { return false; }
}

module.exports = { install, uninstall, status, outdated, hookCommand, MARK, LEGACY, PERM, EVENTS };
