"""Run with:  python -m unittest discover tests"""
import http.client
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prompter_server  # noqa: E402


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.app = root / "app"
        self.scripts = root / "Scripts"
        (self.app / "js").mkdir(parents=True)
        self.scripts.mkdir()
        (self.app / "index.html").write_text("<!doctype html><title>App</title>")
        (self.app / "js" / "main.js").write_text("// app")
        (root / "secret.txt").write_text("outside the app folder")
        self.opened = []
        self.server = prompter_server.create_server(0, self.app, self.scripts, on_open_folder=self.opened.append)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.temp.cleanup()

    def request(self, path, method="GET", **headers):
        headers.setdefault("Host", f"127.0.0.1:{self.port}")
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.putrequest(method, path, skip_host=True)
        for name, value in headers.items():
            connection.putheader(name.replace("_", "-"), value)
        connection.endheaders()
        response = connection.getresponse()
        body = response.read()
        connection.close()
        return response, body

    def test_serves_the_app_with_security_headers(self):
        response, body = self.request("/")
        self.assertEqual(response.status, 200)
        self.assertIn(b"<title>App</title>", body)
        self.assertIn("default-src 'none'", response.getheader("Content-Security-Policy"))
        self.assertEqual(response.getheader("X-Content-Type-Options"), "nosniff")
        self.assertEqual(response.getheader("X-Frame-Options"), "DENY")
        response, _ = self.request("/js/main.js")
        self.assertEqual(response.getheader("Content-Type"), "text/javascript; charset=utf-8")
        self.assertIn("worker-src 'self'", response.getheader("Content-Security-Policy"))

    def test_refuses_files_outside_the_app(self):
        paths = (
            "/../secret.txt", "/%2e%2e/secret.txt", "/js/%2e%2e/%2e%2e/secret.txt", "/..%5csecret.txt",
            "/%5C%5Cexample.invalid%5Cshare%5Cx.js", "/C:%5CWindows%5Cwin.ini", "/nothing.js",
        )
        for path in paths:
            response, body = self.request(path)
            self.assertEqual(response.status, 404, path)
            self.assertNotIn(b"outside", body)

    def test_refuses_other_websites(self):
        cases = [
            {"Host": "evil.example"},
            {"Host": f"evil.example:{self.port}"},
            {"Origin": "https://evil.example"},
            {"Origin": "http://127.0.0.1:1"},
            {"Sec_Fetch_Site": "cross-site"},
        ]
        for headers in cases:
            response, _ = self.request("/api/scripts", **headers)
            self.assertEqual(response.status, 403, headers)
        response, _ = self.request("/api/open-folder", "POST", Origin="https://evil.example")
        self.assertEqual(response.status, 403)
        self.assertEqual(self.opened, [])

    def test_lists_scripts(self):
        (self.scripts / "b.txt").write_text("Second", encoding="utf-8")
        (self.scripts / "A.md").write_bytes("Caf\xe9".encode("cp1252"))
        (self.scripts / ".hidden.txt").write_text("hidden")
        (self.scripts / "notes.docx").write_text("not text")
        (self.scripts / "huge.txt").write_bytes(b"x" * (prompter_server.MAX_SCRIPT_BYTES + 1))
        response, body = self.request("/api/scripts", Origin=f"http://127.0.0.1:{self.port}", Sec_Fetch_Site="same-origin")
        self.assertEqual(response.status, 200)
        scripts = json.loads(body)["scripts"]
        self.assertEqual([s["file"] for s in scripts], ["A.md", "b.txt"])
        self.assertEqual(scripts[0]["text"], "Caf\xe9")
        self.assertNotIn("folder", json.loads(body))

    def test_recognises_a_running_launcher(self):
        self.assertTrue(prompter_server.already_running(self.port))
        self.assertIsNotNone(self.server.last_ping, "asking should keep it running")
        self.assertFalse(prompter_server.port_is_free(self.port))
        free = prompter_server.free_port(self.port + 1)
        self.assertFalse(prompter_server.already_running(free))

    def test_reports_a_moved_port(self):
        _, body = self.request("/api/scripts")
        self.assertNotIn("movedFrom", json.loads(body))
        moved = prompter_server.create_server(0, self.app, self.scripts, moved_from=8777)
        threading.Thread(target=moved.serve_forever, daemon=True).start()
        try:
            port = moved.server_address[1]
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            connection.request("GET", "/api/scripts")
            self.assertEqual(json.loads(connection.getresponse().read())["movedFrom"], 8777)
            connection.close()
        finally:
            moved.shutdown()
            moved.server_close()

    def test_unchanged_folder_answers_not_modified(self):
        (self.scripts / "a.txt").write_text("One", encoding="utf-8")
        first, _ = self.request("/api/scripts")
        tag = first.getheader("ETag")
        self.assertTrue(tag)
        again, body = self.request("/api/scripts", If_None_Match=tag)
        self.assertEqual((again.status, body), (304, b""))
        (self.scripts / "b.text").write_text("Two", encoding="utf-8")
        changed, body = self.request("/api/scripts", If_None_Match=tag)
        self.assertEqual(changed.status, 200)
        self.assertEqual([s["file"] for s in json.loads(body)["scripts"]], ["a.txt", "b.text"])

    def test_opens_the_scripts_folder(self):
        response, _ = self.request("/api/open-folder", "POST", Host=f"localhost:{self.port}", Origin=f"http://localhost:{self.port}")
        self.assertEqual(response.status, 200)
        self.assertEqual(self.opened, [self.scripts])


if __name__ == "__main__":
    unittest.main()
