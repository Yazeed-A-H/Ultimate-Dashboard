// Cron 7-day timeline: expand a job row into its upcoming runs (client side; Hermes returns only `next_run_at`).
// shortcut: wall clock = the UTC offset in `next_run_at`, fixed for the window (a DST change inside it shifts later runs by 1 h);
//   names (MON-FRI), 6 fields and L/W/# extensions are not expanded and fall back to the single known next run; `repeat` limits are not modelled. Upgrade: a backend route using croniter.
import { isOff, scheduleRaw } from './format.js'

const MIN = 60000, DAY = 864e5

// One cron field -> Set of values, or null when the shape is not plain numeric. dow allows 7 (= Sunday).
function field(s, lo, hi, open = hi) { // open: where a non-star `a/N` ends (dow: 6, so 7 does not add Sunday twice)
  const out = new Set()
  for (const part of s.split(',')) {
    const m = /^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
    if (!m) return null
    const star = part.startsWith('*'), a = star ? lo : +m[1], b = star ? hi : m[2] !== undefined ? +m[2] : m[3] !== undefined ? open : a, step = m[3] === undefined ? 1 : +m[3]
    if (!step || a < lo || b > hi || a > b) return null
    for (let v = a; v <= b; v += step) out.add(v)
  }
  return out
}

// Offset in minutes from an ISO string ("...+03:00", "...Z"); without one, this machine's.
const offsetMin = (iso, ms) => { const m = /([+-])(\d\d):?(\d\d)$/.exec(iso); return /Z$/i.test(iso) ? 0 : m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : -new Date(ms).getTimezoneOffset() }

// -> { runs: [ms...], frequent }. Window is [fromMs, fromMs + days) (a run exactly at the end is out). Paused, finished or unparseable jobs -> no runs.
// frequent (more than 20 runs in the window: half of the 40 Week rows) -> no runs, the card prints one "Every ..." line instead.
export function upcomingRuns(job, fromMs, days = 7, cap = 50) {
  const first = Date.parse(job?.next_run_at), none = { runs: [], frequent: false }
  if (!job || isOff(job) || !isFinite(first) || !isFinite(fromMs)) return none
  const end = fromMs + days * DAY, lo = fromMs - MIN, keep = t => t >= lo && t < end // a run overdue by up to a minute still counts; older ones are a stale next_run_at
  const one = { runs: keep(first) ? [first] : [], frequent: false }
  const done = runs => (runs.length > 20 ? { runs: [], frequent: true } : { runs, frequent: false })
  const raw = scheduleRaw(job), iv = /^every\s+(\d+)m$/i.exec(raw)
  if (iv) {
    const n = +iv[1]
    if (!n) return one
    const runs = []
    for (let t = first < lo ? first + Math.ceil((lo - first) / (n * MIN)) * n * MIN : first; t < end && runs.length < cap; t += n * MIN) runs.push(t)
    return done(runs)
  }
  const f = raw.split(/\s+/)
  if (f.length !== 5) return one
  const [mi, hr, dom, mon, dow] = [field(f[0], 0, 59), field(f[1], 0, 23), field(f[2], 1, 31), field(f[3], 1, 12), field(f[4], 0, 7, 6)]
  if (!mi || !hr || !dom || !mon || !dow) return one
  const off = offsetMin(job.next_run_at, first) * MIN, days7 = [...dow].map(d => d % 7)
  const both = f[2] !== '*' && f[4] !== '*' // dom + dow both set (`*/2` counts): either matches, as croniter does
  const times = [...hr].sort((a, b) => a - b).flatMap(h => [...mi].sort((a, b) => a - b).map(m => h * 60 + m))
  const runs = keep(first) ? [first] : []
  const day0 = Math.floor((Math.max(first, lo) + off) / DAY) * DAY // local midnight of the first run (or of now when it is stale), as a UTC timestamp
  for (let d = day0; d < end + off && runs.length < cap; d += DAY) {
    const x = new Date(d), okDom = dom.has(x.getUTCDate()), okDow = days7.includes(x.getUTCDay())
    if (!mon.has(x.getUTCMonth() + 1) || !(both ? okDom || okDow : okDom && okDow)) continue
    for (const tm of times) {
      const t = d + tm * MIN - off
      if (t > first && keep(t) && runs.length < cap) runs.push(t)
    }
  }
  return done(runs)
}
