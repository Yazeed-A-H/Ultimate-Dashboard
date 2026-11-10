"""GET /memory: counts like the Hermes store, numbers only (no text, no paths)."""
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_api import load  # noqa: E402

AR = "أحب القهوة العربية"  # 18 chars, 33 bytes
SECRET = "my-secret-token-123"


def config(mem):
    return {"hermes_cli": types.ModuleType("hermes_cli"), "hermes_cli.config": types.SimpleNamespace(load_config_readonly=lambda: {"memory": mem})}


class MemoryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        (self.home / "memories").mkdir()
        self.api = load(self.home)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, text):
        (self.home / "memories" / name).write_text(text, "utf-8")

    def test_chars_not_bytes_and_no_text(self):
        self.write("MEMORY.md", f"\ufeff{AR}\n§\n\n§\n  {SECRET}  \n§\n")
        with mock.patch.dict(sys.modules, config({})):
            out = self.api.memory()
        m = out["files"]["memory"]
        self.assertEqual((m["chars"], m["entries"], m["limit"], m["enabled"]), (len(AR) + 3 + len(SECRET), 2, 2200, True))
        self.assertGreater(len((AR + SECRET).encode()), m["chars"] - 3)  # bytes != chars
        self.assertEqual(out["files"]["user"], {"chars": 0, "limit": 1375, "entries": 0, "mtime": None, "enabled": True})  # missing file
        self.assertEqual(out["provider"], "")
        dump = json.dumps(out, ensure_ascii=False)
        for leak in (AR, SECRET, str(self.home), "MEMORY.md", "USER.md"):
            self.assertNotIn(leak, dump)

    def test_crlf_files_count_like_lf(self):
        raw = f"\ufeff{AR}\n§\n\n§\n  {SECRET}  \n§\n".replace("\n", "\r\n").encode("utf-8")
        (self.home / "memories" / "MEMORY.md").write_bytes(raw)  # bytes, so Windows does not translate them again
        with mock.patch.dict(sys.modules, config({})):
            m = self.api.memory()["files"]["memory"]
        self.assertEqual((m["chars"], m["entries"]), (len(AR) + 3 + len(SECRET), 2))

    def test_config_limits_flags_and_provider(self):
        self.write("USER.md", "x" * 3000)  # over a lowered limit
        cfg = {"memory_char_limit": 500, "user_char_limit": "bad", "memory_enabled": False, "provider": "Hindsight"}
        with mock.patch.dict(sys.modules, config(cfg)):
            out = self.api.memory()
        self.assertEqual((out["files"]["memory"]["limit"], out["files"]["memory"]["enabled"]), (500, False))
        self.assertEqual((out["files"]["user"]["limit"], out["files"]["user"]["chars"]), (1375, 3000))
        self.assertEqual(out["provider"], "Hindsight")
        with mock.patch.dict(sys.modules, config({"provider": "built-in"})):
            self.assertEqual(self.api.memory()["provider"], "")

    def test_config_values_parse_like_hermes(self):  # tools/memory_tool.py:56 int(...), :309 is_truthy_value(v, default=True)
        cfg = {"memory_char_limit": "3000", "user_char_limit": 0, "memory_enabled": "false", "user_profile_enabled": 0}
        with mock.patch.dict(sys.modules, config(cfg)):
            f = self.api.memory()["files"]
        self.assertEqual((f["memory"]["limit"], f["memory"]["enabled"], f["user"]["limit"], f["user"]["enabled"]), (3000, False, 0, False))
        for v, want in (("yes", True), (" ON ", True), ("1", True), ("no", False), ("", False), (None, True), (1, True), (False, False)):
            with mock.patch.dict(sys.modules, config({"memory_enabled": v})):
                self.assertEqual(self.api.memory()["files"]["memory"]["enabled"], want, v)

    def test_no_config_module_uses_defaults_and_read_cap(self):
        self.write("MEMORY.md", "y" * (self.api.MAX_MEMORY_BYTES + 5000))
        with mock.patch.dict(sys.modules, {"hermes_cli.config": None}):  # import raises ImportError
            out = self.api.memory()
        self.assertTrue(out["available"])
        self.assertEqual((out["files"]["memory"]["limit"], out["files"]["memory"]["chars"]), (2200, self.api.MAX_MEMORY_BYTES))

    def test_memory_dir_missing_and_never_written(self):
        (self.home / "memories").rmdir()
        with mock.patch.dict(sys.modules, config({})):
            out = self.api.memory()
        self.assertTrue(out["available"] and out["files"]["memory"]["chars"] == 0)
        self.assertFalse((self.home / "memories").exists())


if __name__ == "__main__":
    unittest.main()
