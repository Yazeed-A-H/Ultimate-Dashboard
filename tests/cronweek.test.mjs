import { test } from 'node:test'
import assert from 'node:assert/strict'
import { upcomingRuns } from '../src/state/cronweek.js'
import { getCard, sanitizeOptions } from '../src/state/cards.js'
import { FLAT } from '../src/ui/i18n.js'

// "Now" is Sun 2026-11-08 12:00 +03:00; the window is 7 days, so it ends Sun 15th 12:00 (excluded).
const NOW = Date.parse('2026-11-08T12:00:00+03:00')
const iso = (ms, off = '+03:00') => { const m = (off[0] === '-' ? -1 : 1) * (+off.slice(1, 3) * 60 + +off.slice(4)); return new Date(ms + m * 60000).toISOString().slice(0, 16) }
const run = (schedule, next, extra = {}) => upcomingRuns({ job_id: 'j', schedule, next_run_at: next, enabled: true, ...extra }, NOW)
const at = (r, off) => r.runs.map(t => iso(t, off))
const NONE = { runs: [], frequent: false }

test('cronweek: interval anchors on next_run_at', () => {
  const r = run('every 720m', '2026-11-08T13:00:00+03:00')
  assert.deepEqual(at(r).slice(0, 3), ['2026-11-08T13:00', '2026-11-09T01:00', '2026-11-09T13:00'])
  assert.equal(run('every 120m', '2026-11-08T13:00:00+03:00').frequent, true) // more than 20 runs would flood the 40-row week list
  assert.equal(upcomingRuns({ schedule: 'every 720m', next_run_at: '2026-11-08T13:00:00+03:00' }, NOW, 7, 10).runs.length, 10, 'per-job cap')
  assert.deepEqual(run('every 15m', '2026-11-08T12:15:00+03:00'), { runs: [], frequent: true })
  assert.equal(run('every 60m', '2026-11-08T13:00:00+03:00').frequent, true)
  assert.equal(run('every 239m', '2026-11-08T13:00:00+03:00').frequent, true)
  assert.equal(run('every 240m', '2026-11-08T13:00:00+03:00').frequent, true) // 42 runs
  assert.equal(run('every 720m', '2026-11-08T13:00:00+03:00').runs.length, 14)
})

test('cronweek: numeric 5-field cron table', () => {
  const table = [
    ['0 4 * * *', '2026-11-09T04:00:00+03:00', ['2026-11-09T04:00', '2026-11-10T04:00', '2026-11-11T04:00', '2026-11-12T04:00', '2026-11-13T04:00', '2026-11-14T04:00', '2026-11-15T04:00']],
    ['0 10 * * 5', '2026-11-13T10:00:00+03:00', ['2026-11-13T10:00']],
    ['15 10 * * 5', '2026-11-13T10:15:00+03:00', ['2026-11-13T10:15']],
    ['0 5 * * 0', '2026-11-15T05:00:00+03:00', ['2026-11-15T05:00']], // Sunday as 0 ...
    ['0 5 * * 7', '2026-11-15T05:00:00+03:00', ['2026-11-15T05:00']], // ... and as 7
    ['0 10 1 * *', '2026-12-01T10:00:00+03:00', []], // next run is past the window
    ['0 9 * * 1-5', '2026-11-09T09:00:00+03:00', ['2026-11-09T09:00', '2026-11-10T09:00', '2026-11-11T09:00', '2026-11-12T09:00', '2026-11-13T09:00']],
    ['0 9,17 * * *', '2026-11-08T17:00:00+03:00', ['2026-11-08T17:00', '2026-11-09T09:00', '2026-11-09T17:00']],
    ['0 9 */2 * 1-5', '2026-11-09T09:00:00+03:00', ['2026-11-09T09:00', '2026-11-10T09:00', '2026-11-11T09:00', '2026-11-12T09:00', '2026-11-13T09:00', '2026-11-15T09:00']], // croniter: dom */N + dow is a union
    ['0 9 15 * *', '2026-11-15T09:00:00+03:00', ['2026-11-15T09:00']], // dom only
    ['0 9 * * 7', '2026-11-08T09:00:00+03:00', ['2026-11-15T09:00']], // Sunday as 7, stale next: the loop must find it
    ['*/30 9 * * 1', '2026-11-09T09:00:00+03:00', ['2026-11-09T09:00', '2026-11-09T09:30']],
    ['0 9 1,15 * 1', '2026-11-09T09:00:00+03:00', ['2026-11-09T09:00', '2026-11-15T09:00']], // dom + dow restricted: OR
    ['30 2 29 2 *', '2028-02-29T02:30:00+03:00', []], // 29 Feb: nothing in this window
  ]
  for (const [s, next, want] of table) assert.deepEqual(at(run(s, next)).slice(0, want.length), want, s)
  assert.equal(run('0 9 * * 1-5', '2026-11-09T09:00:00+03:00').runs.length, 5)
  assert.equal(run('0 9 */2 * 1-5', '2026-11-09T09:00:00+03:00').runs.length, 6)
  assert.equal(run('0 9 15 * *', '2026-11-15T09:00:00+03:00').runs.length, 1, 'dom only: not every day')
  assert.equal(run('0 9,17 * * *', '2026-11-08T17:00:00+03:00').runs.length, 14)
  assert.deepEqual(run('*/20 9-17 * * 1-5', '2026-11-09T09:00:00+03:00'), { runs: [], frequent: true }) // 27 a day
})

test('cronweek: the offset in next_run_at is the wall clock; window end excluded', () => {
  const r = run('0 4 * * *', '2026-11-09T04:00:00-05:00')
  assert.equal(r.runs[0], Date.parse('2026-11-09T09:00:00Z'))
  assert.deepEqual(at(r, '-05:00').slice(0, 2), ['2026-11-09T04:00', '2026-11-10T04:00'])
  assert.ok(!at(run('0 12 * * *', '2026-11-09T12:00:00+03:00')).includes('2026-11-15T12:00'), 'exactly now + 7 d is out')
  assert.ok(at(run('59 11 * * *', '2026-11-09T11:59:00+03:00')).includes('2026-11-15T11:59'), 'one minute earlier is in')
})

test('cronweek: fallbacks give the single next run, never throw', () => {
  for (const s of ['every monday 9am', '0 9 * * MON-FRI', 'once in 1m', '0 0 9 * * *', '5 4 L * *', '0 61 * * *', '', undefined, 12]) {
    assert.deepEqual(at(run(s, '2026-11-10T09:00:00+03:00')), ['2026-11-10T09:00'], String(s))
  }
  for (const next of [null, undefined, 'soon', '']) assert.deepEqual(run('0 4 * * *', next), NONE)
  assert.deepEqual(run('0 4 * * *', '2026-11-09T04:00:00+03:00', { enabled: false }), NONE)
  assert.deepEqual(run('0 4 * * *', '2026-11-09T04:00:00+03:00', { state: 'paused' }), NONE)
  assert.deepEqual(upcomingRuns(null, NOW), NONE)
})

test('cronweek: week is a cron field choice; copy exists in both languages', () => {
  assert.deepEqual(sanitizeOptions('cron', { fields: ['week', 'bogus'] }).fields, ['week'])
  assert.ok(getCard('cron'))
  for (const k of ['f.week', 'cron.week', 'cron.weekNone', 'cron.freq']) assert.ok(FLAT.en[k] && FLAT.ar[k], k)
})

test('cronweek: a job with more than 20 runs in the window is \"frequent\"', () => {
  assert.deepEqual(run('0 * * * *', '2026-11-08T13:00:00+03:00'), { runs: [], frequent: true })
  assert.equal(run('0 */3 * * *', '2026-11-08T15:00:00+03:00').frequent, true)
  assert.equal(run('0 */4 * * *', '2026-11-08T16:00:00+03:00').frequent, true) // 42 runs would fill the list
  assert.equal(run('0 9,13,17 * * *', '2026-11-08T13:00:00+03:00').frequent, true) // 21
  assert.equal(run('0 9,17 * * *', '2026-11-08T17:00:00+03:00').runs.length, 14)
  assert.equal(run('0,30 9-10 * * 1-5', '2026-11-09T09:00:00+03:00').runs.length, 20, 'exactly 20 is still listed')
  assert.equal(run('0,15,30,45 9-10 * * *', '2026-11-09T09:00:00+03:00').frequent, true)
})

test('cronweek: frequent only counts runs inside the window', () => {
  assert.deepEqual(run('*/10 9-10 1 * *', '2026-12-01T09:00:00+03:00'), NONE) // monthly burst, 22 days away
  assert.deepEqual(run('*/10 9-10 1 * *', '2026-11-01T09:00:00+03:00'), NONE) // stale next
  assert.equal(run('*/10 9-10 * * 6', '2026-11-14T09:00:00+03:00').runs.length, 12) // Saturday burst that does run this week: 12 rows, listed
})

test('cronweek: a 4-hourly job does not starve the Sunday job in 40 rows', () => {
  const mk = (id, s, n) => ({ job_id: id, schedule: s, next_run_at: n, enabled: true })
  const jobs = [mk('4h', '0 */4 * * *', '2026-11-08T16:00:00+03:00'), mk('daily', '0 9 * * *', '2026-11-09T09:00:00+03:00'), mk('sun', '0 10 * * 0', '2026-11-15T10:00:00+03:00'), mk('sat', '0 10 * * 6', '2026-11-14T10:00:00+03:00')]
  const shown = jobs.flatMap(j => upcomingRuns(j, NOW).runs.map(ms => ({ ms, id: j.job_id }))).sort((a, b) => a.ms - b.ms).slice(0, 40).map(x => x.id)
  assert.ok(shown.includes('sun') && shown.includes('sat'))
})

test('cronweek: dow a/N ends at 6, so Sunday is not added twice (croniter)', () => {
  assert.deepEqual(at(run('0 9 * * 5/1', '2026-11-13T09:00:00+03:00')), ['2026-11-13T09', '2026-11-14T09'].map(x => x + ':00')) // Fri, Sat
  assert.equal(run('0 9 * * 1/2', '2026-11-09T09:00:00+03:00').runs.length, 3) // Mon Wed Fri
  assert.equal(run('0 9 * * 3/2', '2026-11-11T09:00:00+03:00').runs.length, 2) // Wed Fri
  assert.equal(run('0 9 * * 1-7/2', '2026-11-09T09:00:00+03:00').runs.length, 4) // explicit 7 still counts
})

test('cronweek: a stale next_run_at never lists runs in the past', () => {
  const stale = '2026-11-04T09:00:00+03:00'
  assert.deepEqual(at(run('0 9 * * *', stale)), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'].map(d => d + 'T09:00'))
  const iv = run('every 720m', stale)
  assert.ok(iv.runs.length > 0 && iv.runs.every(t => t >= NOW), 'interval')
  assert.equal(iv.runs[0], Date.parse('2026-11-08T21:00:00+03:00'))
  assert.deepEqual(run('every monday 9am', stale), NONE)
  assert.equal(run('0 9 * * *', '2026-11-08T11:59:30+03:00').runs[0], Date.parse('2026-11-08T11:59:30+03:00'), 'overdue by seconds stays')
})
