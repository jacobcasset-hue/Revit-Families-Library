# Runs INSIDE Revit (IronPython) via the pyRevit Routes execute_code endpoint.
# sync.js fills in the __MANIFEST__ / __OUTDIR__ / __START__ / __END__ placeholders before sending it.
import io
import json
import os
import traceback
from System.Collections.Generic import List as NetList

MANIFEST_PATH = r"__MANIFEST__"
OUT_DIR = r"__OUTDIR__"
LOG_PATH = os.path.join(OUT_DIR, "_progress.log")

if not os.path.exists(OUT_DIR):
    os.makedirs(OUT_DIR)

START = __START__
END = __END__

MESH_VERT_CAP = __VERTCAP__
FT_TO_MM = 304.8

app = __revit__.Application


def log(msg):
    with open(LOG_PATH, "a") as f:
        f.write(msg + "\n")


def safe_u(v):
    if v is None:
        return u""
    if isinstance(v, unicode):
        s = v
    elif isinstance(v, str):
        try:
            s = v.decode('utf-8')
        except Exception:
            s = v.decode('latin-1')
    else:
        s = unicode(v)
    s = s.replace(u'\u00b0', u'deg').replace(u'\u00ae', u'(R)').replace(u'\u2019', u"'")
    out = []
    for ch in s:
        if ord(ch) < 128:
            out.append(ch)
        else:
            out.append('?')
    return u''.join(out)


def param_value_str(p):
    try:
        st = p.StorageType
        if st == DB.StorageType.Double:
            try:
                disp = p.AsValueString()
                if disp is not None:
                    return safe_u(disp)
            except Exception:
                pass
            return safe_u(round(p.AsDouble(), 3))
        elif st == DB.StorageType.Integer:
            try:
                disp = p.AsValueString()
                if disp is not None:
                    return safe_u(disp)
            except Exception:
                pass
            return safe_u(p.AsInteger())
        elif st == DB.StorageType.String:
            return safe_u(p.AsString())
        elif st == DB.StorageType.ElementId:
            try:
                disp = p.AsValueString()
                return safe_u(disp) if disp is not None else u""
            except Exception:
                return u""
        else:
            return u""
    except Exception:
        return u""


def collect_solids(document):
    opt = DB.Options()
    opt.ComputeReferences = False
    opt.IncludeNonVisibleObjects = False
    opt.DetailLevel = DB.ViewDetailLevel.Fine
    solids = []

    def walk(geo_elem):
        for obj in geo_elem:
            try:
                if isinstance(obj, DB.Solid):
                    if obj.Faces.Size > 0 and obj.Volume > 1e-6:
                        solids.append(obj)
                elif isinstance(obj, DB.GeometryInstance):
                    inst_geo = obj.GetInstanceGeometry()
                    if inst_geo is not None:
                        walk(inst_geo)
            except Exception:
                continue

    collector = DB.FilteredElementCollector(document).WhereElementIsNotElementType()
    for el in collector:
        try:
            geo = el.get_Geometry(opt)
        except Exception:
            geo = None
        if geo is None:
            continue
        walk(geo)
    return solids


def build_mesh(document):
    solids = collect_solids(document)
    v = []
    i_arr = []
    counter = 0
    for solid in solids:
        for face in solid.Faces:
            try:
                mesh = face.Triangulate(0.0)
            except Exception:
                continue
            if mesh is None:
                continue
            for t_idx in range(mesh.NumTriangles):
                tri = mesh.get_Triangle(t_idx)
                for corner in range(3):
                    pt = tri.get_Vertex(corner)
                    v.append(int(round(pt.X * FT_TO_MM)))
                    v.append(int(round(pt.Y * FT_TO_MM)))
                    v.append(int(round(pt.Z * FT_TO_MM)))
                    i_arr.append(counter)
                    counter += 1
    vert_count = counter
    if vert_count == 0:
        return None, 0
    return {"v": v, "i": i_arr}, vert_count


def find_floor_plan_view(document):
    views = DB.FilteredElementCollector(document).OfClass(DB.View).ToElements()
    candidates = [vv for vv in views if not vv.IsTemplate and vv.ViewType == DB.ViewType.FloorPlan]
    if not candidates:
        return None
    for vv in candidates:
        if 'ref' in vv.Name.lower() or 'level' in vv.Name.lower():
            return vv
    return candidates[0]


def find_sheet_view(document):
    for vv in DB.FilteredElementCollector(document).OfClass(DB.View).ToElements():
        try:
            if vv.ViewType == DB.ViewType.DrawingSheet:
                return vv
        except Exception:
            continue
    return None


def hide_dimensions(document, view, extra=False):
    cats = [DB.BuiltInCategory.OST_Dimensions]
    if extra:
        cats += [DB.BuiltInCategory.OST_CLines, DB.BuiltInCategory.OST_ReferenceLines]
    for bic in cats:
        try:
            cat = DB.Category.GetCategory(document, bic)
            if cat is not None and view.CanCategoryBeHidden(cat.Id):
                view.SetCategoryHidden(cat.Id, True)
        except Exception:
            pass


def export_plan_png(document, view, out_prefix, pixel_size=700, sheet=False):
    opts = DB.ImageExportOptions()
    opts.ExportRange = DB.ExportRange.SetOfViews
    opts.SetViewsAndSheets(NetList[DB.ElementId]([view.Id]))
    opts.FilePath = os.path.join(OUT_DIR, out_prefix)
    opts.HLRandWFViewsFileType = DB.ImageFileType.PNG
    opts.ZoomType = DB.ZoomFitType.FitToPage
    opts.PixelSize = pixel_size
    opts.ImageResolution = DB.ImageResolution.DPI_150
    opts.ShouldCreateWebSite = False
    document.ExportImage(opts)
    expected = out_prefix + " - Floor Plan - " + view.Name.replace('.', '-') + ".png"
    full = os.path.join(OUT_DIR, expected)
    if os.path.exists(full):
        return expected
    base = os.path.basename(out_prefix)
    for fn in os.listdir(OUT_DIR):
        if fn.startswith(base + " ") and fn.lower().endswith('.png'):
            return fn
    return None


def detect_dims(fm):
    names = set()
    for p in fm.Parameters:
        try:
            names.add(p.Definition.Name)
        except Exception:
            continue
    if "Width" in names and "Height" in names:
        d = {"w": "Width", "h": "Height"}
        if "Depth" in names:
            d["d"] = "Depth"
        return d
    return None


def process_family(entry):
    fid = entry["id"]
    path = entry["realPath"]
    result = {"ok": False, "id": fid}
    famdoc = None
    try:
        famdoc = app.OpenDocumentFile(path)
        fm = famdoc.FamilyManager

        instance_params = []
        type_param_defs = []
        for p in fm.Parameters:
            try:
                pname = safe_u(p.Definition.Name)
            except Exception:
                continue
            if p.IsInstance:
                instance_params.append(pname)
            else:
                type_param_defs.append(p)

        dims = detect_dims(fm)

        view = find_floor_plan_view(famdoc)
        sheet_mode = False
        if view is None:
            view = find_sheet_view(famdoc)
            sheet_mode = view is not None
        if view is not None:
            t0 = DB.Transaction(famdoc, "prep view")
            t0.Start()
            hide_dimensions(famdoc, view, sheet_mode)
            t0.Commit()

        types_out = []
        ftypes = list(fm.Types)
        if len(ftypes) == 0:
            ftypes = [None]
        for idx, ftype in enumerate(ftypes):
            t = DB.Transaction(famdoc, "switch type")
            t.Start()
            if ftype is not None:
                fm.CurrentType = ftype
            famdoc.Regenerate()
            t.Commit()

            params_list = []
            for p in type_param_defs:
                try:
                    pname = safe_u(p.Definition.Name)
                    pval = param_value_str(p)
                    params_list.append([pname, pval])
                except Exception:
                    continue

            plan_file = None
            if view is not None:
                try:
                    prefix = "%s_t%d" % (fid, idx)
                    if sheet_mode:
                        # annotation sheet: one large image per family is enough (types share the drawing)
                        if idx == 0:
                            plan_file = export_plan_png(famdoc, view, prefix, 2400, True)
                    else:
                        plan_file = export_plan_png(famdoc, view, prefix)
                except Exception:
                    plan_file = None

            mesh, vert_count = build_mesh(famdoc)
            if mesh is not None and vert_count > MESH_VERT_CAP:
                mesh = None

            types_out.append({
                "name": safe_u(ftype.Name) if ftype is not None else u"Default",
                "params": params_list,
                "vertCount": vert_count,
                "mesh": mesh,
                "planFile": plan_file,
            })

        result["ok"] = True
        result["sheetView"] = sheet_mode
        result["name"] = entry["name"]
        result["cat"] = entry["cat"]
        result["sub"] = entry["sub"]
        result["realPath"] = path
        result["dims"] = dims
        result["instanceParams"] = instance_params
        result["types"] = types_out
    except Exception as e:
        result["ok"] = False
        result["error"] = safe_u(str(e)) + " | " + safe_u(traceback.format_exc())
    finally:
        if famdoc is not None:
            try:
                famdoc.Close(False)
            except Exception:
                pass
    return result


manifest = json.load(io.open(MANIFEST_PATH, "r", encoding="utf-8"))
batch = manifest[START:END]
log("=== batch start %d:%d (%d families) ===" % (START, END, len(batch)))

for entry in batch:
    out_path = os.path.join(OUT_DIR, entry["id"] + ".json")
    r = process_family(entry)
    with open(out_path, "w") as f:
        json.dump(r, f)
    status = "OK types=%d" % len(r.get("types", [])) if r.get("ok") else "FAIL: %s" % r.get("error", "?")[:200]
    log("%s -> %s" % (entry["id"], status))

log("=== batch done %d:%d ===" % (START, END))
print("DONE " + str(START) + ":" + str(END))
