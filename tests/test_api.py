"""Backend tests: temp HERMES_HOME with a minimal state.db; runs without Hermes installed."""
import asyncio
import importlib.util
import json
import os
import re
import sqlite3
import sys
import tempfile
import threading
import time
import types
import unittest
from datetime import datetime
from unittest import mock
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _stub_fastapi():
    """The tests call the route functions directly, so the router is never mounted; outside Hermes fastapi may be missing."""
    if importlib.util.find_spec("fastapi"):
        return
    fa, resp = types.ModuleType("fastapi"), types.ModuleType("fastapi.responses")

    class APIRouter:
        def get(self, *a, **k):
            return lambda f: f
        put = get

    class JSONResponse:
        def __init__(self, status_code=200, content=None):
            self.status_code, self.content = status_code, content

    fa.APIRouter, fa.Request, resp.JSONResponse = APIRouter, object, JSONResponse
    sys.modules["fastapi"], sys.modules["fastapi.responses"] = fa, resp


_stub_fastapi()


def hermes_utils_stub():
    """Mirrors utils.atomic_json_write: Hermes defaults to indent=2 unless the caller passes indent=None."""
    def atomic_json_write(path, data, *, indent=2, **kw):
        Path(path).write_text(json.dumps(data, indent=indent, ensure_ascii=False), "utf-8")
    return types.SimpleNamespace(atomic_json_write=atomic_json_write)


def load(home: Path, utils_stub=None):
    sys.modules["hermes_constants"] = types.SimpleNamespace(get_hermes_home=lambda: home)
    for m in ("plugins.plugin_storage", "utils"):
        sys.modules.pop(m, None)
    if utils_stub:
        sys.modules["utils"] = utils_stub
    spec = importlib.util.spec_from_file_location("ht_api", ROOT / "plugin/dashboard/plugin_api.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run(c):
    return asyncio.run(c)


def put(api, body, length=None, raw=None):
    """Call put_state with a stand-in Request (headers + stream())."""
    data = raw if raw is not None else json.dumps(body, ensure_ascii=False).encode()  # like a browser's JSON.stringify

    async def stream():
        yield data

    async def parse():  # Starlette's request.json(): buffers the whole body
        return json.loads(data)
    headers = {"content-length": str(len(data) if length is None else length)}
    return run(api.put_state(types.SimpleNamespace(headers=headers, stream=stream, json=parse)))


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        db = sqlite3.connect(self.home / "state.db")
        db.executescript("""
          CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, source TEXT, model TEXT, parent_session_id TEXT,
            started_at REAL, ended_at REAL, end_reason TEXT, message_count INT, tool_call_count INT, last_activity_at REAL);
          CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL);
        """)
        now = time.time()
        f = self.home / "made.md"
        f.write_text("x")
        db.execute("INSERT INTO sessions VALUES ('s1','Docs','desktop','m',NULL,?,NULL,NULL,3,0,?)", (now - 60, now - 30))
        db.execute("INSERT INTO sessions VALUES ('w1','Subagent: Read files','subagent','h','s1',?,?,'agent_close',4,2,NULL)", (now - 50, now - 40))
        db.execute("INSERT INTO sessions VALUES ('old','Old','desktop','m',NULL,?,NULL,NULL,1,0,?)", (now - 40 * 86400, now - 40 * 86400))
        db.execute("INSERT INTO sessions VALUES ('nul','NoSource',NULL,'m',NULL,?,NULL,NULL,1,0,?)", (now - 20, now - 10))
        db.execute("INSERT INTO messages VALUES (3,'nul','assistant','MEDIA:/tmp/from-null-source.txt',?)", (now - 15,))
        db.execute("INSERT INTO messages VALUES (1,'s1','assistant',?,?)", (f"Done.\n\nMEDIA:{f}\nand MEDIA:/nope/gone.png.", now - 35))
        db.execute("INSERT INTO messages VALUES (2,'s1','user','MEDIA:/user/upload.png',?)", (now - 34,))
        db.commit()
        db.close()
        self.api = load(self.home)

    def tearDown(self):
        self.tmp.cleanup()

    def doc(self):
        return {"schema": 1, "views": [{"id": "v", "name": "", "cards": []}]}

    def test_state_rev_and_conflict(self):
        self.assertEqual(run(self.api.get_state())["rev"], 0)
        ok = put(self.api, {"base_rev": 0, "doc": self.doc()})
        self.assertEqual(ok["rev"], 1)
        stale = put(self.api, {"base_rev": 0, "doc": self.doc() | {"x": 1}})
        self.assertTrue(stale["conflict"])
        self.assertEqual(stale["rev"], 1)
        self.assertEqual(stale["doc"], self.doc())
        self.assertEqual(run(self.api.get_state())["doc"], self.doc())

    def test_state_validation_and_size(self):
        self.assertEqual(put(self.api, {"base_rev": 0, "doc": {"schema": 2, "views": [{}]}}).status_code, 400)
        self.assertEqual(put(self.api, {"base_rev": "0", "doc": self.doc()}).status_code, 400)
        big = self.doc() | {"pad": "x" * 300000}
        self.assertEqual(put(self.api, {"base_rev": 0, "doc": big}).status_code, 413)
        self.assertEqual(run(self.api.get_state())["rev"], 0)

    def test_state_near_limit_doc_survives_hermes_default_indent(self):
        api = load(self.home, hermes_utils_stub())
        self.addCleanup(sys.modules.pop, "utils", None)
        doc = self.doc() | {"pad": [[1]] * 48000}  # ~240 KB with json.dumps' default (spaced) separators, ~192 KB compact; indent=2 would write > MAX_STATE_FILE_BYTES
        self.assertLessEqual(len(json.dumps(doc)), api.MAX_DOC_BYTES)
        self.assertEqual(put(api, {"base_rev": 0, "doc": doc})["rev"], 1)
        got = run(api.get_state())
        self.assertEqual((got["rev"], got["doc"]), (1, doc))

    def test_state_rejects_non_finite_and_too_deep_json(self):
        deep = b'{"base_rev":0,"doc":{"schema":1,"views":[1],"x":' + b"[" * 1500 + b"]" * 1500 + b"}}"
        mid = b'{"base_rev":0,"doc":{"schema":1,"views":[1],"x":' + b"[" * 100 + b"]" * 100 + b"}}"  # parses fine, but deeper than MAX_DOC_DEPTH: refused by policy
        for raw in (mid, b'{"base_rev":0,"doc":{"schema":1,"views":[1],"x":NaN}}',
                    b'{"base_rev":0,"doc":{"schema":1,"views":[1],"x":1e999}}', deep):
            self.assertEqual(put(self.api, None, raw=raw).status_code, 400, raw[:60])
        self.assertEqual(run(self.api.get_state())["rev"], 0)

    def compact(self, doc):
        return len(json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode())

    def doc_of_compact_size(self, n):
        d = self.doc() | {"pad": [[1]] * (n // 5), "s": ""}  # small arrays: spaced separators add ~25 %
        d["s"] = "x" * (n - self.compact(d))
        self.assertEqual(self.compact(d), n)
        return d

    def test_state_cap_is_measured_compact_like_the_client(self):
        ok = self.doc_of_compact_size(262000)
        self.assertGreater(len(json.dumps(ok, ensure_ascii=False).encode()), self.api.MAX_DOC_BYTES)  # spaced size is over the cap
        def body(rev, doc):  # compact like the browser, so Content-Length stays under the early 413
            return json.dumps({"base_rev": rev, "doc": doc}, ensure_ascii=False, separators=(",", ":")).encode()
        self.assertEqual(put(self.api, None, raw=body(0, ok))["rev"], 1)
        self.assertEqual(put(self.api, None, raw=body(1, self.doc_of_compact_size(262200))).status_code, 413)

    def test_state_depth_boundary(self):
        def nested(depth):  # the document itself is depth 1, as _depth_over counts
            x = []
            for _ in range(depth - 2):
                x = [x]
            return self.doc() | {"x": x}
        for depth, over in ((self.api.MAX_DOC_DEPTH, False), (self.api.MAX_DOC_DEPTH + 1, True)):
            self.assertEqual(self.api._depth_over(nested(depth), self.api.MAX_DOC_DEPTH), over, depth)
        self.assertEqual(put(self.api, {"base_rev": 0, "doc": nested(self.api.MAX_DOC_DEPTH)})["rev"], 1)
        self.assertEqual(put(self.api, {"base_rev": 1, "doc": nested(self.api.MAX_DOC_DEPTH + 1)}).status_code, 400)

    def test_state_concurrent_puts_with_one_base_rev_win_once(self):
        real = self.api._read_state

        def slow(path):
            cur = real(path)
            time.sleep(0.02)  # widens the read-then-write window: without the lock every thread reads rev 0
            return cur
        results = []
        with mock.patch.object(self.api, "_read_state", slow):
            ts = [threading.Thread(target=lambda i=i: results.append(put(self.api, {"base_rev": 0, "doc": self.doc() | {"i": i}})))
                  for i in range(8)]
            [t.start() for t in ts]
            [t.join() for t in ts]
        self.assertEqual(sorted(r["conflict"] for r in results), [False] + [True] * 7)
        self.assertEqual(run(self.api.get_state())["rev"], 1)

    def test_poisoned_state_file_starts_empty(self):
        d = self.home / "plugin-data" / "ultimate-dashboard"; d.mkdir(parents=True, exist_ok=True)
        for bad in ('{"rev":5,"updated_at":1,"doc":{"schema":1,"views":[1],"x":NaN}}',
                    '{"rev":5,"updated_at":1,"doc":{"schema":1,"views":[1],"x":' + "[" * 1000 + "]" * 1000 + "}}"):
            (d / "state.json").write_text(bad)
            got = run(self.api.get_state())
            self.assertEqual((got["rev"], got["doc"]), (0, None), bad[:60])
            self.assertEqual(put(self.api, {"base_rev": 0, "doc": self.doc()})["rev"], 1, bad[:60])

    def test_state_rejects_by_content_length_before_parsing(self):
        async def boom():
            raise AssertionError("read")
            yield
        req = types.SimpleNamespace(headers={"content-length": str(self.api.MAX_DOC_BYTES + 100000)}, stream=boom)
        self.assertEqual(run(self.api.put_state(req)).status_code, 413)
        self.assertEqual(put(self.api, {"base_rev": 0, "doc": self.doc()}, length=1)["rev"], 1)  # a small declared size passes
        self.assertEqual(put(self.api, None, raw=b"{nope").status_code, 400)
        self.assertEqual(put(self.api, None, raw=b"[1]").status_code, 400)

    def test_state_chunked_body_is_cut_off_at_the_cap(self):
        pulled, chunk = [], b"x" * 65536  # no Content-Length: a chunked upload of 100 chunks (6.5 MB)

        async def stream():
            for _ in range(100):
                pulled.append(1)
                yield chunk

        async def buffered():  # Starlette's request.json(): pulls every chunk before parsing
            return json.loads(b"".join([c async for c in stream()]))
        req = types.SimpleNamespace(headers={}, stream=stream, json=buffered)
        self.assertEqual(run(self.api.put_state(req)).status_code, 413)
        self.assertLessEqual(len(pulled), (self.api.MAX_DOC_BYTES + self.api.ENVELOPE_SLACK) // len(chunk) + 1)  # 5, not 100
        self.assertEqual(put(self.api, {"base_rev": 0, "doc": self.doc()}, length=0)["rev"], 1)  # no declared length, normal body

    def test_state_base_rev_must_be_a_real_int(self):
        for bad in (True, False, 1.0, None):
            self.assertEqual(put(self.api, {"base_rev": bad, "doc": self.doc()}).status_code, 400, bad)

    def test_non_int_stored_rev_counts_as_zero(self):
        d = self.home / "plugin-data" / "ultimate-dashboard"; d.mkdir(parents=True, exist_ok=True)
        for bad in ('"7"', "true", "1.5", "null"):
            (d / "state.json").write_text('{"rev": %s, "doc": null}' % bad)
            self.assertEqual(run(self.api.get_state())["rev"], 0, bad)
            self.assertEqual(put(self.api, {"base_rev": 0, "doc": self.doc()})["rev"], 1, bad)

    def test_state_file_read_is_capped(self):
        d = self.home / "plugin-data" / "ultimate-dashboard"; d.mkdir(parents=True, exist_ok=True)
        (d / "state.json").write_text(json.dumps({"rev": 5, "doc": self.doc(), "pad": "x" * self.api.MAX_STATE_FILE_BYTES}))
        self.assertEqual(run(self.api.get_state())["rev"], 0)

    def test_state_file_holds_a_max_size_non_ascii_document(self):
        doc = self.doc() | {"pad": "ع" * 130000}  # ~260 KB as UTF-8, ~780 KB once the file escapes it
        self.assertLessEqual(len(json.dumps(doc, ensure_ascii=False).encode()), self.api.MAX_DOC_BYTES)
        self.assertEqual(put(self.api, {"base_rev": 0, "doc": doc})["rev"], 1)
        self.assertEqual(run(self.api.get_state())["doc"], doc)

    def test_unreadable_state_file_is_an_error_not_an_empty_state(self):
        self.assertEqual(put(self.api, {"base_rev": 0, "doc": self.doc()})["rev"], 1)
        f = self.home / "plugin-data" / "ultimate-dashboard" / "state.json"
        before = f.read_bytes()
        real = Path.open

        def deny(p, *a, **k):
            if p.name == "state.json":
                raise PermissionError("denied")
            return real(p, *a, **k)
        with mock.patch.object(Path, "open", deny):
            with self.assertRaises(PermissionError):
                run(self.api.get_state())
            with self.assertRaises(PermissionError):  # a fresh client (base_rev 0) must not overwrite the layout it could not see
                put(self.api, {"base_rev": 0, "doc": self.doc() | {"x": 1}})
        self.assertEqual(f.read_bytes(), before)

    def test_state_file_read_depth_is_capped(self):
        d = self.home / "plugin-data" / "ultimate-dashboard"; d.mkdir(parents=True, exist_ok=True)
        def nested(depth):  # the doc is depth 1 as _depth_over counts; the {rev, doc} wrapper adds one
            x = []
            for _ in range(depth - 2):
                x = [x]
            return self.doc() | {"x": x}
        for depth, rev in ((self.api.MAX_DOC_DEPTH + 1, 5), (self.api.MAX_DOC_DEPTH + 2, 0)):  # file depth MAX+2 passes, MAX+3 is refused
            (d / "state.json").write_text(json.dumps({"rev": 5, "doc": nested(depth)}))
            self.assertEqual(run(self.api.get_state())["rev"], rev, depth)

    def test_state_file_io_runs_off_the_event_loop(self):
        seen = []
        real = self.api._read_state

        def spy(path):
            seen.append(threading.current_thread())
            return real(path)
        with mock.patch.object(self.api, "_read_state", spy):
            run(self.api.get_state())
            put(self.api, {"base_rev": 0, "doc": self.doc()})
        self.assertEqual(len(seen), 2)
        self.assertNotIn(threading.main_thread(), seen)  # asyncio.run drives the loop on the main thread

    def test_corrupt_state_file_starts_empty(self):
        d = self.home / "plugin-data" / "ultimate-dashboard"; d.mkdir(parents=True, exist_ok=True)
        for bad in ("{trunc", "[1, 2]"):
            (d / "state.json").write_text(bad)
            self.assertEqual(run(self.api.get_state())["rev"], 0)
        self.assertEqual(put(self.api, {"base_rev": 0, "doc": self.doc()})["rev"], 1)

    def test_state_is_one_document_per_profile(self):
        # Desktop (no dashboard session) and the Webapp (signed-in user) must share one document.
        put(self.api, {"base_rev": 0, "doc": self.doc()})
        self.assertEqual(run(self.api.get_state())["rev"], 1)
        self.assertEqual(sorted(p.name for p in (self.home / "plugin-data" / "ultimate-dashboard").iterdir()), ["state.json"])

    def test_files(self):
        out = self.api.files(days="7")
        self.assertTrue(out["available"])
        paths = [f["path"] for f in out["files"]]
        # newest first; NULL source counted; user upload excluded; trailing dot stripped
        self.assertEqual(paths, ["/tmp/from-null-source.txt", str(self.home / "made.md"), "/nope/gone.png"])
        self.assertFalse(out["truncated"])

    def test_files_leaves_out_subagent_and_tool_sessions(self):
        db = sqlite3.connect(self.home / "state.db")
        db.execute("INSERT INTO sessions VALUES ('t1','T','tool','m',NULL,?,NULL,NULL,1,0,NULL)", (time.time() - 60,))
        for i, sid in enumerate(("w1", "t1")):
            db.execute("INSERT INTO messages VALUES (?,?,'assistant',?,?)", (50 + i, sid, f"MEDIA:/tmp/from-{sid}.txt", time.time() - 5))
        db.commit(); db.close()
        paths = [f["path"] for f in self.api.files(days="7")["files"]]
        self.assertEqual(len(paths), 3)
        self.assertFalse([p for p in paths if p.startswith(("/tmp/from-w1", "/tmp/from-t1"))])

    def test_limit_and_days_caps(self):
        self.assertEqual([self.api._limit(v, 50, 200) for v in ("999", "0", "-3", "x", None, "7")], [200, 1, 1, 50, 50, 7])
        self.assertEqual(len(self.api.files(days="7", limit="1")["files"]), 1)
        self.assertAlmostEqual(self.api._since("9999"), time.time() - 90 * 86400, delta=5)  # days are capped at 90
        self.assertAlmostEqual(self.api._since("-4"), time.time(), delta=5)  # and floored at 0

    def test_since_today_is_local_midnight(self):
        self.assertEqual(self.api._since("today"), datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
        self.assertEqual(self.api._since(None), self.api._since(""))

    def test_files_not_crowded_out_by_many_recent_sessions(self):
        now = time.time()
        db = sqlite3.connect(self.home / "state.db")
        for i in range(45):  # short cron/push sessions, all newer than the session that made the old file
            db.execute("INSERT INTO sessions VALUES (?,?,'cron','m',NULL,?,NULL,NULL,1,0,?)", (f"c{i}", "Cron", now - 100 + i, now - 100 + i))
            db.execute("INSERT INTO messages VALUES (?,?,'assistant','ok',?)", (100 + i, f"c{i}", now - 100 + i))
        db.execute("INSERT INTO sessions VALUES ('o3','Three days ago','desktop','m',NULL,?,NULL,NULL,1,0,?)", (now - 3 * 86400, now - 3 * 86400))
        db.execute("INSERT INTO messages VALUES (200,'o3','assistant','MEDIA:/tmp/three-days.txt',?)", (now - 3 * 86400,))
        db.commit(); db.close()
        out = self.api.files(days="7", limit="200")
        self.assertIn("/tmp/three-days.txt", [f["path"] for f in out["files"]])
        self.assertFalse(out["truncated"])
        with mock.patch.object(self.api, "FILES_SCAN_ROWS", 2):
            self.assertTrue(self.api.files(days="7")["truncated"])

    def test_versions_agree(self):
        root = Path(__file__).resolve().parent.parent
        yaml_v = re.search(r"^version:\s*(\S+)", (root / "plugin" / "plugin.yaml").read_text(), re.M).group(1)
        self.assertEqual(self.api.VERSION, yaml_v)
        self.assertEqual(self.api.VERSION, json.loads((root / "package.json").read_text())["version"])
        catalog = root / "catalog" / "ultimate-dashboard.yaml"  # not part of the public export
        if catalog.exists():
            self.assertEqual(self.api.VERSION, re.search(r'^version:\s*"?([^"\s]+)', catalog.read_text(), re.M).group(1))

    def test_files_stats_only_returned_rows_and_skips_network_paths(self):
        db = sqlite3.connect(self.home / "state.db")
        db.execute("INSERT INTO messages VALUES (9,'s1','assistant',?,?)", ("MEDIA:\\\\h\\s\\u.txt MEDIA://h/s/v.txt MEDIA:/tmp/z.txt", time.time() - 5))
        db.commit(); db.close()
        with mock.patch.object(self.api.os.path, "exists", return_value=True) as ex:
            out = self.api.files(days="7", limit="2")
        self.assertEqual(out["total"], 6)
        self.assertEqual(len(out["files"]), 2)
        self.assertEqual(ex.call_count, sum(f["exists"] is not None for f in out["files"]))
        with mock.patch.object(self.api.os.path, "exists", side_effect=lambda p: p.startswith("/") and not p.startswith("//")) as ex:
            out = self.api.files(days="7", limit="200")
        unc = {f["path"]: f["exists"] for f in out["files"] if f["path"].startswith(("\\\\", "//"))}
        self.assertNotIn("//h/s/v.txt", [c.args[0] for c in ex.call_args_list])
        self.assertEqual(unc, {"\\\\h\\s\\u.txt": None, "//h/s/v.txt": None})

    def test_media_regex(self):
        cases = {
            "MEDIA:/tmp/a.png.": ["/tmp/a.png."],
            "see MEDIA:C:\\Users\\me\\a b.png": ["C:\\Users\\me\\a"],
            "MEDIA:D:/out/a.md`": ["D:/out/a.md"],
            "MEDIA:\\\\srv\\share\\a.pdf)": ["\\\\srv\\share\\a.pdf"],
            "MEDIA:Cool MEDIA:C: MEDIA:C:x MEDIA:": [],
        }
        for text, want in cases.items():
            self.assertEqual(self.api._MEDIA.findall(text), want, text)

    def test_files_finds_windows_paths(self):
        db = sqlite3.connect(self.home / "state.db")
        db.execute("INSERT INTO messages VALUES (9,'s1','assistant',?,?)", ("MEDIA:C:\\x\\w.txt MEDIA:\\\\h\\s\\u.txt", time.time() - 5))
        db.commit(); db.close()
        paths = [f["path"] for f in self.api.files(days="7")["files"]]
        self.assertIn("C:\\x\\w.txt", paths)
        self.assertIn("\\\\h\\s\\u.txt", paths)

    def test_machine_load_fallback(self):
        try:
            import psutil
        except ImportError:
            self.skipTest("psutil missing")
        with mock.patch.object(os, "getloadavg", None, create=True), mock.patch.object(psutil, "getloadavg", create=True, return_value=(1.0, 2.0, 3.0)):
            self.assertEqual(self.api.machine()["load"], [1.0, 2.0, 3.0])
        with mock.patch.object(os, "getloadavg", None, create=True), mock.patch.object(psutil, "getloadavg", create=True, side_effect=OSError):
            out = self.api.machine()
            self.assertTrue(out["available"])
            self.assertIsNone(out["load"])

    def test_machine_cpu_uses_one_shared_baseline(self):
        try:
            import psutil
        except ImportError:
            self.skipTest("psutil missing")
        from collections import namedtuple
        T = namedtuple("T", "user system idle")
        self.api._cpu.update(t=T(10, 10, 80), pct=0.0)
        with mock.patch.object(psutil, "cpu_times", return_value=T(40, 20, 140)):  # +30 +10 busy, +60 idle
            self.assertEqual(self.api.machine()["cpu_percent"], 40.0)
            self.assertEqual(self.api.machine()["cpu_percent"], 40.0, "no tick since: keep the last reading, never 0")

    def test_machine_does_not_expose_the_home_path(self):
        try:
            import psutil  # noqa: F401
        except ImportError:
            self.skipTest("psutil missing")
        self.assertNotIn("path", self.api.machine()["disk"])

    def test_machine_disk_is_derived_from_free(self):
        try:
            import psutil
        except ImportError:
            self.skipTest("psutil missing")
        from collections import namedtuple
        U = namedtuple("U", "total used free")
        with mock.patch.object(psutil, "disk_usage", return_value=U(100, 50, 20)):  # APFS: used < total - free
            self.assertEqual(self.api.machine()["disk"], {"total": 100, "free": 20, "used": 80, "percent": 80.0})

    def test_workers(self):
        out = self.api.workers(days="30")
        self.assertEqual(out["total"], 1)
        self.assertEqual(out["workers"][0]["title"], "Read files")

    def test_no_db_is_unavailable(self):
        (self.home / "state.db").unlink()
        self.assertFalse(self.api.files()["available"])
        self.assertFalse(self.api.workers()["available"])
        self.assertFalse(self.api.spend()["available"])
        self.assertFalse(self.api.activity()["available"])

    def test_db_never_written(self):
        before = (self.home / "state.db").stat().st_mtime_ns
        self.api.files(days="30"); self.api.workers(days="30"); self.api.spend(days="30"); self.api.activity(days="30")
        self.assertEqual((self.home / "state.db").stat().st_mtime_ns, before)

    def job_dir(self, id="job1"):
        d = self.home / "cron" / "output" / id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def test_job_output_rejects_invalid_ids(self):
        for bad in ("../x", "", None, "a" * 65, "عمل", "a.b", "a/b", "ok\n"):
            self.assertEqual(self.api.job_output(bad), {"available": False, "reason": "invalid job id"}, bad)
        self.assertTrue(self.api.job_output("a" * 64)["available"])

    def test_job_output_missing_folder_and_empty_folder(self):
        want = {"available": True, "job_id": "nope", "runs": 0, "latest": None}
        self.assertEqual(self.api.job_output("nope"), want)
        self.job_dir("nope")
        (self.home / "cron" / "output" / "nope" / "note.txt").write_text("x")
        self.assertEqual(self.api.job_output("nope"), want)

    def test_job_output_picks_newest_file_by_name(self):
        d = self.job_dir()
        (d / "2026-11-05_00-21-28.md").write_text("old")
        (d / "2026-11-06_09-00-00.md").write_bytes("# new\nمرحبا".encode())  # bytes: write_text turns \n into \r\n on Windows
        (d / "2026-11-04_23-59-59.md").write_text("older")
        os.utime(d / "2026-11-04_23-59-59.md", (time.time() + 99, time.time() + 99))  # mtime must not decide
        out = self.api.job_output("job1")
        self.assertEqual(out["runs"], 3)
        self.assertEqual(out["latest"]["file"], "2026-11-06_09-00-00.md")
        self.assertEqual(out["latest"]["at"], "2026-11-06T09:00:00")
        self.assertEqual(out["latest"]["text"], "# new\nمرحبا")
        self.assertEqual(out["latest"]["size"], len("# new\nمرحبا".encode()))
        self.assertFalse(out["latest"]["truncated"])
        self.assertAlmostEqual(out["latest"]["mtime"], (d / "2026-11-06_09-00-00.md").stat().st_mtime)

    def test_job_output_truncates_at_64_kib(self):
        d = self.job_dir()
        n = self.api.MAX_JOB_OUTPUT_BYTES
        (d / "2026-11-06_09-00-00.md").write_bytes(b"a" * n)
        out = self.api.job_output("job1")["latest"]
        self.assertEqual((len(out["text"]), out["truncated"]), (n, False))
        (d / "2026-11-06_09-00-00.md").write_bytes(b"a" * (n + 10))
        out = self.api.job_output("job1")["latest"]
        self.assertEqual((len(out["text"]), out["size"], out["truncated"]), (n, n + 10, True))

    def test_job_output_replaces_invalid_utf8(self):
        (self.job_dir() / "2026-11-06_09-00-00.md").write_bytes(b"ok \xff\xfe end")
        self.assertEqual(self.api.job_output("job1")["latest"]["text"], "ok \ufffd\ufffd end")

    def test_job_output_unparsable_name_gives_null_at(self):
        (self.job_dir() / "weird.md").write_text("hi")
        out = self.api.job_output("job1")["latest"]
        self.assertEqual((out["file"], out["at"], out["text"]), ("weird.md", None, "hi"))

    def test_job_output_refuses_symlinks_out_of_the_output_folder(self):
        outside = self.home / "elsewhere"; outside.mkdir()
        (outside / "2026-11-06_09-00-00.md").write_text("secret")
        (self.home / "cron" / "output").mkdir(parents=True)
        (self.home / "cron" / "output" / "link").symlink_to(outside, target_is_directory=True)
        out = self.api.job_output("link")
        self.assertFalse(out["available"])
        self.assertNotIn("secret", json.dumps(out))
        d = self.job_dir()  # a symlinked file is not listed either
        secret = self.home / "secret.md"; secret.write_text("secret")
        (d / "2026-11-06_09-00-00.md").symlink_to(secret)
        self.assertEqual(self.api.job_output("job1")["runs"], 0)

    def test_job_output_never_writes(self):
        d = self.job_dir(); f = d / "2026-11-06_09-00-00.md"; f.write_text("x")
        before = (f.stat().st_mtime_ns, sorted(p.name for p in d.iterdir()))
        self.api.job_output("job1")
        self.assertEqual((f.stat().st_mtime_ns, sorted(p.name for p in d.iterdir())), before)

    def test_state_accepts_job_result_instance_ids(self):
        doc = {"schema": 1, "views": [{"id": "v", "name": "", "cards": [
            {"id": "job-result~a1b2c3", "size": "l", "options": {"job": "3b0257a90de4"}}]}]}
        self.assertEqual(put(self.api, {"base_rev": 0, "doc": doc})["rev"], 1)
        self.assertEqual(run(self.api.get_state())["doc"], doc)

    def test_health(self):
        self.assertTrue(run(self.api.health())["ok"])


if __name__ == "__main__":
    unittest.main()
