// One-time patch: sync_overrides.json can mark a family as removed ({"id": {"removed": true}}).
// Removed families disappear from the library without touching the big data shards.
const fs = require('fs');
const L = require('./lib');
let h = fs.readFileSync(L.HTML, 'utf8');
const crlf = h.includes('\r\n');
if (crlf) h = h.split('\r\n').join('\n');
if (h.includes('.removed')) { console.log('already patched'); process.exit(0); }
const a = '    // make sure every category / sub-category in use has a place in the navigation\n';
if (!h.includes(a)) throw new Error('anchor not found');
h = h.replace(a, () =>
  '    // families the sync tool has marked as removed (their file is gone from the library folder)\n' +
  '    for (var ri = FAMILIES.length - 1; ri >= 0; ri--) {\n' +
  '      var ro = overrides && overrides[FAMILIES[ri].id];\n' +
  '      if (ro && ro.removed) FAMILIES.splice(ri, 1);\n' +
  '    }\n' + a);
fs.writeFileSync(L.HTML, crlf ? h.split('\n').join('\r\n') : h, 'utf8');
console.log('patched');
