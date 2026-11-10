import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushSample, sparkPoints } from '../src/state/spark.js'

test('pushSample: caps, dedupes by time, ignores bad input, never mutates', () => {
  let b = []
  for (let i = 1; i <= 5; i++) b = pushSample(b, i, i * 10, 3)
  assert.deepEqual(b, [[3, 30], [4, 40], [5, 50]])
  const same = pushSample(b, 5, 1)
  assert.equal(same, b) // repeated at
  assert.equal(pushSample(b, 4, 1), b) // older at
  assert.equal(pushSample(b, 6, NaN), b)
  assert.equal(pushSample(b, undefined, 1), b)
  assert.equal(b.length, 3)
})

test('sparkPoints: fixed 0-100 scale, bounds, short series', () => {
  assert.equal(sparkPoints([], 10, 10), '')
  assert.equal(sparkPoints([50], 10, 10), '')
  assert.equal(sparkPoints([0, 100], 10, 20), '0,20 10,0')
  assert.equal(sparkPoints([5, 5, 5], 10, 10), '0,9.5 5,9.5 10,9.5')
  assert.equal(sparkPoints([-5, 150], 10, 10), '0,10 10,0') // clamped
})
