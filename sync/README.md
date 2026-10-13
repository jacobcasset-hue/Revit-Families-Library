# Library sync

Keeps the Revit Families Library in step with `X:\Systems\REVIT\Revit Families`.

```
node sync/sync.js scan        what is new / changed / moved / missing (no Revit needed)
node sync/sync.js run         scan -> read from Revit -> write data -> push to GitHub
node sync/sync.js baseline    mark everything as already synced
```

- **Revit must be open** (a project is not needed) and pyRevit running for `run`/`extract`; the tool talks to the same route the MCP server uses (`http://127.0.0.1:48884/revit_mcp/execute_code/`).
- Category / sub-category come from the folder: top folder = category, `<Brand> Spec Families\<Level>` = "Brand - Level", Doors / Windows are flat. Edit `rules.json` to change this or to ignore folders (`ignore`).
- Results go to `data/families_sync.json`, `mesh_type_sync.json`, `family_images_type_sync.json`, `photos_sync.json`, `sync_overrides.json`. `index.html` loads them at start-up, so it never needs re-editing.
- Product photos: matched automatically from `X:\Standard Inclusions\Specification Images` by model code; otherwise drop `photos/<id>.jpg` (or `photos/<family file name>.jpg`).
- `state.json` remembers what was synced (file time/size). `last_report.md` is the last run's report. `work/` is scratch.
- Publishing the data to the Claude artifact is a Claude step - say "sync the library" (skill `sync-revit-library`).
- `patch_html.js` is the one-time patch that taught `index.html` to load the shards.

## Automatic weekly run

Windows Task Scheduler task "Revit Families Library - weekly check" runs `weekly_check.ps1` every Monday at 8:00 (or when the PC next starts). It scans; if Revit is reachable it also runs the sync (extract, merge, push to GitHub); if more than 25 files are pending, or Revit is not reachable, it only shows a Windows notification. When it adds anything it creates `needs_publish.flag`: tell Claude "publish the library sync" to put the new data on the claude.ai page (the one step that cannot be automated, because pages cannot fetch from GitHub).
