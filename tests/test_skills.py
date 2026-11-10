"""Skills card route: reads ~/.hermes/skills/.usage.json directly (no state.db, no Hermes internals)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_api import load  # noqa: E402


class SkillsUsageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        (self.home / "skills").mkdir()
        self.api = load(self.home)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, data):
        p = self.home / "skills" / ".usage.json"
        p.write_text(data if isinstance(data, str) else json.dumps(data), encoding="utf-8")
        return p

    def test_missing_file_is_available_and_empty(self):
        self.assertEqual(self.api.skills_usage(), {"available": True, "skills": {}})

    def test_dates_only_and_dict_records_only(self):
        rec = {"last_used_at": "2026-11-01T10:00:00+00:00", "created_at": "2026-10-01T00:00:00+00:00", "use_count": 7,
               "last_viewed_at": "x", "created_by": "SECRET-AUTHOR", "path": "/SECRET/dir/skill", "state": "active", "pinned": True}
        p = self.write({"a": rec, "b": "junk", "c": [1], "d": {"last_used_at": 5}})
        before = p.stat().st_mtime_ns
        out = self.api.skills_usage()
        self.assertEqual(out["skills"], {
            "a": {"used": "2026-11-01T10:00:00+00:00", "added": "2026-10-01T00:00:00+00:00"},
            "d": {"used": None, "added": None}})
        self.assertNotIn("SECRET-AUTHOR", json.dumps(out))  # nothing but names and dates
        self.assertNotIn("/SECRET/dir", json.dumps(out))  # a path stored in the file never leaves
        self.assertNotIn(str(self.home), json.dumps(out))
        self.assertEqual(p.stat().st_mtime_ns, before)

    def test_cap(self):
        self.write({f"s{i}": {"last_used_at": None} for i in range(self.api.MAX_USAGE_SKILLS + 50)})
        self.assertEqual(len(self.api.skills_usage()["skills"]), self.api.MAX_USAGE_SKILLS)

    def test_bad_files_are_unavailable(self):
        self.write("{not json")
        self.assertFalse(self.api.skills_usage()["available"])
        self.write("[1, 2]")
        self.assertFalse(self.api.skills_usage()["available"])
        self.write(" " * (self.api.MAX_USAGE_BYTES + 1))
        self.assertFalse(self.api.skills_usage()["available"])

    def test_size_cap_applies_to_valid_json(self):  # padding keeps the file valid JSON, so only the size check can refuse it
        n = self.api.MAX_USAGE_BYTES
        self.write("{}" + " " * (n - 2))
        self.assertTrue(self.api.skills_usage()["available"])
        self.write("{}" + " " * (n - 1))
        self.assertEqual(self.api.skills_usage(), {"available": False, "reason": "usage file is too large"})

    def test_works_without_state_db(self):
        self.assertFalse((self.home / "state.db").exists())
        self.assertTrue(self.api.skills_usage()["available"])


if __name__ == "__main__":
    unittest.main()
