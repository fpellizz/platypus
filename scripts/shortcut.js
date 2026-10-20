'use strict';
// Collegamenti per aprire Agent Office senza terminale:
//  - Windows: icona sul Desktop (il menu Start lo crea l'app al primo avvio)
//  - macOS:   "Agent Office.app" in ~/Applications (un piccolo lanciatore)
//  - Linux:   voce nel menu delle applicazioni (~/.local/share/applications)
// Tutti puntano alla cartella del repository: se la sposti, rilancia "npm run shortcut".

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function psQuote(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }

function windows({ root, electron }) {
  const desktop = path.join(os.homedir(), 'Desktop');
  const lnk = path.join(fs.existsSync(desktop) ? desktop : os.homedir(), 'Agent Office.lnk');
  const ps = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + psQuote(lnk) + ')',
    '$s.TargetPath = ' + psQuote(electron),
    '$s.Arguments = ' + psQuote('"' + root + '"'),
    '$s.WorkingDirectory = ' + psQuote(root),
    '$s.IconLocation = ' + psQuote(path.join(root, 'build', 'icon.ico') + ',0'),
    '$s.Description = "Agent Office"',
    '$s.Save()',
  ].join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { encoding: 'utf8' });
  if (r.status !== 0) return ['Non sono riuscito a creare il collegamento: ' + (r.stderr || r.error || '').toString().trim()];
  return ['Collegamento creato: ' + lnk, 'Al primo avvio l\'app aggiunge anche la voce nel menu Start (serve alle notifiche di Windows).'];
}

function mac({ root }) {
  const apps = path.join(os.homedir(), 'Applications');
  const app = path.join(apps, 'Agent Office.app');
  const contents = path.join(app, 'Contents');
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });
  const exe = path.join(contents, 'MacOS', 'agent-office');
  fs.writeFileSync(exe, `#!/bin/bash
# lanciatore di Agent Office (repository: ${root})
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
cd ${JSON.stringify(root)} || exit 1
exec node scripts/launch.js --background
`);
  fs.chmodSync(exe, 0o755);
  // icona: dalla PNG del progetto con gli strumenti di macOS (sips + iconutil), se ci sono
  let icon = false;
  try {
    const set = path.join(os.tmpdir(), 'agent-office.iconset');
    fs.rmSync(set, { recursive: true, force: true });
    fs.mkdirSync(set);
    const src = path.join(root, 'build', 'icon.png');
    for (const s of [16, 32, 64, 128, 256, 512]) {
      spawnSync('sips', ['-z', String(s), String(s), src, '--out', path.join(set, `icon_${s}x${s}.png`)]);
      spawnSync('sips', ['-z', String(s * 2), String(s * 2), src, '--out', path.join(set, `icon_${s}x${s}@2x.png`)]);
    }
    icon = spawnSync('iconutil', ['-c', 'icns', set, '-o', path.join(contents, 'Resources', 'icon.icns')]).status === 0;
  } catch {}
  fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Agent Office</string>
  <key>CFBundleDisplayName</key><string>Agent Office</string>
  <key>CFBundleIdentifier</key><string>com.agentoffice.launcher</string>
  <key>CFBundleExecutable</key><string>agent-office</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${require(path.join(root, 'package.json')).version}</string>
  ${icon ? '<key>CFBundleIconFile</key><string>icon</string>' : ''}
  <key>LSUIElement</key><true/>
</dict></plist>
`);
  return ['Creato ' + app, 'Aprilo dal Finder (Applicazioni dell\'utente) o trascinalo nel Dock.'];
}

function linux({ root }) {
  const dir = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'agent-office.desktop');
  fs.writeFileSync(file, `[Desktop Entry]
Type=Application
Name=Agent Office
Comment=Claude Code agents in an 80s pixel-art office
Exec=${JSON.stringify(path.join(root, 'start.sh'))} --background
Path=${root}
Icon=${path.join(root, 'build', 'icon.png')}
Terminal=false
Categories=Development;Utility;
StartupWMClass=Agent Office
`);
  fs.chmodSync(file, 0o755);
  spawnSync('update-desktop-database', [dir]);
  return ['Voce aggiunta al menu delle applicazioni: ' + file];
}

function install(opts) {
  if (process.platform === 'win32') return windows(opts);
  if (process.platform === 'darwin') return mac(opts);
  return linux(opts);
}

module.exports = { install };
