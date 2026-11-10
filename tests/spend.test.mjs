import test from 'node:test'
import assert from 'node:assert/strict'
import { compact, costLabel, money } from '../src/state/spend.js'

test('costLabel: included, unknown, estimated and mixed', () => {
  assert.deepEqual(costLabel({ sessions: 3, included: 3, unknown: 0 }), { kind: 'included', unpriced: 0 })
  assert.deepEqual(costLabel({ sessions: 2, included: 0, unknown: 2 }), { kind: 'unknown', unpriced: 0 })
  assert.deepEqual(costLabel({ sessions: 5, included: 1, unknown: 2 }), { kind: 'est', unpriced: 3 })
  assert.deepEqual(costLabel({ sessions: 4, included: 0, unknown: 0 }), { kind: 'est', unpriced: 0 })
  assert.deepEqual(costLabel({ sessions: 0, included: 0, unknown: 0 }), { kind: 'est', unpriced: 0 }) // never "included" for nothing
  assert.deepEqual(costLabel({ sessions: 1, included: 0, unknown: 1 }), { kind: 'unknown', unpriced: 0 }) // a single session
})

test('compact and money handle null and large values', () => {
  assert.equal(compact('en', 1_234_567), '1.2M')
  assert.equal(compact('en', null), '0')
  assert.equal(money('en', 3850.123), '$3,850.12')
  assert.equal(money('en', null), '$0.00')
})
