"""Backend tests: temp HERMES_HOME with a minimal state.db; runs without Hermes installed."""
import asyncio
import contextlib
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
    sys.modules["hermes_constants"] = types.SimpleNamespace(get_hermes_home=lambda: home, get_hermes_dir=lambda new, old, *, home=home: home / new)
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


HEADER = ("=== Hermes subagent live transcript ===\ndelegation: deleg_aabbccdd   task: 0\ngoal: Read the repo\nstarted: {st}\n"
          "(append-only; streams while the subagent runs — tail -f me)\n" + "=" * 40 + "\n")


class LiveTest(unittest.TestCase):
    """GET /live: worker logs shaped like tools/delegation_live_log.py writes them, and Main chats in a state.db with the real messages columns."""
    FMT = "%Y-%m-%d %H:%M:%S"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.root = self.home / "cache" / "delegation" / "live"
        self.root.mkdir(parents=True)
        self.now = time.time()
        self.db = sqlite3.connect(self.home / "state.db")
        self.db.executescript("""
          CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, source TEXT, parent_session_id TEXT, started_at REAL);
          CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, active INT DEFAULT 1);
          INSERT INTO sessions VALUES ('s1', 'Plan the release', 'desktop', NULL, 1), ('t1', 'T', 'tool', NULL, 1);
        """)
        self.api = load(self.home)

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def stamp(self, age=60):
        return datetime.fromtimestamp(self.now - age).strftime(self.FMT)

    def folder(self, name="deleg_aabbccdd", age=60, goals=("Read the repo",), completed=None, logs=None, log_age=5, model="m1", raw_manifest=None):
        d = self.root / name
        d.mkdir()
        mf = {"delegation_id": name, "started": self.stamp(age), "task_count": len(goals), "model": model, "provider": None,
              "tasks": [{"index": i, "goal": g, "log": None, "status": "running"} for i, g in enumerate(goals)]}
        if completed is not None:
            mf["completed"] = self.stamp(completed)
        (d / "manifest.json").write_text(raw_manifest if raw_manifest is not None else json.dumps(mf, ensure_ascii=False), "utf-8")
        for i, text in (logs or {}).items():
            (d / f"task-{i}.log").write_bytes((HEADER.format(st=self.stamp(age)) + text).encode())
            os.utime(d / f"task-{i}.log", (self.now - log_age, self.now - log_age))
        return d

    def at(self, age):  # HH:MM:SS as Hermes writes it
        return datetime.fromtimestamp(self.now - age).strftime("%H:%M:%S")

    def lines(self, *rows):  # (age, role, text)
        return "".join(f"{self.at(a)} {r:<9}| {t}\n" for a, r, t in rows)

    def test_log_steps_last_now_and_privacy(self):
        log = self.lines((50, "user", "kickoff: SECRET-KICKOFF"), (50, "start", "SECRET-START"), (45, "tool", "-> terminal(git status -sb)"),
                         (44, "result", "terminal ok 1.2s: SECRET-RESULT"), (43, "think", "SECRET-THINK"), (42, "assistant", "SECRET-ASSISTANT"),
                         (40, "tool", "-> read_file(/tmp/a.py)"), (39, "result", "read_file ERROR 0.3s: SECRET-ERROR"), (38, "weird", "SECRET-UNKNOWN"),
                         (30, "tool", "-> search_files(بحث عن ملف)"), (29, "result", "search_files ok: نتيجة"),
                         (20, "tool", "-> terminal(echo مرحبا)")) + f"{self.at(10)} tool     | -> read_f"  # cut mid-write, no newline
        self.folder(logs={0: log})
        out = self.api.live()
        self.assertTrue(out["available"] and out["running"])
        (g,), (k,) = out["groups"], out["groups"][0]["tasks"]
        self.assertTrue(g["running"])
        self.assertEqual((k["index"], k["goal"], k["model"], k["status"], k["ended"], k["steps"], k["truncated"]), (0, "Read the repo", "m1", "running", None, 4, False))
        self.assertEqual([(x["tool"], x["ok"], x["secs"]) for x in k["last"]], [("terminal", True, 1.2), ("read_file", False, 0.3), ("search_files", True, 1.0)])  # no `1.2s` on the last: result time minus tool time
        for x, age in zip(k["last"], (45, 40, 30)):
            self.assertAlmostEqual(x["at"], self.now - age, delta=1)  # `at` is the START of the step (its tool line)
        self.assertEqual((k["now"]["tool"], k["now"]["text"]), ("terminal", "echo مرحبا"))  # the redacted preview of the running step is the only text shown
        self.assertAlmostEqual(k["now"]["at"], self.now - 20, delta=1)
        self.assertEqual(k["started"], g["started"])
        self.assertAlmostEqual(g["started"], self.now - 60, delta=1)
        raw = json.dumps(out, ensure_ascii=False)
        for word in ("SECRET", "kickoff", "نتيجة"):
            self.assertNotIn(word, raw)

    def test_final_line_gives_status_and_never_the_summary(self):
        log = self.lines((30, "tool", "-> terminal(ls)"), (29, "result", "terminal ok 0.1s: x"), (5, "final", "status=completed duration=25.0s summary: SECRET-SUMMARY"),
                         (4, "final", "end status=completed"))
        self.folder(logs={0: log})
        k = self.api.live()["groups"][0]["tasks"][0]
        self.assertEqual((k["status"], k["now"], k["steps"]), ("completed", None, 1))
        self.assertAlmostEqual(k["ended"], self.now - 4, delta=1)
        self.assertNotIn("SECRET", json.dumps(self.api.live()))
        self.assertEqual(self.api.live()["groups"][0]["running"], True)  # no manifest `completed` yet: the batch still runs

    def test_parallel_calls_finish_in_any_order(self):
        self.folder(logs={0: self.lines((9, "tool", "-> terminal(a)"), (8, "tool", "-> read_file(b)"), (7, "result", "terminal ok 0.5s: x"))})
        k = self.api.live()["groups"][0]["tasks"][0]
        self.assertEqual((k["now"]["tool"], k["steps"], len(k["last"])), ("read_file", 2, 1))

    def test_parallel_calls_of_one_tool_pair_first_in_first_out(self):
        self.folder(logs={0: self.lines((20, "tool", "-> terminal(a)"), (19, "tool", "-> terminal(b)"), (18, "result", "terminal ok 1.0s: x"), (15, "result", "terminal ERROR 2.0s: x"))})
        k = self.api.live()["groups"][0]["tasks"][0]
        self.assertEqual([(x["ok"], x["secs"]) for x in k["last"]], [(True, 1.0), (False, 2.0)])
        self.assertAlmostEqual(k["last"][0]["at"], self.now - 20, delta=1)
        self.assertAlmostEqual(k["last"][1]["at"], self.now - 19, delta=1)
        self.assertEqual((k["now"], k["steps"]), (None, 2))

    def test_last_keeps_the_newest_400_steps_oldest_first(self):
        self.folder(logs={0: "".join(f"12:00:00 tool     | -> terminal({i})\n12:00:00 result   | terminal ok {i}.0s: x\n" for i in range(450))})
        k = self.api.live()["groups"][0]["tasks"][0]
        self.assertEqual((len(k["last"]), k["steps"], k["last"][0]["secs"], k["last"][-1]["secs"]), (400, 450, 50.0, 449.0))


    def test_midnight_wrap_adds_a_day(self):
        d = self.folder(logs={0: "23:59:55 tool     | -> terminal(a)\n23:59:58 result   | terminal ok 1.0s: x\n00:00:05 tool     | -> terminal(b)\n00:00:07 result   | terminal ok 2.0s: x\n"})
        mf = json.loads((d / "manifest.json").read_text())
        mf["started"] = "2026-11-10 23:59:50"
        (d / "manifest.json").write_text(json.dumps(mf))
        k = self.api.live()["groups"][0]["tasks"][0]
        a, b = (x["at"] for x in k["last"])
        self.assertEqual(b - a, 10)
        self.assertEqual(datetime.fromtimestamp(a).strftime(self.FMT), "2026-11-10 23:59:55")
        self.assertEqual(datetime.fromtimestamp(b).strftime(self.FMT), "2026-11-11 00:00:05")

    def test_big_log_is_read_from_the_end(self):
        row = "12:00:00 tool     | -> terminal(" + "x" * 50 + ")\n"
        n = self.api.MAX_LIVE_LOG_BYTES // len(row) + 3000
        self.folder(logs={0: row * n})
        k = self.api.live()["groups"][0]["tasks"][0]
        self.assertTrue(k["truncated"])
        self.assertTrue(self.api.MAX_LIVE_LOG_BYTES // len(row) - 2 <= k["steps"] <= self.api.MAX_LIVE_LOG_BYTES // len(row) + 1, k["steps"])
        self.assertEqual(k["now"]["text"], "x" * 50)  # the partial first line was dropped, so no half-line is read as a step

    def test_bad_folders_and_manifests_are_skipped(self):
        for bad in ("deleg_zzzzzzzz", "deleg_aabbccd", "deleg_aabbccdd-x", "other", "deleg_AABBCCDD"):
            self.folder(bad, logs={0: self.lines((5, "tool", "-> terminal(x)"))})
        self.folder("deleg_00000001", raw_manifest="{not json", logs={0: ""})
        self.folder("deleg_00000002", raw_manifest=json.dumps({"started": self.stamp(), "tasks": [], "pad": "x" * 70000}), logs={0: ""})  # over the 64 KB read cap: cut JSON
        self.folder("deleg_00000003", raw_manifest="[1]")
        self.folder("deleg_00000004", raw_manifest=json.dumps({"started": "yesterday", "tasks": []}))
        self.folder("deleg_00000005-2", logs={0: self.lines((5, "tool", "-> terminal(x)"))})  # a retried id is allowed
        (self.root / "deleg_00000006").write_text("a file, not a folder")
        self.assertEqual([g["id"] for g in self.api.live()["groups"]], ["deleg_00000005-2"])

    def test_symlinked_folder_and_log_are_skipped(self):
        out = self.home / "elsewhere"
        out.mkdir()
        (out / "manifest.json").write_text(json.dumps({"started": self.stamp(), "tasks": [{"index": 0, "goal": "SECRET-GOAL"}]}))
        (self.root / "deleg_11111111").symlink_to(out, target_is_directory=True)
        d = self.folder(logs={})
        secret = self.home / "secret.log"
        secret.write_text(self.lines((5, "tool", "-> terminal(SECRET-TOOL)")))
        (d / "task-0.log").symlink_to(secret)
        res = self.api.live()
        self.assertEqual([g["id"] for g in res["groups"]], ["deleg_aabbccdd"])
        k = res["groups"][0]["tasks"][0]
        self.assertEqual((k["steps"], k["now"]), (0, None))
        self.assertFalse(res["groups"][0]["running"])  # no readable log, so no sign of life
        self.assertNotIn("SECRET", json.dumps(res))

    def test_symlinked_manifest_is_skipped(self):
        out = self.home / "elsewhere"
        out.mkdir()
        (out / "manifest.json").write_text(json.dumps({"started": self.stamp(), "tasks": [{"index": 0, "goal": "SECRET-GOAL"}]}))
        d = self.folder(logs={})
        (d / "manifest.json").unlink()
        (d / "manifest.json").symlink_to(out / "manifest.json")
        self.assertEqual(self.api.live()["groups"], [])
        self.assertNotIn("SECRET", json.dumps(self.api.live()))

    def test_finished_batches_stay_30_minutes(self):
        self.folder("deleg_00000001", age=3600, completed=29 * 60, logs={0: self.lines((29 * 60 + 5, "tool", "-> terminal(a)"))}, log_age=29 * 60)
        self.folder("deleg_00000002", age=3600, completed=31 * 60, logs={0: ""}, log_age=31 * 60)
        res = self.api.live()
        self.assertEqual([g["id"] for g in res["groups"]], ["deleg_00000001"])
        g = res["groups"][0]
        self.assertEqual((g["running"], g["tasks"][0]["status"], res["running"]), (False, "stalled", False))  # manifest task status is still "running": it never finished
        self.assertAlmostEqual(g["completed"], self.now - 29 * 60, delta=1)
        self.assertAlmostEqual(g["tasks"][0]["ended"], g["completed"], delta=1)

    def test_manifest_status_is_used_once_the_batch_completed(self):
        d = self.folder(age=600, completed=60, logs={0: self.lines((300, "tool", "-> terminal(a)"))}, log_age=60)
        mf = json.loads((d / "manifest.json").read_text())
        mf["tasks"][0]["status"] = "interrupted"
        (d / "manifest.json").write_text(json.dumps(mf))
        self.assertEqual(self.api.live()["groups"][0]["tasks"][0]["status"], "interrupted")

    def test_quiet_logs_make_a_batch_stalled_then_history(self):
        self.folder("deleg_00000001", age=3000, logs={0: self.lines((1200, "tool", "-> terminal(a)"))}, log_age=20 * 60)  # 20 min quiet: stalled
        self.folder("deleg_00000002", age=9000, logs={0: self.lines((3000, "tool", "-> terminal(a)"))}, log_age=50 * 60)  # 50 min quiet: left behind by a crash, history
        res = self.api.live()
        self.assertEqual([g["id"] for g in res["groups"]], ["deleg_00000001"])
        k = res["groups"][0]["tasks"][0]
        self.assertEqual((res["groups"][0]["running"], k["status"], k["now"], res["running"]), (False, "stalled", None, False))
        self.assertEqual(k["steps"], 1)

    def test_groups_newest_first_capped(self):
        for i in range(10):
            self.folder(f"deleg_0000000{i}", age=100 + i, goals=[f"g{j}" for j in range(12)], logs={0: self.lines((5, "tool", "-> terminal(a)"))})
        res = self.api.live()
        self.assertEqual([g["id"] for g in res["groups"]], [f"deleg_0000000{i}" for i in range(8)])
        self.assertEqual(len(res["groups"][0]["tasks"]), 10)

    def sub(self, sid, title, parent="s1", age=60):
        self.db.execute("INSERT INTO sessions VALUES (?,?,?,?,?)", (sid, title, "subagent", parent, self.now - age))
        self.db.commit()

    def test_parent_is_found_by_start_and_title_prefix(self):
        goal = "In /home/u/project, do the thing\n  with   care and more words after"
        self.folder(goals=[goal])
        self.sub("w1", "Subagent: In /home/u/project, do the thing with… #2", age=62)
        self.assertEqual(self.api.live()["groups"][0]["parent"], "s1")
        self.assertEqual([m["id"] for m in self.api.live()["mains"]], ["s1"])

    def test_parent_of_two_similar_chats_is_the_closest_start(self):
        goal = "Summarise the repository structure and the tests"
        self.folder("deleg_aaaaaaaa", age=60, goals=[goal])
        self.folder("deleg_bbbbbbbb", age=57, goals=[goal])
        self.sub("wa", "Subagent: Summarise the repository structure…", parent="sA", age=60)
        self.sub("wb", "Subagent: Summarise the repository structure…", parent="sB", age=57)
        by = {g["id"]: g["parent"] for g in self.api.live()["groups"]}
        self.assertEqual(by, {"deleg_aaaaaaaa": "sA", "deleg_bbbbbbbb": "sB"})

    def test_parent_matched_by_most_tasks_wins(self):
        self.folder(goals=["Read the repo", "Check the build"])
        self.sub("w1", "Subagent: Read the repo", parent="sB", age=60)  # B matches one task, exactly at the start
        self.sub("w2", "Subagent: Read the repo", parent="sA", age=58)
        self.sub("w3", "Subagent: Check the build", parent="sA", age=58)
        self.assertEqual(self.api.live()["groups"][0]["parent"], "sA")

    def test_untitled_subagent_rows_resolve_the_parent(self):
        self.folder(goals=["Read the repo", "Check the build"])
        self.sub("w1", None, parent="sA")
        self.sub("w2", "", parent="sA", age=59)
        self.assertEqual(self.api.live()["groups"][0]["parent"], "sA")

    def test_titled_match_beats_untitled_rows_of_another_parent(self):
        self.folder(goals=["Read the repo"])
        self.sub("w1", "Subagent: Read the repo", parent="sA", age=58)
        self.sub("w2", None, parent="sB")
        self.sub("w3", None, parent="sB")
        self.assertEqual(self.api.live()["groups"][0]["parent"], "sA")

    def test_untitled_rows_of_two_parents_resolve_each_folder_to_the_closer(self):
        self.folder("deleg_aaaaaaaa", age=60, goals=["Read the repo"])
        self.folder("deleg_bbbbbbbb", age=57, goals=["Read the repo"])
        self.sub("wa", None, parent="sA", age=60)
        self.sub("wb", None, parent="sB", age=57)
        by = {g["id"]: g["parent"] for g in self.api.live()["groups"]}
        self.assertEqual(by, {"deleg_aaaaaaaa": "sA", "deleg_bbbbbbbb": "sB"})

    def worker(self, sid, parent, goal, age=60):  # an untitled Worker of a one-shot chat: its first message carries the goal after a CONTEXT block
        self.sub(sid, None, parent=parent, age=age)
        self.msg(sid, "user", age, content=f"CONTEXT: a long\n  background...\n\nTASK:\n{goal}\n")

    def test_title_cut_from_the_context_block_is_matched_by_the_goal_text(self):
        self.folder("deleg_aaaaaaaa", age=60, goals=["Read the repository layout"])
        self.sub("wa", "Subagent: CONTEXT: #2", parent="sA", age=60)
        self.msg("wa", "user", 60, content="CONTEXT: a long\n  background...\n\nTASK:\nRead the repository layout\n")
        self.sub("wx", "Subagent: CONTEXT:", parent="sX", age=60)  # another chat's Worker: its message holds another goal
        self.msg("wx", "user", 60, content="CONTEXT: other\n\nTASK:\nCheck the build output\n")
        self.assertEqual(self.api.live()["groups"][0]["parent"], "sA")

    def test_untitled_rows_started_together_are_told_apart_by_the_goal_text(self):
        self.folder("deleg_aaaaaaaa", age=60, goals=["Read the repository layout"])
        self.folder("deleg_bbbbbbbb", age=60, goals=["Check the build output"])
        self.worker("wb", "sB", "Check the  build output")  # inserted first: a time-only vote would give it to both
        self.worker("wa", "sA", "Read the repository layout")
        by = {g["id"]: g["parent"] for g in self.api.live()["groups"]}
        self.assertEqual(by, {"deleg_aaaaaaaa": "sA", "deleg_bbbbbbbb": "sB"})

    def test_untitled_rows_of_folders_with_two_and_three_tasks(self):
        ga, gb = ["Read the repository layout", "Run the unit tests"], ["Check the build output", "Lint the sources", "Summarise the changelog"]
        self.folder("deleg_aaaaaaaa", age=60, goals=ga)
        self.folder("deleg_bbbbbbbb", age=60, goals=gb)
        for i, g in enumerate(gb):
            self.worker(f"wb{i}", "sB", g, age=60 - i % 2)
        for i, g in enumerate(ga):
            self.worker(f"wa{i}", "sA", g, age=60 - i % 2)
        by = {g["id"]: g["parent"] for g in self.api.live()["groups"]}
        self.assertEqual(by, {"deleg_aaaaaaaa": "sA", "deleg_bbbbbbbb": "sB"})

    def test_untitled_row_without_a_goal_in_its_message_keeps_the_vote_fallback(self):
        self.folder(goals=["Read the repository layout"])
        self.worker("w1", "sA", "something else entirely")
        self.sub("w2", None, parent="sB", age=59)  # no message row at all
        self.assertEqual(self.api.live()["groups"][0]["parent"], "sA")  # closest start

    def test_goal_text_is_compared_but_never_returned(self):
        self.folder(goals=["Read the repository layout"])
        self.worker("w1", "sA", "Read the repository layout")
        self.assertEqual(self.api.live()["groups"][0]["parent"], "sA")
        self.assertNotIn("background", json.dumps(self.api.live()))

    def test_untitled_row_without_a_messages_table_does_not_raise(self):
        self.folder(goals=["Read the repository layout"])
        self.sub("w1", None, parent="sA")
        self.db.execute("ALTER TABLE messages RENAME TO messages_gone"); self.db.commit()
        with contextlib.closing(self.api._db()) as conn:  # live() itself needs messages further on; this checks the parent lookup alone
            self.assertEqual(self.api._live_parent(conn, self.now - 60, ["Read the repository layout"]), "sA")

    def test_parent_none_when_title_or_time_differ(self):
        self.folder(goals=["Read the repo"])
        self.sub("w1", "Subagent: Something else entirely…")
        self.sub("w2", "Subagent: Read the repo", age=20)  # 40 s from the start
        self.sub("w3", None, age=20)  # untitled rows count only inside the window
        res = self.api.live()
        self.assertEqual((res["groups"][0]["parent"], res["mains"]), (None, []))

    def tool(self, sid, name, content, age, call="c"):
        self.db.execute("INSERT INTO messages (session_id, role, content, timestamp, tool_call_id, tool_name) VALUES (?, 'tool', ?, ?, ?, ?)", (sid, json.dumps(content), self.now - age, call, name))
        self.db.commit()

    def msg(self, sid, role, age, tool_calls=None, content="SECRET-CONTENT"):
        self.db.execute("INSERT INTO messages (session_id, role, content, timestamp, tool_calls) VALUES (?,?,?,?,?)", (sid, role, content, self.now - age, json.dumps(tool_calls) if tool_calls else None))
        self.db.commit()

    def test_mains_steps_last_and_pending_tool_calls(self):
        self.msg("s1", "user", 300)
        self.tool("s1", "terminal", {"exit_code": 0, "output": "SECRET-OUT"}, 200, "a")
        self.msg("s1", "user", 100)
        for i in range(14):
            self.tool("s1", "read_file" if i % 2 else "terminal", {"exit_code": 1 if i == 12 else 0, "error": None}, 90 - i, f"r{i}")
        self.msg("s1", "assistant", 5, [{"id": "p1", "call_id": "p1", "type": "function", "function": {"name": "terminal", "arguments": "{\"command\": \"SECRET-ARG\"}"}},
                                        {"id": "p2", "call_id": "p2", "type": "function", "function": {"name": "delegate_task", "arguments": "{\"goal\": \"SECRET-GOAL\"}"}}])
        self.tool("s1", "terminal", {"exit_code": 0}, 3, "p1")  # p1 already has its row, p2 is still running
        self.tool("t1", "terminal", {"exit_code": 0}, 3, "x")  # tool sessions never count
        res = self.api.live()
        (m,) = res["mains"]
        self.assertEqual((m["id"], m["title"], m["source"]), ("s1", "Plan the release", "desktop"))
        self.assertEqual(m["steps"], 15)  # tool rows after the newest user row
        self.assertEqual(len(m["last"]), 15)  # only this turn: r0..r13 and p1, not the tool row before the second user row
        self.assertEqual([x["ok"] for x in m["last"]], [True] * 12 + [False, True, True])  # r12 (a terminal call, exit_code 1) failed
        self.assertEqual(m["last"][-1]["tool"], "terminal")
        self.assertAlmostEqual(m["turn_at"], self.now - 100, delta=1)
        # `at` = when the row before it was written (the user row, a result, the assistant row), `secs` = the gap to the tool row
        for x, (at, secs) in zip((m["last"][0], m["last"][1], m["last"][-1]), ((100, 10), (90, 1), (5, 2))):
            self.assertAlmostEqual(x["at"], self.now - at, delta=1)
            self.assertAlmostEqual(x["secs"], secs, delta=1)
        self.assertEqual(m["now"]["tools"], ["delegate_task"])
        self.assertAlmostEqual(m["now"]["at"], self.now - 5, delta=1)  # the assistant row that made the calls
        self.assertAlmostEqual(m["last_at"], self.now - 3, delta=1)
        self.assertTrue(res["running"])
        self.assertNotIn("SECRET", json.dumps(res))

    def test_mains_without_a_user_row_have_no_turn_and_the_first_step_starts_at_itself(self):
        self.tool("s1", "terminal", {"exit_code": 0}, 30, "a")
        (m,) = self.api.live()["mains"]
        self.assertEqual((m["turn_at"], m["now"], m["steps"], m["last"][0]["secs"]), (None, None, 1, 0.0))
        self.assertAlmostEqual(m["last"][0]["at"], self.now - 30, delta=1)

    def test_mains_last_is_capped_at_400(self):
        self.msg("s1", "user", 900)
        for i in range(405):
            self.tool("s1", "terminal", {"exit_code": 0}, 800 - i, f"c{i}")
        (m,) = self.api.live()["mains"]
        self.assertEqual((m["steps"], len(m["last"])), (405, 400))
        self.assertAlmostEqual(m["last"][-1]["at"], self.now - (800 - 403), delta=1)

    def test_mains_pending_calls_expire_and_quiet_chats_drop_out(self):
        self.msg("s1", "assistant", 20 * 60, [{"id": "p1", "type": "function", "function": {"name": "terminal", "arguments": "{}"}}])
        self.tool("s1", "terminal", {"exit_code": 0}, 120, "z")
        self.tool("old", "terminal", {"exit_code": 0}, 11 * 60, "z")
        self.db.execute("INSERT INTO sessions VALUES ('old', 'Old', 'desktop', NULL, 1)")
        self.db.commit()
        res = self.api.live()
        self.assertEqual([(m["id"], m["now"]) for m in res["mains"]], [("s1", None)])  # a call older than 15 min is not "now"
        self.assertFalse(res["running"])

    def test_missing_live_folder_is_an_empty_answer(self):
        self.root.rmdir()
        res = self.api.live()
        self.assertEqual({k: v for k, v in res.items() if k != "at"}, {"available": True, "running": False, "groups": [], "mains": []})
        self.assertAlmostEqual(res["at"], time.time(), delta=5)

    def test_no_db_is_unavailable_and_nothing_is_written(self):
        d = self.folder(logs={0: self.lines((5, "tool", "-> terminal(a)"))})
        before = [(p.name, p.stat().st_mtime_ns) for p in sorted(d.iterdir())] + [(self.home / "state.db").stat().st_mtime_ns]
        self.api.live()
        self.assertEqual([(p.name, p.stat().st_mtime_ns) for p in sorted(d.iterdir())] + [(self.home / "state.db").stat().st_mtime_ns], before)
        self.db.close()
        (self.home / "state.db").unlink()
        self.assertEqual(self.api.live()["available"], False)


if __name__ == "__main__":
    unittest.main()
