// One-time patch: teach index.html to load the sync shards (data/*_sync.json). Safe to run twice.
const fs = require('fs');
const L = require('./lib');
let h = fs.readFileSync(L.HTML, 'utf8');
const crlf = h.includes('\r\n'); // git on Windows may have checked the file out with CRLF line endings
if (crlf) h = h.split('\r\n').join('\n');
if (h.includes('applySyncData')) { console.log('index.html already patched'); process.exit(0); }
function must(a) { if (!h.includes(a)) throw new Error('anchor not found: ' + a.slice(0, 60)); }

// 1. optional loader (a missing shard must never break the page)
const loaderAnchor = '  Promise.all([\n    loadJson("data/mesh_data.json"),';
must(loaderAnchor);
h = h.replace(loaderAnchor, () =>
  '  function loadJsonOpt(url, fallback) {\n' +
  '    return loadJson(url).catch(function () { return fallback; });\n' +
  '  }\n' + loaderAnchor);

// 2. fetch the shards alongside the others (results[12..16])
const lastLoad = '    loadJson("data/family_images.json"),\n  ]).then(function (results) {';
must(lastLoad);
h = h.replace(lastLoad, () =>
  '    loadJson("data/family_images.json"),\n' +
  '    loadJsonOpt("data/families_sync.json", []),\n' +
  '    loadJsonOpt("data/mesh_type_sync.json", {}),\n' +
  '    loadJsonOpt("data/family_images_type_sync.json", {}),\n' +
  '    loadJsonOpt("data/photos_sync.json", {}),\n' +
  '    loadJsonOpt("data/sync_overrides.json", {}),\n' +
  '  ]).then(function (results) {');

// 3. the merge function, defined just before the loader
const fn = `
  // Families added/updated by the sync tool (sync/sync.js) arrive as data shards, so the page never needs re-editing.
  function applySyncData(fams, meshT, imgT, photos, overrides) {
    (fams || []).forEach(function (f) {
      var at = -1;
      for (var i = 0; i < FAMILIES.length; i++) { if (FAMILIES[i].id === f.id) { at = i; break; } }
      if (at >= 0) FAMILIES[at] = f; else FAMILIES.push(f);
      var imgs = (imgT && imgT[f.id]) || [];
      var first = imgs.filter(function (x) { return x; })[0];
      FAMILY_IMAGES[f.id] = FAMILY_IMAGES[f.id] || {};
      if (first) FAMILY_IMAGES[f.id].plan = first;
    });
    Object.assign(MESH_DATA_TYPE, meshT || {});
    Object.assign(FAMILY_IMAGES_TYPE, imgT || {});
    Object.keys(photos || {}).forEach(function (id) {
      FAMILY_IMAGES[id] = FAMILY_IMAGES[id] || {};
      FAMILY_IMAGES[id].photo = photos[id];
    });
    Object.keys(overrides || {}).forEach(function (id) {
      FAMILIES.forEach(function (f) { if (f.id === id) Object.assign(f, overrides[id]); });
    });
    // make sure every category / sub-category in use has a place in the navigation
    FAMILIES.forEach(function (f) {
      var entry = STRUCTURE.filter(function (e) { return e[0] === f.cat; })[0];
      if (!entry) {
        entry = [f.cat, []];
        STRUCTURE.push(entry);
        STRUCTURE.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
      }
      if (f.sub && entry[1].indexOf(f.sub) === -1) entry[1].push(f.sub);
    });
  }
`;
must('  function loadJson(url) {');
h = h.replace('  function loadJson(url) {', () => fn + '\n  function loadJson(url) {');

// 4. call it just before the first render
const callAnchor = '    renderAll();\n  }).catch(function (err) {\n    console.error("Failed to load family media data:", err);';
must(callAnchor);
h = h.replace(callAnchor, () => '    applySyncData(results[12], results[13], results[14], results[15], results[16]);\n' + callAnchor);

fs.writeFileSync(L.HTML, crlf ? h.split('\n').join('\r\n') : h, 'utf8');
console.log('index.html patched');
