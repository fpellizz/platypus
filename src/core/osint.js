'use strict';
// Integrazione con il sistema operativo: porta in primo piano la finestra di una sessione,
// riprende una sessione chiusa in un nuovo terminale, apre la cartella del progetto.
// Windows: PowerShell (incluso nel sistema) · macOS: ps + osascript · Linux: /proc + xdotool/wmctrl.
// Nessun dato esce dal computer.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const { tr } = require('../i18n');

const WIN_NAMES = {
  ide: ['Code', 'Cursor', 'Windsurf', 'idea64', 'pycharm64', 'webstorm64', 'rider64'],
  desktop: ['Claude'],
  cowork: ['Claude'],
  cli: ['WindowsTerminal'],
  unknown: ['WindowsTerminal', 'Claude'],
};

function psEncoded(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

// risale dal processo di Claude Code fino alla prima finestra visibile (terminale, IDE o app)
function focusScriptWin(pid, names) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Runtime.InteropServices;
public class AOW {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
}
"@
function Focus($h) {
  if ([AOW]::IsIconic($h)) { [AOW]::ShowWindowAsync($h, 9) | Out-Null }
  [AOW]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [AOW]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [AOW]::SetForegroundWindow($h) | Out-Null
}
$cur = ${Number(pid) || 0}
for ($i = 0; $i -lt 12 -and $cur -gt 0; $i++) {
  $p = Get-Process -Id $cur
  if ($p -and $p.MainWindowHandle -ne [IntPtr]::Zero) { Focus $p.MainWindowHandle; Write-Output ("OK:" + $p.ProcessName); exit }
  $w = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $cur)
  if (-not $w) { break }
  $cur = [int]$w.ParentProcessId
}
foreach ($n in @(${names.map(n => `'${n.replace(/'/g, '')}'`).join(',')})) {
  $p = Get-Process -Name $n | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
  if ($p) { Focus $p.MainWindowHandle; Write-Output ("NAME:" + $p.ProcessName); exit }
}
Write-Output "NOTFOUND"
`;
}

function run(cmd, args, timeoutMs = 8000) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => resolve({ err, out: String(stdout || '').trim() }));
  });
}

function safeDir(d) {
  return typeof d === 'string' && d.length < 500 && !/["\r\n`$]/.test(d) && fs.existsSync(d);
}

async function focusSession({ pid, kind, cwd }) {
  if (process.platform === 'win32') {
    const names = WIN_NAMES[kind] || WIN_NAMES.unknown;
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncoded(focusScriptWin(pid, names))]);
    if (r.out.startsWith('OK:')) return { ok: true, how: 'window', app: r.out.slice(3) };
    // l'IDE si può sempre richiamare sulla cartella del progetto
    if (kind === 'ide' && safeDir(cwd)) { spawn('cmd.exe', ['/c', 'code', cwd], { detached: true, windowsHide: true, stdio: 'ignore' }).unref(); return { ok: true, how: 'ide' }; }
    if (r.out.startsWith('NAME:')) return { ok: true, how: 'app', app: r.out.slice(5), approx: true };
    return { ok: false, reason: tr('Non ho trovato la finestra di questa sessione.') };
  }
  if (process.platform === 'darwin') {
    // risale i processi padre fino all'app che li contiene (Terminal, iTerm, VS Code, Claude...)
    let app = await macAppOf(pid);
    if (!app) app = kind === 'ide' ? 'Visual Studio Code' : (kind === 'desktop' || kind === 'cowork') ? 'Claude' : 'Terminal';
    const r = await run('osascript', ['-e', `tell application ${JSON.stringify(app)} to activate`]);
    return r.err ? { ok: false, reason: tr('Non riesco ad attivare {app}', { app }) } : { ok: true, how: 'app', app };
  }
  // Linux (X11): xdotool o wmctrl; su Wayland i programmi non possono attivare finestre altrui
  const chain = await ancestors(pid);
  if (await has('xdotool')) {
    for (const p of chain) {
      const r = await run('xdotool', ['search', '--onlyvisible', '--pid', String(p)], 3000);
      const id = r.out.split('\n').filter(Boolean).pop();
      if (id) { await run('xdotool', ['windowactivate', id], 3000); return { ok: true, how: 'window' }; }
    }
  }
  if (await has('wmctrl')) {
    const list = (await run('wmctrl', ['-lp'], 3000)).out.split('\n');
    for (const p of chain) {
      const line = list.find(l => l.split(/\s+/)[2] === String(p));
      if (line) { await run('wmctrl', ['-ia', line.split(/\s+/)[0]], 3000); return { ok: true, how: 'window' }; }
    }
  }
  if (kind === 'ide' && safeDir(cwd) && await has('code')) { spawn('code', [cwd], { detached: true, stdio: 'ignore' }).unref(); return { ok: true, how: 'ide' }; }
  return { ok: false, reason: process.env.WAYLAND_DISPLAY && !process.env.DISPLAY
    ? tr('Su Wayland non è possibile portare in primo piano la finestra di un altro programma.')
    : tr('Per portare in primo piano la finestra installa xdotool o wmctrl.') };
}

function has(cmd) { return run(process.platform === 'win32' ? 'where.exe' : 'which', [cmd], 3000).then(r => !r.err && !!r.out); }

// processi padre di pid (lui compreso), fino a 15 livelli
async function ancestors(pid) {
  const out = [];
  let cur = Number(pid) || 0;
  for (let i = 0; i < 15 && cur > 1; i++) {
    out.push(cur);
    let ppid = 0;
    if (process.platform === 'linux') {
      try { ppid = Number(fs.readFileSync(`/proc/${cur}/stat`, 'utf8').replace(/^.*\) /, '').split(' ')[1]); } catch { break; }
    } else {
      const r = await run('ps', ['-o', 'ppid=', '-p', String(cur)], 3000);
      ppid = Number(r.out.trim());
    }
    if (!ppid || ppid === cur) break;
    cur = ppid;
  }
  return out;
}
async function macAppOf(pid) {
  for (const p of await ancestors(pid)) {
    const r = await run('ps', ['-o', 'comm=', '-p', String(p)], 3000);
    const m = /\/([^/]+)\.app\//.exec(r.out);
    if (m) return m[1];
  }
  return null;
}

// apre un nuovo terminale nella cartella giusta con "claude --resume <id>"
async function resumeSession({ cwd, id }) {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id || '')) return { ok: false, reason: tr('Id di sessione non valido.') };
  if (!safeDir(cwd)) return { ok: false, reason: tr('La cartella del progetto non esiste più.') };
  if (process.platform === 'win32') {
    const wt = await run('where.exe', ['wt.exe'], 3000);
    if (!wt.err && wt.out) {
      spawn('wt.exe', ['-d', cwd, 'cmd', '/k', 'claude', '--resume', id], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, how: 'wt' };
    }
    // cwd e id sono già validati (niente virgolette né caratteri speciali)
    spawn('cmd.exe', ['/c', `start "Claude Code" /D "${cwd}" cmd /k claude --resume ${id}`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
    return { ok: true, how: 'cmd' };
  }
  if (process.platform === 'darwin') {
    const cmd = `cd ${JSON.stringify(cwd)} && claude --resume ${id}`;
    await run('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(cmd)}`, '-e', 'tell application "Terminal" to activate']);
    return { ok: true, how: 'terminal' };
  }
  // Linux: il primo terminale disponibile
  const inner = `cd ${JSON.stringify(cwd)} && claude --resume ${id}; exec "\${SHELL:-bash}"`;
  const TERMS = [
    ['x-terminal-emulator', ['-e', 'bash', '-lc', inner]],
    ['gnome-terminal', ['--', 'bash', '-lc', inner]],
    ['konsole', ['-e', 'bash', '-lc', inner]],
    ['xfce4-terminal', ['-x', 'bash', '-lc', inner]],
    ['kitty', ['bash', '-lc', inner]],
    ['alacritty', ['-e', 'bash', '-lc', inner]],
    ['wezterm', ['start', '--', 'bash', '-lc', inner]],
    ['xterm', ['-e', 'bash', '-lc', inner]],
  ];
  for (const [t, a] of TERMS) {
    if (!(await has(t))) continue;
    spawn(t, a, { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, how: t };
  }
  return { ok: false, reason: tr('Nessun terminale trovato.') };
}

function openFolder(cwd) {
  if (!safeDir(cwd)) return { ok: false, reason: tr('Cartella non trovata.') };
  const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(cmd, [cwd], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true };
}

module.exports = { focusSession, resumeSession, openFolder, focusScriptWin };
