// data.js hooks with the Hermes SDK and React stubbed (same hook as runtime.test.mjs). useQuery just records its options.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const SDK = `
export const host = {}
export const atom = v => ({ get: () => v, set() {}, listen: () => () => {} })
export const useValue = a => a.get()
export const useQuery = o => globalThis.__useQuery(o)
export const useI18n = () => ({ locale: 'en' })
export const usePluginI18n = () => k => k`
const STUB = { '@hermes/plugin-sdk': SDK, react: 'export const useCallback = f => f; export const useEffect = () => {}' }
registerHooks({
  resolve: (spec, ctx, next) => (STUB[spec] ? { url: 'ht-stub:' + spec, shortCircuit: true } : next(spec, ctx)),
  load: (url, ctx, next) => (url.startsWith('ht-stub:') ? { format: 'module', shortCircuit: true, source: STUB[url.slice(8)] } : next(url, ctx))
})
const { R } = await import('../src/ui/runtime.js')
const { useApprovals } = await import('../src/ui/data.js')

test('approvals: with more than 20 busy sessions the waiting ones are asked first', () => {
  R.ctx = { source: 't' }
  const sessions = [...Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, status: 'running' })), { id: 'w1', status: 'waiting' }, { id: 'idle', status: 'idle' }]
  let asked
  globalThis.__useQuery = o => (o.queryKey[1] === 'active' ? { data: sessions, isSuccess: true } : ((asked = o.queryKey[2]), { data: undefined }))
  useApprovals()
  const ids = asked.split(',')
  assert.equal(ids.length, 20)
  assert.equal(ids[0], 'w1')
  assert.ok(!ids.includes('idle'))
})
