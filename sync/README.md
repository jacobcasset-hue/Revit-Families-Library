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
- `data/family_dates.json` is rewritten on every merge (`node sync/sync.js dates` rebuilds it without Revit): the page shows "New" for two weeks after a family is first added (`added`, stamped at merge) and "Updated" for two weeks after its file is re-saved (`updated`, the `.rfa` time from `state.json`), plus the "What's new" list on the home screen.
- Product photos: matched automatically from `X:\Standard Inclusions\Specification Images` by model code; otherwise drop `photos/<id>.jpg` (or `photos/<family file name>.jpg`).
- `state.json` remembers what was synced (file time/size). `last_report.md` is the last run's report. `work/` is scratch.
- Publishing the data to the Claude artifact is a Claude step - say "sync the library" (skill `sync-revit-library`).

## Automatic weekly run

Windows Task Scheduler task "Revit Families Library - weekly check" runs `weekly_check.ps1` every Monday at 8:00 (or when the PC next starts). It scans; if Revit is reachable it also runs the sync (extract, merge, push to GitHub); if more than 25 files are pending, or Revit is not reachable, it only shows a Windows notification. When it adds anything it creates `needs_publish.flag`: tell Claude "publish the library sync" to put the new data on the claude.ai page (the one step that cannot be automated, because pages cannot fetch from GitHub).

## SharePoint copy

`rules.json` > `sharepointSyncRoot` is the OneDrive-synced copy of the SharePoint `GH Revit Families Library`. After each sync, new families are copied into it (same sub-folders as X:) and OneDrive uploads them; changed families overwrite the SharePoint copy only when the X: file is newer; nothing is deleted. The Microsoft 365 connector is read-only, so this is the only way Claude can put files into SharePoint.

## Revit pairing (newer extension versions)

The pyRevit extension now rejects requests that are not paired and reviewed in Revit (HTTP 401, "Bridge is disconnected or pairing is invalid"). This tool cannot pair, so `run` and the Monday automatic sync only work when the old unauthenticated route is available. Otherwise: in Revit choose **MCP > Bridge > Connect**, run `node sync/sync.js extract --prepare`, run the generated `sync/work/extract_code.py` through the paired MCP connection (Claude does this), then `node sync/sync.js merge` and `push`.
