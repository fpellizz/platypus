'use strict';
// Modalità browser: avvia solo il server e apre l'ufficio nel browser predefinito.
//   node src/standalone.js [--no-open] [--demo]
const { exec } = require('child_process');
const { startCore } = require('./core');
const { tr } = require('./i18n');

const core = startCore({ includeCowork: !process.argv.includes('--no-cowork') });
core.ready.then(({ port }) => {
  const url = `http://127.0.0.1:${port}/`;
  console.log(tr('Agent Office in ascolto su {url}  (Ctrl+C per uscire)', { url }));
  if (process.argv.includes('--demo')) core.demo.start();
  if (!process.argv.includes('--no-open')) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
}).catch(err => {
  if (err.code === 'EADDRINUSE') console.error(tr('La porta è già occupata: forse Agent Office è già aperto?'));
  else console.error(err);
  process.exit(1);
});
process.on('SIGINT', () => { core.stop(); process.exit(0); });
