'use strict';
// Dove può andare la finestra dell'ufficio: le sue pagine restano dentro, i link esterni si aprono nel browser
// solo se sono http(s). Mai file:, smb:, protocolli registrati da altre app (ms-*, vscode:, ...) e simili,
// che shell.openExternal lancerebbe senza chiedere nulla.

function parse(u) { try { return new URL(String(u)); } catch { return null; } }

// una pagina dell'ufficio stesso (il server locale sulla sua porta)
function isOwnUrl(u, port) {
  const x = parse(u);
  return !!x && x.protocol === 'http:' && (x.hostname === '127.0.0.1' || x.hostname === 'localhost') && Number(x.port) === Number(port);
}

// un indirizzo che si può passare a shell.openExternal
function isExternalUrl(u) {
  const x = parse(u);
  return !!x && (x.protocol === 'https:' || x.protocol === 'http:') && !!x.hostname && !x.username && !x.password;
}

module.exports = { isOwnUrl, isExternalUrl };
