#!/usr/bin/env node
// Revit Families Library - sync tool.
//
//   node sync/sync.js scan                 what is new / changed / moved / missing on the X: drive (no Revit needed)
//   node sync/sync.js extract              read the new + changed families out of Revit (Revit must be open)
//   node sync/sync.js merge                write the results into data/*_sync.json and update sync/state.json
//   node sync/sync.js push                 commit + push the data to GitHub
//   node sync/sync.js run [--no-push] [--no-changed]   scan -> extract -> merge -> push in one go
//   node sync/sync.js baseline             accept every file as already synced (clears the "changed" list)
//
// The page itself (index.html) never needs editing: it loads the *_sync.json shards at start-up.
// Publishing the updated shards to the Claude artifact is done by Claude (see sync/README.md).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./lib');

const WORK = path.join(__dirname, 'work');
const EXPORT = path.join(WORK, 'export');
const PENDING = path.join(WORK, 'pending.json');
const RUN = path.join(WORK, 'run.json');
const SUMMARY = path.join(WORK, 'summary.json');
const REPORT = path.join(__dirname, 'last_report.md');
const SHARDS = {
  families: path.join(L.DATA, 'families_sync.json'),
  mesh: path.join(L.DATA, 'mesh_type_sync.json'),
  images: path.join(L.DATA, 'family_images_type_sync.json'),
  photos: path.join(L.DATA, 'photos_sync.json'),
  overrides: path.join(L.DATA, 'sync_overrides.json'),
};
const args = process.argv.slice(3);
const flag = n => args.includes('--' + n);

function mkdirp(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }
function log() { console.log.apply(console, arguments); }

// ---------------------------------------------------------------- state
function loadState() {
  let st = L.readJson(L.STATE_FILE, null);
  if (st) return st;
  // First run: treat every library family whose file exists as already synced.
  // Entries built before 2026-10-12 were read out of Revit on or before the dates below.
  st = { version: 1, files: {} };
  const disk = {};
  L.scanDisk().forEach(f => { disk[f.full.toLowerCase()] = f; });
  L.libraryFamilies().forEach(f => {
    if (!f.realPath) return;
    const d = disk[L.norm(f.realPath).toLowerCase()];
    if (!d) return;
    const syncedAt = /^nf\d+$/.test(f.id) ? Date.parse('2026-10-12T00:00:00+10:00') : Date.parse('2026-09-14T23:59:59+10:00');
    st.files[d.rel.toLowerCase()] = { id: f.id, mtime: d.mtime, size: d.size, syncedAt: syncedAt };
  });
  L.writeJson(L.STATE_FILE, st, true);
  log('(first run: baseline state created for ' + Object.keys(st.files).length + ' families)');
  return st;
}

// ---------------------------------------------------------------- scan
function scan() {
  const st = loadState();
  const disk = L.scanDisk();
  const fams = L.libraryFamilies();
  const byId = {};
  fams.forEach(f => { byId[f.id] = f; });
  const diskByKey = {};
  disk.forEach(f => { diskByKey[f.rel.toLowerCase()] = f; });

  const knownKeys = new Set(Object.keys(st.files));
  const libPaths = new Set(fams.filter(f => f.realPath).map(f => L.relPath(f.realPath).toLowerCase()));
  const result = { scannedAt: new Date().toISOString(), diskCount: disk.length, libraryCount: fams.length, new: [], changed: [], moved: [], missing: [], unclassified: [] };

  // library entries whose file is gone
  const missing = fams.filter(f => f.realPath && !diskByKey[L.relPath(f.realPath).toLowerCase()]);
  const missingByBase = {};
  missing.forEach(f => { (missingByBase[path.basename(L.norm(f.realPath)).toLowerCase()] = missingByBase[path.basename(L.norm(f.realPath)).toLowerCase()] || []).push(f); });

  const movedIds = new Set();
  disk.forEach(f => {
    const key = f.rel.toLowerCase();
    if (knownKeys.has(key) || libPaths.has(key)) return;
    const base = path.basename(f.full).toLowerCase();
    const cands = (missingByBase[base] || []).filter(m => !movedIds.has(m.id));
    const c = L.classify(f.rel);
    if (cands.length === 1) {
      movedIds.add(cands[0].id);
      result.moved.push({ id: cands[0].id, name: cands[0].name, from: L.relPath(cands[0].realPath), rel: f.rel, full: f.full, cat: c.cat, sub: c.sub });
      return;
    }
    if (!c) { result.unclassified.push(f.rel); return; }
    result.new.push({ rel: f.rel, full: f.full, name: L.displayName(f.full), cat: c.cat, sub: c.sub, note: c.note, mtime: f.mtime, size: f.size });
  });
  result.missing = missing.filter(m => !movedIds.has(m.id)).map(m => ({ id: m.id, name: m.name, was: m.realPath }));

  Object.keys(st.files).forEach(key => {
    const d = diskByKey[key];
    const e = st.files[key];
    if (!d) return;
    if (d.mtime > e.syncedAt + 60000 && (d.mtime !== e.mtime || d.size !== e.size)) {
      const f = byId[e.id];
      result.changed.push({ id: e.id, name: f ? f.name : e.id, rel: d.rel, full: d.full, cat: f ? f.cat : null, sub: f ? f.sub : null, modified: new Date(d.mtime).toISOString().slice(0, 10) });
    }
  });

  mkdirp(WORK);
  L.writeJson(PENDING, result, true);
  printScan(result);
  return result;
}

function printScan(r) {
  log('Library folder: ' + L.ROOT);
  log(r.diskCount + ' family files on disk, ' + r.libraryCount + ' families in the library');
  log('');
  log('NEW (' + r.new.length + ')');
  r.new.forEach(f => log('  + ' + f.rel + '   -> ' + f.cat + (f.sub ? ' / ' + f.sub : '') + (f.note ? '   [' + f.note + ']' : '')));
  log('CHANGED since last sync (' + r.changed.length + ')');
  r.changed.forEach(f => log('  ~ ' + f.rel + '   (saved ' + f.modified + ')'));
  log('MOVED / RENAMED folder (' + r.moved.length + ')');
  r.moved.forEach(f => log('  > ' + f.from + '  ->  ' + f.rel));
  log('MISSING - in the library but no file on disk (' + r.missing.length + ')');
  r.missing.forEach(f => log('  - ' + f.id + ' ' + f.name));
  if (r.unclassified.length) {
    log('NOT CLASSIFIED - file sits directly in the library root (' + r.unclassified.length + ')');
    r.unclassified.forEach(f => log('  ? ' + f));
  }
  log('');
  log(r.new.length || r.changed.length || r.moved.length ? 'Pending work: ' + r.new.length + ' new, ' + r.changed.length + ' changed, ' + r.moved.length + ' moved.' : 'Library is up to date.');
}

// ---------------------------------------------------------------- Revit
// /status/ answers 503 when Revit sits at the Home screen with no project open, but code can still run
// (families are opened in the background), so probe with a trivial script instead.
async function revitStatus() {
  const base = L.rules.revitUrl;
  try {
    const r = await fetch(base + '/execute_code/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'print(1)', description: 'Library sync: connection check' }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.status !== 'success') return null;
    return { revit_available: true, document_title: 'no project name available' };
  } catch (e) {
    return null;
  }
}

async function revitExec(code, description) {
  const r = await fetch(L.rules.revitUrl + '/execute_code/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: code, description: description }),
    signal: AbortSignal.timeout(20 * 60 * 1000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === 'error') throw new Error('Revit returned ' + r.status + ': ' + JSON.stringify(j).slice(0, 600));
  return j;
}

async function extract(pending) {
  pending = pending || L.readJson(PENDING, null);
  if (!pending) throw new Error('Nothing scanned yet - run "scan" first');
  const includeChanged = !flag('no-changed');
  const fams = L.libraryFamilies();
  const nextId = L.nextId(fams);
  const jobs = [];
  pending.new.forEach(f => jobs.push({ kind: 'new', id: nextId(), name: f.name, cat: f.cat, sub: f.sub, rel: f.rel, realPath: L.toWindows(f.full) }));
  if (includeChanged) pending.changed.forEach(f => jobs.push({ kind: 'changed', id: f.id, name: f.name, cat: f.cat, sub: f.sub, rel: f.rel, realPath: L.toWindows(f.full) }));
  const moves = pending.moved || [];
  if (!jobs.length && !moves.length) { log('Nothing to extract.'); L.writeJson(RUN, { jobs: [], moves: [] }, true); return { jobs: [], moves: [] }; }

  if (jobs.length) {
    const status = await revitStatus();
    if (!status || status.revit_available === false) {
      throw new Error('Cannot reach Revit on ' + L.rules.revitUrl + '. Open Revit (pyRevit must be running) and try again. ' +
        'If it still fails, check Task Manager for a second Revit.exe fighting over port 48884.');
    }
    log('Revit connected. Extracting ' + jobs.length + ' families...');
  }
  mkdirp(EXPORT);
  jobs.forEach(j => { const f = path.join(EXPORT, j.id + '.json'); if (fs.existsSync(f)) fs.unlinkSync(f); });
  const manifestPath = path.join(WORK, 'manifest.json');
  L.writeJson(manifestPath, jobs.map(j => ({ id: j.id, name: j.name, cat: j.cat, sub: j.sub, realPath: j.realPath })), true);
  const template = fs.readFileSync(path.join(__dirname, 'revit_extract.py'), 'utf8');
  const BATCH = 2;
  let failures = 0;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const end = Math.min(i + BATCH, jobs.length);
    const code = template.split('__MANIFEST__').join(manifestPath).split('__OUTDIR__').join(EXPORT)
      .split('__START__').join(String(i)).split('__END__').join(String(end)).split('__VERTCAP__').join(String(process.env.SYNC_VERTCAP || L.rules.meshVertCap || 5000));
    process.stdout.write('  ' + (i + 1) + '-' + end + ' of ' + jobs.length + ' ... ');
    try {
      await revitExec(code, 'Library sync: extract families ' + (i + 1) + '-' + end);
    } catch (e) {
      log('request failed: ' + e.message);
    }
    const bad = [];
    for (let k = i; k < end; k++) {
      const out = L.readJson(path.join(EXPORT, jobs[k].id + '.json'), null);
      if (!out || !out.ok) bad.push(jobs[k].name + (out && out.error ? ' (' + String(out.error).split('|')[0].trim() + ')' : ' (no result)'));
    }
    failures += bad.length;
    log(bad.length ? 'FAILED: ' + bad.join('; ') : 'ok');
  }
  L.writeJson(RUN, { jobs: jobs, moves: moves, extractedAt: new Date().toISOString() }, true);
  log('Extraction finished: ' + (jobs.length - failures) + ' ok, ' + failures + ' failed.');
  return { jobs: jobs, moves: moves };
}

// ---------------------------------------------------------------- product photos
function walkImages(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jpe?g|png|webp)$/i.test(e.name) && !/^in situ_/i.test(e.name)) out.push(L.norm(p));
    }
  })(root);
  return out;
}
function codeOf(file) {
  let s = path.basename(file).replace(/\.[a-z]+$/i, '').replace(/_CC\d*$/i, '');
  const parts = s.split('_');
  return parts[parts.length - 1].trim().toLowerCase();
}
function toDataUri(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.webp') return null; // GDI+ cannot read webp
  const tmp = path.join(WORK, 'photo_' + Date.now() + '.jpg');
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'resize_photo.ps1'), '-InFile', file, '-OutFile', tmp, '-MaxDim', '600', '-Quality', '75'], { stdio: 'pipe' });
    const b = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    return 'data:image/jpeg;base64,' + b.toString('base64');
  } catch (e) {
    return null;
  }
}
function trimImage(file) {
  const out = path.join(WORK, 'trim_' + path.basename(file).replace(/[^A-Za-z0-9_.]/g, '_'));
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'trim_image.ps1'), '-InFile', file, '-OutFile', out], { stdio: 'pipe' });
    return fs.existsSync(out) ? out : null;
  } catch (e) {
    return null;
  }
}
function findPhoto(fam, specFiles) {
  // 1. a picture dropped into sync/photos/<id>.(jpg|png) or named after the family file
  const dir = path.join(__dirname, 'photos');
  for (const stem of [fam.id, fam.name]) {
    for (const ext of ['.jpg', '.jpeg', '.png']) {
      const p = path.join(dir, stem + ext);
      if (fs.existsSync(p)) return { file: p, how: 'sync/photos' };
    }
  }
  // 2. a Specification Images file whose model code appears in the family's own model / description fields
  const texts = [fam.name, path.basename(L.norm(fam.realPath || ''))];
  fam.types.forEach(t => texts.push(t.name));
  fam.types.forEach(t => t.params.forEach(p => { if (/^(Model|Description|Type Mark|Type Comments)$/.test(p[0]) && p[1]) texts.push(p[1]); }));
  const text = texts.join(' | ').toLowerCase();
  // a code such as 154-7300-00.01 also matches as 154-7300-00 (family type names omit the colour suffix)
  const hit = specFiles.find(s => [s.code, s.code.replace(/\.\d+$/, '')].some(c => c.length >= 5 && /[0-9]/.test(c) && text.indexOf(c) >= 0));
  return hit ? { file: hit.file, how: 'Specification Images' } : null;
}

// ---------------------------------------------------------------- merge
function merge() {
  const run = L.readJson(RUN, null);
  if (!run) throw new Error('No extraction run found - run "extract" first');
  mkdirp(L.DATA);
  const fam = L.readJson(SHARDS.families, []);
  const mesh = L.readJson(SHARDS.mesh, {});
  const imgs = L.readJson(SHARDS.images, {});
  const photos = L.readJson(SHARDS.photos, {});
  const overrides = L.readJson(SHARDS.overrides, {});
  const st = loadState();
  const now = Date.now();
  const rep = { added: [], updated: [], moved: [], failed: [], noPhoto: [], photoFrom: [] };
  const specFiles = walkImages(L.rules.specImagesRoot).map(f => ({ file: f, code: codeOf(f) }));
  const changedShards = new Set();

  for (const j of run.jobs) {
    const d = L.readJson(path.join(EXPORT, j.id + '.json'), null);
    if (!d || !d.ok) { rep.failed.push(j.name + (d && d.error ? ' - ' + String(d.error).split('|')[0].trim() : '')); continue; }
    if (!d.types || !d.types.length) { rep.failed.push(j.name + ' - no types'); continue; }
    const entry = { id: d.id, name: d.name, cat: d.cat, sub: d.sub, realPath: d.realPath, dims: d.dims, instanceParams: d.instanceParams, types: d.types.map(t => ({ name: t.name, params: t.params })) };
    const at = fam.findIndex(x => x.id === entry.id);
    if (at >= 0) fam[at] = entry; else fam.push(entry);
    mesh[d.id] = d.types.map(t => t.mesh || null);
    imgs[d.id] = d.types.map((t, idx) => {
      let file = t.planFile;
      if (!file) {
        const prefix = d.id + '_t' + idx + ' ';
        file = fs.readdirSync(EXPORT).find(fn => fn.indexOf(prefix) === 0 && /\.(png|jpe?g)$/i.test(fn)) || null;
      }
      if (!file || !fs.existsSync(path.join(EXPORT, file))) return null;
      let full = path.join(EXPORT, file);
      if (d.sheetView) full = trimImage(full) || full; // annotation sheet: cut the empty paper away and enlarge the symbol
      return 'data:' + (/\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/png') + ';base64,' + fs.readFileSync(full).toString('base64');
    });
    if (j.kind === 'new') {
      const hit = findPhoto(entry, specFiles);
      const uri = hit ? toDataUri(hit.file) : null;
      if (uri) { photos[entry.id] = uri; rep.photoFrom.push(entry.name + '  <-  ' + hit.how); }
      else rep.noPhoto.push(entry.name + (hit ? ' (found ' + path.basename(hit.file) + ' but could not convert it)' : ''));
    }
    (j.kind === 'new' ? rep.added : rep.updated).push(entry.cat + (entry.sub ? ' / ' + entry.sub : '') + ' : ' + entry.name + ' (' + entry.types.length + ' types)');
    const fst = fs.statSync(L.norm(j.realPath));
    st.files[j.rel.toLowerCase()] = { id: entry.id, mtime: Math.floor(fst.mtimeMs), size: fst.size, syncedAt: now };
    ['families', 'mesh', 'images', 'photos'].forEach(k => changedShards.add(k));
  }

  for (const m of run.moves) {
    const target = fam.find(x => x.id === m.id);
    const upd = { realPath: L.toWindows(m.full), cat: m.cat, sub: m.sub };
    if (target) Object.assign(target, upd); else overrides[m.id] = upd;
    delete st.files[m.from.toLowerCase()];
    const s = fs.statSync(m.full);
    st.files[m.rel.toLowerCase()] = { id: m.id, mtime: Math.floor(s.mtimeMs), size: s.size, syncedAt: now };
    rep.moved.push(m.name + ': ' + m.from + ' -> ' + m.rel);
    changedShards.add(target ? 'families' : 'overrides');
  }

  L.writeJson(SHARDS.families, fam);
  L.writeJson(SHARDS.mesh, mesh);
  L.writeJson(SHARDS.images, imgs);
  L.writeJson(SHARDS.photos, photos);
  L.writeJson(SHARDS.overrides, overrides);
  st.lastSync = new Date(now).toISOString();
  L.writeJson(L.STATE_FILE, st, true);

  const summary = {
    syncedAt: st.lastSync,
    changedDataFiles: ['families_sync.json', 'mesh_type_sync.json', 'family_images_type_sync.json', 'photos_sync.json', 'sync_overrides.json'].map(f => 'data/' + f),
    added: rep.added.length, updated: rep.updated.length, moved: rep.moved.length, failed: rep.failed.length,
  };
  mkdirp(WORK);
  L.writeJson(SUMMARY, summary, true);
  writeReport(rep);
  return rep;
}

function writeReport(rep) {
  const lines = ['# Library sync report', '', 'Run: ' + new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC', ''];
  const sec = (title, arr) => { lines.push('## ' + title + ' (' + arr.length + ')'); arr.forEach(a => lines.push('- ' + a)); lines.push(''); };
  sec('Added', rep.added);
  sec('Updated (file changed)', rep.updated);
  sec('Moved / renamed folder', rep.moved);
  sec('Failed to extract', rep.failed);
  sec('Product photo found automatically', rep.photoFrom);
  sec('No product photo (card shows the plan view) - drop a picture in sync/photos/<id>.jpg to fix', rep.noPhoto);
  fs.writeFileSync(REPORT, lines.join('\n'), 'utf8');
  log(lines.join('\n'));
}

// ---------------------------------------------------------------- git
function git() { return execFileSync('git', Array.from(arguments), { cwd: L.REPO, encoding: 'utf8' }).trim(); }
function push() {
  const sum = L.readJson(SUMMARY, null);
  try { git('pull', '--rebase', '--autostash', 'origin', 'main'); } catch (e) { log('(pull skipped: ' + String(e.message).split('\n')[0] + ')'); }
  git('add', 'data', 'sync');
  const status = git('status', '--porcelain');
  if (!status) { log('Nothing to commit.'); return false; }
  const msg = sum ? 'Library sync: ' + sum.added + ' new, ' + sum.updated + ' updated, ' + sum.moved + ' moved' : 'Library sync';
  git('commit', '-m', msg + '\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>');
  git('push', 'origin', 'main');
  log('Pushed to GitHub: ' + msg);
  return true;
}

function baseline() {
  const st = loadState();
  const now = Date.now();
  const disk = {};
  L.scanDisk().forEach(f => { disk[f.rel.toLowerCase()] = f; });
  Object.keys(st.files).forEach(k => { const d = disk[k]; if (d) { st.files[k].mtime = d.mtime; st.files[k].size = d.size; st.files[k].syncedAt = now; } });
  L.writeJson(L.STATE_FILE, st, true);
  log('All ' + Object.keys(st.files).length + ' known families marked as up to date.');
}

// ---------------------------------------------------------------- main
(async function () {
  const cmd = process.argv[2];
  try {
    if (cmd === 'scan') scan();
    else if (cmd === 'extract') { if (!fs.existsSync(PENDING)) scan(); await extract(); }
    else if (cmd === 'merge') merge();
    else if (cmd === 'reextract') {
      // node sync/sync.js reextract nf112 nf113   -> read those families out of Revit again (keeps names / photos)
      const ids = process.argv.slice(3).filter(a => !a.startsWith('--'));
      if (!ids.length) throw new Error('give one or more family ids, e.g. reextract nf112 nf113');
      const byId = {};
      L.libraryFamilies().forEach(f => { byId[f.id] = f; });
      const changed = ids.map(id => {
        const f = byId[id];
        if (!f || !f.realPath) throw new Error('unknown family or no file path: ' + id);
        return { id: id, name: f.name, cat: f.cat, sub: f.sub, rel: L.relPath(f.realPath), full: L.norm(f.realPath) };
      });
      await extract({ new: [], changed: changed, moved: [] });
      merge();
      if (!flag('no-push')) push();
    }
    else if (cmd === 'push') push();
    else if (cmd === 'baseline') baseline();
    else if (cmd === 'run') {
      const p = scan();
      if (!p.new.length && !p.changed.length && !p.moved.length) return;
      await extract(p);
      merge();
      if (!flag('no-push')) push();
      log('\nNext: publish the updated data files to the artifact (ask Claude: "publish the library sync").');
    } else {
      log('Usage: node sync/sync.js scan | extract | merge | push | run [--no-push] [--no-changed] | baseline');
      process.exitCode = 1;
    }
  } catch (e) {
    console.error('ERROR: ' + e.message);
    process.exitCode = 1;
  }
})();
