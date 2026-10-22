# Architecture

*Versione italiana: [ARCHITETTURA.md](ARCHITETTURA.md).*

Platypus is split into three independent layers. That is what lets it run the same way on Windows, macOS and Linux, and one day swap the shell (for example for Tauri) without rewriting the engine or the graphics.

```
┌────────────────────────────────────────────────────────────┐
│ Desktop shell         src/main.js + src/preload.js         │  Electron: window, tray icon,
│ (replaceable)         src/autostart.js                     │  notifications, start at login
├────────────────────────────────────────────────────────────┤
│ Interface             renderer/  (HTML, CSS, JS, canvas)    │  the same page in the window
│                                                            │  and in the browser
├────────────────────────────────────────────────────────────┤
│ Engine                src/core/  (Node.js, no external     │  reads Claude Code's data, keeps the
│                       dependencies)                        │  state, serves page and API over HTTP
└────────────────────────────────────────────────────────────┘
        ▲ transcripts and registry (~/.claude)    ▲ hooks (curl → 127.0.0.1:47800)
```

## Engine (`src/core`)

Node.js modules only, no npm packages: that's why browser mode starts without `npm install`.

| File | Role |
|---|---|
| `index.js` | startup, HTTP server on 127.0.0.1 only, SSE, API, pending permissions |
| `sources.js` | reading the transcripts (`projects/**/*.jsonl`) and the session registry, finding Cowork folders |
| `state.js` | state of sessions, agents and subagents, costs, alerts, whiteboards, releases |
| `hooks.js` | installing and removing the hooks in `settings.json` |
| `archive.js` | archive and replay with a virtual clock |
| `osint.js` | system integration: bring window to front, resume session, open folder (Windows / macOS / Linux) |
| `stats.js` | daily and weekly statistics, report |
| `worldmap.js` | map of reality: territory, frontier, 7-dimensional trajectory |
| `semantic.js` | context bubble and north star (TF-IDF, PCA, clusters, alignment) |
| `weather.js`, `releases.js`, `describe.js`, `demo.js`, `demoworld.js` | weather, git/gh releases, tool descriptions, demo |
| `../i18n` | translations (key = Italian text, `locales/<language>/*.json`) |

Everything that depends on the operating system lives in three places: `osint.js`, `sources.js` (Cowork and WSL paths) and `hooks.js` (`curl` / `curl.exe`).

### API (all on `http://127.0.0.1:<port>`)

| Method and path | What it does |
|---|---|
| `GET /events` | SSE stream of the state (and of the replay frames) |
| `GET /api/state`, `/api/settings` | state and options |
| `POST /api/settings` | saves the options |
| `POST /platypus-hook` | hook events (asynchronous) |
| `POST /platypus-hook/permission` | synchronous permissions hook: waits for the office's answer |
| `POST /api/approve` | answer to a permission: `allow`, `always`, `deny` |
| `GET /api/agentmap`, `/api/agentmind` | map of reality, bubble and north star |
| `GET /api/archive`, `POST /api/replay` | archive and replay |
| `POST /api/focus`, `/api/resume`, `/api/open-folder` | window, resume, folder |
| `GET /api/stats/costs`, `/api/stats/honors`, `/api/report` | statistics and report |
| `POST /api/demo`, `/api/cowork`, `/api/cowork-scan` | demo, Cowork wing, Cowork scan |
| `GET /i18n.js` | translations for the page |

The server rejects requests whose `Host` or `Origin` is not `127.0.0.1`/`localhost` (protection against DNS rebinding and websites).

## Interface (`renderer/`)

Static page: `index.html`, `style.css`, `game.js` (building, floors, balloons), `worldmap.js` (map of reality), `report.html`, `i18n-runtime.js`. It talks to the engine only over HTTP and SSE. The only point of contact with the shell is the optional `window.officeApp` object (if it's missing, you're in the browser).

### The `window.officeApp` contract (from `src/preload.js`)

| Function | Use |
|---|---|
| `minimize()`, `close()` | title bar buttons |
| `toggleMaximize()`, `isMaximized()`, `onMaximized(cb)` | full screen: the button also follows maximizing done outside the page |
| `togglePin()`, `getPin()` | always on top |
| `setCounts({sessions, agents, busy, waiting})` | updates the tray icon and flashes the window |
| `setWidget(on)` | mini mode (small window, always on top) |
| `onGoto(cb)` | click on a notification → go to the session's floor |

## Desktop shell (`src/main.js`)

Starts the engine in the same process, opens a frameless window on `http://127.0.0.1:<port>/`, and handles:
- the system tray icon and menu;
- notifications (permissions, alerts, report);
- mini mode;
- start at login (`src/autostart.js`);
- on Windows, the Start menu entry with the AppUserModelID for notifications;
- on macOS, the app menu and the Dock icon;
- on Linux, the app_id/`desktopName` `platypus` (matches `platypus.desktop`) and Wayland: natively there is no always-on-top or window position, so `getPin()` returns `false` and `PIN` offers to restart with `--ozone-platform=x11` (XWayland). The choice is `x11` in the app's `config.json`, also read by `scripts/launch.js`.

## Moving to Tauri (or another shell)

The engine and the interface don't change. A Tauri shell would need to:

1. **start the engine**, in one of two ways:
   - as an external Node.js process (`node src/standalone.js --no-open`), or compiled into a single executable (`node --experimental-sea-config`, Bun or Deno);
   - alternatively, port it to Rust one module at a time, keeping the same HTTP API;
2. **open a webview** on `http://127.0.0.1:<port>/`;
3. **provide `window.officeApp`** with the same functions as the table above, implemented as Tauri commands (`invoke`);
4. **rewrite the shell parts in Rust**: tray icon (`tray`), notifications (`tauri-plugin-notification`), start at login (`tauri-plugin-autostart`), bring window to front and mini mode.

The benefit would be much smaller binaries (about 10 MB instead of 150) and less memory. The cost: anyone starting from source has to install Rust and the system libraries to build it. That's why, as long as distribution is "clone and launch", the shell stays Electron.

## Data on disk

| Path | Contents |
|---|---|
| `~/.claude/` | Claude Code's: read, never changed, except the hooks in `settings.json` if you install them |
| `~/.platypus/settings.json` | office options |
| `~/.platypus/stats.json` | daily and weekly statistics |
| `~/.platypus/launch.log` | messages from the last window launch |
| Electron data folder (`Platypus`) | window position and shell preferences |
