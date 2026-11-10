import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byDate, skillCounts, unusedSkills } from '../src/state/skills.js'

const L = [
  { name: 'b-hub', provenance: 'hub', enabled: true, usage: 0 },
  { name: 'a-agent', provenance: 'agent', enabled: true, usage: 0 },
  { name: 'c-bundled', provenance: 'bundled', enabled: true, usage: 0 },
  { name: 'd-ext', provenance: 'external', enabled: true, usage: 3 },
  { name: 'e-off', provenance: 'agent', enabled: false, usage: 0 },
  { name: 'f-bundled', provenance: 'bundled', enabled: true, usage: 1 },
  { name: 'g-none', enabled: true, usage: 0 }
]

test('counts: external counts as yours, missing provenance only in the total', () => {
  assert.deepEqual(skillCounts(L), { total: 7, counts: { yours: 3, builtin: 2, hub: 1 }, known: true })
})

test('usage undefined is unknown, not zero', () => {
  const old = L.map(({ usage, ...s }) => s)
  assert.equal(skillCounts(old).known, false)
  assert.deepEqual(unusedSkills(old), [])
})

test('unused: enabled only, yours then hub then built-in, then name', () => {
  assert.deepEqual(unusedSkills(L).map(s => s.name), ['a-agent', 'g-none', 'b-hub', 'c-bundled'])
})

test('byDate: newest first, bundled never "added", bad or missing dates dropped', () => {
  const d = {
    'a-agent': { used: '2026-11-01T10:00:00+00:00', added: '2026-10-01T00:00:00+00:00' },
    'b-hub': { used: '2026-11-05T10:00:00+00:00', added: '2026-11-07T00:00:00+00:00' },
    'c-bundled': { used: '2026-11-08T10:00:00+00:00', added: '2026-11-08T00:00:00+00:00' },
    'd-ext': { used: null, added: 'not a date' }
  }
  assert.deepEqual(byDate(L, d, 'used').map(r => r.name), ['c-bundled', 'b-hub', 'a-agent'])
  assert.deepEqual(byDate(L, d, 'added').map(r => r.name), ['b-hub', 'a-agent'])
  assert.deepEqual(byDate(L, undefined, 'used'), [])
})
