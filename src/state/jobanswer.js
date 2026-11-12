// The part of a cron archive file (~/.hermes/cron/output/<job>/*.md) worth showing: the answer, not the prompt or the header.
// Mirrors Hermes' own rule (scheduler_prompt._archive_answer): the LAST `## Response` heading starts the answer.
// shortcut: no length-frame validation and a 64 KB read cap (backend), so a prompt that quotes `## Response` in a file cut at the cap can show prompt text; upgrade when the backend returns the frame lengths.
export function jobAnswer(text, truncated) {
  const s = String(text || ''), r = [...s.matchAll(/^## Response[ \t]*$/gm)].pop() // line-anchored: `### Response` is not the heading
  if (r) return s.slice(r.index + r[0].length).trim()
  const e = s.includes('## Prompt') ? [...s.matchAll(/^## Error[ \t]*$/gm)].pop() : null // agent files only: script output can have its own `## Error` line
  if (e) return s.slice(e.index).trim() // a failed run: keep the error, drop the prompt before it
  if (truncated && s.includes('## Prompt')) return '' // the answer is past the cap
  return s.replace(/^\s*# Cron Job:.*(\n\s*\*\*[^\n*]+:\*\*.*)*/, '').replace(/^\s*-{3,}[ \t]*(\n|$)/, '').trim()
}

// Only plain web links are clickable in a job answer (untrusted text): no other scheme, no credentials in the URL.
export function webUrl(href) {
  try { const u = new URL(href); return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password ? u.href : null } catch { return null }
}
