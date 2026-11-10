// Locale helpers with no SDK dependency (testable in node).

// {name} placeholders; string values are isolated (FSI..PDI) so a Latin name next to Arabic text (or the other way round)
// cannot reorder the punctuation around it. Numbers go in as they are.
export const fill = (s, vars) => (vars && typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? (typeof vars[k] === 'string' ? `\u2068${vars[k]}\u2069` : String(vars[k])) : m)) : s)

export const greetingKey = hour => (hour < 5 ? 'greet.night' : hour < 12 ? 'greet.morning' : hour < 18 ? 'greet.afternoon' : 'greet.evening')

// Plural message from category forms, e.g. plural('ar', n, {zero, one, two, few, many, other}).
// Forms are functions (n, fmt) => string; a missing category falls back to `other`.
export function plural(locale, n, forms) {
  const cat = new Intl.PluralRules(locale).select(n)
  const f = forms[cat] || forms.other
  return f(n, new Intl.NumberFormat(locale).format(n))
}

export const pct = v => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null)
// Warning thresholds are user-tunable per card (50-99); 90 is the old hard-coded value.
export const WARN = { min: 50, max: 99, def: 90 }
export const nearLimit = (v, at = WARN.def) => typeof v === 'number' && v >= at

// Seconds -> compact duration (ago / elapsed) in the locale, e.g. "5 min", "3 hr"; 'short' keeps Arabic readable (narrow gives "3 ي" for days).
export function shortDuration(locale, seconds) {
  const s = Math.max(0, Math.round(seconds))
  const [v, unit] = s < 60 ? [s, 'second'] : s < 3600 ? [Math.floor(s / 60), 'minute'] : s < 86400 ? [Math.floor(s / 3600), 'hour'] : [Math.floor(s / 86400), 'day']
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' }).format(v)
}

// Date + time with a day word: today / tomorrow / yesterday, a weekday for the next 6 days, else "Nov 12, 3:40 PM".
// `lower` keeps the day word lower-case mid-sentence ("resets tomorrow, 3:40 PM"). Intl does the words, so Arabic works too.
export function whenText(locale, ms, now = new Date(), lower = false) {
  const d = new Date(ms), midnight = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()), diff = Math.round((midnight(d) - midnight(now)) / 864e5)
  const f = o => new Intl.DateTimeFormat(locale, o).format(d), hm = { hour: 'numeric', minute: '2-digit' }
  if (Math.abs(diff) > 1 && !(diff > 1 && diff < 7)) return f({ month: 'short', day: 'numeric', ...hm })
  const w = diff > 1 ? f({ weekday: 'long' }) : new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(diff, 'day')
  return `${lower && diff <= 1 ? w : w.charAt(0).toLocaleUpperCase(locale) + w.slice(1)}${String(locale).startsWith('ar') ? '، ' : ', '}${f(hm)}`
}

// Gateway platform display name (Hermes' hermes_cli/platforms.py labels, without the emoji); unknown slugs get Title Case.
const PLATFORMS = { api_server: 'API Server', bluebubbles: 'BlueBubbles', dingtalk: 'DingTalk', homeassistant: 'Home Assistant', qqbot: 'QQBot', sms: 'SMS', wecom: 'WeCom', whatsapp: 'WhatsApp', whatsapp_cloud: 'WhatsApp Business (Cloud)', wecom_callback: 'WeCom Callback' }
export const platformName = (slug, v) => (typeof v?.name === 'string' && v.name.trim()) || PLATFORMS[slug] || String(slug).replace(/[_-]+/g, ' ').replace(/\b\p{L}/gu, c => c.toUpperCase())

// Bytes -> "13 GB" in the locale (1024 steps, one decimal under 10).
// base 1024 for memory (as macOS shows RAM), 1000 for disk (as Finder and Disk Utility show storage).
export function bytesText(locale, n, base = 1024) {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte']
  let i = 0, v = Number(n)
  while (v >= base && i < units.length - 1) { v /= base; i++ }
  return new Intl.NumberFormat(locale, { style: 'unit', unit: units[i], unitDisplay: 'short', maximumFractionDigits: v < 10 && i ? 1 : 0 }).format(v)
}

// cli.exec joins stdout and stderr, so CLI warnings can wrap the JSON; take the outer object.
export function cliJson(out) {
  const s = String(out || '')
  // starts: the first `{` and every line-start `{`; ends: every `}`. The LONGEST slice that parses wins (`opts={}` noise must not beat the real object); garbage -> null (never throws).
  // shortcut: 10 candidates from each side (20 in all), so a noisy log cannot make this quadratic; upgrade if a CLI prints more than 10 brace lines on both sides.
  const edge = a => (a.length > 20 ? [...a.slice(0, 10), ...a.slice(-10)] : a)
  const starts = edge([...new Set([s.indexOf('{'), ...[...s.matchAll(/^\{/gm)].map(m => m.index)])].filter(i => i >= 0))
  const ends = edge([...s.matchAll(/\}/g)].map(m => m.index))
  let best = null, len = -1
  for (const a of starts) for (const b of ends) if (b - a > len) try { best = JSON.parse(s.slice(a, b + 1)); len = b - a } catch { /* next candidate */ }
  return best
}

// Range -> seconds back from now.
const rangeSeconds = r => (r === '7d' ? 7 * 86400 : r === '30d' ? 30 * 86400 : null)
export function rangeStart(r, now = new Date()) {
  if (r === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime() / 1000 }
  return now.getTime() / 1000 - (rangeSeconds(r) || 0)
}

// What a Quick launch shortcut types in the composer: `/skill prompt`, or just the prompt when it has
// no skill. Never sent.
// Mirror of Hermes modelDisplayParts()/splitTrailingTags()/prettifyBase() (apps/desktop/src/lib/model-status-label.ts,
// ~lines 56-160; the SDK does not export them): provider prefix off, hyphen versions dotted, title-cased, variant
// (Fast/Flash/...), quant and `[1m]` context tags split out. shortcut: re-sync by hand when Hermes changes its rules.
const VARIANTS = [[/-fast$/i, 'Fast'], [/-flash$/i, 'Flash'], [/-thinking$/i, 'Thinking'], [/-preview$/i, 'Preview'], [/-latest$/i, 'Latest']]
const CASING = [[/\bDeepseek\b/g, 'DeepSeek'], [/\bGlm\b/g, 'GLM'], [/\bMinimax\b/g, 'MiniMax'], [/\bOpenai\b/g, 'OpenAI'], [/\bErnie\b/g, 'ERNIE'], [/\bMimo\b/g, 'MiMo'], [/\bBge\b/g, 'BGE'], [/\bVl\b/g, 'VL'], [/\bIt\b/g, 'IT'], [/\bFp8\b/g, 'FP8'], [/\bAi\b/g, 'AI']]
const title = t => t.replace(/\b\w/g, c => c.toUpperCase()).trim()
const vendor = t => CASING.reduce((x, [re, to]) => x.replace(re, to), t.replace(/\b(a?)(\d+(?:\.\d+)?)b\b/gi, (_, a, n) => `${a.toUpperCase()}${n}B`))
const pretty = b => /^claude-/i.test(b) ? vendor(title(b.replace(/^claude-/i, '').replace(/(\d)-(?=\d)/g, '$1.').replace(/-/g, ' ')))
  : /^gpt-/i.test(b) ? b.replace(/^gpt-/i, 'GPT-')
  : /^gemini-/i.test(b) ? vendor(title(b.replace(/^gemini-/i, 'Gemini ').replace(/-/g, ' ')))
  : vendor(title(b.replace(/-/g, ' ')))
export function modelParts(model) {
  const raw = String(model ?? '').trim()
  let base = raw.slice(raw.lastIndexOf('/') + 1), variant = '', quant = ''
  for (let go = true; go;) {
    go = false
    if (!variant) for (const [re, label] of VARIANTS) if (re.test(base)) { variant = label; base = base.replace(re, ''); go = true; break }
    const q = !quant && base.match(/-(?:UD-)?(Q\d(?:_[A-Z0-9]+)*|IQ\d(?:_[A-Z0-9]+)*|F16|BF16)$/i)
    if (q) { quant = q[1].split('_')[0].toUpperCase(); base = base.slice(0, -q[0].length).replace(/-(?:Instruct|Chat)(?:-\d{4})?$/i, ''); go = true }
  }
  const ctx = base.match(/\[(\d+[mk])\]$/i)
  if (ctx) base = base.slice(0, -ctx[0].length)
  return { name: pretty(base.replace(/-\d{8}$/, '')) || raw, tag: [variant, quant, ctx && ctx[1].toUpperCase()].filter(Boolean).join(' ') }
}
// "Opus 5.5 · 1M" for text contexts (titles, toasts, the picker trigger); the raw id belongs in title/aria-label.
export const modelLabel = model => { const { name, tag } = modelParts(model); return tag ? `${name} · ${tag}` : name }
// Trigger text of a stored model: "Opus 5.5 · 1M · Provider name" (the slug when the catalog has not loaded); '' = Hermes default.
export const modelText = (m, providers = []) => m?.model ? `${modelLabel(m.model)}${m.provider ? ` · ${(providers || []).find(p => p.slug === m.provider)?.name || m.provider}` : ''}` : ''
export const shortcutDraft = sc => (sc.skill ? `/${sc.skill}${sc.prompt ? ' ' + sc.prompt : ' '}` : sc.prompt || '')
// The shortcut's prompt stays fixed; the text typed at launch follows it, one space apart unless the draft already ends in whitespace.
export function withExtra(draft, extra) {
  const x = (extra || '').trim()
  if (!x) return draft
  if (!draft || /\s$/.test(draft)) return draft + x
  return draft + ' ' + x
}
// Button label: the user's label, else the skill, else the first words of the prompt, cut on a word boundary with "…".
const words = (s, n) => { const t = s.trim().replace(/\s+/g, ' '); if (t.length <= n) return t; const sp = t.slice(0, n + 1).lastIndexOf(' '); return (sp > 0 ? t.slice(0, sp) : t.slice(0, n)) + '…' }
export const shortcutLabel = sc => sc.label || sc.skill || words(sc.prompt || '', 24)

// Keyboard shortcuts: canonical `mod[+alt][+shift]+key` (mod = Cmd on Mac, Ctrl elsewhere), the same
// strings Hermes' KEYBINDS_AREA takes. Always has Cmd/Ctrl so it can fire while typing.
const PUNCT = { Backquote: '`', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Comma: ',', Equal: '=', Minus: '-', Period: '.', Quote: "'", Semicolon: ';', Slash: '/' }
const KEY_RE = /^mod(\+alt)?(\+shift)?\+([a-z0-9]|f([1-9]|1[0-2])|[`\-=[\]\\;',./])$/
export const cleanCombo = v => (typeof v === 'string' && KEY_RE.test(v) ? v : '')
// Keydown -> combo, or null when it is only modifiers, lacks the platform modifier (Cmd on Mac, Ctrl elsewhere; the other one is refused), or has a key we do not take.
export function comboFromEvent(e, mac) {
  if (!e || e.isComposing || (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey)) return null
  const code = String(e.code || '')
  const base = (/^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : null) ?? (!e.shiftKey && Object.values(PUNCT).includes(e.key) ? e.key : null) ??
    (/^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d{1,2}$/.test(code) ? code.toLowerCase() : PUNCT[code] ?? null)
  return base ? cleanCombo(['mod', e.altKey && 'alt', e.shiftKey && 'shift', base].filter(Boolean).join('+')) || null : null
}
export const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent || '')
// "⌘⇧K" on Mac, "Ctrl+Shift+K" elsewhere.
export function comboLabel(combo, mac) {
  const p = String(combo || '').split('+'), key = p.pop().toUpperCase()
  const m = { mod: mac ? '⌘' : 'Ctrl', alt: mac ? '⌥' : 'Alt', shift: mac ? '⇧' : 'Shift' }
  return [...p.map(x => m[x] || x), key].join(mac ? '' : '+')
}

// Cron: internal one-shot jobs other plugins schedule (e.g. hermes-mobile-device-access-<hash>, "once in 1m").
// Rule: name is hermes-<words>-<hex hash> AND the schedule is a one-shot. Both must hold.
export const isInternalJob = j => /^hermes-[a-z0-9-]*-[0-9a-f]{6,}$/i.test(String(j?.name || '')) && /^once\b/i.test(String(j?.schedule || ''))
// Cron job / Worker status helpers shared by the tone, the label and the sort.
export const isOff = j => j.enabled === false || j.state === 'paused'
export const isFailed = st => /err|fail/i.test(String(st || ''))
export const CRON_STATUSES = ['ok', 'error', 'delivery_failed', 'delivery_queued', 'blocked_config', 'interrupted', 'cancelled']

// `hermes usage --json` strings come in English; the known ones map to i18n keys, the rest stay as given.
const UW = { weekly: 'u.w.weekly', session: 'u.w.session', 'current week': 'u.w.currentWeek', 'current session': 'u.w.currentSession', 'api key quota': 'u.w.apiKey' }
export function usageText(label, detail = false) {
  const s = String(label ?? '').trim()
  if (detail) { const m = /^(.+) of (.+) remaining$/i.exec(s); return m ? ['u.d.remaining', { a: m[1], b: m[2] }] : null }
  if (UW[s.toLowerCase()]) return [UW[s.toLowerCase()], {}]
  const m = /^(.+) week$/i.exec(s)
  return m ? ['u.w.named', { name: m[1] }] : null
}

// Pending approvals of many sessions. One failing call may be a session that ended in between; but when
// every call fails "nothing pending" is a guess, so throw (a missed approval blocks an agent).
export async function gatherApprovals(sessions, fetchOne) {
  const out = []; let failed = 0
  await Promise.all(sessions.map(async s => {
    try { for (const a of (await fetchOne(s)).approvals || []) if (a.request_id) out.push({ ...a, kind: 'command', session: s }) } catch { failed++ }
  }))
  if (sessions.length && failed === sessions.length) throw new Error('approval.pending failed for every session')
  return out
}

// Plan usage per provider: `fetchOne(slug)` returns the row or null (no data); a throw is a transient failure.
// Slugs go into a CLI argv, so only plain slugs pass; providers that answered "no data" are skipped until
// `skipped` (a Map slug -> expiry ms) lets them back in; `limit` calls run at once.
// Session first, then the plain weekly window, then named ones ("Fable week") in their original order (sort is stable).
const windowKind = l => /session/i.test(l) ? 0 : /^\s*(current\s+)?week(ly)?\s*$/i.test(l) ? 1 : 2
export const sortWindows = ws => [...ws].sort((a, b) => windowKind(a.label || '') - windowKind(b.label || ''))

export async function gatherUsage(slugs, fetchOne, { skipped = new Map(), limit = 2, now = Date.now(), skipMs = 60 * 60e3 } = {}) {
  const todo = slugs.filter(s => /^[a-z0-9][\w.-]*$/.test(s) && !((skipped.get(s) ?? 0) > now))
  const out = []; let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, todo.length) }, async () => {
    while (next < todo.length) {
      const slug = todo[next++]
      try { const row = await fetchOne(slug); if (row) out.push(row); else skipped.set(slug, now + skipMs) } catch { /* transient: try again next time */ }
    }
  }))
  return todo.map(s => out.find(r => r.slug === s)).filter(Boolean) // provider order, whatever finished first
}

// Delivery states ride on top of a run that finished; they get their own chip instead of replacing the run status.
export const isDelivery = st => /^delivery_/.test(String(st || ''))
// The status the chip shows: a delivery state rides on a finished run, so it reads OK (or Error when the run left an error).
export const cronSt = j => (isDelivery(j.last_status) ? (j.last_error ? 'error' : 'ok') : j.last_status)

// Cron schedule -> readable text (what Hermes' Scheduled jobs page shows). `t` is the plugin translator (keys sch.*).
// shortcut: only the common 5-field shapes are translated (*/N, daily, weekdays 1-5, weekly list, monthly day); anything else stays raw.
const isCron = s => { const f = typeof s === 'string' ? s.trim().split(/\s+/) : []; return f.length === 5 && f.every(x => /^[\d*\/,-]+$/.test(x)) } // numeric fields only: 'Every day at 4 AM' is also 5 words
const txt = v => (typeof v === 'string' ? v.trim() : '')
export const scheduleRaw = j => txt(j?.schedule?.expr) || txt(j?.schedule_display) || txt(j?.schedule?.display) || txt(j?.schedule)
export function scheduleText(j, locale, t) {
  const human = [j?.schedule_display, j?.schedule?.display, j?.schedule].map(txt).find(s => s && !isCron(s))
  const iv = /^every\s+(\d{1,4})\s*m(?:in(?:ute)?s?)?$/i.exec(human || '') // Hermes prints interval jobs as "every 15m"
  if (iv && +iv[1] > 0) return t('sch.min', { n: +iv[1] })
  if (human) return human
  const raw = [j?.schedule?.expr, j?.schedule_display, j?.schedule?.display, j?.schedule].map(txt).find(isCron)
  if (!raw) return scheduleRaw(j)
  const [mi, h, dom, mon, dow] = raw.split(/\s+/), int = (s, max, min = 0) => (/^\d{1,2}$/.test(s) && +s >= min && +s <= max ? +s : null)
  const m = int(mi, 59), hr = int(h, 23), d = int(dom, 31, 1)
  const time = () => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, hr, m))
  const step = /^\*\/(\d{1,2})$/.exec(mi) // only a step that divides 60 repeats evenly (`*/45` fires at :00 and :45)
  if (step && +step[1] > 0 && 60 % +step[1] === 0 && +step[1] < 60 && [h, dom, mon, dow].every(x => x === '*')) return t('sch.min', { n: +step[1] })
  if (m !== null && h === '*' && dom === '*' && mon === '*' && dow === '*') return t('sch.hourly', { mm: String(m).padStart(2, '0') })
  if (m === null || hr === null || mon !== '*') return raw
  if (dom === '*' && dow === '*') return t('sch.daily', { time: time() })
  if (dom === '*' && dow === '1-5') return t('sch.weekdays', { time: time() })
  if (dom === '*' && /^[0-7](,[0-7])*$/.test(dow)) {
    const ar = String(locale).startsWith('ar'), fmt = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
    const names = [...new Set(dow.split(',').map(x => +x % 7))].sort((a, b) => a - b).map(x => fmt.format(Date.UTC(2000, 0, 2 + x)).replace(ar ? /^ال/ : /$^/, '')) // 2000-01-02 is a Sunday; Arabic "كل سبت" takes the bare name
    return t('sch.weekly', { days: new Intl.ListFormat(locale, { type: 'conjunction' }).format(names.map(n => t('sch.dow', { d: n }))), time: time() })
  }
  if (d !== null && dow === '*') return t('sch.monthly', { d, time: time() })
  return raw
}

// Keeps a busy state on screen for at least `ms`, so a fast refresh is still seen. Resolves with the promise's value.
export const holdFor = async (p, ms, sleep) => (await Promise.all([p, sleep(ms)]))[0]
// True when any of the given query states ended in error (a refresh that left a card failed).
export const anyFailed = states => states.some(s => s.status === 'error')
