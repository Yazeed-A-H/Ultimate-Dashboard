import { test } from 'node:test'
import assert from 'node:assert/strict'
import { burn } from '../src/state/burn.js'

const now = Date.parse('2026-11-08T12:00:00Z'), H = 3600e3
const w = (label, used_percent, leftMs) => ({ label, used_percent, resets_at: new Date(now + leftMs).toISOString() })

test('burn: limit before reset', () => {
  const b = burn(w('Session', 80, 3.75 * H), now) // 25% elapsed (1.25 h), 80% used -> 20% left lasts 20 min
  assert.equal(b.state, 'limit')
  assert.equal(Math.round(b.limitS), 1125) // (100-80)/(80/4500)
  assert.equal(Math.round(b.shortS), 13500 - 1125)
})
test('burn: ok pace, capped at 99', () => {
  assert.deepEqual(burn(w('Weekly', 10, 84 * H), now), { state: 'ok', endPct: 20 })
  assert.deepEqual(burn(w('Session', 50, 2.5 * H), now), { state: 'ok', endPct: 99 }) // exactly reaches 100% at reset
})
test('burn: no projection', () => {
  assert.equal(burn(w('Session', 30, 4.8 * H), now), null) // <10% elapsed
  assert.equal(burn(w('Session', 0, 2 * H), now), null)
  assert.equal(burn(w('Session', 100, 2 * H), now), null)
  assert.equal(burn(w('Session', 120, 2 * H), now), null)
  assert.equal(burn(w('Session', 50, 6 * H), now), null) // left > length
  assert.equal(burn(w('Session', 50, -H), now), null) // past reset
  assert.equal(burn({ label: 'Session', used_percent: 50 }, now), null)
  assert.equal(burn({ label: 'Session', used_percent: 50, resets_at: 'soon' }, now), null)
  for (const l of ['Subscription', 'API key quota', 'Today', 'This week', 'This month']) assert.equal(burn(w(l, 50, 2 * H), now), null, l)
})
test('burn: label families map to 5 h / 7 d; bad input never throws', () => {
  for (const l of ['Current session', 'Session']) assert.notEqual(burn(w(l, 40, 2.5 * H), now), null, l)
  for (const l of ['Current week', 'Weekly', 'Opus week', 'Fable week']) assert.notEqual(burn(w(l, 40, 84 * H), now), null, l)
  for (const x of [null, undefined, {}, 5, { label: 3, used_percent: '5' }]) assert.equal(burn(x, now), null)
})
