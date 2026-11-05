#!/usr/bin/env python3
"""Trip Builder - local server.

Run:  python3 start.py          (opens http://localhost:8765 in your browser)
      python3 start.py --port 9000 --no-browser

Standard library only. Nothing is uploaded anywhere except:
  * address lookups (geocoding) sent to OpenStreetMap Nominatim, one per second;
  * the map-area download from the Protomaps daily build (only when you click it);
  * one-off downloads of the pmtiles tool and map label fonts.
"""
import argparse
import base64
import datetime as dt
import hashlib
import io
import json
import mimetypes
import os
import platform
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.parse
import urllib.request
import webbrowser
import zipfile
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECTS = ROOT / "projects"
EXPORTS = ROOT / "exports"
TOOLS = ROOT / "tools"
VENDOR = ROOT / "vendor"
SAMPLE = ROOT / "sample"
APP = ROOT / "app-template"
STATIC_DIRS = {"builder", "app-template", "vendor"}
USER_AGENT = "TripCompanionBuilder/1.0 (personal trip planner; local app)"
PMTILES_VERSION_FALLBACK = "v1.31.2"
SIZE_WARN_MB = 50

mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("application/x-protobuf", ".pbf")
mimetypes.add_type("application/octet-stream", ".pmtiles")

_geo_lock = threading.Lock()
_geo_last = [0.0]
_save_lock = threading.Lock()


# ----------------------------------------------------------------------------- helpers
def slugify(text, fallback="trip"):
    text = re.sub(r"[^\w\s-]", "", (text or "").lower(), flags=re.UNICODE)
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    text = text.encode("ascii", "ignore").decode() or fallback
    return text[:48]


def safe_id(value):
    if not value or not re.fullmatch(r"[A-Za-z0-9._-]{1,80}", value) or ".." in value:
        raise ValueError("bad id")
    return value


def project_dir(pid):
    return PROJECTS / safe_id(pid)


def write_json_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    for attempt in range(10):  # Windows refuses to replace a file another request is still reading
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.05)


def human_mb(n):
    return f"{n / 1048576:.1f} MB"


def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


# ----------------------------------------------------------------------------- projects
def list_projects():
    out = []
    if PROJECTS.exists():
        for d in sorted(PROJECTS.iterdir()):
            pj = d / "project.json"
            if d.is_dir() and pj.exists() and not d.name.startswith("."):
                try:
                    p = json.loads(pj.read_text(encoding="utf-8"))
                except Exception:
                    continue
                out.append({"id": d.name, "tripName": p.get("settings", {}).get("tripName", d.name),
                            "updated": pj.stat().st_mtime})
    out.sort(key=lambda x: -x["updated"])
    return out


def new_project_id(name):
    base = slugify(name)
    pid, i = base, 2
    while (PROJECTS / pid).exists():
        pid, i = f"{base}-{i}", i + 1
    return pid


def create_project(template, name=None):
    if template == "sample":
        proj = json.loads((SAMPLE / "sample-project.json").read_text(encoding="utf-8"))
        start = dt.date.today() + dt.timedelta(days=1)
        shift_relative_dates(proj, start)
        pid = new_project_id(name or proj["settings"]["tripName"])
        d = PROJECTS / pid
        (d / "files").mkdir(parents=True)
        for f in (SAMPLE / "files").iterdir():
            shutil.copy2(f, d / "files" / f.name)
        if (SAMPLE / "lisbon.pmtiles").exists():
            (d / "map").mkdir()
            shutil.copy2(SAMPLE / "lisbon.pmtiles", d / "map" / "area.pmtiles")
            proj["settings"]["mapArea"]["file"] = "area.pmtiles"
            proj["settings"]["mapArea"]["size"] = (d / "map" / "area.pmtiles").stat().st_size
    else:
        proj = json.loads((ROOT / "builder" / "blank-project.json").read_text(encoding="utf-8"))
        if name:
            proj["settings"]["tripName"] = name
        pid = new_project_id(name or "my-trip")
        (PROJECTS / pid / "files").mkdir(parents=True)
    proj["id"] = pid
    write_json_atomic(PROJECTS / pid / "project.json", proj)
    return proj


def shift_relative_dates(obj, start):
    """Sample dates are stored as '+N' (days after tomorrow) so the demo is always upcoming."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("date", "endDate") and isinstance(v, str) and v.startswith("+"):
                obj[k] = (start + dt.timedelta(days=int(v[1:]))).isoformat()
            else:
                shift_relative_dates(v, start)
    elif isinstance(obj, list):
        for v in obj:
            shift_relative_dates(v, start)


def gc_files(pid, proj):
    """Remove files no longer referenced by the project."""
    used = set()
    for fid, meta in (proj.get("files") or {}).items():
        used.add(fid)
        used.update(meta.get("pages") or [])
        if meta.get("thumb"):
            used.add(meta["thumb"])
    for m in (proj.get("maps") or {}).get("list", []):
        used.add(m.get("fileId"))
    icon = (proj.get("settings") or {}).get("icon") or {}
    if icon.get("fileId"):
        used.add(icon["fileId"])
    fdir = project_dir(pid) / "files"
    if fdir.exists():
        for f in fdir.iterdir():
            if f.name not in used:
                f.unlink()


# ----------------------------------------------------------------------------- geocoding
def geocode(q):
    cache_file = PROJECTS / ".geocache.json"
    cache = {}
    if cache_file.exists():
        try:
            cache = json.loads(cache_file.read_text(encoding="utf-8"))
        except Exception:
            cache = {}
    key = q.strip().lower()
    if key in cache:
        return cache[key]
    with _geo_lock:  # Nominatim usage policy: max 1 request per second
        wait = 1.1 - (time.time() - _geo_last[0])
        if wait > 0:
            time.sleep(wait)
        url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
            {"q": q, "format": "jsonv2", "limit": 4, "addressdetails": 0})
        try:
            data = json.loads(http_get(url, timeout=20))
        finally:
            _geo_last[0] = time.time()
    res = [{"lat": round(float(r["lat"]), 6), "lng": round(float(r["lon"]), 6),
            "label": r.get("display_name", "")} for r in data]
    cache[key] = res
    PROJECTS.mkdir(exist_ok=True)
    write_json_atomic(cache_file, cache)
    return res


# ----------------------------------------------------------------------------- map extract
def pmtiles_binary():
    exe = TOOLS / ("pmtiles.exe" if os.name == "nt" else "pmtiles")
    if exe.exists():
        try:
            subprocess.run([str(exe), "version"], capture_output=True, timeout=20)
            return exe
        except OSError:
            exe.unlink()  # wrong architecture; fetch the right one
    TOOLS.mkdir(exist_ok=True)
    system = {"Darwin": "Darwin", "Linux": "Linux", "Windows": "Windows"}[platform.system()]
    mach = platform.machine().lower()
    arch = "arm64" if mach in ("arm64", "aarch64") else "x86_64"
    try:
        tag = json.loads(http_get("https://api.github.com/repos/protomaps/go-pmtiles/releases/latest"))["tag_name"]
    except Exception:
        tag = PMTILES_VERSION_FALLBACK
    ver = tag.lstrip("v")
    if system == "Linux":
        name = f"go-pmtiles_{ver}_{system}_{arch}.tar.gz"
    else:
        name = f"go-pmtiles-{ver}_{system}_{arch}.zip"
    blob = http_get(f"https://github.com/protomaps/go-pmtiles/releases/download/{tag}/{name}", timeout=300)
    if name.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            member = [m for m in z.namelist() if Path(m).name.startswith("pmtiles")][0]
            exe.write_bytes(z.read(member))
    else:
        with tarfile.open(fileobj=io.BytesIO(blob)) as t:
            member = [m for m in t.getmembers() if Path(m.name).name == "pmtiles"][0]
            exe.write_bytes(t.extractfile(member).read())
    exe.chmod(0o755)
    return exe


def latest_protomaps_build():
    for back in range(0, 12):
        day = (dt.date.today() - dt.timedelta(days=back)).strftime("%Y%m%d")
        url = f"https://build.protomaps.com/{day}.pmtiles"
        try:
            req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=15) as r:
                if r.status == 200:
                    return url
        except Exception:
            continue
    raise RuntimeError("Could not find a recent Protomaps build (no internet?)")


def map_extract(pid, bbox, maxzoom, dry_run):
    exe = pmtiles_binary()
    src = latest_protomaps_build()
    out_dir = project_dir(pid) / "map"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / ("dryrun.pmtiles" if dry_run else "area.new.pmtiles")
    bbox_s = ",".join(f"{float(v):.5f}" for v in bbox)
    cmd = [str(exe), "extract", src, str(out), f"--bbox={bbox_s}", f"--maxzoom={int(maxzoom)}"]
    if dry_run:
        cmd.append("--dry-run")
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    log = r.stdout + r.stderr
    if r.returncode != 0:
        raise RuntimeError(log[-800:])
    m = re.search(r"archive size of ([\d.]+) (\w+)", log)
    est = None
    if m:
        est = float(m.group(1)) * {"B": 1, "kB": 1e3, "KB": 1e3, "MB": 1e6, "GB": 1e9}.get(m.group(2), 1)
    if dry_run:
        return {"estimatedBytes": est, "source": src}
    os.replace(out, out_dir / "area.pmtiles")
    return {"file": "area.pmtiles", "size": (out_dir / "area.pmtiles").stat().st_size, "source": src,
            "date": dt.date.today().isoformat()}


# ----------------------------------------------------------------------------- export
APP_FILES = ["index.html", "app.css", "render.js", "app.js"]
FONT_FILES = ["atkinson-400-latin.woff2", "atkinson-400-latin-ext.woff2",
              "atkinson-700-latin.woff2", "atkinson-700-latin-ext.woff2", "OFL.txt"]


def data_url(path):
    mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return f"data:{mime};base64," + base64.b64encode(Path(path).read_bytes()).decode()


def export_trip(pid, payload):
    proj = json.loads((project_dir(pid) / "project.json").read_text(encoding="utf-8"))
    slug = pid  # stable across renames, so re-exports always land in the same folder
    out = EXPORTS / slug
    site = out / "site"
    if site.exists():
        shutil.rmtree(site)
    site.mkdir(parents=True)
    files_dir = project_dir(pid) / "files"
    interactive = bool(payload.get("interactive"))

    for f in APP_FILES:
        shutil.copy2(APP / f, site / f)
    (site / "fonts").mkdir()
    for f in FONT_FILES:
        shutil.copy2(APP / "fonts" / f, site / "fonts" / f)

    # documents, page images and map images
    for item in payload["assetFiles"]:
        src = files_dir / safe_id(item["fileId"])
        dst = site / item["path"]
        if not str(dst.resolve()).startswith(str(site.resolve())):
            raise ValueError("bad asset path")
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    # icons (rendered by the builder as PNG data URLs)
    (site / "icons").mkdir()
    for name, durl in payload["icons"].items():
        (site / "icons" / safe_id(name)).write_bytes(base64.b64decode(durl.split(",", 1)[1]))

    if interactive:
        m = site / "map"
        m.mkdir()
        shutil.copy2(project_dir(pid) / "map" / "area.pmtiles", m / "area.pmtiles")
        shutil.copy2(APP / "livemap.js", site / "livemap.js")
        for f in ("maplibre/maplibre-gl.js", "maplibre/maplibre-gl.css", "pmtiles.js", "basemaps.js"):
            shutil.copy2(VENDOR / f, m / Path(f).name)
        shutil.copytree(VENDOR / "sprites", m / "sprites")
        shutil.copytree(VENDOR / "glyphs", m / "glyphs")

    s = proj["settings"]
    color = s.get("icon", {}).get("color") or "#FCB300"
    manifest = {
        "name": s.get("tripName") or "Our trip",
        "short_name": (s.get("shortName") or s.get("tripName") or "Trip")[:12],
        "start_url": "./", "scope": "./", "display": "standalone",
        "background_color": color, "theme_color": color,
        "icons": [
            {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }
    idx = (site / "index.html").read_text(encoding="utf-8")
    idx = (idx.replace("__TITLE__", html_escape(manifest["name"]))
              .replace("__SHORTNAME__", html_escape(manifest["short_name"]))
              .replace("__COLOR__", html_escape(color)))
    (site / "index.html").write_text(idx, encoding="utf-8")
    (site / "manifest.webmanifest").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    (site / "trip.js").write_text("window.TRIP = " + json.dumps(payload["trip"], ensure_ascii=False) + ";\n",
                                  encoding="utf-8")
    (site / "robots.txt").write_text("User-agent: *\nDisallow: /\n")
    (site / ".nojekyll").write_text("")
    (site / "_headers").write_text(
        "/*\n  X-Robots-Tag: noindex\n  Referrer-Policy: no-referrer\n"
        "/sw.js\n  Cache-Control: no-cache\n/trip.js\n  Cache-Control: no-cache\n"
        "/index.html\n  Cache-Control: no-cache\n")

    # service worker: precache list + content version
    precache = sorted(p.relative_to(site).as_posix() for p in site.rglob("*")
                      if p.is_file() and p.name not in ("_headers", "robots.txt", ".nojekyll"))
    h = hashlib.sha256()
    for rel in precache:
        h.update(rel.encode())
        h.update(hashlib.sha256((site / rel).read_bytes()).digest())
    version = h.hexdigest()[:12]
    sw = (APP / "sw.js").read_text(encoding="utf-8")
    sw = sw.replace("__VERSION__", version).replace("__FILES__", json.dumps(["./"] + precache, indent=1))
    (site / "sw.js").write_text(sw, encoding="utf-8")
    # stamp the version into the page so the app can show it
    trip_js = (site / "trip.js").read_text(encoding="utf-8")
    (site / "trip.js").write_text(trip_js + f"window.TRIP_VERSION = {json.dumps(version)};\n", encoding="utf-8")

    # zip
    zpath = out / f"{slug}-site.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(site.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(site).as_posix())

    # single self-contained HTML
    single = out / f"{slug}-offline.html"
    single.write_text(build_single_html(site, payload, version), encoding="utf-8")

    # parents' how-to sheet
    howto = out / f"How-to-use-{slug}.html"
    howto.write_text(build_howto(proj, payload.get("siteUrl") or s.get("siteUrl") or ""), encoding="utf-8")

    site_bytes = sum(p.stat().st_size for p in site.rglob("*") if p.is_file())
    warnings = []
    if site_bytes > SIZE_WARN_MB * 1048576:
        warnings.append(f"The app folder is {human_mb(site_bytes)} (target under {SIZE_WARN_MB} MB). "
                        "It will take a while to download on a phone.")
    if single.stat().st_size > SIZE_WARN_MB * 1048576:
        warnings.append(f"The single HTML file is {human_mb(single.stat().st_size)}; some phones may struggle to open it.")
    return {
        "folder": str(out), "site": str(site), "zip": str(zpath), "single": str(single), "howto": str(howto),
        "siteBytes": site_bytes, "zipBytes": zpath.stat().st_size, "singleBytes": single.stat().st_size,
        "files": len(precache), "version": version, "warnings": warnings,
        "urls": {"site": f"/exports/{slug}/site/index.html", "single": f"/exports/{slug}/{single.name}",
                 "howto": f"/exports/{slug}/{howto.name}"},
    }


def build_single_html(site, payload, version):
    css = (site / "app.css").read_text(encoding="utf-8")
    for f in FONT_FILES:
        if f.endswith(".woff2"):
            css = css.replace(f"fonts/{f}", data_url(site / "fonts" / f))
    static_html = payload["staticHtml"]

    def inline(m):
        attr, path = m.group(1), m.group(2)
        p = site / path
        # data-asset lets the app (when JavaScript runs) reuse the inlined copy
        return f'data-asset="{path}" {attr}="{data_url(p)}"' if p.is_file() else m.group(0)

    static_html = re.sub(r'(src|href)="((?:docs|maps)/[^"]+)"', inline, static_html)
    icon = data_url(site / "icons" / "apple-touch-icon.png")
    trip = (site / "trip.js").read_text(encoding="utf-8")
    js = "\n".join((site / f).read_text(encoding="utf-8") for f in ("render.js", "app.js"))
    title = payload["trip"]["settings"].get("tripName", "Our trip")
    color = payload["trip"]["settings"].get("color", "#FCB300")
    js_safe = js.replace("/script", "<\\/script")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="{color}">
<title>{html_escape(title)}</title>
<link rel="apple-touch-icon" href="{icon}">
<link rel="icon" href="{icon}">
<style>{css}</style>
</head>
<body class="single-file" data-version="{version}">
{static_html}
<script>{trip}</script>
<script>{js_safe}</script>
</body>
</html>
"""


def html_escape(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))


def build_howto(proj, site_url):
    tpl = (ROOT / "builder" / "howto-template.html").read_text(encoding="utf-8")
    s = proj["settings"]
    rep = {
        "{{TRIP}}": html_escape(s.get("tripName", "Our trip")),
        "{{LINK}}": html_escape(site_url) if site_url else "(the link I sent you)",
        "{{EMERGENCY}}": html_escape(s.get("emergencyNumber", "112")),
        "{{MYNAME}}": html_escape(s.get("myName", "me")),
        "{{MYPHONE}}": html_escape(s.get("myPhone", "")),
    }
    for k, v in rep.items():
        tpl = tpl.replace(k, v)
    return tpl


# ----------------------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "TripBuilder/1.0"

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("  " + (fmt % args) + "\n")

    # -- responses
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, msg):
        self.send_json({"error": msg}, status)

    def send_file(self, path, download_name=None):
        path = Path(path)
        try:
            # open first and size the open file: an autosave may replace the file meanwhile
            f = open(path, "rb")
        except (FileNotFoundError, IsADirectoryError, NotADirectoryError):
            return self.send_error_json(404, "not found")
        with f:
            size = os.fstat(f.fileno()).st_size
            ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
            rng = self.headers.get("Range")
            start, end = 0, size - 1
            status = 200
            if rng:
                m = re.match(r"bytes=(\d*)-(\d*)", rng)
                if m:
                    if m.group(1):
                        start = int(m.group(1))
                        end = int(m.group(2)) if m.group(2) else size - 1
                    else:
                        start = max(0, size - int(m.group(2)))
                    end = min(end, size - 1)
                    status = 206
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Cache-Control", "no-cache")
            if status == 206:
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            if download_name:
                self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
            self.end_headers()
            if self.command == "HEAD":
                return
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = f.read(min(1 << 20, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def read_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def read_json(self):
        return json.loads(self.read_body() or b"{}")

    # -- routing
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        parts = [urllib.parse.unquote(p) for p in url.path.split("/") if p]
        q = urllib.parse.parse_qs(url.query)
        try:
            if not parts:
                self.send_response(302)
                self.send_header("Location", "/builder/")
                self.end_headers()
                return
            if parts[0] in STATIC_DIRS:
                rel = "/".join(parts[1:]) or "index.html"
                if url.path.endswith("/"):
                    rel = (rel + "/index.html") if parts[1:] else "index.html"
                return self.serve_under(ROOT / parts[0], rel)
            if parts[0] == "exports":
                return self.serve_under(EXPORTS, "/".join(parts[1:]))
            if parts[0] == "glyphs" and len(parts) == 3:
                return self.serve_glyph(parts[1], parts[2])
            if parts[0] == "sprites" and len(parts) == 2:
                return self.serve_under(VENDOR / "sprites", parts[1])
            if parts[:2] == ["api", "projects"]:
                if len(parts) == 2:
                    return self.send_json(list_projects())
                pid = safe_id(parts[2])
                d = project_dir(pid)
                if len(parts) == 3:
                    return self.send_file(d / "project.json")
                if parts[3] == "files" and len(parts) == 5:
                    return self.send_file(d / "files" / safe_id(parts[4]))
                if parts[3] == "map" and len(parts) == 5:
                    return self.send_file(d / "map" / safe_id(parts[4]))
                if parts[3] == "download":
                    buf = io.BytesIO()
                    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                        for p in sorted(d.rglob("*")):
                            if p.is_file() and p.name != "dryrun.pmtiles":
                                z.write(p, p.relative_to(d).as_posix())
                    data = buf.getvalue()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/zip")
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Content-Disposition", f'attachment; filename="{pid}.tripproject.zip"')
                    self.end_headers()
                    self.wfile.write(data)
                    return
            if parts == ["api", "geocode"]:
                return self.send_json(geocode(q.get("q", [""])[0]))
            if parts == ["api", "open-folder"]:
                return self.send_json(open_folder(q.get("path", [""])[0]))
            self.send_error_json(404, "not found")
        except ValueError as e:
            self.send_error_json(400, str(e))
        except Exception as e:  # noqa: BLE001 - surface errors to the builder UI
            self.send_error_json(500, f"{type(e).__name__}: {e}")

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        parts = [urllib.parse.unquote(p) for p in url.path.split("/") if p]
        q = urllib.parse.parse_qs(url.query)
        try:
            if parts == ["api", "projects"]:
                body = self.read_json()
                return self.send_json(create_project(body.get("template", "blank"), body.get("name")))
            if parts == ["api", "import"]:
                return self.send_json(import_project(self.read_body()))
            if parts[:2] == ["api", "projects"] and len(parts) >= 4:
                pid = safe_id(parts[2])
                d = project_dir(pid)
                if not d.exists():
                    return self.send_error_json(404, "no such project")
                if parts[3] == "files":
                    name = q.get("name", ["file"])[0]
                    ext = Path(name).suffix.lower()[:6] or ".bin"
                    if not re.fullmatch(r"\.[a-z0-9]+", ext):
                        ext = ".bin"
                    fid = secrets.token_hex(6) + ext
                    (d / "files").mkdir(exist_ok=True)
                    data = self.read_body()
                    (d / "files" / fid).write_bytes(data)
                    return self.send_json({"fileId": fid, "size": len(data)})
                if parts[3] == "map-area":
                    body = self.read_json()
                    return self.send_json(map_extract(pid, body["bbox"], body.get("maxzoom", 15),
                                                      bool(body.get("dryRun"))))
                if parts[3] == "export":
                    return self.send_json(export_trip(pid, self.read_json()))
            self.send_error_json(404, "not found")
        except ValueError as e:
            self.send_error_json(400, str(e))
        except Exception as e:  # noqa: BLE001
            self.send_error_json(500, f"{type(e).__name__}: {e}")

    def do_PUT(self):
        parts = [p for p in urllib.parse.urlparse(self.path).path.split("/") if p]
        try:
            if parts[:2] == ["api", "projects"] and len(parts) == 3:
                pid = safe_id(parts[2])
                proj = self.read_json()
                with _save_lock:
                    write_json_atomic(project_dir(pid) / "project.json", proj)
                    gc_files(pid, proj)
                return self.send_json({"ok": True, "saved": time.time()})
            self.send_error_json(404, "not found")
        except Exception as e:  # noqa: BLE001
            self.send_error_json(500, f"{type(e).__name__}: {e}")

    def do_DELETE(self):
        parts = [p for p in urllib.parse.urlparse(self.path).path.split("/") if p]
        try:
            if parts[:2] == ["api", "projects"] and len(parts) == 3:
                d = project_dir(safe_id(parts[2]))
                trash = PROJECTS / ".trash"
                trash.mkdir(exist_ok=True)
                shutil.move(str(d), str(trash / f"{d.name}-{int(time.time())}"))
                return self.send_json({"ok": True})
            self.send_error_json(404, "not found")
        except Exception as e:  # noqa: BLE001
            self.send_error_json(500, f"{type(e).__name__}: {e}")

    # -- static helpers
    def serve_under(self, base, rel):
        base = base.resolve()
        p = (base / rel).resolve()
        if not str(p).startswith(str(base)):
            return self.send_error_json(403, "forbidden")
        if p.is_dir():
            p = p / "index.html"
        return self.send_file(p)

    def serve_glyph(self, font, rng):
        if not re.fullmatch(r"[A-Za-z0-9 ]+", font) or not re.fullmatch(r"\d+-\d+\.pbf", rng):
            return self.send_error_json(400, "bad glyph request")
        p = VENDOR / "glyphs" / font / rng
        if not p.exists():
            try:
                data = http_get("https://protomaps.github.io/basemaps-assets/fonts/"
                                + urllib.parse.quote(font) + "/" + rng, timeout=20)
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(data)
            except Exception:
                return self.send_error_json(404, "glyph range unavailable")
        return self.send_file(p)


def import_project(blob):
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        names = z.namelist()
        if "project.json" not in names:
            raise ValueError("This is not a Trip Builder project file (no project.json inside).")
        proj = json.loads(z.read("project.json"))
        pid = new_project_id(proj.get("settings", {}).get("tripName") or "imported-trip")
        d = PROJECTS / pid
        for n in names:
            if n.endswith("/") or ".." in n or n.startswith("/"):
                continue
            if not (n == "project.json" or re.fullmatch(r"(files|map)/[A-Za-z0-9._-]+", n)):
                continue
            target = d / n
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(z.read(n))
    proj["id"] = pid
    write_json_atomic(d / "project.json", proj)
    return proj


def open_folder(path):
    p = Path(path).resolve()
    if not str(p).startswith(str(EXPORTS.resolve())) or not p.exists():
        return {"ok": False}
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", str(p)])
        elif os.name == "nt":
            os.startfile(str(p))  # noqa: S606
        else:
            subprocess.Popen(["xdg-open", str(p)])
        return {"ok": True}
    except Exception:
        return {"ok": False}


def main():
    ap = argparse.ArgumentParser(description="Trip Builder local server")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()
    PROJECTS.mkdir(exist_ok=True)
    EXPORTS.mkdir(exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = f"http://localhost:{args.port}/builder/"
    print(f"\n  Trip Builder is running at {url}\n  Projects: {PROJECTS}\n  Exports:  {EXPORTS}\n"
          "  Press Ctrl+C to stop.\n")
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")


if __name__ == "__main__":
    main()