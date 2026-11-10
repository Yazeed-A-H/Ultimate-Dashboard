import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memHigh, memPct } from '../src/state/memory.js'

test('memory: fill percent and the worst enabled file', () => {
  assert.equal(memPct({ chars: 1100, limit: 2200 }), 50)
  assert.equal(memPct({ chars: 5, limit: 0 }), 0)
  assert.equal(memPct({ chars: 3000, limit: 2200 }) > 100, true) // over a lowered limit; Bar clamps
  const f = { memory: { chars: 100, limit: 2200, enabled: true }, user: { chars: 1375, limit: 1375, enabled: false } }
  assert.equal(Math.round(memHigh(f)), 5) // the full but disabled file does not count
  assert.equal(memHigh({}), 0)
})
