// Which families / types have no 3D mesh?   node sync/mesh_audit.js [Category ...]
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const cats = process.argv.slice(2);

const data = f => L.readJson(path.join(L.DATA, f), {});
const meshData = data('mesh_data.json');
const typeMesh = {};
['mesh_type_0.json', 'mesh_type_1.json', 'mesh_type_2.json', 'mesh_type_3.json', 'mesh_type_4.json', 'mesh_type_aplace.json', 'mesh_type_new.json', 'mesh_type_sync.json']
  .forEach(f => Object.assign(typeMesh, data(f)));

// aliases the page copies from another family at load time
const html = fs.readFileSync(L.HTML, 'utf8');
const alias = {};
const re = /MESH_DATA(_TYPE)?\["([^"]+)"\]\s*=\s*MESH_DATA(?:_TYPE)?\["([^"]+)"\]/g;
let m;
while ((m = re.exec(html))) alias[m[2]] = m[3];

// type counts come from the family entries (html + sync shard)
const typeCount = {};
const hre = /"id":"([^"]+)","name":"(?:[^"\\]|\\.)*","cat":"[^"]*","sub":(?:null|"(?:[^"\\]|\\.)*"),"realPath":(?:"(?:[^"\\]|\\.)*"|null),"dims":(?:null|\{[^}]*\}),"instanceParams":\[[^\]]*\],"types":\[/g;
const fams = L.libraryFamilies().filter(f => !cats.length || cats.includes(f.cat));

function status(id) {
  const src = alias[id] || id;
  const tm = typeMesh[src] || typeMesh[id];
  const per = tm ? tm.map(x => !!x) : null;
  return { family: !!meshData[src] || !!meshData[id], per: per };
}

const rows = [];
fams.forEach(f => {
  const s = status(f.id);
  const total = s.per ? s.per.length : null;
  const have = s.per ? s.per.filter(Boolean).length : 0;
  rows.push({ id: f.id, name: f.name, cat: f.cat, sub: f.sub, family: s.family, have: have, total: total });
});
const missing = rows.filter(r => !r.family && r.have === 0);
const partial = rows.filter(r => !r.family && r.have > 0 && r.have < r.total);
console.log('families checked', rows.length, '| no 3D at all', missing.length, '| some types without 3D', partial.length);
console.log('\nNO 3D:');
missing.forEach(r => console.log('  ' + r.id.padEnd(10) + (r.cat + (r.sub ? ' / ' + r.sub : '')).padEnd(46) + r.name.slice(0, 70) + (r.total ? ' (' + r.total + ' types)' : '')));
console.log('\nPARTIAL:');
partial.forEach(r => console.log('  ' + r.id.padEnd(10) + r.name.slice(0, 60) + '  ' + r.have + '/' + r.total));
