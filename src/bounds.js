'use strict';
// Posizione della finestra salvata in config.json, controllata contro gli schermi di adesso:
// se stava su un monitor che non c'è più (portatile tolto dalla docking) si riapre al centro,
// invece di aprirsi fuori dallo schermo. Funzione pura: le aree di lavoro le passa main.js.

const MIN_VISIBLE_W = 120, MIN_VISIBLE_H = 40; // basta vedere un pezzo della barra in alto per prenderla

// bounds: {x, y, width, height} (x/y possono mancare) · areas: [{x, y, width, height}] (workArea degli schermi)
// → {x, y, width, height} con x/y tolti se la finestra non si vedrebbe, e dimensioni che stanno nello schermo
function fitBounds(bounds, areas) {
  const b = { ...(bounds || {}) };
  if (!Array.isArray(areas) || !areas.length) return b;
  const main = areas[0];
  if (b.width > main.width) b.width = main.width;
  if (b.height > main.height) b.height = main.height;
  if (typeof b.x !== 'number' || typeof b.y !== 'number') { delete b.x; delete b.y; return b; }
  const w = b.width || 980;
  // la parte alta della finestra (dove si trascina) deve cadere almeno un po' dentro uno schermo
  const visible = areas.some(a => {
    const ix = Math.min(b.x + w, a.x + a.width) - Math.max(b.x, a.x);
    const iy = Math.min(b.y + MIN_VISIBLE_H, a.y + a.height) - Math.max(b.y, a.y);
    return ix >= MIN_VISIBLE_W && iy >= MIN_VISIBLE_H;
  });
  if (!visible) { delete b.x; delete b.y; }
  return b;
}

module.exports = { fitBounds };
