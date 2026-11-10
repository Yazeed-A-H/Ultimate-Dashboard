// Pure helpers for the Skills card: host.skills.list rows ({name, enabled, usage?, provenance?}) joined with
// GET /skills-usage dates ({name: {used, added}}). `usage` undefined = unknown (older Hermes), never 0.
const GROUP = { agent: 'yours', external: 'yours', bundled: 'builtin', hub: 'hub' }
export const GROUPS = ['yours', 'builtin', 'hub']
const RANK = { yours: 0, hub: 1, builtin: 2 }
const by = (a, b) => a.name.localeCompare(b.name)

// Totals, per-provenance counts (rows without provenance are only in the total) and whether usage is known at all.
export function skillCounts(list) {
  const counts = { yours: 0, builtin: 0, hub: 0 }
  for (const s of list) if (GROUP[s.provenance]) counts[GROUP[s.provenance]]++
  return { total: list.length, counts, known: list.some(s => typeof s.usage === 'number') }
}

// Enabled skills never loaded, viewed or patched: yours first, then hub, then built-in; name order inside a group.
export const unusedSkills = list => list.filter(s => s.enabled !== false && s.usage === 0)
  .sort((a, b) => (RANK[GROUP[a.provenance]] ?? 0) - (RANK[GROUP[b.provenance]] ?? 0) || by(a, b))

// Newest first by dates[name][key] ('used' | 'added'); skills with no valid date are left out.
// "Added" skips bundled skills: Hermes re-seeds them on update, so their created_at is the update day.
export function byDate(list, dates, key) {
  const rows = []
  for (const s of list) {
    if (key === 'added' && s.provenance === 'bundled') continue
    const at = Date.parse(dates?.[s.name]?.[key])
    if (at) rows.push({ name: s.name, at })
  }
  return rows.sort((a, b) => b.at - a.at || by(a, b))
}
