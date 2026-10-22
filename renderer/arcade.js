// Cabinet arcade: finestra modale con tre mini giochi (pacman, tetris, invaders).
// API: openArcade(id) / closeArcade() / arcadeOpen(). Caricato dopo game.js.
(() => {
'use strict';
const COL = { k: '#000000', navy: '#1D2B53', plum: '#7E2553', dgreen: '#008751', brown: '#AB5236', dgrey: '#5F574F', lgrey: '#C2C3C7',
  white: '#FFF1E8', red: '#FF004D', orange: '#FFA300', yellow: '#FFEC27', green: '#00E436', blue: '#29ADFF', lav: '#83769C', pink: '#FF77A8', peach: '#FFCCAA' };
const STEP = 1 / 60;
const NAMES = { pacman: 'PAC-MAN', tetris: 'TETRIS', invaders: 'SPACE INVADERS' };
const KM = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', Space: 'fire', KeyX: 'x', KeyZ: 'z' };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

let root = null, cv = null, cx = null, S = null, G = null, raf = 0, last = 0, acc = 0, hudKey = '';

function txt(c, s, x, y, col, al = 'left', px = 6) {
  c.font = px + 'px PS2P, monospace'; c.textAlign = al; c.textBaseline = 'top'; c.fillStyle = col; c.fillText(s, x, y);
}
function loadHi(id) { try { return +localStorage.getItem('ao.arcade.' + id) || 0; } catch { return 0; } }
function saveHi() { try { if (S && S.hi > 0) localStorage.setItem('ao.arcade.' + S.id, String(S.hi)); } catch {} }

// ───────────────────────── PAC-MAN ─────────────────────────
function pacman() {
  const MAZE = [
    '###################',
    '#........#........#',
    '#o##.###.#.###.##o#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.### # ###.####',
    '   #.#       #.#   ',
    '####.# ##-## #.####',
    '    .  #   #  .    ',
    '####.# ##### #.####',
    '   #.#       #.#   ',
    '####.# ##### #.####',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o.#.....P.....#.o#',
    '##.#.#.#####.#.#.##',
    '#....#...#...#....#',
    '#.######.#.######.#',
    '#.................#',
    '###################'];
  const W = 19, H = 21, TS = 8;
  const DIRS = [[0, -1], [-1, 0], [0, 1], [1, 0]];
  const MODES = [6, 16, 6, 16, 5, 16, 5, 1e9];            // scatter/chase alternati
  const CORNER = [[17, 0], [1, 0], [17, 20], [1, 20]];
  const GCOL = [COL.red, COL.pink, COL.blue, COL.orange];
  let grid, dots, lvl, lives, pac, gh, want, face, modeI, modeT, frT, combo, ph, t, anim = 0, maze;

  const cell = (x, y) => grid[y]?.[(x + W) % W];
  const pOk = (x, y) => { const c = cell(x, y); return c !== undefined && c !== '#' && c !== '-'; };
  const gOk = (x, y, door) => { const c = cell(x, y); return c !== undefined && c !== '#' && (c !== '-' || door); };

  function prerender() {
    maze = document.createElement('canvas'); maze.width = W * TS; maze.height = H * TS;
    const c = maze.getContext('2d'), w = (x, y) => (MAZE[y]?.[x] ?? '#') === '#';
    c.fillStyle = COL.k; c.fillRect(0, 0, maze.width, maze.height);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ch = MAZE[y][x];
      if (ch === '-') { c.fillStyle = COL.pink; c.fillRect(x * TS, y * TS + 3, TS, 2); continue; }
      if (ch !== '#') continue;
      c.fillStyle = COL.navy; c.fillRect(x * TS, y * TS, TS, TS);
      c.fillStyle = COL.blue;
      if (!w(x, y - 1)) c.fillRect(x * TS, y * TS, TS, 1);
      if (!w(x, y + 1)) c.fillRect(x * TS, y * TS + TS - 1, TS, 1);
      if (!w(x - 1, y)) c.fillRect(x * TS, y * TS, 1, TS);
      if (!w(x + 1, y)) c.fillRect(x * TS + TS - 1, y * TS, 1, TS);
    }
  }
  function build() {
    grid = MAZE.map(r => r.split('')); dots = 0;
    grid.forEach(r => r.forEach(c => { if (c === '.' || c === 'o') dots++; }));
    grid[15][9] = ' '; resetPos();
  }
  function resetPos() {
    pac = { tx: 9, ty: 15, dx: 0, dy: 0, p: 0, sp: 6.4 }; want = null; face = [-1, 0];
    const rel = Math.max(0, 1 - lvl * 0.1);
    gh = [
      { tx: 9, ty: 7, dx: -1, dy: 0, p: 0, st: 'out', rel: 0 },
      { tx: 9, ty: 9, dx: 0, dy: 0, p: 0, st: 'house', rel: 2 * rel },
      { tx: 8, ty: 9, dx: 0, dy: 0, p: 0, st: 'house', rel: 5 * rel },
      { tx: 10, ty: 9, dx: 0, dy: 0, p: 0, st: 'house', rel: 8 * rel }].map((g, i) => ({ ...g, id: i, fr: false, rev: false, sp: 5.6 }));
    modeI = 0; modeT = MODES[0]; frT = 0; combo = 0; ph = 'ready'; t = 1.5;
  }
  // muove un'entità tile per tile; onArr decide la direzione a ogni centro di tile
  function mv(e, dt, onArr) {
    let d = e.sp * dt;
    while (d > 0) {
      if (!e.dx && !e.dy) { onArr(e); if (!e.dx && !e.dy) return; }
      const s = Math.min(d, 1 - e.p); e.p += s; d -= s;
      if (e.p >= 1 - 1e-9) { e.tx = (e.tx + e.dx + W) % W; e.ty += e.dy; e.p = 0; onArr(e); }
    }
  }
  function pacArr(e) {
    const c = grid[e.ty][e.tx];
    if (c === '.') { grid[e.ty][e.tx] = ' '; dots--; S.add(10); }
    else if (c === 'o') {
      grid[e.ty][e.tx] = ' '; dots--; S.add(50); frT = Math.max(2.5, 7 - lvl); combo = 0;
      gh.forEach(g => { if (g.st === 'out') { g.fr = true; g.rev = true; } });
    }
    if (want && pOk(e.tx + want[0], e.ty + want[1])) { e.dx = want[0]; e.dy = want[1]; }
    else if (!pOk(e.tx + e.dx, e.ty + e.dy)) e.dx = e.dy = 0;
    if (e.dx || e.dy) face = [e.dx, e.dy];
  }
  function target(g) {
    if (g.st === 'leave') return [9, 7];
    if (g.st === 'eyes') return [9, 8];
    if (modeI % 2 === 0) return CORNER[g.id];
    const px = pac.tx, py = pac.ty;
    if (g.id === 1) return [px + face[0] * 4, py + face[1] * 4];
    if (g.id === 2) return [2 * (px + face[0] * 2) - gh[0].tx, 2 * (py + face[1] * 2) - gh[0].ty];
    if (g.id === 3 && Math.hypot(px - g.tx, py - g.ty) < 8) return CORNER[3];
    return [px, py];
  }
  function ghArr(g) {
    if (g.st === 'leave' && g.ty <= 7) g.st = 'out';
    if (g.st === 'eyes' && g.tx === 9 && g.ty === 8) { g.ty = 9; g.st = 'leave'; g.fr = false; g.dx = g.dy = 0; }
    const door = g.st === 'leave' || g.st === 'eyes', mov = g.dx || g.dy;
    let c = DIRS.filter(([x, y]) => !(mov && x === -g.dx && y === -g.dy) && gOk(g.tx + x, g.ty + y, door));
    if (g.rev && mov && g.st === 'out') c = [[-g.dx, -g.dy]];
    g.rev = false;
    if (!c.length) c = [[-g.dx, -g.dy]];
    let best;
    if (g.fr && g.st === 'out') best = pick(c);
    else {
      const [tx, ty] = target(g); let bd = 1e9;
      for (const d of c) { const dd = (g.tx + d[0] - tx) ** 2 + (g.ty + d[1] - ty) ** 2; if (dd < bd) { bd = dd; best = d; } }
    }
    g.dx = best[0]; g.dy = best[1];
  }
  const gpos = e => [e.tx + e.dx * e.p, e.ty + e.dy * e.p];

  return {
    w: W * TS, h: H * TS, hint: () => tr('Frecce: muovi · P: pausa · Esc: esci'),
    reset() { lvl = 0; lives = 3; S.extra = tr('VITE') + ' ' + lives; if (!maze) prerender(); build(); },
    key(k, down) {
      if (!down) return;
      const i = { u: 0, l: 1, d: 2, r: 3 }[k];
      if (i !== undefined) want = DIRS[i];
    },
    update(dt) {
      anim += dt;
      if (ph !== 'run') {
        t -= dt; if (t > 0) return;
        if (ph === 'ready') ph = 'run';
        else if (ph === 'die') { lives--; S.extra = tr('VITE') + ' ' + Math.max(0, lives); if (lives <= 0) { S.end(); return; } resetPos(); }
        else if (ph === 'clear') { lvl++; build(); }
        return;
      }
      if (frT > 0) { frT -= dt; if (frT <= 0) gh.forEach(g => { g.fr = false; }); }
      else if ((modeT -= dt) <= 0) { modeT = MODES[Math.min(++modeI, MODES.length - 1)]; gh.forEach(g => { g.rev = true; }); }
      if (want && (pac.dx || pac.dy) && want[0] === -pac.dx && want[1] === -pac.dy) {   // inversione a metà tile
        pac.tx = (pac.tx + pac.dx + W) % W; pac.ty += pac.dy; pac.p = 1 - pac.p; pac.dx = want[0]; pac.dy = want[1]; face = want;
      }
      mv(pac, dt, pacArr);
      if (dots <= 0) { ph = 'clear'; t = 1.4; return; }
      for (const g of gh) {
        if (g.st === 'house') { if ((g.rel -= dt) <= 0) g.st = 'leave'; continue; }
        g.sp = g.st === 'eyes' ? 13 : g.fr ? 3.6 : Math.min(7, 5.6 + lvl * 0.3);
        mv(g, dt, ghArr);
      }
      const [px, py] = gpos(pac);
      for (const g of gh) {
        if (g.st === 'house' || g.st === 'eyes') continue;
        const [gx, gy] = gpos(g); let ddx = Math.abs(px - gx); ddx = Math.min(ddx, W - ddx);
        if (Math.hypot(ddx, py - gy) > 0.7) continue;
        if (g.fr) { g.st = 'eyes'; g.fr = false; S.add(200 * 2 ** combo++); }
        else { ph = 'die'; t = 1.4; break; }
      }
    },
    draw(c) {
      c.drawImage(maze, 0, 0);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const ch = grid[y][x];
        if (ch === '.') { c.fillStyle = COL.peach; c.fillRect(x * TS + 3, y * TS + 3, 2, 2); }
        else if (ch === 'o' && (anim * 4 | 0) % 2 === 0) { c.fillStyle = COL.peach; c.beginPath(); c.arc(x * TS + 4, y * TS + 4, 3, 0, 7); c.fill(); }
      }
      const flash = ph === 'clear' && (anim * 8 | 0) % 2 === 0;
      if (flash) { c.fillStyle = 'rgba(255,241,232,.35)'; c.fillRect(0, 0, W * TS, H * TS); }
      if (ph !== 'die' || t > 1.0) for (const g of gh) {
        const [gx, gy] = gpos(g), x = gx * TS + 4, y = gy * TS + 4;
        if (g.st !== 'eyes') {
          const fl = g.fr && frT < 2 && (anim * 6 | 0) % 2 === 0;
          c.fillStyle = g.fr ? (fl ? COL.white : COL.blue) : GCOL[g.id];
          c.beginPath(); c.arc(x, y - 0.5, 3.5, Math.PI, 0); c.lineTo(x + 3.5, y + 3.5); c.lineTo(x - 3.5, y + 3.5); c.fill();
          c.fillStyle = COL.k; const f = (anim * 8 | 0) % 2;
          c.fillRect(x - 2.5 + f, y + 2.5, 1, 1); c.fillRect(x - 0.5 + f, y + 2.5, 1, 1); c.fillRect(x + 1.5 + f, y + 2.5, 1, 1);
        }
        if (g.fr) { c.fillStyle = COL.white; c.fillRect(x - 2, y - 1, 1, 1); c.fillRect(x + 1, y - 1, 1, 1); }
        else {
          c.fillStyle = COL.white; c.fillRect(x - 3, y - 2, 2, 3); c.fillRect(x + 1, y - 2, 2, 3);
          c.fillStyle = COL.navy; c.fillRect(x - 3 + (g.dx > 0 ? 1 : 0), y - 1 + (g.dy > 0 ? 1 : g.dy < 0 ? -1 : 0) + 0, 1, 1);
          c.fillRect(x + 1 + (g.dx > 0 ? 1 : 0), y - 1 + (g.dy > 0 ? 1 : g.dy < 0 ? -1 : 0), 1, 1);
        }
      }
      const [px, py] = gpos(pac), x = px * TS + 4, y = py * TS + 4;
      let m = 0.15 + 0.6 * Math.abs(Math.sin(anim * 14));
      if (!pac.dx && !pac.dy) m = 0.5;
      if (ph === 'die') m = Math.min(Math.PI, (1.4 - t) * 3);
      if (ph !== 'die' || m < Math.PI) {
        const a = Math.atan2(face[1], face[0]);
        c.fillStyle = COL.yellow; c.beginPath(); c.moveTo(x, y); c.arc(x, y, 3.6, a + m, a + 2 * Math.PI - m); c.fill();
      }
      if (ph === 'ready') txt(c, tr('PRONTI!'), W * TS / 2, 11 * TS + 1, COL.yellow, 'center', 7);
    },
  };
}

// ───────────────────────── TETRIS ─────────────────────────
function tetris() {
  const CW = 10, RW = 20, CS = 8;
  const SH = { I: [[0, 1], [1, 1], [2, 1], [3, 1]], O: [[1, 0], [2, 0], [1, 1], [2, 1]], T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]], Z: [[0, 0], [1, 0], [1, 1], [2, 1]], J: [[0, 0], [0, 1], [1, 1], [2, 1]], L: [[2, 0], [0, 1], [1, 1], [2, 1]] };
  const TC = { I: COL.blue, O: COL.yellow, T: COL.pink, S: COL.green, Z: COL.red, J: COL.lav, L: COL.orange };
  let board, cur, nxt, bag, lines, lvl, gacc, clr, anim = 0;

  const fits = (cells, x, y) => cells.every(([cx_, cy_]) => { const px = x + cx_, py = y + cy_; return px >= 0 && px < CW && py < RW && (py < 0 || !board[py][px]); });
  const rot = (p, dir) => {
    if (p.k === 'O') return p.cells;
    const n = p.k === 'I' ? 4 : 3;
    return p.cells.map(([x, y]) => dir > 0 ? [n - 1 - y, x] : [y, n - 1 - x]);
  };
  const next = () => {
    if (!bag.length) { bag = Object.keys(SH); for (let i = bag.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [bag[i], bag[j]] = [bag[j], bag[i]]; } }
    const k = bag.pop(); return { k, cells: SH[k], x: 3, y: 0 };
  };
  const spawn = () => { cur = nxt; nxt = next(); gacc = 0; if (!fits(cur.cells, cur.x, cur.y)) S.end(); };
  const iv = () => Math.max(0.06, 0.8 - (lvl - 1) * 0.07);
  const hud = () => { S.extra = tr('LIVELLO') + ' ' + lvl; };
  function lock() {
    for (const [x, y] of cur.cells) if (cur.y + y >= 0) board[cur.y + y][cur.x + x] = cur.k;
    const rows = []; board.forEach((r, i) => { if (r.every(Boolean)) rows.push(i); });
    if (rows.length) clr = { rows, t: 0.22 }; else spawn();
  }
  const drawCell = (c, x, y, s, col) => {
    c.fillStyle = col; c.fillRect(x, y, s, s);
    c.fillStyle = 'rgba(255,255,255,.4)'; c.fillRect(x, y, s, 1); c.fillRect(x, y, 1, s);
    c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x, y + s - 1, s, 1); c.fillRect(x + s - 1, y, 1, s);
  };
  return {
    w: CW * CS + 56, h: RW * CS, hint: () => tr('Frecce: muovi · Su/X: ruota · Spazio: caduta · P: pausa · Esc: esci'),
    reset() { board = Array.from({ length: RW }, () => Array(CW).fill(0)); bag = []; lines = 0; lvl = 1; clr = null; nxt = next(); spawn(); hud(); },
    key(k, down, rep) {
      if (!down || clr) return;
      const mvx = d => { if (fits(cur.cells, cur.x + d, cur.y)) cur.x += d; };
      if (k === 'l') mvx(-1); else if (k === 'r') mvx(1);
      else if ((k === 'u' || k === 'x' || k === 'z') && !rep) {
        const cells = rot(cur, k === 'z' ? -1 : 1);
        for (const dx of [0, -1, 1, -2, 2]) if (fits(cells, cur.x + dx, cur.y)) { cur.cells = cells; cur.x += dx; break; }   // wall kick semplice
      } else if (k === 'fire' && !rep) {
        let n = 0; while (fits(cur.cells, cur.x, cur.y + 1)) { cur.y++; n++; }
        S.add(n * 2); lock();
      }
    },
    update(dt) {
      anim += dt;
      if (clr) {
        if ((clr.t -= dt) > 0) return;
        for (const r of clr.rows) { board.splice(r, 1); board.unshift(Array(CW).fill(0)); }
        const n = clr.rows.length; clr = null; lines += n; S.add([0, 100, 300, 500, 800][n] * lvl);
        lvl = 1 + (lines / 10 | 0); hud(); spawn(); return;
      }
      const soft = S.held.d, step = soft ? Math.min(iv(), 0.045) : iv();
      gacc += dt;
      while (gacc >= step && !clr) {
        gacc -= step;
        if (fits(cur.cells, cur.x, cur.y + 1)) { cur.y++; if (soft) S.add(1); } else { lock(); break; }
      }
    },
    draw(c) {
      c.fillStyle = COL.k; c.fillRect(0, 0, CW * CS + 56, RW * CS);
      c.fillStyle = '#0b0a12'; c.fillRect(0, 0, CW * CS, RW * CS);
      c.fillStyle = COL.navy;
      for (let x = 1; x < CW; x++) c.fillRect(x * CS, 0, 1, RW * CS);
      for (let y = 1; y < RW; y++) c.fillRect(0, y * CS, CW * CS, 1);
      c.fillStyle = COL.dgrey; c.fillRect(CW * CS, 0, 1, RW * CS);
      for (let y = 0; y < RW; y++) for (let x = 0; x < CW; x++) if (board[y][x]) drawCell(c, x * CS, y * CS, CS, TC[board[y][x]]);
      if (clr && (anim * 20 | 0) % 2 === 0) { c.fillStyle = COL.white; for (const r of clr.rows) c.fillRect(0, r * CS, CW * CS, CS); }
      if (cur && !clr) {
        let gy = cur.y; while (fits(cur.cells, cur.x, gy + 1)) gy++;
        c.strokeStyle = TC[cur.k]; c.globalAlpha = 0.4;
        for (const [x, y] of cur.cells) c.strokeRect((cur.x + x) * CS + 0.5, (gy + y) * CS + 0.5, CS - 1, CS - 1);
        c.globalAlpha = 1;
        for (const [x, y] of cur.cells) if (cur.y + y >= 0) drawCell(c, (cur.x + x) * CS, (cur.y + y) * CS, CS, TC[cur.k]);
      }
      const px = CW * CS + 6;
      txt(c, tr('PROSSIMO'), px, 6, COL.pink);
      const sz = nxt.k === 'O' || nxt.k === 'I' ? 4 : 3;
      for (const [x, y] of nxt.cells) drawCell(c, px + 4 + x * 6 + (sz === 3 ? 4 : 0), 18 + y * 6, 6, TC[nxt.k]);
      txt(c, tr('LIVELLO'), px, 60, COL.pink); txt(c, String(lvl), px, 70, COL.white);
      txt(c, tr('RIGHE'), px, 86, COL.pink); txt(c, String(lines), px, 96, COL.white);
    },
  };
}

// ───────────────────────── SPACE INVADERS ─────────────────────────
function invaders() {
  const W = 160, H = 176, COLS = 9, ROWS = 5, PX = 14, PY = 11, PLY = 160;
  const SPR = [   // squid, crab, octopus: 2 frame ciascuno
    [['...##...', '..####..', '.######.', '##.##.##', '########', '..#..#..', '.#.##.#.', '#.#..#.#'], ['...##...', '..####..', '.######.', '##.##.##', '########', '.#.##.#.', '#......#', '.#....#.']],
    [['#.#..#.#', '..#..#..', '.######.', '##.##.##', '########', '#.####.#', '#.#..#.#', '..#..#..'], ['..#..#..', '#.#..#.#', '########', '##.##.##', '########', '.######.', '..#..#..', '.#....#.']],
    [['..####..', '.######.', '########', '##.##.##', '########', '..#..#..', '.##..##.', '##....##'], ['..####..', '.######.', '########', '##.##.##', '########', '.##..##.', '##.##.##', '.#....#.']]];
  const RC = [COL.pink, COL.blue, COL.blue, COL.green, COL.green], RT = [0, 1, 1, 2, 2], RP = [30, 20, 20, 10, 10];
  let inv, x0, y0, dir, stepT, fr, wave, lives, px, pb, cd, eb, fireT, shields, boom, ufo, ufoT, hitT, waitT, anim = 0;

  const alive = () => { let n = 0; inv.forEach(r => r.forEach(v => { if (v) n++; })); return n; };
  function buildWave() {
    inv = Array.from({ length: ROWS }, () => Array(COLS).fill(true));
    x0 = 10; y0 = 24 + Math.min(wave - 1, 5) * 6; dir = 1; stepT = 0.3; fr = 0; eb = []; pb = null; fireT = 1;
    shields = [0, 1, 2, 3].map(i => {
      const cells = Array.from({ length: 8 }, (_, y) => Array.from({ length: 11 }, (_, x) =>
        !((y < 2 && (x < 2 - y || x > 8 + y)) || (y > 4 && x > 3 && x < 7))));
      return { x: Math.round(14.4 * (i + 1) + 22 * i), y: 138, cells };
    });
  }
  function hitShield(bx, by, r) {   // distrugge celle di scudo attorno al punto; true se ha colpito
    for (const s of shields) {
      const cxs = (bx - s.x) / 2 | 0, cys = (by - s.y) / 2 | 0;
      if (cxs < 0 || cxs > 10 || cys < 0 || cys > 7 || !s.cells[cys][cxs]) continue;
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (s.cells[cys + y]?.[cxs + x] !== undefined && Math.random() < 0.8) s.cells[cys + y][cxs + x] = false;
      s.cells[cys][cxs] = false; return true;
    }
    return false;
  }
  const eraseRect = (x, y, w, h) => shields.forEach(s => s.cells.forEach((r, cy) => r.forEach((v, cxs) => {
    if (v && s.x + cxs * 2 < x + w && s.x + cxs * 2 + 2 > x && s.y + cy * 2 < y + h && s.y + cy * 2 + 2 > y) r[cxs] = false;
  })));
  const hud = () => { S.extra = tr('VITE') + ' ' + lives; };
  function hitPlayer() {
    lives--; hud(); eb = []; pb = null; boom.push({ x: px + 5, y: PLY + 2, t: 0.6, p: true });
    if (lives <= 0) S.end(); else hitT = 1.2;
  }
  function sprite(c, s, x, y, col) {
    c.fillStyle = col;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) if (s[j][i] === '#') c.fillRect(x + i, y + j, 1, 1);
  }
  return {
    w: W, h: H, hint: () => tr('Frecce: muovi · Spazio: spara · P: pausa · Esc: esci'),
    reset() { wave = 1; lives = 3; px = 74; cd = 0; boom = []; ufo = null; ufoT = rnd(12, 20); hitT = 0; waitT = 0; buildWave(); hud(); },
    key() {},
    update(dt) {
      anim += dt;
      boom = boom.filter(b => (b.t -= dt) > 0);
      if (hitT > 0) { hitT -= dt; return; }
      if (waitT > 0) { waitT -= dt; return; }
      const h = S.held;
      px = Math.max(4, Math.min(W - 15, px + ((h.r ? 1 : 0) - (h.l ? 1 : 0)) * 75 * dt));
      cd -= dt;
      if ((h.fire || h.x) && !pb && cd <= 0) { pb = { x: px + 5, y: PLY - 4 }; cd = 0.15; }
      if (pb) {   // proiettile del giocatore
        pb.y -= 170 * dt;
        let gone = pb.y < 10;
        if (!gone && hitShield(pb.x, pb.y, 1)) gone = true;
        if (!gone) {
          const c = Math.floor((pb.x - x0) / PX), r = Math.floor((pb.y - y0) / PY);
          if (c >= 0 && c < COLS && r >= 0 && r < ROWS && inv[r][c] && pb.x - x0 - c * PX < 8 && pb.y - y0 - r * PY < 8) {
            inv[r][c] = false; S.add(RP[r]); boom.push({ x: x0 + c * PX + 4, y: y0 + r * PY + 4, t: 0.25 }); gone = true;
          } else if (ufo && pb.y < 22 && pb.x > ufo.x && pb.x < ufo.x + 14) {
            S.add(pick([50, 100, 150, 300])); boom.push({ x: ufo.x + 7, y: 16, t: 0.4 }); ufo = null; gone = true;
          }
        }
        if (gone) pb = null;
      }
      const n = alive();
      if (n === 0) { wave++; buildWave(); waitT = 1; return; }
      if ((stepT -= dt) <= 0) {   // passo della formazione
        stepT = Math.max(0.02, (0.03 + 0.6 * n / (COLS * ROWS)) * Math.pow(0.93, wave - 1));
        let lo = COLS, hi = -1, low = 0;
        inv.forEach((r, ri) => r.forEach((v, ci) => { if (v) { lo = Math.min(lo, ci); hi = Math.max(hi, ci); low = ri; } }));
        if ((dir > 0 && x0 + hi * PX + 8 + 2 >= W - 4) || (dir < 0 && x0 + lo * PX - 2 <= 4)) { y0 += 6; dir = -dir; } else x0 += 2 * dir;
        fr ^= 1;
        eraseRect(x0, y0, COLS * PX, (low + 1) * PY);
        if (y0 + low * PY + 8 >= PLY) { lives = 0; hud(); boom.push({ x: px + 5, y: PLY + 2, t: 0.6, p: true }); S.end(); return; }
      }
      fireT -= dt;
      if (fireT <= 0 && eb.length < 3 + Math.min(wave, 3)) {
        fireT = rnd(0.5, 1.3) / (1 + wave * 0.12);
        const cols = []; for (let ci = 0; ci < COLS; ci++) for (let r = ROWS - 1; r >= 0; r--) if (inv[r][ci]) { cols.push([ci, r]); break; }
        if (cols.length) { const [ci, r] = pick(cols); eb.push({ x: x0 + ci * PX + 4, y: y0 + r * PY + 8 }); }
      }
      for (const b of eb) {
        b.y += (62 + wave * 5) * dt;
        if (b.y > H - 8) b.dead = true;
        else if (hitShield(b.x, b.y + 3, 1)) b.dead = true;
        else if (b.y + 4 >= PLY && b.y <= PLY + 6 && b.x >= px && b.x <= px + 11) { b.dead = true; hitPlayer(); break; }
      }
      eb = eb.filter(b => !b.dead);
      if (!ufo && (ufoT -= dt) <= 0) { ufo = { x: -14, v: 38 }; ufoT = rnd(15, 25); }
      if (ufo && (ufo.x += ufo.v * dt) > W) ufo = null;
    },
    draw(c) {
      c.fillStyle = COL.k; c.fillRect(0, 0, W, H);
      c.fillStyle = '#0b0a12';
      for (let i = 0; i < 24; i++) c.fillRect((i * 67 + 13) % W, (i * 37 + 5) % 150, 1, 1);
      inv.forEach((r, ri) => r.forEach((v, ci) => { if (v) sprite(c, SPR[RT[ri]][fr], Math.round(x0 + ci * PX), Math.round(y0 + ri * PY), RC[ri]); }));
      c.fillStyle = COL.green;
      for (const s of shields) s.cells.forEach((r, cy) => r.forEach((v, cxs) => { if (v) c.fillRect(s.x + cxs * 2, s.y + cy * 2, 2, 2); }));
      if (ufo) {
        c.fillStyle = COL.red; c.fillRect(ufo.x + 3, 12, 8, 2); c.fillRect(ufo.x, 14, 14, 3); c.fillRect(ufo.x + 3, 17, 8, 1);
        c.fillStyle = COL.yellow; c.fillRect(ufo.x + 3, 14, 1, 1); c.fillRect(ufo.x + 7, 14, 1, 1); c.fillRect(ufo.x + 10, 14, 1, 1);
      }
      if (hitT <= 0 || (anim * 12 | 0) % 2 === 0) {
        if (lives > 0) { c.fillStyle = COL.green; c.fillRect(px, PLY + 3, 11, 4); c.fillRect(px + 2, PLY + 1, 7, 2); c.fillRect(px + 5, PLY - 2, 1, 3); }
      }
      if (pb) { c.fillStyle = COL.white; c.fillRect(pb.x, pb.y, 1, 4); }
      c.fillStyle = COL.yellow; for (const b of eb) { c.fillRect(b.x, b.y, 1, 2); c.fillRect(b.x + ((anim * 12 | 0) % 2 ? -1 : 1), b.y + 2, 1, 2); }
      for (const b of boom) {
        c.fillStyle = b.p ? COL.green : COL.white; const r = b.p ? 7 : 5;
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; c.fillRect(b.x + Math.cos(a) * r * (1 - b.t) * 1.5, b.y + Math.sin(a) * r * (1 - b.t) * 1.5, 1, 1); }
      }
      c.fillStyle = COL.green; c.fillRect(0, PLY + 9, W, 1);
      txt(c, tr('ONDATA') + ' ' + wave, 4, H - 8, COL.lav);
    },
  };
}

const GAMES = { pacman, tetris, invaders };

// ───────────────────────── guscio: finestra, input, loop ─────────────────────────
function fit() {
  if (!cv || !G) return;
  const sc = Math.max(1, Math.min(5, Math.floor(Math.min((innerHeight - 230) / G.h, (innerWidth - 90) / G.w))));
  cv.style.width = G.w * sc + 'px'; cv.style.height = G.h * sc + 'px';
}
function setMsg(kind) {
  const m = root.querySelector('.ac-msg');
  m.hidden = !kind;
  m.innerHTML = '';
  if (!kind) return;
  const b = document.createElement('b'); b.textContent = kind === 'over' ? 'GAME OVER' : tr('PAUSA'); m.appendChild(b);
  const s = document.createElement('span'); s.textContent = kind === 'over' ? tr('PREMI INVIO PER GIOCARE') : tr('Premi P per continuare'); m.appendChild(s);
}
function setState(st) { S.st = st; setMsg(st === 'play' ? '' : st); if (st === 'over') saveHi(); }
function startGame() {
  S.score = 0; S.held = {}; acc = 0; hudKey = '';
  G.reset(); setState('play');
}
function onKey(e, down) {
  if (!root) return;
  // solo i tasti del gioco: F5, F11, F12, Tab e scorciatoie restano al browser
  if (!KM[e.code] && !/^(Escape|Enter|KeyP)$/.test(e.code)) return;
  if (!(e.ctrlKey || e.metaKey)) e.preventDefault();
  e.stopImmediatePropagation();
  if (!down) { const k = KM[e.code]; if (k) { S.held[k] = false; G.key(k, false); } return; }
  if (e.code === 'Escape') { closeArcade(); return; }
  if (e.repeat && !KM[e.code]) return;
  if (e.code === 'Enter' || (e.code === 'Space' && S.st === 'over')) { if (S.st === 'over' && !e.repeat) startGame(); return; }
  if (e.code === 'KeyP') { if (S.st === 'play') setState('pause'); else if (S.st === 'pause') setState('play'); return; }
  const k = KM[e.code];
  if (!k) return;
  S.held[k] = true;
  if (S.st === 'play') G.key(k, true, e.repeat);
}
const kd = e => onKey(e, true), ku = e => onKey(e, false);
const onBlur = () => { if (S) { S.held = {}; if (S.st === 'play') setState('pause'); } };

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000)); last = now;
  if (S.st === 'play') { acc += dt; while (acc >= STEP && S.st === 'play') { G.update(STEP); acc -= STEP; } }
  cx.imageSmoothingEnabled = false; G.draw(cx);
  const k = S.score + '|' + S.hi + '|' + S.extra;
  if (k !== hudKey) {
    hudKey = k; const h = root.querySelector('.ac-hud').children;
    h[0].textContent = tr('PUNTI') + ' ' + S.score; h[1].textContent = tr('RECORD') + ' ' + S.hi; h[2].textContent = S.extra || '';
  }
}

function openArcade(id) {
  if (!GAMES[id]) return;
  if (root) closeArcade();
  S = { id, st: 'play', score: 0, hi: loadHi(id), extra: '', held: {} };
  S.add = n => { S.score += n; if (S.score > S.hi) S.hi = S.score; };
  S.end = () => setState('over');
  G = GAMES[id]();
  root = document.createElement('div'); root.id = 'arcade';
  root.innerHTML = '<div class="ac-cab"><div class="ac-mq"></div><button class="ac-x" type="button">X</button>' +
    '<div class="ac-bez"><canvas></canvas><div class="ac-msg" hidden></div></div>' +
    '<div class="ac-hud"><span></span><span></span><span></span></div><div class="ac-hint"></div></div>';
  root.querySelector('.ac-mq').textContent = NAMES[id];
  root.querySelector('.ac-hint').textContent = G.hint();
  cv = root.querySelector('canvas'); cv.width = G.w; cv.height = G.h; cx = cv.getContext('2d');
  root.addEventListener('mousedown', e => { if (e.target === root) closeArcade(); });
  root.querySelector('.ac-x').addEventListener('click', closeArcade);
  (document.body).appendChild(root);
  window.addEventListener('keydown', kd, true); window.addEventListener('keyup', ku, true);
  window.addEventListener('blur', onBlur); window.addEventListener('resize', fit);
  fit(); startGame();
  last = performance.now(); raf = requestAnimationFrame(frame);
}
function closeArcade() {
  if (!root) return;
  cancelAnimationFrame(raf); raf = 0; saveHi();
  window.removeEventListener('keydown', kd, true); window.removeEventListener('keyup', ku, true);
  window.removeEventListener('blur', onBlur); window.removeEventListener('resize', fit);
  root.remove(); root = cv = cx = S = G = null;
}
window.openArcade = openArcade;
window.closeArcade = closeArcade;
window.arcadeOpen = () => !!root;
})();
