// Logs card: pure helpers. host.logs returns raw file lines; they are cleaned and masked here before any state or DOM.
export const LOG_FILES = ['agent', 'errors', 'gateway', 'gui'] // only formatter-written (redacted) files; the server also whitelists
export const LOG_LEVELS = ['ALL', 'WARNING', 'ERROR']
export const logFile = f => (LOG_FILES.includes(f) ? f : 'agent')
export const logLevel = l => (LOG_LEVELS.includes(l) ? l : 'ALL')

// shortcut: short pattern list; the real redaction is Hermes' RedactingFormatter at write time. Extend if a leak is reported.
const SECRETS = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer ***'],
  [/\b(?:sk-|ghp_|gho_|xox[a-z]-|AIza)[A-Za-z0-9_-]{8,}/g, '***'],
  [/\b((?:api[_-]?key|token|secret|password|authorization)["']?\s*[=:]\s*(?:["']?(?:basic|bearer)\s+)?)\S+/gi, '$1***']
]
export const maskSecrets = s => SECRETS.reduce((a, [re, to]) => a.replace(re, to), s)

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g, LEVEL = /\s(DEBUG|INFO|WARNING|ERROR|CRITICAL)\s/, STAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/ // LEVEL as in Hermes logs.py
// shortcut: lines are cut at 600 chars, raise if users need full stack lines.
// Only a stamped line has its own level: a traceback frame or message text may contain " INFO " too. Others take the level above.
export function parseLogs(lines) {
  let level = null
  return (Array.isArray(lines) ? lines : []).filter(l => typeof l === 'string').map(l => {
    const text = maskSecrets(l.replace(/\r?\n$/, '').replace(ANSI, '')).slice(0, 600) // mask first: a cut through a key would leave a fragment
    const m = STAMP.test(text) ? LEVEL.exec(text) : null
    level = m?.[1] || level
    return { text, level, at: m ? m.index + 1 : -1 } // at: where this line's own level word starts (-1: continuation)
  })
}

const ORDER = { DEBUG: 0, INFO: 1, WARNING: 2, ERROR: 3, CRITICAL: 4 }
// The server filters by level too; this guarantees no row below the chosen minimum (also unlevelled ones at the window start).
export const atLeast = (rows, level) => (level === 'ALL' ? rows : rows.filter(r => (ORDER[r.level] ?? -1) >= ORDER[level]))
