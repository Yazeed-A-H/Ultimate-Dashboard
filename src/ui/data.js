// Data doors per card. All through the SDK's one query client, keyed under ctx.source so
// dispose can drop them. No sample data anywhere: a failed door is an error/unavailable state.
import { atom, host, useQuery, useValue } from '@hermes/plugin-sdk'
import { $sync, R, restRetry, useDoc } from './runtime.js'
import { cliJson, gatherApprovals, gatherUsage } from '../state/format.js'
import { pushSample } from '../state/spark.js'
import { atLeast, logFile, logLevel, parseLogs } from '../state/logs.js'

const MS = { '15s': 15e3, '30s': 30e3, '1m': 60e3, '5m': 300e3, manual: false }
export const useRefresh = () => MS[useDoc()?.prefs.refresh] ?? 60e3
export const qk = (...k) => [R.ctx.source, ...k]
const rpc = (m, p = {}, t) => host.request(m, p, t)
const minMs = (ms, floor) => (ms === false ? false : Math.max(ms, floor))

// Even on "Only when I press Refresh" the list is read every minute: approvals depend on it (a missed one blocks an agent).
export function useActive() {
  const every = useRefresh()
  return useQuery({ queryKey: qk('active'), queryFn: async () => (await rpc('session.active_list')).sessions || [], refetchInterval: every === false ? 60e3 : minMs(every, 15e3) })
}

// Clarify questions arrive as events only (no pending RPC). Kept per session until that session
// stops waiting; a waiting session without a pending command still shows as a question row.
export const $clarify = atom({})

// Oldest first, ties by ids, so rows never swap places between refreshes (a click lands on the row you saw).
const when = v => (typeof v === 'number' ? v : Date.parse(v) || 0)
const oldestFirst = (a, b) => when(a.created_at ?? a.session.last_active) - when(b.created_at ?? b.session.last_active) || a.session.id.localeCompare(b.session.id) || String(a.request_id).localeCompare(String(b.request_id))

// Approvals keep polling even with "Only when I press Refresh" on, on purpose: a missed approval blocks an agent
// (documented in the settings text). Only sessions that are not idle can have a pending command, so only those are
// asked; 15 s while one is waiting, else 60 s (the approval events refetch at once anyway).
export function useApprovals() {
  const active = useActive()
  const sessions = active.data || []
  const busy = sessions.filter(s => s.status && s.status !== 'idle').sort((a, b) => (b.status === 'waiting') - (a.status === 'waiting')).slice(0, 20) // waiting first: past 20 busy sessions the rest are not asked
  const q = useQuery({
    queryKey: qk('approvals', busy.map(s => s.id).join(',')),
    enabled: active.isSuccess,
    refetchInterval: sessions.some(s => s.status === 'waiting') ? 15e3 : 60e3,
    retry: 0, // the poll is the retry; the error state should show at once
    placeholderData: prev => prev, // the key follows the busy ids: keep the last list instead of the skeleton
    queryFn: () => gatherApprovals(busy, s => rpc('approval.pending', { session_id: s.id }))
  })
  const clar = useValue($clarify)
  const cmds = q.data || []
  const withCmd = new Set(cmds.map(a => a.session.id))
  const questions = sessions
    .filter(s => s.status === 'waiting' && !withCmd.has(s.id))
    .map(s => ({ kind: 'question', session: s, request_id: clar[s.id]?.request_id || s.id, question: clar[s.id]?.question || '' }))
  return { ...q, isLoading: active.isLoading || q.isLoading, error: active.error || q.error, data: q.data ? [...cmds, ...questions].sort(oldestFirst) : undefined, refetch: () => { active.refetch(); q.refetch() } }
}

export function useRecentSessions() {
  const every = useRefresh()
  // The canonical gateway (Webapp) lists only live sessions unless asked for stored ones; the classic gateway
  // (Desktop) rejects the unknown `scope` key, so it gets the plain call.
  const list = () => rpc('session.list', { limit: 60, scope: 'stored' }).catch(() => rpc('session.list', { limit: 60 }))
  return useQuery({ queryKey: qk('sessions'), queryFn: async () => (await list()).sessions || [], refetchInterval: every })
}

export function useCron() {
  const every = useRefresh()
  return useQuery({ queryKey: qk('cron'), queryFn: async () => (await rpc('cron.manage', { action: 'list', include_disabled: true })).jobs || [], refetchInterval: minMs(every, 60e3) })
}

export function useMcp() {
  const every = useRefresh()
  return useQuery({ queryKey: qk('mcp'), queryFn: async () => (await rpc('mcp.servers.status', {})).servers || [], refetchInterval: minMs(every, 60e3), retry: 0 })
}

export function useStatus() {
  const every = useRefresh()
  return useQuery({ queryKey: qk('status'), queryFn: () => host.status(), refetchInterval: every })
}

export function useModels() {
  return useQuery({ queryKey: qk('models'), queryFn: () => rpc('model.options', {}), staleTime: 5 * 60e3 })
}

export function useSkillsUsage() {
  const every = useRefresh(), on = useBackendOn()
  return useQuery({ queryKey: qk('skills-usage'), queryFn: () => rest('/skills-usage'), refetchInterval: minMs(every, 5 * 60e3), retry: 0, enabled: on })
}

export function useSkills() {
  return useQuery({ queryKey: qk('skills'), queryFn: async () => { const s = await host.skills.list(); return Array.isArray(s) ? s : s?.skills || [] }, staleTime: 5 * 60e3 })
}

// Plan usage per authenticated provider via `hermes usage --provider <slug> --json`. `only`: the providers the
// card shows (its option); the rest are not asked. Providers with no data are skipped for 60 min (gatherUsage), two run
// at once, the last result stays on screen while the next one loads, and "Only when I press Refresh" sets no timer.
const noData = new Map()
export function useUsage(only) {
  const every = useRefresh()
  const models = useModels()
  const provs = models.data?.providers || []
  const slugs = provs.filter(p => p.authenticated && (!only || only.includes(p.slug))).map(p => p.slug)
  const names = Object.fromEntries(provs.map(p => [p.slug, p.name || p.slug]))
  const q = useQuery({
    queryKey: qk('usage', slugs.join(',')),
    enabled: models.isSuccess,
    staleTime: 10 * 60e3,
    refetchInterval: every === false ? false : 10 * 60e3,
    placeholderData: prev => prev,
    queryFn: () => gatherUsage(slugs, async slug => {
      const r = await rpc('cli.exec', { argv: ['usage', '--provider', slug, '--json'], timeout: 60 }, 70e3)
      const j = r.code !== 0 || r.blocked ? null : cliJson(r.output)
      return j && Array.isArray(j.windows) && j.windows.length ? { slug, name: names[slug], ...j } : null
    }, { skipped: noData })
  })
  // The models list gates the usage fetch: if it fails the usage query stays idle, so surface that error.
  return { ...q, error: q.error || models.error, isLoading: models.isLoading || q.isLoading, refetch: () => { models.refetch(); return q.refetch() } }
}

// Health composes four queries and returns a query-shaped object for Q. Status and cron are required (data stays undefined
// until one has loaded, error only when both failed); MCP and usage are optional and never block the light.
export function useHealth() {
  const s = useStatus(), c = useCron(), m = useMcp(), u = useUsage()
  const qs = [s, c, m, u], times = qs.map(x => x.dataUpdatedAt).filter(Boolean)
  const ready = (s.data || c.data) !== undefined
  return {
    data: ready ? { status: s.data, cron: c.data, mcp: m.data, usage: u.data } : undefined,
    isLoading: s.isLoading || c.isLoading, isPending: !ready && (s.isPending || c.isPending), fetchStatus: s.fetchStatus,
    error: s.error && c.error, dataUpdatedAt: times.length ? Math.min(...times) : 0,
    refetch: () => Promise.all(qs.map(x => x.refetch()))
  }
}

export function useDelegation() {
  const every = useRefresh() // honours "Manually" like every other query except approvals
  return useQuery({ queryKey: qk('delegation'), queryFn: () => rpc('delegation.status', {}), refetchInterval: minMs(every, 15e3) })
}

// Backend routes: {available:false, reason} is data, not an error; a 404 means no backend.
const rest = path => restRetry(path)
const useBackendOn = () => useValue($sync).backend !== 'off' // known-off backend: no point fetching (the card says how to enable it)
// shortcut: in-memory only, per window, lost on reload; persist via ctx.storage if that matters.
const hist = { cpu: [], mem: [] }
export const machineHistory = () => hist
export function useMachine() {
  const every = useRefresh(), on = useBackendOn()
  return useQuery({ queryKey: qk('machine'), queryFn: async () => {
    const m = await rest('/machine')
    if (m?.available) { hist.cpu = pushSample(hist.cpu, m.at, m.cpu_percent); hist.mem = pushSample(hist.mem, m.at, m.memory?.percent) }
    return m
  }, refetchInterval: minMs(every, 10e3), retry: 0, enabled: on })
}
export function useFiles(range) {
  const every = useRefresh(), on = useBackendOn()
  return useQuery({ queryKey: qk('files', range), queryFn: () => rest(`/files?days=${range === 'today' ? 'today' : parseInt(range, 10)}&limit=60`), refetchInterval: minMs(every, 60e3), retry: 0, enabled: on })
}
export function useWorkers(range) {
  const every = useRefresh(), on = useBackendOn()
  return useQuery({ queryKey: qk('workers', range), queryFn: () => rest(`/workers?days=${range === 'today' ? 'today' : parseInt(range, 10)}&limit=60`), refetchInterval: minMs(every, 60e3), retry: 0, enabled: on })
}
// The user's last 30 days of Workers: only the base for the "usual finish" estimate on the Live tasks card, so it is read slowly.
export function useWorkerHistory() {
  const every = useRefresh(), on = useBackendOn()
  return useQuery({ queryKey: qk('workers-usual'), queryFn: () => rest('/workers?days=30&limit=200'), refetchInterval: minMs(every, 300e3), retry: 0, enabled: on })
}
export function useMemory() {
  const every = useRefresh(), on = useBackendOn()
  return useQuery({ queryKey: qk('memory'), queryFn: () => rest('/memory'), refetchInterval: minMs(every, 60e3), retry: 0, enabled: on })
}
export function useSpend(range) {
  const every = useRefresh(), on = useBackendOn()
  return useQuery({ queryKey: qk('spend', range), queryFn: () => rest(`/spend?days=${range === 'today' ? 'today' : parseInt(range, 10)}`), refetchInterval: minMs(every, 60e3), retry: 0, enabled: on })
}
export function useActivity(range) {
  const every = useRefresh(), on = useBackendOn()
  return useQuery({ queryKey: qk('activity', range), queryFn: () => rest(`/activity?days=${range === 'today' ? 'today' : parseInt(range, 10)}&limit=10`), refetchInterval: minMs(every, 60e3), retry: 1, enabled: on })
}
// 5 s while the last answer says something runs (the lanes move), else the user's refresh, never faster than 15 s; Manually = no timer.
export function useLive() {
  const every = useRefresh(), on = useBackendOn()
  return useQuery({ queryKey: qk('live'), queryFn: () => rest('/live'), refetchInterval: q => (every === false ? false : q.state.data?.running === true ? 5e3 : minMs(every, 15e3)), retry: 0, enabled: on })
}
export function useJobOutput(id) {
  const every = useRefresh(), on = useBackendOn()
  return useQuery({ queryKey: qk('job-output', id), queryFn: () => rest('/job-output?id=' + encodeURIComponent(id)), refetchInterval: minMs(every, 60e3), retry: 0, enabled: on && !!id })
}

// Log tail through the Desktop host (the app's own /api/logs). No plugin backend; older Hermes without host.logs -> unavailable.
export function useLogs(file, level, lines) {
  const every = useRefresh(), f = logFile(file), l = logLevel(level)
  return useQuery({
    queryKey: qk('logs', f, l, lines),
    queryFn: async () => (typeof host.logs !== 'function' ? { available: false } : atLeast(parseLogs((await host.logs({ file: f, lines, level: l === 'ALL' ? undefined : l }))?.lines), l)),
    refetchInterval: minMs(every, 10e3), retry: 0
  })
}

export const isNoBackend = err => /^404\b/.test(String(err?.message || ''))
