"""CI check of the installed plugin against a real Hermes (stdlib only; run by .github/workflows/test.yml).

Needs `hermes` on PATH and HERMES_HOME set. Installs the plugin the way plugin/README.md says (link on
POSIX, copy on Windows), enables it, validates it, starts `hermes serve` and calls the plugin routes with
a throwaway session token minted here (the documented HERMES_DASHBOARD_SESSION_TOKEN).
"""
import json, os, secrets, shutil, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

if os.environ.get("GITHUB_ACTIONS") != "true" and os.environ.get("HT_CI_DRIVER_ALLOW") != "1":  # this script rewrites HERMES_HOME/plugins, config and state.db
    raise SystemExit("refusing to run: it relinks the plugin, enables it and imports a session into HERMES_HOME. Set HT_CI_DRIVER_ALLOW=1 (with a throwaway HERMES_HOME) to run it outside CI.")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Windows runners default to cp1252; Hermes prints check marks
ROOT = Path(__file__).resolve().parents[1]
HOME = Path(os.environ["HERMES_HOME"])
DEFAULT_HOME = (Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "hermes") if sys.platform == "win32" else Path.home() / ".hermes"
if os.environ.get("GITHUB_ACTIONS") != "true" and HOME.resolve() == DEFAULT_HOME.resolve():
    raise SystemExit(f"refusing to run: HERMES_HOME is the real Hermes home ({HOME}). Point it at a throwaway directory.")
PLUGIN = HOME / "plugins" / "ultimate-dashboard"
PORT = 9471
TOKEN = secrets.token_urlsafe(32)
BASE = f"http://127.0.0.1:{PORT}/api/plugins/ultimate-dashboard"


def hermes(*args):
    r = subprocess.run(["hermes", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    print(f"$ hermes {' '.join(args)} -> {r.returncode}\n{r.stdout}{r.stderr}", flush=True)
    assert r.returncode == 0, f"hermes {args[0]} {args[1] if len(args) > 1 else ''} failed"
    return r.stdout


def call(path, method="GET", body=None):
    req = urllib.request.Request(BASE + path, method=method, headers={"X-Hermes-Session-Token": TOKEN, "Content-Type": "application/json"},
                                 data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def status(path, method="GET", raw=None, token=True):
    """HTTP status of a call with a raw body and/or no token (urllib raises HTTPError for 4xx)."""
    req = urllib.request.Request(BASE + path, method=method, data=raw, headers={"Content-Type": "application/json", **({"X-Hermes-Session-Token": TOKEN} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


# 1. install as the README says, then enable / validate / list
PLUGIN.parent.mkdir(parents=True, exist_ok=True)
if PLUGIN.exists() or PLUGIN.is_symlink():
    shutil.rmtree(PLUGIN) if PLUGIN.is_dir() and not PLUGIN.is_symlink() else PLUGIN.unlink()
if os.name == "nt":
    shutil.copytree(ROOT / "plugin", PLUGIN)
else:
    PLUGIN.symlink_to(ROOT / "plugin", target_is_directory=True)
hermes("plugins", "validate", str(ROOT / "plugin"))
hermes("plugins", "enable", "ultimate-dashboard")
listed = hermes("plugins", "list", "--plain", "--no-bundled")
assert any(l.split()[:1] == ["enabled"] and "ultimate-dashboard" in l for l in listed.splitlines()), "ultimate-dashboard not listed as enabled"

# 2. a real session store with one assistant message that names a file, created by Hermes' own import (no model needed)
made = HOME / "made.md"
made.write_text("hi")
seed = HOME / "seed.jsonl"
seed.write_text("\n".join(json.dumps(r) for r in (
    {"type": "user", "sessionId": "ci1", "message": {"role": "user", "content": "make a file"}},
    {"type": "assistant", "sessionId": "ci1", "message": {"role": "assistant", "content": [{"type": "text", "text": f"Done. MEDIA:{made}"}]}},
)) + "\n", encoding="utf-8")
hermes("sessions", "import", "--from", "claude", str(seed))

# 3. start the backend that mounts plugin routes
log = open(HOME / "serve.log", "w")
server = subprocess.Popen(["hermes", "serve", "--port", str(PORT), "--skip-build"], stdout=log, stderr=subprocess.STDOUT,
                          env={**os.environ, "HERMES_DASHBOARD_SESSION_TOKEN": TOKEN})
try:
    for _ in range(120):
        try:
            health = call("/health")
            break
        except Exception:
            assert server.poll() is None, "hermes serve exited early"
            time.sleep(1)
    else:
        raise SystemExit("hermes serve did not answer in 120 s")
    print("health", health)
    want = next(l.split(":", 1)[1].strip() for l in (ROOT / "plugin" / "plugin.yaml").read_text("utf-8").splitlines() if l.startswith("version:"))
    assert health["version"] == want and health["ok"] is True, (health, want)
    m = call("/machine")
    print("machine", {k: m.get(k) for k in ("available", "cpu_percent", "cpu_count", "load", "memory", "disk")})
    assert m["available"] is True
    assert all(isinstance(x, (int, float)) for x in (m["cpu_percent"], m["memory"]["percent"], m["disk"]["percent"]))
    f = call("/files")
    print("files", f)
    assert f["available"] is True and isinstance(f["files"], list) and [x["path"] for x in f["files"]] == [str(made)] and f["files"][0]["exists"]
    s0 = call("/state")
    doc = {"schema": 1, "views": [{"id": "v", "name": "CI", "cards": []}]}
    put = call("/state", "PUT", {"base_rev": s0["rev"], "doc": doc})
    s1 = call("/state")
    print("state", put, s1)
    assert s1["doc"] == doc and s1["rev"] == s0["rev"] + 1
    # hardening checks
    assert status("/health", token=False) == 401, "plugin routes must need the session token"
    assert status("/state", "PUT", b'{"base_rev":%d,"doc":{"schema":1,"views":[1],"x":NaN}}' % s1["rev"]) == 400 and status("/state") == 200
    assert status("/state", "PUT", json.dumps({"base_rev": s1["rev"], "doc": {**doc, "pad": "x" * 300000}}).encode()) == 413
    j = call("/job-output?id=..%2Fx")
    assert j["available"] is False and "invalid" in j["reason"], j
    if os.name != "nt":  # symlinks are not reliable on Windows runners
        outside = HOME / "outside-job"
        outside.mkdir()
        (outside / "output.md").write_text("secret")
        (HOME / "cron" / "output").mkdir(parents=True, exist_ok=True)
        (HOME / "cron" / "output" / "jobX").symlink_to(outside, target_is_directory=True)
        j = call("/job-output?id=jobX")
        assert j["available"] is False and "outside" in j["reason"], j
    print("OK")
finally:
    server.terminate()
    try:
        server.wait(15)
    except subprocess.TimeoutExpired:
        server.kill()
    log.close()
    print("---- serve.log ----\n" + (HOME / "serve.log").read_text(errors="replace")[-3000:])
