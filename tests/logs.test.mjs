import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LOG_FILES, LOG_LEVELS, logFile, logLevel, atLeast, maskSecrets, parseLogs } from '../src/state/logs.js'
import { CARDS, getCard } from '../src/state/cards.js'
import { FLAT } from '../src/ui/i18n.js'

test('parseLogs: level, continuation, newline, ANSI, cap, non-strings', () => {
  const r = parseLogs(['2026-11-08 10:00:00,123 ERROR agent.x: boom\n', '  File "a.py", line 1\n', '2026-11-08 10:00:01,000 INFO a: \x1b[31mok\x1b[0m\n', 5, null, 'x'.repeat(900)])
  assert.deepEqual(r.map(x => x.level), ['ERROR', 'ERROR', 'INFO', 'INFO'])
  assert.equal(r[0].text, '2026-11-08 10:00:00,123 ERROR agent.x: boom')
  assert.equal(r[2].text, '2026-11-08 10:00:01,000 INFO a: ok')
  assert.equal(r[3].text.length, 600)
  assert.deepEqual(r.map(x => x.at), [24, -1, 24, -1])
  assert.equal(r[0].text.slice(24, 29), 'ERROR')
  assert.equal(parseLogs([' plain\n'])[0].level, null)
  assert.deepEqual(parseLogs(undefined), [])
})

test('parseLogs: masks secrets before anything else sees the line', () => {
  assert.equal(parseLogs(['2026-11-08 10:00:00,1 WARNING a: Authorization: Bearer abcdef123456789\n'])[0].text.includes('abcdef'), false)
})

test('maskSecrets: Bearer, prefixed keys, key=value; clean lines unchanged', () => {
  assert.equal(maskSecrets('Bearer abcdef123456'), 'Bearer ***')
  assert.equal(maskSecrets('key sk-abcdefgh12345678 end'), 'key *** end')
  assert.equal(maskSecrets('ghp_abcdefghij1234 xoxb-1234567890-abc AIzaSyabcdefghij'), '*** *** ***')
  assert.equal(maskSecrets('api_key=hunter2 password: "p4ss" token = abc'), 'api_key=*** password: *** token = ***')
  const clean = '2026-11-08 10:00:00,1 INFO gateway.run: connected 3 platforms in 1.2s'
  assert.equal(maskSecrets(clean), clean)
})

test('whitelist: exactly four files, anything else falls back', () => {
  assert.deepEqual(LOG_FILES, ['agent', 'errors', 'gateway', 'gui'])
  assert.deepEqual(LOG_LEVELS, ['ALL', 'WARNING', 'ERROR'])
  for (const f of LOG_FILES) assert.equal(logFile(f), f)
  for (const bad of ['desktop', '../agent', 'agent.log', '', undefined, 5]) assert.equal(logFile(bad), 'agent')
  assert.equal(logLevel('ERROR'), 'ERROR'); assert.equal(logLevel('debug'), 'ALL'); assert.equal(logLevel(undefined), 'ALL')
})

test('logs card: registered, sizes, no options, strings in both locales', () => {
  const c = getCard('logs')
  assert.deepEqual(c.sizes, ['m', 'l', 'xl']); assert.equal(c.defaultSize, 'l'); assert.equal(c.multi, false)
  assert.ok(CARDS.find(x => x.id === 'logs'))
  const keys = Object.keys(FLAT.en).filter(k => k.startsWith('lg.'))
  assert.ok(keys.length >= 10)
  for (const k of keys) assert.ok(FLAT.ar[k], k)
})

test('level filter: message text with a level word does not re-level a continuation line; nothing below the minimum shows', () => {
  const rows = parseLogs([
    '    raise RuntimeError("state INFO changed")\n', // window starts mid-record: no level yet
    '2026-11-08 10:00:00,123 ERROR agent.x [sess_1] run: failed\n',
    'Traceback (most recent call last):\n',
    '  File "a.py", line 1, in f  # DEBUG mode\n',
    '2026-11-08 10:00:01,000 WARNING a.b: slow\n'
  ])
  assert.deepEqual(rows.map(x => x.level), [null, 'ERROR', 'ERROR', 'ERROR', 'WARNING'])
  assert.equal(atLeast(rows, 'ALL').length, 5)
  assert.deepEqual(atLeast(rows, 'ERROR').map(x => x.level), ['ERROR', 'ERROR', 'ERROR'])
  assert.deepEqual(atLeast(rows, 'WARNING').map(x => x.level), ['ERROR', 'ERROR', 'ERROR', 'WARNING'])
})

test('parseLogs masks before it cuts; Basic credentials are masked', () => {
  const key = 'sk-' + 'ABCDEFGHIJKLMNOPQ' // 20 chars
  const t = parseLogs(['x '.repeat(297) + key + ' tail'])[0].text // the cut at 600 would leave `sk-ABC`: too short for the key rule
  assert.equal(t.length <= 600, true); assert.doesNotMatch(t, /sk-|ABCD/)
  assert.equal(maskSecrets('Authorization: Basic dXNlcjpwYXNzd29yZA=='), 'Authorization: Basic ***')
  assert.equal(maskSecrets('Authorization: Bearer abcdef123456'), 'Authorization: Bearer ***')
  assert.doesNotMatch(parseLogs(['2026-11-08 10:00:00,1 WARNING a: authorization="Basic dXNlcjpwYXNzd29yZA=="'])[0].text, /dXNl/)
})
