// One light + ranked problems from data the plugin already reads. Pure; every input is undefined when not loaded / not supported.
// Rows carry enum-derived `detail` only (never last_error, error_message or log text), so nothing secret can reach the UI.
import { PLATFORM_OK } from './services.js'
import { cronSt, isFailed, isInternalJob, isOff, platformName, WARN } from './format.js'

const KINDS = ['gateway', 'platform', 'cron', 'mcp', 'disk', 'usage'] // tie-break: what stops the agent reaching you first
const PLATFORM_DETAIL = ['fatal', 'retrying', 'paused']

export function evaluateHealth({ status, cron, mcp, usage } = {}) {
  const items = [], add = (sev, kind, name, detail, fix = null) => items.push({ sev, kind, name, detail, fix })
  if (status) {
    if (!status.gateway_running || status.gateway_state === 'startup_failed') add(2, 'gateway', '', 'down', 'messaging')
    else {
      if (status.gateway_state === 'degraded' || status.gateway_heartbeat_stale_s != null) add(1, 'gateway', '', 'stale', 'messaging')
      for (const [k, v] of Object.entries(status.gateway_platforms || {})) {
        const st = String(v?.state || '').toLowerCase()
        if (PLATFORM_OK.has(st)) continue
        add(st === 'fatal' || v?.needs_attention ? 2 : 1, 'platform', platformName(k, v), PLATFORM_DETAIL.includes(st) ? st : 'unknown', 'messaging')
      }
    }
    const p = status.disk?.pressure
    if (p === 'critical' || p === 'elevated') add(p === 'critical' ? 2 : 1, 'disk', '', p)
  }
  for (const j of cron || []) {
    if (isOff(j) || isInternalJob(j)) continue
    const st = cronSt(j), bad = isFailed(st)
    if (st && st !== 'ok') add(bad ? 2 : 1, 'cron', j.name || j.job_id, bad ? 'failed' : 'other', 'cron')
  }
  for (const s of mcp || []) {
    // shortcut: local vs remote is judged by transport only (rows carry no URL), so a stopped loopback http server can show amber; upgrade if people report it.
    if (s.needs_auth) add(1, 'mcp', s.name, 'auth', 'capabilities')
    else if (s.status === 'failed' && s.transport !== 'stdio') add(1, 'mcp', s.name, 'failed', 'capabilities')
  }
  for (const u of usage || []) {
    const top = Math.max(0, ...(u.windows || []).map(w => w.used_percent).filter(Number.isFinite))
    if (top >= 100) add(2, 'usage', u.name || u.slug, 'full')
    else if (top >= WARN.def) add(1, 'usage', u.name || u.slug, 'near')
  }
  items.sort((a, b) => b.sev - a.sev || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || String(a.name).localeCompare(String(b.name)))
  // A required source that did not load is never green.
  const unchecked = [['status', status], ['cron', cron]].filter(([, v]) => v === undefined).map(([k]) => k)
  return { level: items.length ? (items[0].sev === 2 ? 'bad' : 'warn') : unchecked.length ? 'unknown' : 'ok', items, unchecked }
}
