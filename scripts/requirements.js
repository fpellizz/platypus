'use strict';
// Versioni di Node.js: la finestra desktop (Electron 44) vuole Node.js 22.12 o più recente; il motore e la
// modalità browser non hanno dipendenze e girano anche su versioni più vecchie, ma Node.js 20 non riceve più
// aggiornamenti di sicurezza dal 30 aprile 2026.

const WINDOW_NODE = '22.12.0';

function parts(v) { return String(v || '').replace(/^v/, '').split('.').map(n => Number(n) || 0); }

// "22.12.0" o più recente?
function windowNodeOk(v) {
  const [a, b] = parts(v), [x, y] = parts(WINDOW_NODE);
  return a > x || (a === x && b >= y);
}

module.exports = { WINDOW_NODE, windowNodeOk };
