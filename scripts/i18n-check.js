#!/usr/bin/env node
'use strict';
// Controlla le traduzioni: trova tutti i testi passati a tr()/trn() nel codice e i testi scritti
// negli HTML, e dice quali mancano in ogni lingua (e quali traduzioni non servono più).
//   node scripts/i18n-check.js            riepilogo
//   node scripts/i18n-check.js --missing  elenca le chiavi mancanti
//   node scripts/i18n-check.js --stub en  aggiunge le mancanti a locales/en/_todo.json (valori vuoti)

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LOC = path.join(ROOT, 'src', 'i18n', 'locales');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'locales' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}
function unescapeJs(s, q) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (m, c) => c[0] === 'u' ? String.fromCharCode(parseInt(c.slice(1), 16)) : c[0] === 'x' ? String.fromCharCode(parseInt(c.slice(1), 16)) : c === 'n' ? '\n' : c === 't' ? '\t' : c);
}
const STR = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|\x60((?:[^\x60\\$]|\\.|\$(?!\{))*)\x60`;
const reTr = new RegExp(String.raw`\btrn?\(\s*(?:` + STR + String.raw`)(?:\s*,\s*(?:` + STR + `))?`, 'g');

const keys = new Map(); // chiave -> primo file
function add(k, file) { if (k && /[A-Za-zÀ-ú]/.test(k) && !keys.has(k)) keys.set(k, path.relative(ROOT, file)); }

for (const f of walk(path.join(ROOT, 'src')).concat(walk(path.join(ROOT, 'renderer')))) {
  const src = fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, ''); // i commenti non contano
  if (f.endsWith('.js') || f.endsWith('.html')) {
    let m;
    reTr.lastIndex = 0;
    while ((m = reTr.exec(src))) {
      const a = m[1] ?? m[2] ?? m[3], b = m[4] ?? m[5] ?? m[6];
      if (a != null) add(unescapeJs(a), f);
      if (b != null) add(unescapeJs(b), f);
    }
  }
  if (f.endsWith('.html')) {
    // testi fuori dagli script: nodi di testo e attributi title/placeholder/aria-label
    const html = src.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
    const title = /<title>([^<]*)<\/title>/.exec(html);
    if (title) add(title[1].trim(), f);
    for (const m of html.matchAll(/>([^<>]+)</g)) {
      const k = m[1].replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
      if (k.length > 1) add(k, f);
    }
    for (const m of html.matchAll(/\s(?:title|placeholder|aria-label)="([^"]+)"/g)) add(m[1], f);
  }
}

const langs = fs.existsSync(LOC) ? fs.readdirSync(LOC).filter(d => fs.statSync(path.join(LOC, d)).isDirectory()) : [];
const args = process.argv.slice(2);
let bad = 0;
for (const lang of langs) {
  const dict = {};
  for (const f of fs.readdirSync(path.join(LOC, lang)).filter(f => f.endsWith('.json'))) {
    try { Object.assign(dict, JSON.parse(fs.readFileSync(path.join(LOC, lang, f), 'utf8'))); }
    catch (e) { console.log(`[${lang}] ${f}: JSON non valido (${e.message})`); bad++; }
  }
  const missing = [...keys.keys()].filter(k => !(k in dict) || dict[k] === '');
  const unused = Object.keys(dict).filter(k => !keys.has(k));
  // segnaposto diversi tra originale e traduzione
  const ph = s => (s.match(/\{\w+\}/g) || []).sort().join(',');
  const wrongPh = Object.keys(dict).filter(k => keys.has(k) && dict[k] && ph(k) !== ph(dict[k]));
  console.log(`[${lang}] ${keys.size} testi · ${missing.length} mancanti · ${unused.length} non usati · ${wrongPh.length} con segnaposto diversi`);
  if (args.includes('--missing')) for (const k of missing) console.log('  - ' + JSON.stringify(k) + '   (' + keys.get(k) + ')');
  if (args.includes('--unused')) for (const k of unused) console.log('  ~ ' + JSON.stringify(k));
  for (const k of wrongPh) console.log('  ! ' + JSON.stringify(k) + ' -> ' + JSON.stringify(dict[k]));
  if (args[0] === '--stub' && args[1] === lang && missing.length) {
    const todo = path.join(LOC, lang, '_todo.json');
    const cur = fs.existsSync(todo) ? JSON.parse(fs.readFileSync(todo, 'utf8')) : {};
    for (const k of missing) if (!(k in cur)) cur[k] = '';
    fs.writeFileSync(todo, JSON.stringify(cur, null, 2) + '\n');
    console.log(`  scritte ${missing.length} chiavi in ${path.relative(ROOT, todo)}`);
  }
  if (missing.length || wrongPh.length) bad++;
}
process.exitCode = bad ? 1 : 0;
