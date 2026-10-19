// Shared helpers for the Revit Families Library sync tool.
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DATA = path.join(REPO, 'data');
const HTML = path.join(REPO, 'index.html');
const STATE_FILE = path.join(__dirname, 'state.json');
const RULES_FILE = path.join(__dirname, 'rules.json');

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}
function writeJson(p, obj, pretty) {
  fs.writeFileSync(p, pretty ? JSON.stringify(obj, null, 1) : JSON.stringify(obj), 'utf8');
}

const rules = readJson(RULES_FILE, null);
if (!rules) throw new Error('sync/rules.json is missing');
const ROOT = String(process.env.SYNC_ROOT || rules.root).replace(/\\/g, '/'); // e.g. X:/Systems/REVIT/Revit Families (SYNC_ROOT is for testing)

function norm(p) { return String(p || '').replace(/\\/g, '/'); }
function relPath(full) {
  const n = norm(full);
  return n.toLowerCase().startsWith(ROOT.toLowerCase() + '/') ? n.slice(ROOT.length + 1) : n;
}
function toWindows(full) { return norm(full).replace(/\//g, '\\'); }

// Every .rfa under the library root, minus Revit backups (Name.0001.rfa) and ignored folders.
function scanDisk() {
  if (!fs.existsSync(ROOT)) throw new Error('Library folder not reachable: ' + ROOT + ' (is the X: drive mapped?)');
  const ignore = (rules.ignore || []).map(s => s.toLowerCase());
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.rfa$/i.test(e.name)) continue;
      if (/\.\d{4}\.rfa$/i.test(e.name)) continue; // Revit backup file
      const full = norm(p);
      const rel = relPath(full).toLowerCase();
      if (ignore.some(s => rel.indexOf(s) >= 0)) continue;
      const st = fs.statSync(p);
      out.push({ full: full, rel: relPath(full), mtime: Math.floor(st.mtimeMs), size: st.size });
    }
  })(ROOT);
  return out;
}

// Families already in the library: the ones baked into index.html plus those sync added to data/families_sync.json.
function libraryFamilies() {
  const h = fs.readFileSync(HTML, 'utf8');
  const STR = '"(?:[^"\\\\]|\\\\.)*"';
  const reJson = new RegExp('"id":"([^"]+)","name":(' + STR + '),"cat":"([^"]*)","sub":(null|' + STR + '),"realPath":(' + STR + '|null)', 'g');
  const reJs = new RegExp('id: "([^"]+)", name: (' + STR + '), cat: "([^"]*)", sub: (null|' + STR + '),\\s*realPath: (' + STR + '|null)', 'g');
  const fams = [];
  for (const re of [reJson, reJs]) {
    let m;
    while ((m = re.exec(h))) {
      fams.push({ id: m[1], name: JSON.parse(m[2]), cat: m[3], sub: m[4] === 'null' ? null : JSON.parse(m[4]), realPath: m[5] === 'null' ? null : JSON.parse(m[5]), source: 'html' });
    }
  }
  // families_sync.json replaces/extends the baked-in list; sync_overrides.json patches path/category of moved ones
  const byId = {};
  fams.forEach(f => { byId[f.id] = f; });
  readJson(path.join(DATA, 'families_sync.json'), []).forEach(f => {
    byId[f.id] = { id: f.id, name: f.name, cat: f.cat, sub: f.sub, realPath: f.realPath, source: 'sync' };
  });
  const overrides = readJson(path.join(DATA, 'sync_overrides.json'), {});
  Object.keys(overrides).forEach(id => { if (byId[id]) Object.assign(byId[id], overrides[id]); });
  return Object.keys(byId).map(id => byId[id]).filter(f => !f.removed);
}

function nextId(fams) {
  let max = 0;
  fams.forEach(f => { const m = /^nf(\d+)$/.exec(f.id); if (m) max = Math.max(max, parseInt(m[1], 10)); });
  return function () { max += 1; return 'nf' + String(max).padStart(3, '0'); };
}

// Work out category / sub-category for a file from its folder, using rules.json.
// Top folder = category; "<Brand> Spec Families/<Level>" = "Brand - Level"; Doors/Windows are flat.
// Returns { cat, sub, note } or null when the file sits directly in the root.
function classify(rel) {
  const dirs = rel.split('/').slice(0, -1);
  if (!dirs.length) return null;
  let cat = dirs[0];
  if ((rules.catAliases || {})[cat]) cat = rules.catAliases[cat];
  let sub = null, note = null;
  if (!(rules.flatCategories || []).includes(cat) && dirs.length >= 2) {
    const seg = dirs[1];
    const brand = (rules.brandFolders || []).find(b => new RegExp(b.match, 'i').test(seg));
    const fixed = (rules.subFolders || {})[dirs[0] + '/' + seg];
    if (brand) sub = dirs[2] ? brand.brand + ' - ' + dirs[2] : brand.brand;
    else if (fixed) sub = fixed;
    else note = 'sub-folder "' + seg + '" has no rule, filed under ' + cat + ' only';
  }
  return { cat: cat, sub: sub, note: note };
}

function displayName(file) {
  return path.basename(file).replace(/\.rfa$/i, '');
}

module.exports = { REPO, DATA, HTML, STATE_FILE, RULES_FILE, ROOT, readJson, writeJson, rules, norm, relPath, toWindows, scanDisk, libraryFamilies, nextId, classify, displayName };
