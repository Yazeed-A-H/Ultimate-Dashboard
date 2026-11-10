"""GET /spend: own fixture (the shared one has no token columns). Imports the loader from test_api."""
import json
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from test_api import load


class SpendTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        db = sqlite3.connect(self.home / "state.db")
        db.executescript("""
          CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, model TEXT, started_at REAL, input_tokens INT, output_tokens INT,
            cache_read_tokens INT, estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT, system_prompt TEXT);
          CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, content TEXT);
        """)
        now = time.time()
        rows = [
            ("a1", "Big one", "opus", now - 60, 1000, 500, 99999, 1.5, None, "estimated", "SECRET PROMPT"),
            ("a2", "Small", "opus", now - 50, 100, 50, 0, 0.25, None, "estimated", None),
            ("b1", "Plan", "codex", now - 40, 300, 200, 5, 0, None, "included", None),
            ("b2", "Plan 2", "codex", now - 30, 10, 10, 0, 0, None, "included", None),
            ("c1", None, "", now - 20, None, None, None, None, None, "unknown", None),
            ("old", "Old", "opus", now - 40 * 86400, 5000, 5000, 0, 9, None, "estimated", None),
        ]
        db.executemany("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
        db.execute("INSERT INTO messages VALUES (1,'a1','PRIVATE MESSAGE TEXT')")
        db.commit()
        db.close()
        self.api = load(self.home)

    def tearDown(self):
        self.tmp.cleanup()

    def test_totals_models_and_top(self):
        out = self.api.spend(days="7")
        self.assertTrue(out["available"])
        # cache tokens are excluded; the 40-day-old session is outside the range
        self.assertEqual(out["totals"], {"tokens": 2170, "cost": 1.75, "sessions": 5, "included": 2, "unknown": 1})
        self.assertEqual([m["model"] for m in out["models"]], ["opus", "codex", "unknown"])
        codex = out["models"][1]
        self.assertEqual((codex["tokens"], codex["sessions"], codex["included"], codex["unknown"]), (520, 2, 2, 0))
        unk = out["models"][2]  # empty model name and NULL tokens still count as a session
        self.assertEqual((unk["tokens"], unk["unknown"], unk["sessions"]), (0, 1, 1))
        self.assertEqual([s["id"] for s in out["top"]], ["a1", "b1", "a2", "b2"])  # no zero-token session
        self.assertEqual(out["top"][0], {"id": "a1", "title": "Big one", "model": "opus", "tokens": 1500, "cost": 1.5, "cost_status": "estimated"})

    def test_range_changes_totals(self):
        self.assertEqual(self.api.spend(days="90")["totals"]["tokens"], 12170)

    def test_privacy_no_content_or_actual_cost(self):
        out = self.api.spend(days="30")
        text = json.dumps(out)
        for bad in ("PRIVATE MESSAGE TEXT", "SECRET PROMPT", "actual", str(self.home)):
            self.assertNotIn(bad, text)
        self.assertEqual(set(out), {"available", "since", "totals", "models", "top"})
        self.assertEqual(set(out["top"][0]), {"id", "title", "model", "tokens", "cost", "cost_status"})
        self.assertEqual(set(out["models"][0]), {"model", "tokens", "cost", "sessions", "included", "unknown"})

    def test_old_schema_is_unavailable_not_an_error(self):
        db = sqlite3.connect(self.home / "state.db")
        db.execute("ALTER TABLE sessions DROP COLUMN cost_status")
        db.commit(); db.close()
        out = self.api.spend(days="7")
        self.assertFalse(out["available"])
        self.assertNotIn("PRIVATE", out["reason"])

    def test_no_db_and_never_written(self):
        before = (self.home / "state.db").stat().st_mtime_ns
        self.api.spend(days="30")
        self.assertEqual((self.home / "state.db").stat().st_mtime_ns, before)
        (self.home / "state.db").unlink()
        self.assertFalse(self.api.spend()["available"])


if __name__ == "__main__":
    unittest.main()
