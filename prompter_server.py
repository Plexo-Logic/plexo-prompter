"""Plexo Prompter launcher.

Serves the app to this computer only (127.0.0.1), lists the text files in the
Scripts folder next to it so new or edited scripts appear in the app straight
away, and opens the app in its own Edge or Chrome window.

    python prompter_server.py                          opens the app window
    python prompter_server.py --no-browser --port 8777

Standard library only, so it runs on any Python 3.8+ and can be bundled into a
single .exe.
"""
import argparse
import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen

FROZEN = getattr(sys, "frozen", False)
HERE = Path(sys.executable if FROZEN else __file__).resolve().parent
APP_DIR = Path(getattr(sys, "_MEIPASS", HERE)) / "app"
SCRIPTS_DIR = HERE / "Scripts"

SCRIPT_EXTENSIONS = (".txt", ".md", ".text")  # the same list as TEXT_FILE in app/js/core.js
MAX_SCRIPT_BYTES = 2_000_000
MAX_SCRIPTS = 200
MAX_TOTAL_BYTES = 20_000_000
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
}
LOCAL_HOSTS = ("127.0.0.1", "localhost")

# The app only ever loads its own files, so the browser is told to refuse anything else.
SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
        "connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; "
        "frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "microphone=(self), camera=(self), geolocation=()",  # the camera, for record mode
    "Cache-Control": "no-store",
}


def decode(raw):
    """Reads a text file saved by any common Windows or Mac editor."""
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1")


def scan_scripts(folder):
    """The script files in the folder with their details, skipping hidden, oversized and linked files."""
    folder.mkdir(parents=True, exist_ok=True)
    found = []
    for path in sorted(folder.iterdir(), key=lambda p: p.name.lower()):
        if len(found) >= MAX_SCRIPTS:
            break
        if path.name.startswith((".", "~")) or path.suffix.lower() not in SCRIPT_EXTENSIONS:
            continue
        try:
            if path.is_symlink() or not path.is_file():
                continue
            stat = path.stat()
        except OSError:
            continue
        if stat.st_size <= MAX_SCRIPT_BYTES:
            found.append((path, stat))
    return found


def folder_tag(found):
    """A fingerprint of the folder's files, so an unchanged folder is answered with "304 Not Modified"."""
    listing = ";".join(f"{path.name}:{stat.st_mtime_ns}:{stat.st_size}" for path, stat in found)
    return '"%s"' % hashlib.sha256(listing.encode("utf-8")).hexdigest()[:20]


def list_scripts(folder, found=None):
    """The text of each script file, read with a size limit per file and in total."""
    scripts = []
    total = 0
    for path, stat in scan_scripts(folder) if found is None else found:
        try:
            with path.open("rb") as file:
                raw = file.read(MAX_SCRIPT_BYTES + 1)  # bounded, even if the file grows while it is read
        except OSError:
            continue  # for example, locked by an editor mid-save; it's picked up on the next check
        if len(raw) > MAX_SCRIPT_BYTES or total + len(raw) > MAX_TOTAL_BYTES:
            continue
        total += len(raw)
        scripts.append({"file": path.name, "mtime": stat.st_mtime, "text": decode(raw)})
    return scripts


def open_in_file_manager(folder):
    folder.mkdir(parents=True, exist_ok=True)
    if sys.platform.startswith("win"):
        os.startfile(folder)  # noqa: S606 (a fixed local folder, never user input)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(folder)])
    else:
        subprocess.Popen(["xdg-open", str(folder)])


def app_files(app_dir):
    """Maps each URL the app may request to its file. Built once, so request paths never touch the disk."""
    app_dir = Path(app_dir).resolve()
    files = {}
    for path in app_dir.rglob("*"):
        if path.suffix in CONTENT_TYPES and path.is_file() and not path.is_symlink():
            files["/" + path.relative_to(app_dir).as_posix()] = path
    files["/"] = files.get("/index.html")
    return files


class Server(ThreadingHTTPServer):
    # On Windows, address reuse lets a second program bind a port that is already in use.
    allow_reuse_address = not sys.platform.startswith("win")


def create_server(port=0, app_dir=APP_DIR, scripts_dir=SCRIPTS_DIR, on_open_folder=open_in_file_manager, moved_from=None):
    """Builds the server without starting it. Port 0 picks any free port.

    moved_from is the port the user asked for, when it was busy and another had to be used.
    The app tells the user, because the browser keeps saved scripts separately for each port.
    """
    files = app_files(app_dir)
    scripts_dir = Path(scripts_dir)

    class Handler(BaseHTTPRequestHandler):
        server_version = "PlexoPrompter"
        sys_version = ""

        def log_message(self, *args):
            pass

        def send(self, status, body, content_type="text/plain; charset=utf-8", headers=None):
            data = body if isinstance(body, bytes) else body.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            for name, value in {**SECURITY_HEADERS, **(headers or {})}.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(data)

        def is_from_this_app(self):
            """Blocks other websites, including DNS rebinding, from reaching the server."""
            host_header = self.headers.get("Host", "")
            origin = self.headers.get("Origin")
            site = self.headers.get("Sec-Fetch-Site")
            return (
                urlparse(f"//{host_header}").hostname in LOCAL_HOSTS
                and origin in (None, f"http://{host_header}")
                and site in (None, "same-origin", "none")
            )

        def do_GET(self):
            if not self.is_from_this_app():
                return self.send(403, "Forbidden")
            path = urlparse(self.path).path
            if path == "/api/scripts":
                self.server.last_ping = time.time()
                found = scan_scripts(scripts_dir)
                tag = folder_tag(found)
                if self.headers.get("If-None-Match") == tag:
                    return self.send(304, b"", headers={"ETag": tag})
                payload = {"scripts": list_scripts(scripts_dir, found)}
                if moved_from:
                    payload["movedFrom"] = moved_from
                return self.send(200, json.dumps(payload), "application/json", headers={"ETag": tag})
            target = files.get(path)
            if target is None:
                return self.send(404, "Not found")
            return self.send(200, target.read_bytes(), CONTENT_TYPES[target.suffix])

        def do_POST(self):
            if not self.is_from_this_app():
                return self.send(403, "Forbidden")
            if urlparse(self.path).path != "/api/open-folder":
                return self.send(404, "Not found")
            on_open_folder(scripts_dir)
            return self.send(200, "{}", "application/json")

    server = Server(("127.0.0.1", port), Handler)
    server.last_ping = None
    return server


def port_is_free(port):
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def free_port(preferred):
    return next((port for port in range(preferred, preferred + 20) if port_is_free(port)), 0)


def already_running(port):
    """True if Plexo Prompter is serving on this port. Asking also keeps it from closing."""
    try:
        with urlopen(f"http://127.0.0.1:{port}/api/scripts", timeout=2) as response:
            return response.headers.get("Server", "").startswith("PlexoPrompter")
    except (OSError, ValueError):
        return False


def open_window(url):
    """Opens the app in its own window, without browser tabs or an address bar."""
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]
    candidates += filter(None, map(shutil.which, ["microsoft-edge", "google-chrome", "chromium", "chromium-browser"]))
    for exe in candidates:
        if os.path.exists(exe):
            subprocess.Popen([exe, f"--app={url}", "--window-size=1200,760"])
            return
    webbrowser.open(url)


def close_when_window_closes(server):
    """Stops the launcher a minute after the app window stops checking in."""
    while True:
        time.sleep(10)
        if server.last_ping and time.time() - server.last_ping > 60:
            server.shutdown()
            return


def main():
    parser = argparse.ArgumentParser(description="Plexo Prompter launcher")
    parser.add_argument("--port", type=int, default=8777)
    parser.add_argument("--no-browser", action="store_true", help="don't open the app window")
    args = parser.parse_args()

    SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)

    # Started twice, or again within a minute of closing the window: use the one that's running,
    # so the app stays on the same address and keeps its saved scripts.
    if not port_is_free(args.port) and already_running(args.port):
        url = f"http://127.0.0.1:{args.port}/"
        print(f"Plexo Prompter is already running at {url}", flush=True)
        if not args.no_browser:
            open_window(url)
        return

    port = free_port(args.port)
    server = create_server(port, moved_from=args.port if port != args.port else None)
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(f"Plexo Prompter running at {url}  Scripts folder: {SCRIPTS_DIR}", flush=True)
    if not args.no_browser:
        threading.Thread(target=close_when_window_closes, args=(server,), daemon=True).start()
        open_window(url)
    server.serve_forever()


if __name__ == "__main__":
    main()
