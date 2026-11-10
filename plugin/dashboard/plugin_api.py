"""Ultimate Dashboard backend: routes under /api/plugins/ultimate-dashboard/.

Serves what Hermes has no plugin-facing API for: the synced layout document, live machine
resources, files made in sessions, the Workers history, and tool-call activity. Reads state.db read-only and never
writes it. Every read failure answers {"available": false, "reason": ...} instead of a 500.
"""
from __future__ import annotations

import asyncio
import json
from contextlib import closing
from datetime import datetime
import os
import re
import socket
import sqlite3
import threading
import time
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

PLUGIN = "ultimate-dashboard"
VERSION = "0.4.1"
FILES_SCAN_ROWS = 300
SCHEMA = 1
MAX_DOC_BYTES = 262144
MAX_DOC_DEPTH = 64  # real documents nest about 8 levels
MAX_STATE_FILE_BYTES = MAX_DOC_BYTES * 4  # ensure_ascii escaping can triple a saved document
ENVELOPE_SLACK = 1024  # {"base_rev", "doc"} wrapper around a document of at most MAX_DOC_BYTES
MAX_JOB_OUTPUT_BYTES = 65536
MAX_MEMORY_BYTES = 262144
MEMORY_DELIMITER = "\n§\n"  # tools/memory_tool_store.py ENTRY_DELIMITER
BUILTIN_MEMORY = {"", "default", "builtin", "built-in", "none"}  # memory.provider values that mean no external provider
MAX_USAGE_BYTES = 1048576  # a real file is ~70 KB for 135 skills
MAX_USAGE_SKILLS = 2000
router = APIRouter()
_lock = threading.Lock()  # serialises read-modify-write of the state file
# POSIX (/x), Windows drive (C:\x or C:/x) and UNC (\\server\x) paths; a bare "MEDIA:C:" or "MEDIA:Cool" never matches.
_MEDIA = re.compile(r"MEDIA:((?:/|[A-Za-z]:[\\/]|\\\\)[^\s`'\"<>)\]]+)")


# psutil keeps cpu_percent()'s baseline per thread and the routes run in a threadpool, and macOS refreshes
# cpu_times about once a second, so a fresh thread or a short sample often reads 0: keep one shared baseline.
_cpu = {"t": None, "pct": 0.0}


def _cpu_percent(psutil) -> float:
    t, last = psutil.cpu_times(), _cpu["t"]
    if last is None:
        _cpu["t"] = t
        return psutil.cpu_percent(interval=None)
    d = {k: getattr(t, k) - getattr(last, k) for k in t._fields}
    total = sum(d.values()) - d.get("guest", 0) - d.get("guest_nice", 0)  # guest time is already in user/nice
    if total > 0:  # two calls inside one counter tick keep the last reading
        _cpu["t"], _cpu["pct"] = t, round(min(100.0, max(0.0, 100 * (1 - (d["idle"] + d.get("iowait", 0)) / total))), 1)
    return _cpu["pct"]


try:  # baseline at load, so the first request after a gateway start already has an interval to measure
    _cpu["t"] = __import__("psutil").cpu_times()
except ImportError:
    pass


def _home() -> Path:
    from hermes_constants import get_hermes_home
    return Path(get_hermes_home())


def _data_dir() -> Path:
    try:
        from plugins.plugin_storage import plugin_data_dir
        return Path(plugin_data_dir(PLUGIN))
    except Exception:
        d = _home() / "plugin-data" / PLUGIN
        d.mkdir(parents=True, exist_ok=True)
        return d


def _state_path() -> Path:
    # One document per profile (plugin_data_dir follows the profile). Not per signed-in user: native
    # Desktop requests carry no dashboard session, so a per-user file would split Desktop from the Webapp.
    return _data_dir() / "state.json"


def _reject_constant(name):
    raise ValueError(name)


def _read_state(path: Path) -> dict:
    empty = {"rev": 0, "updated_at": None, "doc": None}
    try:
        with path.open("rb") as f:
            raw = f.read(MAX_STATE_FILE_BYTES + 1)
        if len(raw) > MAX_STATE_FILE_BYTES:
            return empty  # a file this big was not written by us: treat as corrupt
        data = json.loads(raw, parse_constant=_reject_constant)  # NaN/Infinity (stored by v0.4.0) would break every GET
    except (FileNotFoundError, ValueError, RecursionError):  # missing or corrupt: start empty, the client re-saves its copy
        return empty  # any other OSError propagates (5xx): an empty answer would let a fresh client overwrite a layout we merely failed to read
    if not isinstance(data, dict) or _depth_over(data, MAX_DOC_DEPTH + 2):  # +2: slack for the {rev, doc} wrapper
        return empty
    if type(data.get("rev")) is not int:  # hand-edited rev: restart the count rather than crash the compare
        data["rev"] = 0
    return data


def _depth_over(node, limit: int) -> bool:
    stack = [(node, 1)]  # iterative: a recursive walk would hit the very limit it guards
    while stack:
        n, d = stack.pop()
        if isinstance(n, (dict, list)):
            if d > limit:
                return True
            stack.extend((c, d + 1) for c in (n.values() if isinstance(n, dict) else n))
    return False


def _write_state(path: Path, data: dict) -> None:
    try:
        from utils import atomic_json_write
        atomic_json_write(path, data, indent=None)  # Hermes defaults to indent=2, which can push a legal document past MAX_STATE_FILE_BYTES
    except ImportError:  # shortcut: outside Hermes (tests) fall back to temp + replace
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), "utf-8")
        os.replace(tmp, path)


def _db() -> sqlite3.Connection:
    path = _home() / "state.db"
    if not path.exists():
        raise FileNotFoundError("state.db not found")
    conn = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=2.0)
    conn.row_factory = sqlite3.Row
    return conn


def _unavailable(reason: str, **extra) -> dict:
    return {"available": False, "reason": reason, **extra}


def _since(days: str | int | None) -> float:
    try:
        d = float(days) if days not in (None, "", "today") else None
    except (TypeError, ValueError):
        d = None
    if d is None:  # today: local midnight on the gateway machine
        t = time.localtime()
        return time.mktime((t.tm_year, t.tm_mon, t.tm_mday, 0, 0, 0, 0, 0, -1))
    return time.time() - max(0.0, min(d, 90.0)) * 86400


def _limit(v, default: int, top: int) -> int:
    try:
        return max(1, min(int(v), top))
    except (TypeError, ValueError):
        return default


@router.get("/health")
async def health():
    return {"ok": True, "plugin": PLUGIN, "version": VERSION, "schema": SCHEMA}


@router.get("/state")
async def get_state():
    def read():
        with _lock:
            return _read_state(_state_path())
    return await asyncio.to_thread(read)  # file I/O stays off the event loop


@router.put("/state")
async def put_state(request: Request):
    # Content-Length first, so an oversized body is refused before it is read; a chunked body is cut off while streaming.
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0
    if declared > MAX_DOC_BYTES + ENVELOPE_SLACK:
        return JSONResponse(status_code=413, content={"detail": "document too large"})
    buf = bytearray()
    async for chunk in request.stream():
        buf += chunk
        if len(buf) > MAX_DOC_BYTES + ENVELOPE_SLACK:
            return JSONResponse(status_code=413, content={"detail": "document too large"})
    try:
        body = json.loads(buf)
    except (ValueError, RecursionError):  # bad JSON, or nested deeper than the parser allows
        body = None
    if not isinstance(body, dict):
        return JSONResponse(status_code=400, content={"detail": "invalid document"})
    doc = body.get("doc")
    base = body.get("base_rev")
    if not isinstance(doc, dict) or doc.get("schema") != SCHEMA or not isinstance(doc.get("views"), list) or not doc["views"]:
        return JSONResponse(status_code=400, content={"detail": "invalid document"})
    if type(base) is not int:  # bool is an int subclass
        return JSONResponse(status_code=400, content={"detail": "base_rev must be an integer"})
    if _depth_over(doc, MAX_DOC_DEPTH):  # policy limit; Python 3.14's json would accept any depth
        return JSONResponse(status_code=400, content={"detail": "invalid document"})
    try:  # compact separators: the client measures JSON.stringify. allow_nan=False: NaN/Infinity (also 1e999) would be stored and then break every GET
        size = len(json.dumps(doc, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8"))
    except (ValueError, RecursionError):
        return JSONResponse(status_code=400, content={"detail": "invalid document"})
    if size > MAX_DOC_BYTES:
        return JSONResponse(status_code=413, content={"detail": "document too large"})
    path = _state_path()

    def save():
        with _lock:
            cur = _read_state(path)
            if base != cur.get("rev", 0):
                # A 200 with conflict:true, not a 409: ctx.rest flattens HTTP errors into a message string.
                return {"conflict": True, **cur}
            nxt = {"rev": cur.get("rev", 0) + 1, "updated_at": time.time(), "doc": doc}
            _write_state(path, nxt)
            return {"conflict": False, "rev": nxt["rev"], "updated_at": nxt["updated_at"]}
    return await asyncio.to_thread(save)


@router.get("/machine")
def machine():
    try:
        import psutil
    except ImportError:
        return _unavailable("psutil is not installed in the Hermes environment")
    try:
        vm = psutil.virtual_memory()
        du = psutil.disk_usage(str(_home()))
        try:
            load = list((getattr(os, "getloadavg", None) or psutil.getloadavg)())  # os has none on Windows
        except Exception:  # noqa: BLE001 - load is optional
            load = None
        return {
            "available": True,
            "hostname": socket.gethostname(),
            "cpu_percent": _cpu_percent(psutil),
            "cpu_count": psutil.cpu_count(),
            "load": load,
            "memory": {"total": vm.total, "used": vm.total - vm.available, "percent": vm.percent},
            # APFS: du.used is only the Data volume, so derive used from free to match Disk Utility and the Storage view.
            "disk": {"total": du.total, "free": du.free, "used": du.total - du.free, "percent": round((du.total - du.free) / du.total * 100, 1) if du.total else 0},
            "uptime_s": max(0, time.time() - psutil.boot_time()),
            "at": time.time(),
        }
    except Exception as exc:  # noqa: BLE001 - surfaced to the card as a reason
        return _unavailable(f"machine stats failed: {type(exc).__name__}")


@router.get("/files")
def files(days: str | None = None, limit: str | None = None):
    since, cap = _since(days), _limit(limit, 50, 200)
    try:
        with closing(_db()) as conn:
            # One query over messages, not a per-session loop: short cron/push sessions would fill a session cap and hide older files.
            rows = conn.execute(
                "SELECT m.content, m.timestamp, m.session_id, s.title FROM messages m JOIN sessions s ON s.id = m.session_id "
                "WHERE m.role = 'assistant' AND m.timestamp >= ? AND COALESCE(s.source, '') NOT IN ('subagent','tool') "
                "AND (m.content LIKE '%MEDIA:/%' OR m.content LIKE '%MEDIA:_:%' OR m.content LIKE '%MEDIA:\\\\%') "
                f"ORDER BY m.timestamp DESC LIMIT {FILES_SCAN_ROWS}",
                (since,),
            ).fetchall()
            out, seen = [], set()
            for r in rows:
                for p in _MEDIA.findall(r["content"] or ""):
                    p = p.rstrip(".,;:")
                    if p in seen:
                        continue
                    seen.add(p)
                    out.append({
                        "path": p, "name": os.path.basename(p), "ext": os.path.splitext(p)[1].lstrip(".").lower(),
                        "session_id": r["session_id"], "session_title": r["title"], "created_at": r["timestamp"],
                    })
        out.sort(key=lambda f: f["created_at"], reverse=True)
        total, out = len(out), out[:cap]
        for f in out:  # stat only what is returned; never touch a network path (UNC stat can hang or leak NTLM)
            f["exists"] = None if f["path"].startswith(("\\\\", "//")) else os.path.exists(f["path"])
        # shortcut: scans the newest FILES_SCAN_ROWS matching messages of the range; `truncated` says when that cap was hit.
        return {"available": True, "since": since, "total": total, "truncated": len(rows) >= FILES_SCAN_ROWS, "files": out}
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"cannot read sessions: {type(exc).__name__}")


@router.get("/job-output")
def job_output(id: str | None = None):
    # fullmatch + ASCII class: `$` would accept a trailing newline, and \w would accept unicode.
    if not id or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", id):
        return _unavailable("invalid job id")
    try:
        root = (_home() / "cron" / "output").resolve()
        folder = (root / id).resolve()
        if folder.parent != root:  # a symlinked folder pointing elsewhere
            return _unavailable("job folder is outside the output folder")
        if not folder.is_dir():
            return {"available": True, "job_id": id, "runs": 0, "latest": None}
        # Symlinked files are skipped: they could point at any file the gateway can read.
        names = sorted(p.name for p in folder.iterdir() if p.suffix == ".md" and p.is_file() and not p.is_symlink())
        if not names:
            return {"available": True, "job_id": id, "runs": 0, "latest": None}
        with (folder / names[-1]).open("rb") as f:
            st = os.fstat(f.fileno())
            raw = f.read(MAX_JOB_OUTPUT_BYTES)
        try:
            at = datetime.strptime(names[-1][:-3], "%Y-%m-%d_%H-%M-%S").isoformat()
        except ValueError:
            at = None
        latest = {"file": names[-1], "at": at, "mtime": st.st_mtime, "size": st.st_size,
                  "text": raw.decode("utf-8", errors="replace"), "truncated": st.st_size > MAX_JOB_OUTPUT_BYTES}
        return {"available": True, "job_id": id, "runs": len(names), "latest": latest}
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"cannot read job output: {type(exc).__name__}")


@router.get("/workers")
def workers(days: str | None = None, limit: str | None = None):
    since, cap = _since(days), _limit(limit, 30, 200)
    try:
        with closing(_db()) as conn:
            rows = conn.execute(
                "SELECT id, title, model, parent_session_id, started_at, ended_at, end_reason, message_count, tool_call_count "
                "FROM sessions WHERE source = 'subagent' AND started_at >= ? ORDER BY started_at DESC LIMIT ?",
                (since, cap),
            ).fetchall()
            total = conn.execute("SELECT COUNT(*) FROM sessions WHERE source = 'subagent' AND started_at >= ?", (since,)).fetchone()[0]
        items = []
        for r in rows:
            title = r["title"] or ""
            items.append({**dict(r), "title": title.removeprefix("Subagent: ")})
        return {"available": True, "since": since, "total": total, "workers": items}
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"cannot read sessions: {type(exc).__name__}")


def _memory_file(name: str, limit: int, enabled: bool) -> dict:
    """Entry count, characters (counted like the Hermes store, not bytes) and mtime of one memory file. Never its text."""
    path = _home() / "memories" / name
    try:
        with path.open("rb") as f:
            st = os.fstat(f.fileno())
            raw = f.read(MAX_MEMORY_BYTES)
    except OSError:
        return {"chars": 0, "limit": limit, "entries": 0, "mtime": None, "enabled": enabled}
    # shortcut: a file over 256 KB is counted on its first 256 KB (the limits are a few thousand chars), upgrade if Hermes adds a memory API for plugins.
    text = raw.decode("utf-8-sig", errors="replace").replace("\r\n", "\n").replace("\r", "\n")  # Hermes reads with universal newlines
    entries = [e for e in (x.strip() for x in text.split(MEMORY_DELIMITER)) if e]
    return {"chars": len(MEMORY_DELIMITER.join(entries)), "limit": limit, "entries": len(entries), "mtime": st.st_mtime, "enabled": enabled}


@router.get("/memory")
def memory():
    cfg = {}
    try:
        from hermes_cli.config import load_config_readonly
        cfg = load_config_readonly().get("memory") or {}
    except Exception:  # noqa: BLE001 - defaults still make a useful card
        pass

    def limit(key: str, default: int) -> int:  # like Hermes tools/memory_tool.py:56: int(value), the default when it is not a number
        try:
            return int(cfg.get(key, default))
        except (TypeError, ValueError):
            return default

    def flag(key: str) -> bool:  # like Hermes utils.py:28 is_truthy_value(v, default=True) (tools/memory_tool.py:309), inlined: utils is not importable outside Hermes
        v = cfg.get(key)
        if isinstance(v, str):
            return v.strip().lower() in ("1", "true", "yes", "on")
        return True if v is None else bool(v)

    try:
        provider = str(cfg.get("provider") or "").strip()
        return {
            "available": True,
            "files": {
                "memory": _memory_file("MEMORY.md", limit("memory_char_limit", 2200), flag("memory_enabled")),
                "user": _memory_file("USER.md", limit("user_char_limit", 1375), flag("user_profile_enabled")),
            },
            "provider": "" if provider.lower() in BUILTIN_MEMORY else provider[:64],
        }
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"cannot read memory files: {type(exc).__name__}")


@router.get("/skills-usage")
def skills_usage():
    # Dates only; the counts come from the host's skills list. Read directly: tools.skill_usage is not a public plugin API.
    path = _home() / "skills" / ".usage.json"
    try:
        if not path.exists():  # fresh install: Hermes creates the file lazily
            return {"available": True, "skills": {}}
        if path.stat().st_size > MAX_USAGE_BYTES:
            return _unavailable("usage file is too large")
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return _unavailable("usage file is not an object")
        date = lambda v: v[:40] if isinstance(v, str) else None  # noqa: E731
        skills = {k: {"used": date(r.get("last_used_at")), "added": date(r.get("created_at"))}
                  for k, r in list(raw.items())[:MAX_USAGE_SKILLS] if isinstance(r, dict)}
        return {"available": True, "skills": skills}
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"cannot read skill usage: {type(exc).__name__}")


@router.get("/spend")
def spend(days: str | None = None):
    since = _since(days)
    tok = "COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)"  # cache tokens are left out on purpose
    agg = f"SUM({tok}) t, COALESCE(SUM(estimated_cost_usd), 0) c, COUNT(*) n, SUM(cost_status = 'included') inc, SUM(cost_status = 'unknown') unk"
    try:
        with closing(_db()) as conn:
            # shortcut: groups by sessions.model (the session's last model), not session_model_usage, so a mid-session /model
            # switch or aux spend can differ from the Analytics page; upgrade if users report mismatches.
            models = conn.execute(
                f"SELECT COALESCE(NULLIF(model, ''), 'unknown') model, {agg} FROM sessions WHERE started_at >= ? GROUP BY 1 ORDER BY t DESC LIMIT 20",
                (since,),
            ).fetchall()
            totals = conn.execute(f"SELECT {agg} FROM sessions WHERE started_at >= ?", (since,)).fetchone()
            top = conn.execute(
                f"SELECT id, title, COALESCE(NULLIF(model, ''), 'unknown') model, {tok} t, COALESCE(estimated_cost_usd, 0) c, cost_status "
                f"FROM sessions WHERE started_at >= ? AND {tok} > 0 ORDER BY t DESC LIMIT 5",
                (since,),
            ).fetchall()
        # estimated_cost_usd only: actual_cost_usd is empty on most installs and is never shown.
        row = lambda r: {"tokens": r["t"] or 0, "cost": r["c"], "sessions": r["n"], "included": r["inc"] or 0, "unknown": r["unk"] or 0}
        return {
            "available": True, "since": since, "totals": row(totals),
            "models": [{"model": r["model"], **row(r)} for r in models],
            "top": [{"id": r["id"], "title": r["title"] or "", "model": r["model"], "tokens": r["t"], "cost": r["c"], "cost_status": r["cost_status"] or ""} for r in top],
        }
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"cannot read sessions: {type(exc).__name__}")


# Failure rule = agent/display.py `_detect_tool_failure` for JSON results: `terminal` fails on a non-zero exit_code only; every other tool
# fails on a non-empty error (or a message when success is false) and on a status of failed/error.
# json_valid guards each row: one malformed result would otherwise abort the whole query. Result text is read here only, never selected.
# shortcut: web/browser/mcp results (wrapped in <untrusted_tool_result>) and plain-text failures count as ok, and user_summary, guardrail_refusal and
# all-items-errored `results` batches are not mirrored, so "failed" is a lower bound; upgrade only if Hermes stores an outcome column.
_TOOL_FAILED = (
    "CASE WHEN NOT json_valid(m.content) THEN 0 WHEN m.tool_name = 'terminal' THEN COALESCE(json_extract(m.content,'$.exit_code'),0) <> 0 "
    "ELSE (COALESCE(NULLIF(json_extract(m.content,'$.error'),''), NULLIF(json_extract(m.content,'$.message'),'')) IS NOT NULL "
    "AND (COALESCE(json_extract(m.content,'$.success'),1) = 0 OR json_type(m.content,'$.error') IS NOT NULL)) "
    "OR lower(COALESCE(json_extract(m.content,'$.status'),'')) IN ('failed','error') END"
)
# active = 1: compaction archives old rows, which would count a call twice. Subagent calls are left out, like /files.
_TOOL_ROWS = (
    "FROM messages m JOIN sessions s ON s.id = m.session_id WHERE m.role = 'tool' AND m.active = 1 "
    "AND m.timestamp >= ? AND m.tool_name IS NOT NULL AND COALESCE(s.source, '') NOT IN ('subagent', 'tool')"
)


@router.get("/activity")
def activity(days: str | None = None, limit: str | None = None):
    since, cap = _since(days), _limit(limit, 10, 30)
    try:
        with closing(_db()) as conn:
            tools = conn.execute(
                f"SELECT m.tool_name AS tool, COUNT(*) AS calls, COALESCE(SUM({_TOOL_FAILED}), 0) AS failed {_TOOL_ROWS} "
                "GROUP BY m.tool_name ORDER BY failed DESC, calls DESC LIMIT 200", (since,)).fetchall()
            feed = conn.execute(
                f"SELECT m.tool_name AS tool, m.session_id, s.title AS session_title, m.timestamp AS at, ({_TOOL_FAILED}) = 0 AS ok "
                f"{_TOOL_ROWS} ORDER BY m.timestamp DESC LIMIT ?", (since, cap)).fetchall()
        return {"available": True, "since": since, "calls": sum(r["calls"] for r in tools), "failed": sum(r["failed"] for r in tools),
                "tools": [dict(r) for r in tools], "feed": [{**dict(r), "ok": bool(r["ok"])} for r in feed]}
    except Exception as exc:  # noqa: BLE001
        return _unavailable(f"cannot read sessions: {type(exc).__name__}")
