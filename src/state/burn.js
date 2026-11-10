// Window length is not in `hermes usage --json`; the provider labels imply it (Session 5 h, week 7 d).
// shortcut: Today / This week / This month (calendar windows) and unlabelled ones get no projection, when a provider reports their length.
const windowSeconds = l => (/session/i.test(l) ? 18000 : /week/i.test(l) && !/^\s*this\b/i.test(l) ? 604800 : 0)

// Average pace since the window started -> null | { state: 'limit', limitS, shortS } | { state: 'ok', endPct }
export function burn(w, now = Date.now()) {
  const used = w?.used_percent, length = windowSeconds(String(w?.label ?? '')), end = Date.parse(w?.resets_at)
  if (typeof used !== 'number' || !(used > 0 && used < 100) || !length || !isFinite(end)) return null
  const left = (end - now) / 1000, elapsed = length - left
  if (left <= 0 || left > length || elapsed < length * 0.1) return null // past reset, clock skew / wrong length, rate unreliable right after a reset
  const rate = used / elapsed, limitS = (100 - used) / rate
  return limitS < left ? { state: 'limit', limitS, shortS: left - limitS } : { state: 'ok', endPct: Math.min(99, used + rate * left) }
}
