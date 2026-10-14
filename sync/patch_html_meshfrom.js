// One-time patch: let sync_overrides.json say "reuse another family's 3D model" ({"id": {"meshFrom": "otherId"}}).
const fs = require('fs');
const L = require('./lib');
let h = fs.readFileSync(L.HTML, 'utf8');
const crlf = h.includes('\r\n');
if (crlf) h = h.split('\r\n').join('\n');
if (h.includes('meshFrom')) { console.log('already patched'); process.exit(0); }
const a = "      FAMILIES.forEach(function (f) { if (f.id === id) Object.assign(f, overrides[id]); });\n";
if (!h.includes(a)) throw new Error('anchor not found');
h = h.replace(a, () => a +
  "      var from = overrides[id] && overrides[id].meshFrom;\n" +
  "      if (from && MESH_DATA[from] && !MESH_DATA[id]) MESH_DATA[id] = MESH_DATA[from];\n");
fs.writeFileSync(L.HTML, crlf ? h.split('\n').join('\r\n') : h, 'utf8');
console.log('patched');
