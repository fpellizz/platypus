'use strict';
// node src/hooks-cli.js install | uninstall | status
const hooks = require('./core/hooks');
const { DEFAULT_PORT } = require('./core');
const i18n = require('./i18n');
const { tr } = i18n;
// la lingua scelta nelle opzioni dell'ufficio (o quella del sistema)
try { i18n.setLang(i18n.resolveLang(JSON.parse(require('fs').readFileSync(require('path').join(require('os').homedir(), '.agent-office', 'settings.json'), 'utf8')).lang)); }
catch { i18n.setLang(i18n.resolveLang('auto')); }
const cmd = process.argv[2] || 'status';
try {
  if (cmd === 'install') {
    const r = hooks.install({ port: DEFAULT_PORT });
    console.log(tr('Hook installati in {path} ({n} eventi).', { path: r.path, n: r.events }) + (r.backup ? '\n' + tr('Copia di sicurezza: {path}', { path: r.backup }) : ''));
    console.log(tr('Le sessioni di Claude Code aperte da adesso in poi manderanno gli eventi all\'ufficio.'));
  } else if (cmd === 'uninstall') {
    const r = hooks.uninstall();
    console.log(r.removed ? tr('Hook di Agent Office rimossi da {path}.', { path: r.path }) : tr('Nessun file di impostazioni trovato.'));
  } else {
    console.log(hooks.status() ? tr('Hook di Agent Office: INSTALLATI') : tr('Hook di Agent Office: non installati'));
  }
} catch (e) {
  console.error(tr('Errore: {msg}', { msg: e.message }));
  process.exit(1);
}
