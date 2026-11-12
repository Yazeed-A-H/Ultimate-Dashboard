// Pure model for the Live tasks card (no DOM, no SDK): tool names -> label keys, and what is running where.
import { isFailed } from './format.js'
const TOOLS = new Set(['terminal', 'execute_code', 'read_file', 'search_files', 'patch', 'write_file', 'web_search', 'web_extract', 'browser', 'delegate_task', 'skill_view', 'vision_analyze'])

// Key of the plain-words label (lv.t.<key>), or null: the card then shows the raw tool name. MCP tools lose their `mcp__<server>__` prefix; every browser_* tool is "the browser".
export function toolKey(name) {
  const n = String(name ?? '').replace(/^mcp__.+?__/, '')
  const k = n.startsWith('browser_') ? 'browser' : n
  return TOOLS.has(k) ? k : null
}

// A batch that ends any way but `completed` (interrupted, stalled, an error word) is not a success.
const workerState = k => (k.status === 'running' ? 'running' : k.status === 'completed' ? 'done' : 'failed')

const ends = blocks => blocks.reduce((m, b) => Math.max(m, b.at + (b.secs || 0)), -Infinity)
const blocksOf = last => (last || []).map(b => ({ at: b.at, secs: b.secs || 0, ok: b.ok !== false, tool: b.tool }))

// How long this user's earlier Workers took: the 25th to 75th percentile of the finished, not failed ones (`history` = /workers rows). The same model when it has at least
// 5 rows, else every model; fewer than 5 rows -> null (no estimate). shortcut: nearest-rank by index, no interpolation, fine for a hint.
export function usual(history, model) {
  const ok = (history || []).filter(r => r.ended_at && !isFailed(r.end_reason) && r.ended_at - r.started_at > 0), same = ok.filter(r => r.model === model), rows = same.length >= 5 ? same : ok
  if (rows.length < 5) return null
  const d = rows.map(r => r.ended_at - r.started_at).sort((a, b) => a - b), at = q => d[Math.floor((d.length - 1) * q)]
  return { lo: at(0.25), hi: at(0.75), n: d.length }
}

// `live`: the /live answer. `active`: session.active_list rows. A section is one Main chat with every Worker batch it started (a batch without a known chat is its
// own section, a chat without a batch is a section without Workers). `sections` = the running ones, newest start first; `last` = the newest ended section that had
// Workers, only when nothing runs; `running` = how many lanes run. Lane `start`/`end` are epoch seconds; `end` is null while the lane runs.
// `history` (optional) feeds the estimate: a running Worker gets `usual` and `late` (running longer than the usual 75th percentile). A section gets `total`/`done` Workers.
export function liveView(live, active = [], history = null) {
  const mains = new Map((live?.mains || []).map(m => [m.id, m])), at = live?.at ?? Date.now() / 1e3
  const busy = new Set((active || []).filter(s => s.status && s.status !== 'idle' && s.status !== 'waiting').map(s => s.id))
  const by = new Map()
  for (const g of live?.groups || []) {
    const id = g.parent || g.id, sec = by.get(id) || by.set(id, { id, groups: [] }).get(id)
    sec.groups.push(g)
  }
  for (const m of mains.values()) if (!by.has(m.id)) by.set(m.id, { id: m.id, groups: [] })
  const all = [...by.values()].map(({ id, groups: every }) => {
    const m = mains.get(id), on = !!m?.now || busy.has(id) || every.some(g => g.tasks.some(k => k.status === 'running'))
    // a running chat shows only its current turn's batches (still-running older ones too); an ended one keeps all, it can become `last`
    const groups = m?.turn_at != null && on ? every.filter(g => g.running || g.started >= m.turn_at - 5) : every
    const workers = groups.flatMap(g => g.tasks.map(k => ({ g, k }))).sort((a, b) => a.g.started - b.g.started || a.k.index - b.k.index).map(({ g, k }) => {
      const blocks = blocksOf(k.last), state = workerState(k), end = state === 'running' ? null : k.ended ?? (ends(blocks) > -Infinity ? ends(blocks) : k.started)
      const u = state === 'running' ? usual(history, k.model) : null
      return { kind: 'worker', key: `${g.id}:${k.index}`, title: k.goal, state, start: k.started, end, steps: k.steps, blocks, now: state === 'running' ? k.now : null, model: k.model, index: k.index, usual: u, late: !!u && at - k.started > u.hi }
    })
    let main = null
    if (m) {
      const blocks = blocksOf(m.last), now = m.now ? { at: m.now.at, tool: m.now.tools[0] } : null
      const state = now || busy.has(id) ? 'running' : workers.some(w => w.state === 'running') ? 'waiting' : 'idle'
      main = { kind: 'main', usual: null, late: false, key: id, title: m.title, state, start: m.turn_at ?? blocks[0]?.at ?? workers[0]?.start, end: state === 'idle' ? (ends(blocks) > -Infinity ? ends(blocks) : null) : null, steps: m.steps, blocks, now }
      if (main.state === 'idle' && main.end == null) main.end = main.start
    }
    const lanes = [main, ...workers].filter(Boolean), running = !!main && main.state !== 'idle' || workers.some(w => w.state === 'running')
    const starts = lanes.map(l => l.start).filter(Number.isFinite), t0 = starts.length ? Math.min(...starts) : at
    const t1 = running ? at : Math.max(t0, ...lanes.map(l => l.end ?? -Infinity))
    return { id, main, workers, t0, t1, running, total: workers.length, done: workers.filter(w => w.state !== 'running').length }
  })
  const sections = all.filter(s => s.running).sort((a, b) => b.t0 - a.t0)
  const last = sections.length ? null : all.filter(s => s.workers.length).sort((a, b) => b.t1 - a.t1)[0] || null
  return { sections, last, running: sections.reduce((n, s) => n + [s.main, ...s.workers].filter(l => l?.state === 'running').length, 0) }
}
