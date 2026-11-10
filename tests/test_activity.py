"""GET /activity: failure rule, filters and privacy, on a state.db that has the real messages columns."""
from __future__ import annotations

import json
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path

from test_api import load


class ActivityTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.db = sqlite3.connect(self.home / "state.db")
        self.db.executescript("""
          CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, source TEXT);
          CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL, tool_name TEXT, active INT DEFAULT 1);
          INSERT INTO sessions VALUES ('s1','Docs','desktop'), ('sub','Sub','subagent');
        """)
        self.now = time.time()
        self.api = load(self.home)

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def add(self, content, tool: str | None = "terminal", sid="s1", age=10, active=1, role="tool"):
        self.db.execute("INSERT INTO messages (session_id, role, content, timestamp, tool_name, active) VALUES (?,?,?,?,?,?)",
                        (sid, role, content if isinstance(content, str) or content is None else json.dumps(content), self.now - age, tool, active))
        self.db.commit()

    def test_failure_rule(self):
        # (result, ok, tool): terminal fails on exit_code only; other tools on error / message+success false / status (agent/display.py)
        cases = [({"output": "x", "exit_code": 1, "error": None}, False), ({"output": "x", "exit_code": 0, "error": None}, True),
                 ({"exit_code": 1}, True, "process_manage"), ({"error": "x"}, True), ({"success": False, "error": "boom"}, True),  # not terminal's rule
                 ({"success": False, "error": "boom"}, False, "web_search"), ({"success": False}, True, "web_search"),
                 ({"success": False, "message": "m"}, False, "web_search"), ({"message": "m"}, True, "web_search"),
                 ({"status": "failed"}, False, "web_search"), ({"status": "ok"}, True, "web_search"), ({"error": None, "exit_code": 0}, True),
                 ({"result": {"error": "nested"}}, True, "web_search"), ({"error": ""}, True, "web_search"), ({"error": "x"}, False, "web_search"),
                 ("<untrusted_tool_result>{\"success\": false}</untrusted_tool_result>", True), ("plain text", True),
                 ("{not json", True), ("[1,2]", True), ("5", True), (None, True)]
        for i, (content, ok, *tool) in enumerate(cases):
            self.add(content, age=i + 1, tool=(tool or ["terminal"])[0])
        out = self.api.activity(days="7", limit="30")
        self.assertTrue(out["available"])
        self.assertEqual(out["calls"], len(cases))  # a malformed row does not abort the query
        self.assertEqual([f["ok"] for f in out["feed"]], [c[1] for c in cases])  # newest first = age order
        self.assertEqual(out["failed"], sum(not c[1] for c in cases))

    def test_filters_window_and_limit(self):
        self.add({"exit_code": 0}, tool="a")
        self.add({"exit_code": 0}, tool="b", active=0)  # archived by compaction
        self.add({"exit_code": 0}, tool="c", sid="sub")  # subagent
        self.add("x", tool="d", role="assistant")
        self.add({"exit_code": 0}, tool="e", age=3 * 86400)
        self.add({"exit_code": 0}, tool=None)
        self.assertEqual([t["tool"] for t in self.api.activity(days="1")["tools"]], ["a"])
        self.assertEqual({t["tool"] for t in self.api.activity(days="7")["tools"]}, {"a", "e"})
        for i in range(40):
            self.add({"exit_code": 0}, tool="t")
        self.assertEqual(len(self.api.activity(days="1", limit="999")["feed"]), 30)
        self.assertEqual(len(self.api.activity(days="1")["feed"]), 10)

    def test_by_tool_order_and_empty(self):
        out = self.api.activity(days="1")
        self.assertEqual((out["calls"], out["failed"], out["tools"], out["feed"]), (0, 0, [], []))
        for c in ({"exit_code": 0},) * 3 + ({"exit_code": 2},):
            self.add(c, tool="terminal")
        self.add({"success": False, "error": "x"}, tool="flaky")
        out = self.api.activity(days="1")
        self.assertEqual([(t["tool"], t["calls"], t["failed"]) for t in out["tools"]], [("terminal", 4, 1), ("flaky", 1, 1)])

    def test_privacy_keys(self):
        self.add({"output": "SECRET-OUTPUT", "exit_code": 1, "error": "SECRET-ERROR"})
        out = self.api.activity(days="1")
        self.assertEqual(set(out["feed"][0]), {"tool", "session_id", "session_title", "at", "ok"})
        self.assertEqual(set(out["tools"][0]), {"tool", "calls", "failed"})
        self.assertNotIn("SECRET", json.dumps(out))

    def test_old_schema_is_unavailable(self):
        self.db.executescript("ALTER TABLE messages RENAME TO m2; CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL);")
        self.assertFalse(self.api.activity()["available"])


if __name__ == "__main__":
    unittest.main()
