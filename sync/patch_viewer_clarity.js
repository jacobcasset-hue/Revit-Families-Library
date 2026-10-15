// Clearer 3D viewer: darker, crisper edges, firmer face shading, polygon offset so edges do not break up, fuller framing.
const fs = require('fs');
const L = require('./lib');
let h = fs.readFileSync(L.HTML, 'utf8');
const crlf = h.includes('\r\n');
if (crlf) h = h.split('\r\n').join('\n');
function swap(a, b) { if (!h.includes(a)) throw new Error('anchor not found: ' + a.slice(0, 70)); h = h.replace(a, () => b); }

swap('var material = new THREE.MeshPhongMaterial({ color: 0xe9e9e6, specular: 0x0a0a0a, shininess: 1, side: THREE.DoubleSide, flatShading: false });',
     'var material = new THREE.MeshPhongMaterial({ color: 0xdadcde, specular: 0x0a0a0a, shininess: 1, side: THREE.DoubleSide, flatShading: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });');
swap('new THREE.EdgesGeometry(geometry, 35), new THREE.LineBasicMaterial({ color: 0x53565b, transparent: true, opacity: 0.5 })',
     'new THREE.EdgesGeometry(geometry, 28), new THREE.LineBasicMaterial({ color: 0x1f2328, transparent: true, opacity: 0.85 })');
swap('scene.add(new THREE.AmbientLight(0xffffff, 0.62));', 'scene.add(new THREE.AmbientLight(0xffffff, 0.5));');
swap('var sun = new THREE.DirectionalLight(0xffffff, 0.75);', 'var sun = new THREE.DirectionalLight(0xffffff, 0.9);');
swap('var fill = new THREE.DirectionalLight(0xffffff, 0.32);', 'var fill = new THREE.DirectionalLight(0xffffff, 0.3);');
swap('var distance = radius * 2.6;', 'var distance = radius * 3.0;');

fs.writeFileSync(L.HTML, crlf ? h.split('\n').join('\r\n') : h, 'utf8');
console.log('viewer patched');
