'use strict';
// Integrazione con il sistema operativo: porta in primo piano la finestra di una sessione,
// riprende una sessione chiusa in un nuovo terminale, apre la cartella del progetto.
// Windows: PowerShell (incluso nel sistema) · macOS: ps + osascript · Linux: /proc + xdotool/wmctrl (X11)
// o il compositor Wayland (KWin via DBus, hyprctl, swaymsg).
// Nessun dato esce dal computer.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
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

// Dati per riconoscere la finestra della sessione tra quelle dello stesso processo.
// Serve perché un IDE tiene tutti i progetti aperti in un processo solo: senza questo si
// finisce sempre sulla stessa finestra, che non è quasi mai quella della sessione.
function winMatch(cwd) {
  if (!safeDir(cwd)) return null;
  const name = path.basename(String(cwd).replace(/[\\/]+$/, ''));
  return name ? { name: name.toLowerCase(), path: String(cwd).toLowerCase() } : null;
}
const psq = s => "'" + String(s).replace(/'/g, "''") + "'";

// risale dal processo di Claude Code fino alla prima finestra visibile (terminale, IDE o app)
function focusScriptWin(pid, names, match) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class AOW {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  // tutte le finestre visibili con un titolo di un processo: "handle<TAB>titolo"
  public static List<string> Windows(uint target) {
    var res = new List<string>();
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == target && IsWindowVisible(h)) {
        int len = GetWindowTextLength(h);
        if (len > 0) { var sb = new StringBuilder(len + 1); GetWindowText(h, sb, sb.Capacity); res.Add(h.ToInt64() + ((char)9).ToString() + sb.ToString()); }
      }
      return true;
    }, IntPtr.Zero);
    return res;
  }
}
"@
function Focus($h) {
  if ([AOW]::IsIconic($h)) { [AOW]::ShowWindowAsync($h, 9) | Out-Null }
  [AOW]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [AOW]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
  [AOW]::SetForegroundWindow($h) | Out-Null
}
$PROJ = ${match ? psq(match.name) : "''"}
$PROJPATH = ${match ? psq(match.path) : "''"}
$TAB = [char]9
# quanto il titolo di una finestra assomiglia al progetto della sessione (0 = per niente)
function Score($title) {
  if (-not $PROJ) { return 0 }
  $t = $title.Trim().ToLower()
  if ($PROJPATH -and $t.Contains($PROJPATH)) { return 4 }
  if ($t -eq $PROJ) { return 3 }
  if ($t.Length -gt $PROJ.Length -and $t.StartsWith($PROJ) -and ' -–—[(:|'.Contains($t.Substring($PROJ.Length, 1))) { return 2 }
  if ($t -match ('(^|[^a-z0-9])' + [regex]::Escape($PROJ) + '([^a-z0-9]|$)')) { return 1 }
  return 0
}
# la finestra giusta tra quelle di un processo: prima il titolo, poi quella principale
function Pick($procId, $main) {
  $best = [IntPtr]::Zero; $score = 0; $any = $false
  foreach ($line in [AOW]::Windows([uint32]$procId)) {
    $k = $line.IndexOf($TAB)
    if ($k -lt 0) { continue }
    $any = $true
    $s = Score $line.Substring($k + 1)
    if ($s -gt $score) { $score = $s; $best = [IntPtr][int64]$line.Substring(0, $k) }
  }
  if ($best -eq [IntPtr]::Zero) { $best = $main }
  return @($best, $any)
}
$cur = ${Number(pid) || 0}
for ($i = 0; $i -lt 12 -and $cur -gt 0; $i++) {
  $p = Get-Process -Id $cur
  if ($p) {
    $r = Pick $cur $p.MainWindowHandle
    # ci si ferma al primo antenato che ha una finestra, come prima: cambia solo quale delle sue
    if ($r[0] -ne [IntPtr]::Zero) { Focus $r[0]; Write-Output ("OK:" + $p.ProcessName); exit }
    if ($r[1]) { break }
  }
  $w = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $cur)
  if (-not $w) { break }
  $cur = [int]$w.ParentProcessId
}
foreach ($n in @(${names.map(n => `'${n.replace(/'/g, '')}'`).join(',')})) {
  $list = @(Get-Process -Name $n)
  if (-not $list) { continue }
  # tra gli omonimi, quello con la finestra del progetto giusto; se nessuno aggancia, il primo
  $best = [IntPtr]::Zero; $bestName = ''
  foreach ($p in $list) {
    $r = Pick $p.Id ([IntPtr]::Zero)
    if ($r[0] -ne [IntPtr]::Zero) { $best = $r[0]; $bestName = $p.ProcessName; break }
  }
  if ($best -eq [IntPtr]::Zero) {
    $p = $list | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
    if ($p) { $best = $p.MainWindowHandle; $bestName = $p.ProcessName }
  }
  if ($best -ne [IntPtr]::Zero) { Focus $best; Write-Output ("NAME:" + $bestName); exit }
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

// argomenti per "cmd.exe" che lancia prog sulla cartella (serve a code.cmd, che senza cmd non parte):
// la cartella tra virgolette, così & | < > ^ restano lettere; "%" cmd lo espande anche tra virgolette,
// quindi una cartella con "%" non passa (null). Da usare con windowsVerbatimArguments.
function cmdArgs(prog, dir) {
  if (!safeDir(dir) || dir.includes('%')) return null;
  return ['/d', '/s', '/c', `"${prog} "${dir}""`];
}

async function focusSession({ pid, kind, cwd }) {
  if (process.platform === 'win32') {
    const names = WIN_NAMES[kind] || WIN_NAMES.unknown;
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', psEncoded(focusScriptWin(pid, names, winMatch(cwd)))]);
    if (r.out.startsWith('OK:')) return { ok: true, how: 'window', app: r.out.slice(3) };
    // l'IDE si può sempre richiamare sulla cartella del progetto
    const ide = kind === 'ide' ? cmdArgs('code', cwd) : null;
    if (ide) { spawn('cmd.exe', ide, { detached: true, windowsHide: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref(); return { ok: true, how: 'ide' }; }
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
  // Linux: su Wayland lo chiediamo al compositor (KWin, Hyprland, Sway); su X11 xdotool o wmctrl
  const chain = await ancestors(pid);
  const wl = isWayland() ? await focusWayland(chain) : null; // null = compositor non supportato
  if (wl) return { ok: true, how: 'window' };
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
  if (wl === false) return { ok: false, reason: tr('Non ho trovato la finestra di questa sessione.') };
  return { ok: false, reason: isWayland()
    ? tr('Su Wayland posso portare in primo piano le finestre solo con KDE Plasma, Hyprland o Sway.')
    : tr('Per portare in primo piano la finestra installa xdotool o wmctrl.') };
}

function isWayland() { return process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY; }

// Wayland: le app non possono attivare finestre altrui, il compositor sì
// (true = attivata, false = finestra non trovata, null = compositor non supportato)
async function focusWayland(chain) {
  const pids = chain.filter(p => Number.isInteger(p) && p > 1);
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE && await has('hyprctl')) {
    for (const p of pids) if ((await run('hyprctl', ['dispatch', 'focuswindow', 'pid:' + p], 3000)).out === 'ok') return true;
    return false;
  }
  if (process.env.SWAYSOCK && await has('swaymsg')) {
    // -r: sempre JSON; senza finestre corrispondenti "success" è false
    for (const p of pids) if (/"success":\s*true/.test((await run('swaymsg', ['-r', `[pid=${p}]`, 'focus'], 3000)).out)) return true;
    return false;
  }
  if (/KDE/i.test(process.env.XDG_CURRENT_DESKTOP || '') && await has('gdbus')) return pids.length ? focusKWin(pids) : false;
  return null;
}

// KDE Plasma: uno script KWin caricato via DBus attiva la prima finestra di uno dei pid.
// Se la trova si scarica da solo: così sappiamo se ha funzionato.
async function focusKWin(pids) {
  const name = 'platypus-focus-' + process.pid + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // XDG_RUNTIME_DIR è privato dell'utente; in /tmp un altro utente potrebbe metterci un link
  const file = path.join(process.env.XDG_RUNTIME_DIR || os.tmpdir(), name + '.js');
  const dbus = (obj, method, ...args) => run('gdbus', ['call', '--session', '--dest', 'org.kde.KWin', '--object-path', obj, '--method', method, ...args], 3000);
  fs.writeFileSync(file, `
const pids = ${JSON.stringify(pids)};
const list = workspace.windowList ? workspace.windowList() : workspace.clientList();
let hit = null;
for (const p of pids) { hit = list.find(w => w.pid === p && w.normalWindow); if (hit) break; }
if (hit) {
  if (hit.minimized) hit.minimized = false;
  if ('activeWindow' in workspace) workspace.activeWindow = hit; else workspace.activeClient = hit;
  callDBus('org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting', 'unloadScript', ${JSON.stringify(name)});
}
`, { flag: 'wx', mode: 0o600 });
  try {
    const id = Number((/-?\d+/.exec((await dbus('/Scripting', 'org.kde.kwin.Scripting.loadScript', file, name)).out) || [])[0]);
    if (!(id >= 0)) return false;
    // Plasma 6: /Scripting/Script<id> · Plasma 5: /<id>
    if ((await dbus('/Scripting/Script' + id, 'org.kde.kwin.Script.run')).err) await dbus('/' + id, 'org.kde.kwin.Script.run');
    // run è asincrono: aspettiamo un po' che lo script giri prima di dire "non trovata"
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 150));
      if (/false/.test((await dbus('/Scripting', 'org.kde.kwin.Scripting.isScriptLoaded', name)).out)) return true;
    }
    await dbus('/Scripting', 'org.kde.kwin.Scripting.unloadScript', name);
    return false;
  } finally { try { fs.rmSync(file, { force: true }); } catch {} }
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

// Windows: come lanciare "claude --resume <id>" nella cartella (cwd e id già validati: niente virgolette, id alfanumerico).
// Windows Terminal usa ";" per separare i suoi sottocomandi anche dentro -d: una cartella con ";" nel nome
// farebbe partire come comando il resto del nome. Per quelle si passa da cmd, dove la cartella sta tra virgolette.
function resumeWin(cwd, id, hasWt) {
  if (hasWt && !cwd.includes(';')) return { how: 'wt', cmd: 'wt.exe', args: ['-d', cwd, 'cmd', '/k', 'claude', '--resume', id], verbatim: false };
  return { how: 'cmd', cmd: 'cmd.exe', args: ['/c', `start "Claude Code" /D "${cwd}" cmd /k claude --resume ${id}`], verbatim: true };
}

// apre un nuovo terminale nella cartella giusta con "claude --resume <id>"
async function resumeSession({ cwd, id }) {
  if (!/^[A-Za-z0-9-]{8,80}$/.test(id || '')) return { ok: false, reason: tr('Id di sessione non valido.') };
  if (!safeDir(cwd)) return { ok: false, reason: tr('La cartella del progetto non esiste più.') };
  if (process.platform === 'win32') {
    const wt = await run('where.exe', ['wt.exe'], 3000);
    const r = resumeWin(cwd, id, !wt.err && !!wt.out);
    spawn(r.cmd, r.args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: r.verbatim }).unref();
    return { ok: true, how: r.how };
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

module.exports = { focusSession, resumeSession, openFolder, focusScriptWin, cmdArgs, resumeWin };
