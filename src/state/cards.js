// Card registry: pure data + option sanitizer (no DOM, no SDK). Titles/labels are i18n keys.
import { WARN } from './format.js'

export const RANGES = ['today', '7d', '30d']

const RANGE = { key: 'range', type: 'range' }
// Warning thresholds (percent, 50-99, default 90) and the providers a usage card lists (default: all).
const PCT = key => ({ key, type: 'pct' })
const PROVIDERS = { key: 'providers', type: 'providers' }
const fields = (...keys) => ({ key: 'fields', type: 'fields', choices: keys })
const COMMON = [{ key: 'density', type: 'density' }, { key: 'title', type: 'text', max: 40 }]

// [id, codicon, sizes, defaultSize, extra options]
const DEFS = [
  ['approvals', 'checklist', ['m', 'l', 'xl'], 'l', [fields('kind', 'session', 'age')]],
  ['recent-sessions', 'comment-discussion', ['m', 'l', 'xl'], 'l', [fields('status', 'model', 'messages', 'time'), RANGE]],
  ['cron', 'watch', ['m', 'l', 'xl'], 'xl', [fields('schedule', 'last', 'next', 'note', 'week'), { key: 'pinnedOnly', type: 'bool' }]],
  ['usage', 'graph', ['m', 'l', 'xl'], 'm', [PROVIDERS, PCT('warn')]],
  ['recent-files', 'folder-opened', ['m', 'l', 'xl'], 'l', [fields('type', 'session', 'time'), RANGE]],
  ['services', 'server-process', ['m', 'l'], 'm', []],
  ['machine', 'vm', ['m', 'l'], 'm', [fields('cpu', 'memory', 'disk', 'uptime'), PCT('warnCpu'), PCT('warnMem'), PCT('warnDisk')]],
  ['workers', 'robot', ['l', 'xl'], 'xl', [fields('status', 'task', 'elapsed'), RANGE]],
  ['job-result', 'output', ['m', 'l', 'xl'], 'l', [{ key: 'job', type: 'job' }]],
  ['health', 'pulse', ['s', 'm', 'l'], 'm', []],
  ['logs', 'terminal', ['m', 'l', 'xl'], 'l', []],
  ['memory', 'database', ['m', 'l'], 'm', []],
  ['skills', 'library', ['m', 'l', 'xl'], 'l', [fields('recent', 'added', 'unused')]],
  ['spend', 'credit-card', ['m', 'l', 'xl'], 'm', [RANGE]],
  ['activity', 'history', ['m', 'l', 'xl'], 'l', [RANGE]],
  ['live', 'broadcast', ['l', 'xl'], 'l', []]
]
// Cards the user can add many times. A stored instance id is `<base>~<6 chars [a-z0-9]>`; the bare base id is the TYPE and is never stored.
const MULTI = new Set(['job-result'])
export const MAX_INSTANCES = 12
const INSTANCE = /^[a-z0-9]{6}$/, JOB_ID = /^[A-Za-z0-9_-]{1,64}$/

// Cards removed in v0.3 (the four KPI tiles; running -> Sessions; pinned-cron -> Cron jobs). Saved layouts, templates,
// imports and synced docs still carry the old ids: cleanCards swaps each for its target and carries the options over.
const SESSION_FIELDS = { status: 'status', model: 'model', elapsed: 'time' }
export const ALIASES = new Map([
  ['k-wait', { to: 'approvals', opts: () => ({}) }],
  ['k-files', { to: 'recent-files', opts: o => ({ range: o.range }) }],
  ['k-usage', { to: 'usage', opts: o => ({ providers: o.providers, warn: o.warn }) }],
  ['k-machine', { to: 'machine', opts: o => ({ warnCpu: o.warnCpu, warnMem: o.warnMem, warnDisk: o.warnDisk }) }],
  ['running', { to: 'recent-sessions', opts: o => ({ fields: Array.isArray(o.fields) ? o.fields.map(f => SESSION_FIELDS[f]).filter(Boolean) : undefined }) }],
  ['pinned-cron', { to: 'cron', opts: o => ({ pinnedOnly: true, fields: o.fields }) }]
])

export const CARDS = DEFS.map(([id, icon, sizes, defaultSize, extra]) => ({
  id, icon, sizes, defaultSize, multi: MULTI.has(id), options: [...extra, ...COMMON]
}))
// Map, not an object: ids like "__proto__" from imported JSON must not resolve.
const BY = new Map(CARDS.map(c => [c.id, c]))
export const baseId = id => (typeof id === 'string' && id.includes('~') ? id.slice(0, id.indexOf('~')) : id)
// Resolves instance ids through their base; a `~` id needs a multi base and a valid suffix, else it is unknown.
export const getCard = id => {
  const def = BY.get(baseId(id))
  return typeof id === 'string' && id.includes('~') && !(def?.multi && INSTANCE.test(id.slice(id.indexOf('~') + 1))) ? undefined : def
}
// true when `cards` already holds the most instances a multi card type may have on one view
export const atCap = (cards, id) => { const d = getCard(id); return !!d?.multi && cards.filter(c => baseId(c.id) === d.id).length >= MAX_INSTANCES }
export const hasOption = (id, key) => !!getCard(id)?.options.some(o => o.key === key)

// Keep only known option keys with valid values. Safe for untrusted input.
export function sanitizeOptions(id, o) {
  const def = getCard(id), out = {}
  if (!def || !o || typeof o !== 'object' || Array.isArray(o)) return out
  if (typeof o.title === 'string' && o.title.trim()) out.title = o.title.trim().slice(0, 40)
  if (o.density === 'compact') out.density = 'compact'
  const f = def.options.find(x => x.key === 'fields')
  if (f && Array.isArray(o.fields)) out.fields = [...new Set(o.fields)].filter(k => f.choices.includes(k))
  if (hasOption(id, 'pinnedOnly') && o.pinnedOnly === true) out.pinnedOnly = true
  if (hasOption(id, 'job') && typeof o.job === 'string' && JOB_ID.test(o.job)) out.job = o.job
  if (hasOption(id, 'range') && RANGES.includes(o.range)) out.range = o.range
  for (const x of def.options) if (x.type === 'pct' && Number.isInteger(o[x.key]) && o[x.key] >= WARN.min && o[x.key] <= WARN.max) out[x.key] = o[x.key]
  if (hasOption(id, 'providers') && Array.isArray(o.providers)) {
    const p = [...new Set(o.providers)].filter(s => typeof s === 'string' && /^[\w.-]{1,64}$/.test(s)).slice(0, 50)
    if (p.length) out.providers = p // an empty list means "all", so it is not stored
  }
  return out
}
