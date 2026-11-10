// quick.js launch(): feedback when the host rejects, and one launch at a time. SDK stubbed as in runtime.test.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

// quick.js imports runtime.js, which needs the SDK atoms and React; only launch() is exercised here.
const STUB = {
  '@hermes/plugin-sdk': `export const host = globalThis.__host
export const atom = v => { let x = v; return { get: () => x, set: n => { x = n }, listen: () => () => {} } }
export const useValue = a => a.get()
export const useI18n = () => ({ locale: 'en' })
export const usePluginI18n = () => k => k`,
  react: 'export const useCallback = f => f; export const useEffect = () => {}'
}
registerHooks({
  resolve: (spec, ctx, next) => (STUB[spec] ? { url: 'ht-stub:' + spec, shortCircuit: true } : next(spec, ctx)),
  load: (url, ctx, next) => (url.startsWith('ht-stub:') ? { format: 'module', shortCircuit: true, source: STUB[url.slice(8)] } : next(url, ctx))
})

const H = globalThis.__host = {}
globalThis.window = {}
globalThis.document = { hidden: false, documentElement: {} }
const { R } = await import('../src/ui/runtime.js')
const { launch } = await import('../src/ui/quick.js')

function setup(over = {}) {
  const log = [], drafts = {}
  Object.assign(H, {
    request: async () => ({ session_id: 's-new' }),
    openSession: async () => {},
    newChat: () => log.push('newChat'),
    notify: m => log.push('notify:' + m.message),
    state: { focusedStoredSessionId: { get: () => null } },
    composer: { setDraft: async (a, t) => { log.push('setDraft'); drafts[a] = t; return true }, getDraft: async a => drafts[a] ?? '', insertText: async () => true, focus: () => {} },
    ...over
  })
  R.ctx = { setTimeout: f => { setTimeout(f, 0); return () => {} }, storage: { get: (k, d) => d, set: () => {} } }
  R.t = k => k
  R.store = { get: () => ({ prefs: { defaultModel: { provider: 'p', model: 'm' } } }) }
  return log
}
const sc = { skill: 'summarize', prompt: 'the inbox', target: 'new', model: null, provider: null }

test('a host call that rejects gives a warning and a result, not an unhandled rejection', async () => {
  const log = setup({ composer: { setDraft: async () => { throw new Error('boom') }, getDraft: async () => '', focus: () => {} } })
  assert.deepEqual(await launch(sc), { ok: false, bound: false })
  assert.ok(log.includes('notify:ql.noComposer'))
  // and the guard was released: the next launch runs
  setup()
  assert.equal((await launch(sc)).ok, true)
})

test('a second launch while one runs is ignored (one chat, not two)', async () => {
  let creates = 0
  setup({ request: async () => { creates++; await new Promise(r => setTimeout(r, 20)); return { session_id: 's-new' } } })
  const [a, b] = await Promise.all([launch(sc), launch(sc)])
  assert.equal(creates, 1)
  assert.deepEqual(b, { ok: false, bound: false })
  assert.equal(a.ok, true)
})

test('launch(sc, extra) types the extra text after the shortcut draft', async () => {
  const drafts = {}
  setup({ composer: { setDraft: async (a, t) => { drafts[a] = t; return true }, getDraft: async a => drafts[a] ?? '', insertText: async () => true, focus: () => {} } })
  assert.equal((await launch({ ...sc, skill: 'skill', prompt: 'prompt' }, 'extra text')).ok, true)
  assert.equal(drafts['s-new'], '/skill prompt extra text')
})

test('a launch right after one finished is ignored (held chord); one after the cooldown runs', async () => {
  let creates = 0
  setup({ request: async () => { creates++; return { session_id: 's-new' } } })
  assert.equal((await launch(sc)).ok, true)
  assert.deepEqual(await launch(sc), { ok: false, bound: false }); assert.equal(creates, 1)
  await new Promise(r => setTimeout(r, 600))
  assert.equal((await launch(sc)).ok, true); assert.equal(creates, 2)
})

test('a launch cut off by dispose (its timers cleared) does not block the plugin after re-enable', async () => {
  setup({ composer: { setDraft: async () => false, getDraft: async () => '', focus: () => {} } })
  R.ctx.setTimeout = () => () => {} // dispose cleared the timers: sleep() never resolves
  launch(sc); await new Promise(r => setTimeout(r, 20))
  setup() // register() ran again: a new ctx
  assert.equal((await launch(sc)).ok, true)
})
