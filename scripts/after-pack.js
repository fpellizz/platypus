'use strict';
// Imposta icona e informazioni di versione dell'eseguibile Windows senza bisogno di Wine
// (usato quando si compila da Linux/macOS; su Windows funziona lo stesso).
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  let ResEdit, PE;
  try { ResEdit = await import('resedit'); PE = await import('pe-library'); }
  catch { console.warn('  • resedit non installato: icona dell\'exe non impostata (npm run dist:tools)'); return; }
  const exePath = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const exe = PE.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = PE.NtExecutableResource.from(exe);

  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups[0] || { id: 1, lang: 1033 };
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, target.id, target.lang, ico.icons.map(i => i.data));

  const version = ctx.packager.appInfo.version;
  const [a, b, c] = version.split('.').map(n => parseInt(n, 10) || 0);
  const vis = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = vis[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const lang = { lang: 1033, codepage: 1200 };
  vi.setFileVersion(a, b, c, 0, 1033);
  vi.setProductVersion(a, b, c, 0, 1033);
  vi.setStringValues(lang, {
    FileDescription: 'Agent Office',
    ProductName: 'Agent Office',
    CompanyName: 'Agent Office',
    OriginalFilename: path.basename(exePath),
    InternalName: 'Agent Office',
    LegalCopyright: '',
    FileVersion: version,
    ProductVersion: version,
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('  • icona e versione impostate su', path.basename(exePath));
};
