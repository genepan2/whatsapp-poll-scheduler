'use strict';
const fs = require('node:fs');
const path = require('node:path');
// whatsapp-web.js 1.34.7 assumes the old message-key field. WhatsApp now uses $1.
// Apply the same lookup correction to chat reads and send results (upstream issue #201845).
function patchSource(source) {
  if (source.includes('// cafe-polls: message-key correction')) return source;
  for (const [before, after] of [
    ['chat.lastReceivedKey._serialized', '(chat.lastReceivedKey._serialized || chat.lastReceivedKey.$1)'],
    ['newMsgKey._serialized', '(newMsgKey._serialized || newMsgKey.$1)'],
    ['msg.id._serialized', '(msg.id._serialized || msg.id.$1)'],
    ['const msg = message.serialize();', 'const msg = message.serialize();\n        msg.id = { ...msg.id, _serialized: message.id._serialized || message.id.$1 };']
  ]) {
    if (!source.includes(before)) throw Error('WhatsApp library changed; review the message-key correction.');
    source = source.replaceAll(before, after);
  }
  return '// cafe-polls: message-key correction\n' + source;
}
function apply() {
  const file = path.join(path.dirname(require.resolve('whatsapp-web.js')), 'src', 'util', 'Injected', 'Utils.js');
  const original = fs.readFileSync(file, 'utf8'), patched = patchSource(original);
  if (patched !== original) fs.writeFileSync(file, patched);
}
module.exports = { apply, patchSource };
