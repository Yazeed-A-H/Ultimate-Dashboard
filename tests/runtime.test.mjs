// quick.js launch paths and the runtime.js pull/push logic, with the Hermes SDK and React replaced by stubs
// (a module-resolution hook registered below; no helper files, no dependency). Nothing here touches Hermes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const SDK = `
export const host = globalThis.__host
export const atom = v => { let x = v; const ls = new Set(); return { get: () => x, set: n => { x = n; ls.forEach(f => f(n)) }, listen: f => (ls.add(f), () => ls.delete(f)) } }
export const useValue = a => a.get()
export const useI18n = () => ({ locale: 'en' })
export const usePluginI18n = () => k => k`
const REACT = 'export const useCallback = f => f; export const useEffect = () => {}'
const STUB = { '@hermes/plugin-sdk': SDK, react: REACT }
registerHooks({
  resolve: (spec, ctx, next) => (STUB[spec] ? { url: 'ht-stub:' + spec, shortCircuit: true } : next(spec, ctx)),
  load: (url, ctx, next) => (url.startsWith('ht-stub:') ? { format: 'module', shortCircuit: true, source: STUB[url.slice(8)] } : next(url, ctx))
})

const H = globalThis.__host = {}
globalThis.window = {}
globalThis.document = { hidden: false, documentElement: {} }
const { R, $sync, $editing, $dlg, start, pull } = await import('../src/ui/runtime.js')
const { launch } = await import('../src/ui/quick.js')
const { createStore } = await import('../src/state/store.js')

const tick = () => new Promise(r => setImmediate(r))
const settle = async () => { for (let i = 0; i < 5; i++) await tick() }

// ---------- quick.js ----------
function setup({ focused = null, model = null, composer = true, setDraftOk = true, createFails = false } = {}) {
  const log = [], drafts = {}
  Object.assign(H, {
    request: async (m, p) => { log.push(['request', m, p]); if (createFails) throw new Error('no'); return { session_id: 's-new' } },
    openSession: async id => { log.push(['open', id]) },
    newChat: () => log.push(['newChat']),
    notify: m => log.push(['notify', m.message]),
    state: { focusedStoredSessionId: { get: () => focused } },
    composer: composer ? {
      setDraft: async (a, t) => { log.push(['setDraft', a, t]); if (!setDraftOk) return false; drafts[a] = t; return true },
      getDraft: async a => drafts[a] ?? '',
      insertText: async (a, t, o) => { log.push(['insert', a, t, o.mode]); drafts[a] = t + (drafts[a] || ''); return true },
      focus: a => log.push(['focus', a])
    } : undefined
  })
  const store = new Map()
  R.ctx = { setTimeout: f => { setTimeout(f, 0); return () => {} }, storage: { get: (k, d) => store.get(k) ?? d, set: (k, v) => store.set(k, v) } }
  R.t = (k, v) => k + (v ? JSON.stringify(v) : '')
  R.store = { get: () => ({ prefs: { defaultModel: model } }) }
  return { log, drafts }
}
const sc = o => ({ skill: 'summarize', prompt: 'the inbox', target: 'new', model: null, provider: null, ...o })
const names = log => log.map(x => x[0] + (x[0] === 'notify' ? ':' + x[1].split('{')[0] : ''))

test('launch: a new chat gets the text typed, never sent, with a one-time hint', async () => {
  const { log, drafts } = setup()
  const r = await launch(sc())
  assert.deepEqual(r, { ok: true, bound: false })
  assert.equal(drafts.new, '/summarize the inbox')
  assert.deepEqual(names(log).filter(n => n !== 'focus'), ['newChat', 'setDraft', 'notify:ql.typed'])
  assert.ok(!log.some(([k]) => /submit|send/i.test(k)))
})

test('launch: with a model the session is created first; if that fails a plain new chat and a toast naming the model', async () => {
  let s = setup()
  assert.deepEqual(await launch(sc({ model: 'm1', provider: 'p1' })), { ok: true, bound: true })
  assert.deepEqual(s.log[0], ['request', 'session.create', { model: 'm1', provider: 'p1' }])
  assert.equal(s.drafts['s-new'], '/summarize the inbox')
  s = setup({ createFails: true })
  assert.deepEqual(await launch(sc({ model: 'm1' })), { ok: true, bound: false })
  assert.ok(names(s.log).includes('newChat') && s.log.some(x => x[0] === 'notify' && x[1].startsWith('ql.modelMissing')))
})

test('launch current: prefix when the open chat has text, plain draft when empty, new chat + toast when none is open', async () => {
  let s = setup({ focused: 'chat-1' })
  s.drafts['chat-1'] = 'already typed'
  assert.equal((await launch(sc({ target: 'current' }))).ok, true)
  assert.deepEqual(s.log.find(x => x[0] === 'insert'), ['insert', 'chat-1', '/summarize the inbox', 'prefix'])
  s = setup({ focused: 'chat-2' })
  await launch(sc({ target: 'current' }))
  assert.deepEqual(s.log.find(x => x[0] === 'setDraft'), ['setDraft', 'chat-2', '/summarize the inbox'])
  s = setup({ focused: null })
  const r = await launch(sc({ target: 'current' }))
  assert.equal(r.ok, true)
  assert.deepEqual(names(s.log).filter(n => /notify|newChat/.test(n)).slice(0, 2), ['notify:ql.noChat', 'newChat'])
})

test('launch: a composer that never takes the text ends not-ok after the retries; a host without the composer API gets a new chat and a toast', async () => {
  let s = setup({ setDraftOk: false })
  assert.equal((await launch(sc())).ok, false)
  assert.ok(!s.log.some(x => x[0] === 'notify' && x[1] === 'ql.typed'), 'no "typed" hint when nothing was typed')
  s = setup({ composer: false })
  assert.deepEqual(await launch(sc()), { ok: false, bound: false })
  assert.deepEqual(names(s.log), ['newChat', 'notify:ql.noComposerApi'])
})

// ---------- runtime.js: pull / push ----------
function backend(over = {}) {
  const b = { rev: 0, doc: null, puts: [], fail: null, ...over }
  b.rest = async (path, opts = {}) => {
    if (path === '/health') return { version: '9.9' }
    if (b.fail) throw new Error(b.fail)
    if (opts.method === 'PUT') {
      b.puts.push(opts.body)
      if (b.busy) { b.rev++; return { conflict: true, rev: b.rev, doc: b.doc } } // another window saves before every write
      if (opts.body.base_rev !== b.rev) return { conflict: true, rev: b.rev, doc: b.doc }
      b.rev++; b.doc = opts.body.doc
      return { rev: b.rev }
    }
    return { rev: b.rev, doc: b.doc }
  }
  return b
}
async function boot(b, saved = null, sink = {}) {
  const timers = []
  Object.assign(H, { notify: m => (timers.notes ||= []).push(m.message) })
  start({
    rest: b.rest, i18n: { t: k => k }, storage: { get: (k, d) => (k === 'doc' && saved ? saved : d), set: (k, v) => { sink[k] = v } }, onDispose() {},
    setTimeout: f => { timers.push(f); return () => {} }, setInterval: () => () => {}, addEventListener: () => () => {}
  })
  const flush = async (max = 50) => { await settle(); while (timers.length && max--) { timers.shift()(); await settle() } } // bounded: a save loop fails the test instead of hanging it
  await flush()
  return flush
}
const remoteDoc = name => { const o = createStore(); o.setPref('name', name); return o.persistable() }

test('sync: an empty backend gets this window\'s doc once; a newer backend copy is adopted without a write back', async () => {
  const b = backend()
  const flush = await boot(b)
  assert.equal($sync.get().backend, 'on'); assert.equal($sync.get().version, '9.9')
  assert.deepEqual(b.puts.map(p => p.base_rev), [0]); assert.deepEqual(b.doc, R.store.persistable())
  b.rev = 5; b.doc = remoteDoc('Remote')
  await pull(); await flush()
  assert.equal(R.store.get().prefs.name, 'Remote'); assert.equal(b.puts.length, 1, 'adopting writes nothing back')
})

test('sync: a stale write is retried once on the server copy (last writer wins); editing blocks adopting a newer copy', async () => {
  const b = backend({ rev: 5, doc: remoteDoc('Remote') })
  const flush = await boot(b)
  assert.equal(R.store.get().prefs.name, 'Remote')
  b.rev = 7; b.doc = remoteDoc('Other window') // another window saved meanwhile
  R.store.setPref('name', 'Local'); await flush()
  assert.deepEqual(b.puts.map(p => p.base_rev), [5, 7], 'conflict -> one retry on the server rev')
  assert.equal(b.doc.prefs.name, 'Local'); assert.equal(b.rev, 8)
  R.store.beginEdit()
  b.rev = 20; b.doc = remoteDoc('While editing')
  await pull(); await flush()
  assert.equal(R.store.get().prefs.name, 'Local', 'a newer copy waits until the edit is over')
  R.store.cancelEdit()
})

test('sync: a pref change in one window keeps the views another window saved meanwhile', async () => {
  const b = backend({ rev: 5, doc: remoteDoc('Remote') })
  const flush = await boot(b)
  const other = createStore(b.doc); other.addView('From B') // window B saves a new view
  b.rev = 7; b.doc = other.persistable()
  R.store.setPref('range', '7d'); await flush()
  assert.deepEqual(b.puts.map(p => p.base_rev), [5, 7])
  assert.equal(b.doc.prefs.range, '7d'); assert.equal(b.doc.views.at(-1).name, 'From B')
  assert.equal(R.store.get().views.at(-1).name, 'From B', 'this window shows the merged copy')
  assert.equal(R.store.get().prefs.range, '7d')
})

test('sync: a missing backend route (404) turns the backend off and writes nothing; other errors keep it on', async () => {
  let b = backend({ fail: '404 Not Found' })
  await boot(b)
  assert.equal($sync.get().backend, 'off'); assert.equal(b.puts.length, 0)
  b = backend()
  const flush = await boot(b)
  b.fail = '500 boom'; await pull(); await flush()
  assert.equal($sync.get().backend, 'on'); assert.match($sync.get().error, /boom/)
})

test('sync: a backend with a LOWER rev than the local copy is adopted, never overwritten (switched gateway / restored file)', async () => {
  const b = backend({ rev: 3, doc: remoteDoc('Gateway B') })
  await boot(b, { rev: 40, doc: remoteDoc('Gateway A') })
  assert.equal(R.store.get().prefs.name, 'Gateway B')
  assert.equal(b.puts.length, 0, 'nothing written back')
})

test('sync: a change whose save failed survives the next pull, even when another window saved meanwhile', async () => {
  const b = backend({ rev: 5, doc: remoteDoc('Remote') })
  const flush = await boot(b)
  b.fail = 'offline'; R.store.setPref('range', '7d'); await flush()
  assert.match($sync.get().error, /offline/)
  b.fail = null; b.rev = 6; b.doc = remoteDoc('Other window')
  await pull(); await flush()
  assert.equal(R.store.get().prefs.range, '7d', 'not replaced by the backend copy')
  assert.equal(b.doc.prefs.range, '7d', 'saved over it: merged on the server copy')
  assert.equal(b.doc.prefs.name, 'Other window', 'the other window\'s pref survives')
})

test('sync: a window reopened with an unconfirmed change keeps and saves it; a confirmed copy still yields to the backend', async () => {
  const mine = createStore(); mine.setPref('range', '7d')
  let b = backend({ rev: 6, doc: remoteDoc('Other window') })
  await boot(b, { rev: 5, doc: mine.persistable(), clean: false })
  assert.equal(R.store.get().prefs.range, '7d'); assert.equal(b.doc.prefs.range, '7d')
  b = backend({ rev: 6, doc: remoteDoc('Other window') })
  await boot(b, { rev: 5, doc: mine.persistable(), clean: true })
  assert.equal(R.store.get().prefs.name, 'Other window'); assert.equal(b.puts.length, 0)
})

test('sync: a double conflict while editing parks the save until Done (no save loop; the other window keeps its copy)', async () => {
  const b = backend({ rev: 5, doc: remoteDoc('Remote') })
  const flush = await boot(b)
  R.store.beginEdit()
  b.busy = true; b.doc = remoteDoc('Other window')
  R.store.setPref('range', '7d'); await flush()           // conflict, retry conflicts too -> parked
  const n = b.puts.length
  await flush()
  assert.equal(b.puts.length, n, 'parked: no further saves while editing')
  assert.equal(b.doc.prefs.name, 'Other window')
  b.busy = false; R.store.commitEdit(); await flush()
  assert.equal(b.doc.prefs.range, '7d')
})

test('sync: a conflict parked during Edit saves on the old rev after Done, so it merges instead of overwriting the other window', async () => {
  const base = createStore(); base.setPref('name', 'Base')
  const b = backend({ rev: 5, doc: base.persistable() })
  const flush = await boot(b)
  R.store.setPref('range', '7d'); R.store.beginEdit()
  const o = createStore(b.doc); o.setPref('name', 'B-name'); o.addShortcut({ skill: 'x' }) // the other window saved meanwhile
  b.rev = 6; b.doc = o.persistable()
  await flush(); const n = b.puts.length
  await flush(); assert.equal(b.puts.length, n, 'parked: no save loop while editing')
  R.store.commitEdit(); await flush()
  assert.equal(b.doc.prefs.name, 'B-name'); assert.equal(b.doc.shortcuts.length, 1); assert.equal(b.doc.prefs.range, '7d')
  assert.ok(b.puts.length < n + 4, 'bounded: Done adds a conflict and one merged write')
})

test('sync: an invalid backend document is refused and reported, the local copy stays', async () => {
  const b = backend({ rev: 9, doc: { schema: 1, views: [] } })   // noViews
  await boot(b)
  assert.match($sync.get().error, /rejected/)
  assert.equal(R.store.get().views.length, 2)
  assert.equal(b.puts.length, 0)
})

// ---------- sync regressions ----------
const serve = (b, extra = {}) => { // a backend that also reports updated_at and can park GET snapshots / PUTs
  b.rest = async (path, opts = {}) => {
    if (path === '/health') return { version: '9.9' }
    if (b.fail) throw new Error(b.fail)
    if (opts.method === 'PUT') {
      b.puts.push(opts.body)
      if (b.putGate) await b.putGate
      if (opts.body.base_rev !== b.rev) return { conflict: true, rev: b.rev, updated_at: b.at, doc: b.doc }
      b.rev++; b.doc = opts.body.doc; b.at = (b.at || 0) + 1
      return { conflict: false, rev: b.rev, updated_at: b.at }
    }
    const snap = { rev: b.rev, updated_at: b.at, doc: b.doc } // served now, before a parked PUT lands
    if (b.getGate) await b.getGate
    return snap
  }
  return Object.assign(b, extra)
}

test('sync: a GET served before our own PUT finished is dropped, not adopted over the new edit', async () => {
  const b = serve(backend({ rev: 5, doc: remoteDoc('Base') }))
  const flush = await boot(b)
  let relPut, relGet
  b.putGate = new Promise(r => (relPut = r)); b.getGate = new Promise(r => (relGet = r))
  R.store.setPref('range', '7d'); await flush() // the autosave timer fires and parks on the PUT gate
  const p = pull(); await settle()
  b.getGate = null; relPut(); await settle()
  relGet(); await p; await flush()
  assert.equal(R.store.get().prefs.range, '7d', 'no rollback in the UI')
  R.store.setPref('name', 'Typed after'); await flush()
  assert.equal(b.doc.prefs.range, '7d', 'the next edit does not persist the rollback')
})

test('sync: an unconfirmed change merges onto the other window\'s copy instead of overwriting it', async () => {
  const b = backend({ rev: 5, doc: remoteDoc('Base') })
  const flush = await boot(b)
  b.fail = 'offline'; R.store.setPref('range', '7d'); await flush(); b.fail = null
  const o = createStore(b.doc); o.addView('From B'); o.setPref('name', 'B name')
  b.rev = 6; b.doc = o.persistable()
  await pull(); await flush()
  assert.equal(b.doc.views.length, 3, 'B\'s views kept'); assert.equal(b.doc.prefs.name, 'B name'); assert.equal(b.doc.prefs.range, '7d')
  assert.deepEqual(b.puts.map(p => p.base_rev).slice(-2), [5, 6], 'the PUT conflicted and merged')
})

test('sync: a window reopened after an offline edit merges against the persisted base; storage keeps the old fields', async () => {
  const base = createStore(remoteDoc('Base')); const mine = createStore(base.persistable()); mine.setPref('range', '7d')
  const o = createStore(base.persistable()); o.addView('From B'); o.setPref('name', 'B name')
  const b = backend({ rev: 6, doc: o.persistable() })
  const sink = {}
  await boot(b, { rev: 5, doc: mine.persistable(), clean: false, base: JSON.stringify(base.persistable()) }, sink)
  assert.equal(b.doc.views.length, 3); assert.equal(b.doc.prefs.name, 'B name'); assert.equal(b.doc.prefs.range, '7d')
  assert.equal(sink.doc.clean, true); assert.equal(typeof sink.doc.base, 'string'); assert.equal(typeof sink.doc.rev, 'number')
})

test('sync: same rev but another updated_at (switched gateway) is adopted, not overwritten', async () => {
  const a = serve(backend({ rev: 7, at: 100, doc: remoteDoc('Gateway A') }))
  const flush = await boot(a)
  const g = serve(backend({ rev: 7, at: 200, doc: remoteDoc('Gateway B') }))
  R.ctx.rest = g.rest
  await pull(); await flush()
  assert.equal(R.store.get().prefs.name, 'Gateway B'); assert.equal(g.puts.length, 0)
  // a backend without updated_at keeps the old behaviour: same rev + same content is a no-op
  const n = backend({ rev: 3, doc: remoteDoc('Same') })
  const f2 = await boot(n); await pull(); await f2()
  assert.equal(n.puts.length, 0)
})

test('sync: a conflict whose document fails validation is not toasted; the error is reported, error set', async () => {
  const b = backend({ rev: 5, doc: remoteDoc('Ok') })
  const flush = await boot(b)
  R.ctx.rest = async (p, o = {}) => (p === '/health' ? { version: '9.9' } : o.method === 'PUT' ? (b.puts.push(o.body), { conflict: true, rev: 9, doc: { schema: 1, views: [] } }) : { rev: 5, doc: b.doc })
  const n0 = b.puts.length, notes = []
  H.notify = m => notes.push(m.message)
  R.store.setPref('range', '30d'); await flush()
  assert.deepEqual(notes, [], 'no sync.conflict toast for a document that was not adopted')
  assert.match($sync.get().error, /rejected/); assert.equal(R.store.get().prefs.range, '30d')
})

test('sync: a document over the backend\'s 256 KB limit is not sent; the error says why', async () => {
  const b = backend({ rev: 5, doc: remoteDoc('Ok') })
  const flush = await boot(b)
  const n0 = b.puts.length, doc = { ...R.store.persistable(), pad: 'é'.repeat(140000) } // 140k chars, 280 KB in UTF-8
  R.store.persistable = () => doc
  R.store.setPref('name', 'y'); await flush()
  assert.equal(b.puts.length, n0); assert.match($sync.get().error, /too large/)
})

test('lifecycle: re-enabling the plugin clears a stuck edit mode and dialog', async () => {
  const b = backend({ rev: 5, doc: remoteDoc('Ok') })
  await boot(b)
  R.store.beginEdit(); $dlg.set({ kind: 'gallery' })
  assert.equal($editing.get(), true)
  await boot(b)
  assert.equal($editing.get(), false); assert.equal($dlg.get(), null); assert.equal(R.store.isEditing(), false)
})

// ---------- sync regressions (merge, lifecycle) ----------
test('sync: an edit made during the merged retry does not make the next save overwrite the other window', async () => {
  const b = serve(backend({ rev: 5, doc: remoteDoc('Base') }))
  const flush = await boot(b)
  const o = createStore(b.doc); o.addView('From B'); b.rev = 6; b.doc = o.persistable() // B saved; this window is still on rev 5
  let rel, n = 0; const gate = new Promise(r => (rel = r)), rest = b.rest
  R.ctx.rest = async (p, op = {}) => { if (op.method === 'PUT' && ++n === 2) await gate; return rest(p, op) } // 1st PUT conflicts, the merged 2nd parks
  R.store.setPref('range', '7d'); await flush()
  R.store.setPref('name', 'typed meanwhile'); rel(); await flush()
  assert.ok(b.doc.views.some(v => v.name === 'From B'), 'the other window\'s view is still on the server')
  assert.equal(b.doc.prefs.range, '7d'); assert.equal(b.doc.prefs.name, 'typed meanwhile')
})

test('sync: a merge that breaks a cross-section rule falls back to a valid doc on the server (dangling startView)', async () => {
  const b = serve(backend({ rev: 5, doc: remoteDoc('Base') }))
  const flush = await boot(b)
  R.store.addView('X'); await flush()
  const X = R.store.get().views.at(-1).id
  b.fail = 'offline'; R.store.setPref('startView', X); await flush(); b.fail = null // unconfirmed startView = X
  const o = createStore(b.doc); o.deleteView(X); b.rev++; b.doc = o.persistable() // the other window deletes X
  await pull(); await flush()
  assert.ok(b.doc.prefs.startView === 'last' || b.doc.views.some(v => v.id === b.doc.prefs.startView), 'no dangling startView on the server')
  assert.deepEqual(b.doc, R.store.persistable(), 'server and window converge')
})

test('sync: a merge that duplicates a key (openKey vs another window\'s shortcut) is saved normalised', async () => {
  const b = serve(backend({ rev: 5, doc: remoteDoc('Base') }))
  const flush = await boot(b)
  b.fail = 'offline'; R.store.setPref('openKey', 'mod+k'); await flush(); b.fail = null
  const o = createStore(b.doc); o.addShortcut({ skill: 'x', key: 'mod+k' }); b.rev++; b.doc = o.persistable()
  await pull(); await flush()
  assert.ok(!(b.doc.prefs.openKey && b.doc.shortcuts.some(s => s.key === b.doc.prefs.openKey)), 'no duplicate key on the server')
  assert.deepEqual(b.doc, R.store.persistable())
})

test('sync: a persisted base written before a pref existed does not make its default override the other window', async () => {
  const mine = createStore(); mine.setPref('range', '7d')
  const oldBase = createStore().persistable(); delete oldBase.prefs.hintDismissed
  const o = createStore(); o.setPref('hintDismissed', true)
  const b = serve(backend({ rev: 6, doc: o.persistable() }))
  await boot(b, { rev: 5, doc: mine.persistable(), clean: false, base: JSON.stringify(oldBase) })
  assert.equal(b.doc.prefs.hintDismissed, true); assert.equal(b.doc.prefs.range, '7d')
})

test('lifecycle: a request of a disposed instance does not write into the re-enabled instance', async () => {
  const b1 = serve(backend({ rev: 3, doc: remoteDoc('Gateway 1') }))
  const flush = await boot(b1)
  let rel; b1.putGate = new Promise(r => (rel = r))
  R.store.setPref('range', '7d'); await flush() // the PUT is in flight on the old ctx
  const b2 = serve(backend({ rev: 9, doc: remoteDoc('Gateway 2') })), sink = {}
  await boot(b2, null, sink)
  assert.equal(sink.doc.rev, 9)
  rel(); await settle(); await settle()
  assert.equal(sink.doc.rev, 9, 'the old PUT\'s rev is not written into the new storage')
  assert.equal(R.store.get().prefs.name, 'Gateway 2'); assert.equal(b2.puts.length, 0)
})

test('sync: the "too large" error clears when the document shrinks back to the saved one', async () => {
  const b = backend({ rev: 5, doc: remoteDoc('Ok') })
  const flush = await boot(b)
  const small = structuredClone(R.store.persistable()), big = { ...small, pad: 'x'.repeat(300000) }
  R.store.persistable = () => big; R.store.setPref('name', 'y'); await flush()
  assert.match($sync.get().error, /too large/)
  R.store.persistable = () => small; R.store.setPref('name', 'z'); await flush()
  assert.equal($sync.get().error, null)
})

test('sync: the cap is inclusive: exactly 262144 bytes is sent, one more is not', async () => {
  const b = backend({ rev: 5, doc: remoteDoc('Ok') })
  const flush = await boot(b)
  const small = structuredClone(R.store.persistable()), len = d => new TextEncoder().encode(JSON.stringify(d)).length
  const at = { ...small, pad: 'x'.repeat(262144 - len({ ...small, pad: '' })) }
  assert.equal(len(at), 262144)
  const n0 = b.puts.length
  R.store.persistable = () => ({ ...at, pad: at.pad + 'x' }); R.store.setPref('name', 'a'); await flush()
  assert.equal(b.puts.length, n0, 'one byte over: not sent')
  R.store.persistable = () => at; R.store.setPref('name', 'b'); await flush()
  assert.equal(b.puts.length, n0 + 1, 'exactly at the cap: sent')
})

test('sync: a pull does not replace the doc while a save is scheduled; the next pull adopts the other window\'s copy', async () => {
  const b = backend({ rev: 5, doc: remoteDoc('Base') })
  const flush = await boot(b)
  R.store.setPref('name', 'tmp'); R.store.setPref('name', 'Base') // edit and revert: the doc equals the saved one, but a save timer is queued
  b.rev = 6; b.doc = remoteDoc('Other window')
  await pull()
  assert.equal(R.store.get().prefs.name, 'Base', 'not adopted while a save is scheduled')
  await flush(); await pull(); await flush()
  assert.equal(R.store.get().prefs.name, 'Other window'); assert.equal(b.puts.length, 0)
})
