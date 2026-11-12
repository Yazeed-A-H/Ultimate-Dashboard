import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CARDS, baseId, getCard, sanitizeOptions } from '../src/state/cards.js'
import { createStore, defaults, defaultShortcuts, parseImport, stripMode, validate, BUILTIN_TEMPLATES, LIM } from '../src/state/store.js'
import { saveWithRetry } from '../src/state/sync.js'
import { fill, gatherApprovals, gatherUsage, isFailed, isOff, cliJson, comboFromEvent, comboLabel, greetingKey, isInternalJob, nearLimit, plural, shortcutDraft, withExtra, shortcutLabel, shortDuration, sortWindows, usageText, whenText, scheduleRaw, scheduleText, modelText, modelParts, modelLabel, isDelivery } from '../src/state/format.js'
import { FLAT } from '../src/ui/i18n.js'

const ids = s => s.activeView().cards.map(c => c.id)

test('cards: proto ids never resolve; options sanitized', () => {
  assert.equal(getCard('__proto__'), undefined)
  assert.equal(CARDS.length, 16)
  assert.deepEqual(CARDS.filter(c => c.multi).map(c => c.id), ['job-result'])
  assert.deepEqual(sanitizeOptions('recent-files', { range: '7d', fields: ['type', 'bogus', 'type'], title: '  x  ', evil: 1 }), { range: '7d', fields: ['type'], title: 'x' })
  assert.deepEqual(sanitizeOptions('services', { range: '7d' }), {}) // services has no range
})

test('templates fill full rows at 12 columns', () => {
  const cols = { s: 3, m: 4, l: 6, xl: 12 }
  for (const t of BUILTIN_TEMPLATES) assert.equal(t.cards.reduce((a, c) => a + cols[c.size], 0) % 12, 0, t.id)
})

test('defaults: Dashboard + System views, no overlap, translatable keys, no name', () => {
  const d = defaults()
  assert.deepEqual(d.views.map(v => v.cards.map(c => c.id)), [['approvals', 'recent-sessions', 'cron', 'usage', 'recent-files'], ['services', 'machine', 'workers']])
  assert.deepEqual(d.views.map(v => v.nameKey), ['view.today', 'view.ops'])
  assert.equal(d.prefs.name, '')
  assert.equal(validate(d).ok, true)
})

test('toggleCard adds or removes with one undo step and refuses unknown ids', () => {
  const s = createStore(); s.beginEdit()
  assert.equal(s.toggleCard('cron'), false); assert.ok(!ids(s).includes('cron'))
  assert.equal(s.toggleCard('cron', 'l'), true); assert.ok(ids(s).includes('cron'))
  assert.equal(s.toggleCard('nope'), null)
  s.undo(); assert.ok(!ids(s).includes('cron'))
  s.cancelEdit(); assert.ok(ids(s).includes('cron'), 'cancel restores the original view')
})

test('edit session: undo/redo/cancel/commit', () => {
  const s = createStore()
  const before = ids(s)
  s.beginEdit()
  assert.equal(s.moveCard('usage', 0), true)
  assert.equal(ids(s)[0], 'usage')
  assert.equal(s.removeCard('cron'), true)
  assert.equal(s.canUndo(), true)
  s.undo()
  assert.ok(ids(s).includes('cron'))
  s.redo()
  assert.ok(!ids(s).includes('cron'))
  // persistable during edit = pre-edit layout
  assert.deepEqual(s.persistable().views[0].cards.map(c => c.id), before)
  s.cancelEdit()
  assert.deepEqual(ids(s), before)
  s.beginEdit(); s.removeCard('cron'); s.commitEdit()
  assert.ok(!ids(s).includes('cron'))
  assert.equal(s.undo(), false) // no undo outside edit
})

test('new edit clears redo; history bounded', () => {
  const s = createStore(); s.beginEdit()
  s.removeCard('cron'); s.undo(); s.removeCard('usage')
  assert.equal(s.canRedo(), false)
  for (let i = 0; i < 150; i++) s.moveCard('cron', i % 2)
  let n = 0; while (s.undo()) n++
  assert.equal(n, 100) // literal: LIM.history itself is a mutation target
  assert.equal(LIM.history, 100)
  let r = 0; while (s.redo()) r++
  assert.equal(r, 100)
})

test('size, options, move to view, add, last view protected', () => {
  const s = createStore()
  assert.equal(s.setSize('approvals', 's'), false) // not an allowed size
  assert.equal(s.setSize('approvals', 'm'), true)
  assert.equal(s.setOptions('approvals', { title: 'Mine', density: 'compact' }), true)
  assert.equal(s.setOptions('approvals', { title: null }), true)
  assert.deepEqual(s.activeView().cards.find(c => c.id === 'approvals').options, { density: 'compact' })
  assert.equal(s.resetCard('approvals'), true)
  assert.equal(s.activeView().cards.find(c => c.id === 'approvals').size, 'l')
  assert.equal(s.moveCardToView('usage', 'v-ops'), true)
  assert.ok(!ids(s).includes('usage'))
  assert.ok(s.get().views[1].cards.some(c => c.id === 'usage'))
  assert.equal(s.addCard('usage'), true)
  assert.equal(s.addCard('usage'), false)
  s.removeCard('services'); s.setActiveView('v-ops')
  assert.equal(s.moveCardToView('services', 'v-today'), true)
  s.addCard('services')
  assert.equal(s.moveCardToView('services', 'v-today'), false, 'target already has it: refuse, never drop')
  assert.ok(ids(s).includes('services'))
  s.setActiveView('v-today')
  assert.equal(s.deleteView('v-ops'), true)
  assert.equal(s.deleteView('v-today'), false) // last view
})

test('views: add from template switches to it; rename; reorder', () => {
  const s = createStore()
  const id = s.addView('Mine', 'tpl-minimal')
  assert.equal(s.get().activeView, id)
  assert.equal(s.activeView().cards.length, 2)
  assert.equal(s.renameView(id, ''), true) // empty restores the default name
  assert.equal(s.get().views[2].name, 'View 3')
  assert.equal(s.renameView('v-ops', 'Mine'), true)
  assert.equal(s.renameView('v-ops', '  '), true)
  assert.deepEqual([s.get().views[1].name, s.get().views[1].nameKey], ['', 'view.ops']) // built-in: translated again
  assert.equal(s.renameView('nope', 'x'), false)
  assert.equal(s.renameView(id, 'Ops'), true)
  assert.equal(s.get().views[2].nameKey, undefined) // user "Ops" stays literal
  s.moveView(id, 0)
  assert.equal(s.get().views[0].id, id)
  assert.equal(s.addView('x', 'nope'), null)
})

test('export -> import round trip restores the same doc', () => {
  const s = createStore()
  s.beginEdit(); s.moveCard('cron', 0); s.commitEdit()
  s.addShortcut({ skill: 'arxiv', model: 'm1', provider: 'p1', prompt: 'llm' })
  s.setPinnedCron(['job1'])
  s.saveTemplate('T')
  const json = s.exportJSON()
  const t = createStore()
  const r = t.importJSON(json)
  assert.equal(r.ok, true)
  assert.deepEqual(t.get(), s.get())
})

test('import: corrupt changes nothing; unknown cards ignored and reported', () => {
  const s = createStore()
  const before = JSON.stringify(s.get())
  for (const bad of ['', '{', '[]', '{"schema":99,"views":[{}]}', '{"schema":1,"views":[]}', 'x'.repeat(300000)]) {
    assert.equal(s.importJSON(bad).ok, false, bad.slice(0, 20))
  }
  assert.equal(JSON.stringify(s.get()), before)
  const doc = defaults(); doc.views[0].cards.push({ id: 'projects', size: 'm' }, { id: '__proto__' })
  const r = s.importJSON(JSON.stringify(doc))
  assert.equal(r.ok, true)
  assert.deepEqual(r.ignored.map(x => x.id), ['projects', '__proto__'])
})

test('import accepts the earlier export format, version 6', () => {
  const r = parseImport(JSON.stringify({ version: 6, views: [{ id: 'overview', name: 'Overview', cards: [{ id: 'approvals', size: 'l' }] }], shortcuts: [{ id: 'x', label: 'A', skill: 'arxiv', provider: '', model: '' }] }))
  assert.equal(r.ok, true)
  assert.equal(r.doc.views[0].name, 'Overview')
  assert.equal(r.doc.shortcuts[0].model, null)
})

test('reset layout keeps prefs/shortcuts/pins/templates; reset all clears', () => {
  const s = createStore()
  s.setPref('name', 'Alex'); s.addShortcut({ skill: 'arxiv' }); s.setPinnedCron(['a']); s.saveTemplate('Mine')
  s.removeCard('cron')
  s.resetLayout()
  assert.ok(ids(s).includes('cron'))
  assert.equal(s.get().prefs.name, 'Alex')
  assert.equal(s.get().shortcuts.length, 1)
  assert.equal(s.get().templates.length, 1)
  assert.deepEqual(s.get().pinnedCron, ['a'])
  s.resetAll()
  assert.deepEqual(s.get(), { ...defaults(), views: s.get().views })
  assert.equal(s.get().templates.length, 0)
})

test('prefs validated', () => {
  const s = createStore()
  assert.equal(s.setPref('refresh', '7m'), false)
  assert.equal(s.setPref('navIcon', 'not-a-codicon'), false)
  assert.equal(s.setPref('navIcon', 'home'), true)
  assert.equal(s.setPref('defaultModel', { provider: 'p', model: 'm' }), true)
  assert.equal(s.setPref('defaultModel', null), true)
})

test('shortcuts: no cap, skill validated, reorder, default seeding', () => {
  const s = createStore()
  for (let i = 0; i < 40; i++) assert.ok(s.addShortcut({ skill: 'arxiv' }))
  assert.equal(s.get().shortcuts.length, 40)
  assert.equal(s.addShortcut({ skill: 'two words' }), null)
  const first = s.get().shortcuts[0].id
  s.moveShortcut(first, 39)
  assert.equal(s.get().shortcuts[39].id, first)
  const skills = [
    { name: 'a', provenance: 'bundled', enabled: true, usage: 1 },
    { name: 'b', provenance: 'bundled', enabled: true, usage: 9 },
    { name: 'c', provenance: 'local', enabled: true, usage: 99 },
    { name: 'd', provenance: 'bundled', enabled: false, usage: 50 }
  ]
  assert.deepEqual(defaultShortcuts(skills).map(x => x.skill), ['b', 'a'])
  const t = createStore()
  assert.equal(t.seedShortcuts(skills), true)
  assert.equal(t.seedShortcuts(skills), false) // once only
})

test('strip modes', () => {
  assert.deepEqual([0, 4, 5, 8, 9, 30].map(stripMode), ['row', 'row', 'wrap', 'wrap', 'more', 'more'])
})

test('sync: a conflict retries once with the change, then gives up with the server copy', async () => {
  const calls = []
  const put = async b => { calls.push(b); return calls.length === 1 ? { conflict: true, rev: 5, doc: { n: 1 } } : { conflict: false, rev: 6 } }
  const r = await saveWithRetry(put, 4, { n: 0 }, d => ({ ...d, n: d.n + 1 }))
  assert.equal(r.ok, true); assert.equal(r.rev, 6); assert.deepEqual(calls[1], { base_rev: 5, doc: { n: 2 } })
  const r2 = await saveWithRetry(async () => ({ conflict: true, rev: 9, doc: { s: 1 } }), 1, {}, d => d)
  assert.equal(r2.conflict, true); assert.deepEqual(r2.doc, { s: 1 })
})

test('format: greeting, arabic plurals (all six), draft, durations', () => {
  assert.deepEqual([3, 9, 14, 20].map(greetingKey), ['greet.night', 'greet.morning', 'greet.afternoon', 'greet.evening'])
  const forms = { zero: () => 'zero', one: () => 'one', two: () => 'two', few: () => 'few', many: () => 'many', other: () => 'other' }
  assert.deepEqual([0, 1, 2, 3, 11, 100].map(n => plural('ar', n, forms)), ['zero', 'one', 'two', 'few', 'many', 'other'])
  assert.deepEqual([1, 2].map(n => plural('en', n, forms)), ['one', 'other'])
  assert.equal(shortcutDraft({ skill: 'arxiv', prompt: '' }), '/arxiv ')
  assert.equal(shortcutDraft({ skill: 'arxiv', prompt: 'llm' }), '/arxiv llm')
  assert.match(shortDuration('en', 120), /2/)
  // the unit is picked first and the value floored: 3599 s is 59 min, not "60 min"
  assert.match(shortDuration('en', 3599), /^59 min/)
  assert.match(shortDuration('en', 86399), /^23 hr/)
  assert.match(shortDuration('en', 3600), /^1 hr/)
})

test('cliJson: JSON survives CLI warnings around it (cli.exec joins stderr)', () => {
  assert.deepEqual(cliJson('hermes: a source update is unfinished; run `hermes update`\n{"windows":[{"used_percent":2}]}\n'), { windows: [{ used_percent: 2 }] })
  assert.equal(cliJson('no json here'), null)
  assert.equal(cliJson(''), null)
})

test('shortcuts: skill OR free prompt; target and key validated; old docs still load', () => {
  const s = createStore()
  assert.equal(s.addShortcut({ skill: '', prompt: '' }), null)
  assert.equal(s.addShortcut({ skill: '  ', prompt: '  ' }), null)
  assert.equal(s.addShortcut({ skill: 'two words' }), null)
  assert.equal(s.addShortcut({ skill: 'two words', prompt: 'x' }), null, 'skill stays one token even with a prompt')
  const a = s.addShortcut({ prompt: 'Summarise my inbox\nand list the top 3', target: 'current', key: 'mod+shift+k' })
  const c = s.get().shortcuts[0]
  assert.equal(c.skill, ''); assert.equal(c.target, 'current'); assert.equal(c.key, 'mod+shift+k'); assert.match(c.prompt, /\n/)
  s.addShortcut({ skill: '/arxiv', target: 'bogus', key: 'k' })
  assert.deepEqual([s.get().shortcuts[1].skill, s.get().shortcuts[1].target, s.get().shortcuts[1].key], ['arxiv', 'new', ''])
  for (const bad of ['mod+k+k', 'shift+k', 'alt+k', 'ctrl+k', 'mod+ab', 'mod+f13', 'mod+', 'mod+shift+alt+k', 'MOD+K', 'mod+\n', 5, null, {}]) assert.equal(s.addShortcut({ skill: 'x', key: bad }) && s.get().shortcuts.at(-1).key, '', String(bad))
  for (const good of ['mod+k', 'mod+alt+shift+9', 'mod+f12', 'mod+,', 'mod+shift+[', 'mod+\\']) assert.equal(s.addShortcut({ skill: 'x', key: good }) && s.get().shortcuts.at(-1).key, good)
  assert.equal(s.updateShortcut(a, { prompt: '', skill: '' }), false, 'cannot empty both')
  assert.equal(s.updateShortcut(a, { skill: 'arxiv', prompt: '' }), true)
  // an old doc (no target/key) validates and gets the defaults
  const r = validate({ schema: 1, views: [{ id: 'v', name: 'V', cards: [] }], shortcuts: [{ id: 'old', label: '', skill: 'arxiv', provider: null, model: null, prompt: '' }] })
  assert.equal(r.ok, true); assert.deepEqual([r.doc.shortcuts[0].target, r.doc.shortcuts[0].key], ['new', ''])
  assert.equal(r.doc.prefs.startView, 'last'); assert.equal(r.doc.prefs.hideInternal, true); assert.equal(r.doc.prefs.notifyApprovals, false)
})

test('shortcut keys are unique across shortcuts and the open-dashboard key (store + import)', () => {
  const s = createStore()
  const a = s.addShortcut({ skill: 'a', key: 'mod+1' })
  assert.equal(s.addShortcut({ skill: 'b', key: 'mod+1' }), null)
  const b = s.addShortcut({ skill: 'b', key: 'mod+2' })
  assert.equal(s.updateShortcut(b, { key: 'mod+1' }), false)
  assert.equal(s.updateShortcut(a, { key: 'mod+1', label: 'same key, same shortcut' }), true)
  assert.equal(s.setPref('openKey', 'mod+1'), false); assert.equal(s.setPref('openKey', 'mod+3'), true)
  assert.equal(s.addShortcut({ skill: 'c', key: 'mod+3' }), null)
  assert.equal(s.setPref('openKey', 'k'), false); assert.equal(s.setPref('openKey', ''), true)
  assert.equal(s.keyTaken('mod+1'), true); assert.equal(s.keyTaken('mod+1', a), false)
  const dup = validate({ schema: 1, views: [{ id: 'v', name: 'V', cards: [] }], prefs: { openKey: 'mod+o' }, shortcuts: [{ skill: 'a', key: 'mod+o' }, { skill: 'b', key: 'mod+p' }, { skill: 'c', key: 'mod+p' }] })
  assert.deepEqual([dup.doc.prefs.openKey, ...dup.doc.shortcuts.map(x => x.key)], ['mod+o', '', 'mod+p', ''])
})

test('new prefs validated; startView follows the views', () => {
  const s = createStore()
  assert.equal(s.setPref('startView', 'nope'), false)
  assert.equal(s.setPref('startView', 'v-ops'), true)
  assert.equal(s.setPref('startView', '../x y'), false)
  assert.equal(s.setPref('range', '7d'), true); assert.equal(s.setPref('range', 'year'), false)
  assert.equal(s.setPref('hideGreeting', 'yes'), false); assert.equal(s.setPref('hideGreeting', true), true)
  assert.equal(s.setPref('notifyApprovals', 1), false); assert.equal(s.setPref('notifyApprovals', true), true)
  assert.equal(s.setPref('hideInternal', false), true)
  s.deleteView('v-ops'); assert.equal(s.get().prefs.startView, 'last')
  s.setPref('startView', 'v-today'); s.resetLayout(); assert.equal(s.get().prefs.startView, 'v-today') // default view still exists
  const r = validate({ ...defaults(), prefs: { ...defaults().prefs, startView: 'ghost', hideGreeting: 'x', openKey: 'bad' } })
  assert.deepEqual([r.doc.prefs.startView, r.doc.prefs.hideGreeting, r.doc.prefs.openKey], ['last', false, ''])
  const t = createStore(); assert.equal(t.importJSON(s.exportJSON()).ok, true); assert.deepEqual(t.get().prefs, s.get().prefs)
})

test('pinned order: move, stays in the pin list; internal-job rule needs name AND one-shot', () => {
  const s = createStore(); s.setPinnedCron(['a', 'b', 'c'])
  assert.equal(s.movePinned('c', 0), true); assert.deepEqual(s.get().pinnedCron, ['c', 'a', 'b'])
  assert.equal(s.movePinned('zz', 0), false); assert.equal(s.movePinned('a', 1.5), false)
  const j = (name, schedule) => ({ name, schedule })
  assert.equal(isInternalJob(j('hermes-mobile-device-access-1a2b3c4d', 'once in 1m')), true)
  assert.equal(isInternalJob(j('hermes-mobile-device-access-1a2b3c4d', 'every 1h')), false, 'recurring is the user\'s')
  assert.equal(isInternalJob(j('Weekly digest', 'once in 1m')), false)
  assert.equal(isInternalJob(j('hermes-backup', 'once in 5m')), false, 'no hash suffix')
  assert.equal(isInternalJob(null), false)
})

test('card options: providers + thresholds sanitised', () => {
  assert.deepEqual(sanitizeOptions('usage', { providers: ['openrouter', 'openrouter', 'a b', 5, '../x'], warn: 80 }), { providers: ['openrouter'], warn: 80 })
  assert.deepEqual(sanitizeOptions('usage', { providers: [], warn: 49 }), {})
  assert.deepEqual(sanitizeOptions('usage', { warn: 99.5 }), {}); assert.deepEqual(sanitizeOptions('usage', { warn: '80' }), {})
  assert.deepEqual(sanitizeOptions('usage', { warn: 50 }), { warn: 50 })
  assert.deepEqual(sanitizeOptions('machine', { warnCpu: 70, warnMem: 85, warnDisk: 99, warn: 70 }), { warnCpu: 70, warnMem: 85, warnDisk: 99 })
  assert.deepEqual(sanitizeOptions('machine', { warnCpu: 100 }), {})
  assert.deepEqual(sanitizeOptions('services', { warn: 70, providers: ['x'] }), {}, 'other cards take neither')
  const s = createStore(); s.setOptions('usage', { warn: 70, providers: ['p1'] }); assert.deepEqual(s.activeView().cards.find(c => c.id === 'usage').options, { warn: 70, providers: ['p1'] })
  s.setOptions('usage', { warn: null, providers: null }); assert.deepEqual(s.activeView().cards.find(c => c.id === 'usage').options, {})
})

test('format: free-text draft, labels, combos, usage text, near-limit threshold', () => {
  assert.equal(shortcutDraft({ skill: '', prompt: 'Summarise\nmy inbox' }), 'Summarise\nmy inbox')
  assert.equal(shortcutDraft({ skill: 'x', prompt: 'a\nb' }), '/x a\nb')
  assert.equal(shortcutLabel({ label: 'L', skill: 's', prompt: 'p' }), 'L'); assert.equal(shortcutLabel({ label: '', skill: 's', prompt: 'p' }), 's')
  assert.equal(shortcutLabel({ label: '', skill: '', prompt: '  Summarise my inbox and list the top three  ' }), 'Summarise my inbox and…')
  const k = (key, o = {}) => ({ key, code: /^[a-z]$/i.test(key) ? 'Key' + key.toUpperCase() : o.code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o })
  assert.equal(comboFromEvent(k('k', { metaKey: true }), true), 'mod+k')
  assert.equal(comboFromEvent(k('K', { metaKey: true, shiftKey: true }), true), 'mod+shift+k')
  assert.equal(comboFromEvent(k('˚', { metaKey: true, altKey: true, code: 'KeyK' }), true), 'mod+alt+k')
  assert.equal(comboFromEvent(k('k', { ctrlKey: true }), true), null, 'Mac needs Cmd, not Ctrl')
  assert.equal(comboFromEvent(k('k', { ctrlKey: true, metaKey: true }), true), null)
  assert.equal(comboFromEvent(k('k', { ctrlKey: true }), false), 'mod+k')
  assert.equal(comboFromEvent(k('k'), true), null, 'no Cmd/Ctrl')
  assert.equal(comboFromEvent(k('Meta', { metaKey: true, code: 'MetaLeft' }), true), null, 'modifier alone')
  assert.equal(comboFromEvent(k('&', { metaKey: true, shiftKey: true, code: 'Digit7' }), true), 'mod+shift+7')
  assert.equal(comboFromEvent(k('F5', { metaKey: true, code: 'F5' }), true), 'mod+f5')
  assert.equal(comboFromEvent(k('Enter', { metaKey: true, code: 'Enter' }), true), null)
  assert.equal(comboFromEvent(k(',', { metaKey: true, code: 'Comma' }), true), 'mod+,')
  assert.equal(comboLabel('mod+shift+k', true), '⌘⇧K'); assert.equal(comboLabel('mod+alt+k', false), 'Ctrl+Alt+K')
  assert.deepEqual(usageText('Weekly'), ['u.w.weekly', {}]); assert.deepEqual(usageText('current SESSION'), ['u.w.currentSession', {}])
  assert.deepEqual(usageText('Fable week'), ['u.w.named', { name: 'Fable' }]); assert.deepEqual(usageText('API key quota'), ['u.w.apiKey', {}])
  assert.equal(usageText('Mystery limit'), null); assert.equal(usageText(undefined), null)
  assert.deepEqual(usageText('$1.39 of $30.00 remaining', true), ['u.d.remaining', { a: '$1.39', b: '$30.00' }]); assert.equal(usageText('something else', true), null)
  assert.equal(nearLimit(90), true); assert.equal(nearLimit(89), false); assert.equal(nearLimit(75, 70), true); assert.equal(nearLimit(null), false)
})

const OLD14 = ['k-wait', 'k-files', 'k-usage', 'k-machine', 'approvals', 'running', 'pinned-cron', 'usage', 'services', 'machine', 'recent-files', 'recent-sessions', 'cron', 'workers']

test('v0.3 alias migration: an old 14-card doc becomes 8 cards, options carried, nothing counted as ignored', () => {
  const doc = defaults()
  doc.views = [{ id: 'v1', name: 'Mine', cards: [
    { id: 'k-wait', size: 's' }, { id: 'k-files', size: 's', options: { range: '30d' } }, { id: 'k-usage', size: 's', options: { warn: 70, providers: ['p1'] } },
    { id: 'k-machine', size: 's', options: { warnCpu: 60, title: 'Box' } }, { id: 'approvals', size: 'm' },
    { id: 'running', size: 'l', options: { fields: ['model', 'elapsed'], density: 'compact' } },
    { id: 'pinned-cron', size: 'm', options: { fields: ['next'] } }, { id: 'usage', size: 'l' }, { id: 'services', size: 'm' }, { id: 'machine', size: 'm' },
    { id: 'recent-files', size: 'l' }, { id: 'recent-sessions', size: 'l' }, { id: 'cron', size: 'xl' }, { id: 'workers', size: 'xl' }] }]
  doc.activeView = 'v1'
  assert.deepEqual(doc.views[0].cards.map(c => c.id).sort(), [...OLD14].sort())
  const r = parseImport(JSON.stringify(doc))
  assert.equal(r.ok, true)
  assert.deepEqual(r.ignored, [])
  const cards = r.doc.views[0].cards
  // in place: k-wait -> approvals slot, the real approvals card wins (target present, alias dropped)
  assert.deepEqual(cards.map(c => c.id), ['approvals', 'recent-files', 'usage', 'machine', 'recent-sessions', 'cron', 'services', 'workers'].sort((a, b) => cards.findIndex(c => c.id === a) - cards.findIndex(c => c.id === b)))
  assert.equal(cards.length, 8)
  const by = id => cards.find(c => c.id === id)
  assert.equal(by('approvals').size, 'm', 'the real card keeps its size')
  // targets present -> the alias's options are dropped, the real card's stay
  assert.deepEqual(by('usage').options, {})
  assert.deepEqual(by('recent-sessions').options, {})
  assert.deepEqual(by('cron').options, {})
  // alias only (no real target): replaced in place, options carried
  const only = defaults(); only.views = [{ id: 'v1', name: 'x', cards: [{ id: 'k-files', size: 's', options: { range: '30d' } }, { id: 'k-usage', options: { warn: 70, providers: ['p1'] } }, { id: 'k-machine', options: { warnCpu: 60, title: 'Box' } }, { id: 'running', size: 'l', options: { fields: ['model', 'elapsed', 'bogus'], density: 'compact' } }, { id: 'pinned-cron', options: { fields: ['next'] } }, { id: 'k-wait' }] }]
  only.activeView = 'v1'
  const c2 = parseImport(JSON.stringify(only))
  assert.deepEqual(c2.ignored, [])
  assert.deepEqual(c2.doc.views[0].cards.map(c => c.id), ['recent-files', 'usage', 'machine', 'recent-sessions', 'cron', 'approvals'])
  const g = id => c2.doc.views[0].cards.find(c => c.id === id)
  assert.deepEqual(g('recent-files').options, { range: '30d' })
  assert.deepEqual(g('usage').options, { warn: 70, providers: ['p1'] })
  assert.deepEqual(g('machine').options, { warnCpu: 60, title: 'Box' })
  assert.deepEqual(g('recent-sessions').options, { fields: ['model', 'time'], density: 'compact' })
  assert.deepEqual(g('cron').options, { pinnedOnly: true, fields: ['next'] })
  assert.equal(g('recent-files').size, 'l', 'KPI size S is not valid on the panel: its default applies')
  // idempotent: re-importing the migrated doc changes nothing
  assert.deepEqual(parseImport(JSON.stringify(c2.doc)).doc, c2.doc)
})

test('v0.3 migration: version 6 export with old ids, templates and the store', () => {
  const r = parseImport(JSON.stringify({ version: 6, views: [{ id: 'overview', name: 'Overview', cards: [{ id: 'k-wait', size: 's' }, { id: 'running', size: 'l' }, { id: 'approvals', size: 'l' }] }], shortcuts: [] }))
  assert.equal(r.ok, true); assert.deepEqual(r.ignored, [])
  assert.deepEqual(r.doc.views[0].cards.map(c => c.id), ['recent-sessions', 'approvals'].sort((a, b) => r.doc.views[0].cards.findIndex(c => c.id === a) - r.doc.views[0].cards.findIndex(c => c.id === b)))
  const s = createStore()
  const old = JSON.parse(s.exportJSON()); old.templates = [{ id: 't1', name: 'T', cards: [{ id: 'k-usage', size: 's' }, { id: 'pinned-cron', size: 'm' }] }]
  assert.equal(s.importJSON(JSON.stringify(old)).ok, true)
  assert.deepEqual(s.get().templates[0].cards.map(c => c.id), ['usage', 'cron'])
  assert.equal(s.restoreTemplate(s.get().templates[0]), false, 'undo of a delete never duplicates an id')
})

test('approvals: all calls failing is an error; one failing is fine; empty stays empty', async () => {
  const S = [{ id: 'a' }, { id: 'b' }]
  await assert.rejects(gatherApprovals(S, async () => { throw new Error('rpc') }), /every session/)
  const some = await gatherApprovals(S, async s => { if (s.id === 'a') throw new Error('gone'); return { approvals: [{ request_id: 'r1', command: 'ls' }, { command: 'no id' }] } })
  assert.deepEqual(some.map(a => [a.session.id, a.request_id]), [['b', 'r1']])
  assert.deepEqual(await gatherApprovals([], async () => { throw new Error('never') }), [])
  assert.deepEqual(await gatherApprovals(S, async () => ({})), [])
})

test('fill isolates string values (bidi) and leaves numbers and unknown names alone', () => {
  assert.equal(fill('{greeting}, {name}', { greeting: 'مساء الخير', name: 'Alex' }), '\u2068مساء الخير\u2069, \u2068Alex\u2069')
  assert.equal(fill('{n} more', { n: 5 }), '5 more')
  assert.equal(fill('{x} {y}', { x: 'a' }), '\u2068a\u2069 {y}')
  assert.equal(fill('plain', undefined), 'plain')
  assert.equal(fill('{p} used', { p: '95%' }), '\u206895%\u2069 used') // value and % travel as one run
})

test('cron / worker status helpers', () => {
  assert.equal(isOff({ enabled: false }), true); assert.equal(isOff({ state: 'paused' }), true); assert.equal(isOff({ enabled: true, state: 'scheduled' }), false)
  assert.deepEqual(['error', 'delivery_failed', 'FAILED', 'ok', '', undefined, null].map(isFailed), [true, true, true, false, false, false, false])
})

test('shortcut recording is symmetric: Cmd on Mac, Ctrl elsewhere, the other one refused', () => {
  const k = (key, o = {}) => ({ key, code: 'KeyK', ...o })
  assert.equal(comboFromEvent(k('k', { metaKey: true }), false), null, 'Windows/Linux: Meta alone is not the modifier')
  assert.equal(comboFromEvent(k('k', { ctrlKey: true, metaKey: true }), false), null)
  assert.equal(comboFromEvent(k('k', { ctrlKey: true }), false), 'mod+k')
  assert.equal(comboFromEvent(k('k', { ctrlKey: true, shiftKey: true }), false), 'mod+shift+k')
  assert.equal(comboFromEvent(k('k', { metaKey: true }), true), 'mod+k')
  assert.equal(comboFromEvent(k('k', { ctrlKey: true }), true), null)
})

test('usage gather: plain slugs only, two at a time, no-data providers rest for 60 min, order kept', async () => {
  let live = 0, peak = 0; const asked = []
  const fetchOne = async slug => {
    asked.push(slug); live++; peak = Math.max(peak, live)
    await new Promise(r => setTimeout(r, slug === 'a' ? 15 : 2)); live--
    if (slug === 'boom') throw new Error('timeout')
    return slug === 'none' ? null : { slug }
  }
  const skipped = new Map(), now = 1e6
  const slugs = ['a', 'b', '--version', 'x;rm', '../etc', 'Up', 'none', 'boom', 'c', 'd.e-f_g', '']
  const rows = await gatherUsage(slugs, fetchOne, { skipped, now })
  assert.deepEqual(rows.map(r => r.slug), ['a', 'b', 'c', 'd.e-f_g'], 'argv-unsafe slugs never reach the CLI; results keep the provider order')
  assert.deepEqual(asked.sort(), ['a', 'b', 'boom', 'c', 'd.e-f_g', 'none'])
  assert.ok(peak <= 2, `peak ${peak}`)
  assert.deepEqual([...skipped.keys()], ['none'], 'only "no data" is remembered, not a throw')
  asked.length = 0
  await gatherUsage(['none', 'a'], fetchOne, { skipped, now: now + 59 * 60e3 }); assert.deepEqual(asked, ['a'], 'still resting after 59 min')
  asked.length = 0
  await gatherUsage(['none'], fetchOne, { skipped, now: now + 61 * 60e3 }); assert.deepEqual(asked, ['none'], 'asked again after 60 min')
})

test('durations stay readable in Arabic (short, not narrow)', () => {
  assert.doesNotMatch(shortDuration('ar-u-nu-latn', 3 * 86400), /\s?ي$/)
  assert.match(shortDuration('ar-u-nu-latn', 3 * 86400), /^3 /)
  assert.match(shortDuration('en', 300), /^5 min/)
})

test('usage windows: session, weekly, then named ones in original order', () => {
  const L = ws => sortWindows(ws.map(label => ({ label }))).map(w => w.label)
  assert.deepEqual(L(['Current week', 'Fable week', 'Current session']), ['Current session', 'Current week', 'Fable week']) // provider A, as shown
  assert.deepEqual(L(['Current session', 'Current week', 'Fable week']), ['Current session', 'Current week', 'Fable week']) // provider A, real CLI order
  assert.deepEqual(L(['Weekly', 'Session']), ['Session', 'Weekly']) // provider B
  assert.deepEqual(L(['API key quota']), ['API key quota'])
  assert.deepEqual(L(['Fable week', 'Opus week', 'Weekly', 'Session']), ['Session', 'Weekly', 'Fable week', 'Opus week'])
  assert.deepEqual(sortWindows([{}, { label: 'Session' }]).map(w => w.label), ['Session', undefined])
})

test('cron schedules read as text (real jobs), en + ar; display text wins; unknown stays raw', () => {
  const tr = l => (k, v) => { const m = FLAT[l.slice(0, 2)][k]; return fill(typeof m === 'function' ? m(v) : m, v).replace(/[\u2068\u2069]/g, '') }
  const sch = (schedule, l = 'en') => scheduleText({ schedule }, l === 'ar' ? 'ar-u-nu-latn' : l, tr(l))
  const cases = [
    ['0 4 * * *', 'Every day at 4:00 AM', 'كل يوم الساعة 4:00 ص'],
    ['0 16 * * 6', 'Saturdays at 4:00 PM', 'كل سبت الساعة 4:00 م'],
    ['0 10 1 * *', 'Monthly on day 1 at 10:00 AM', 'كل شهر في اليوم 1 الساعة 10:00 ص'],
    ['0 10 * * 5', 'Fridays at 10:00 AM', 'كل جمعة الساعة 10:00 ص'],
    ['0 5 * * 0', 'Sundays at 5:00 AM', 'كل أحد الساعة 5:00 ص'],
    ['45 15 * * 6', 'Saturdays at 3:45 PM', 'كل سبت الساعة 3:45 م'],
    ['*/15 * * * *', 'Every 15 minutes', 'كل 15 دقيقة'],
    ['*/1 * * * *', 'Every minute', 'كل دقيقة'],
    ['15 * * * *', 'Every hour at :15', 'كل ساعة عند الدقيقة 15'],
    ['30 9 * * 1-5', 'Weekdays at 9:30 AM', 'من الاثنين إلى الجمعة الساعة 9:30 ص'],
    ['0 9 * * 5,6', 'Fridays and Saturdays at 9:00 AM', 'كل جمعة وسبت الساعة 9:00 ص'],
    ['0 9 * * 7', 'Sundays at 9:00 AM', 'كل أحد الساعة 9:00 ص'],
  ]
  for (const [e, en, ar] of cases) { assert.equal(sch(e), en, e); assert.equal(sch(e, 'ar'), ar, e) }
  for (const raw of ['0 0 1 1 *', '0 9 * * 1-3', '61 4 * * *', '0 4 * *', '0 */2 * * *']) assert.equal(sch(raw), raw, 'fallback ' + raw)
  assert.equal(sch('every 15m'), 'Every 15 minutes') // interval jobs: Hermes' own "every 15m", translated like */15
  const j = { schedule_display: 'Every day at 4 AM', schedule: { expr: '0 4 * * *' } }
  assert.equal(scheduleText(j, 'en', tr('en')), 'Every day at 4 AM'); assert.equal(scheduleRaw(j), '0 4 * * *')
  assert.equal(scheduleText({ schedule_display: '0 4 * * *', schedule: { expr: '0 4 * * *', display: '0 4 * * *' } }, 'en', tr('en')), 'Every day at 4:00 AM')
  assert.equal(sch('every 1m'), 'Every minute'); assert.equal(sch('every 15m', 'ar'), 'كل 15 دقيقة'); assert.equal(sch('every 2h'), 'every 2h') // only minute intervals are translated
  assert.equal(scheduleText({}, 'en', tr('en')), ''); assert.equal(scheduleText(null, 'en', tr('en')), '')
})

test('day words (whenText) in ar; delivery states get their own chip', () => {
  const now = new Date(2026, 10, 7, 12, 0), at = d => new Date(2026, 10, d, 4, 0).getTime()
  assert.deepEqual([6, 7, 8].map(d => whenText('ar-u-nu-latn', at(d), now).split('،')[0]), ['أمس', 'اليوم', 'غدًا'])
  assert.equal(isDelivery('delivery_queued'), true); assert.equal(isDelivery('ok'), false); assert.equal(isDelivery(null), false)
})

test('refresh feedback: busy is held for the minimum time, failures are detected', async () => {
  const { holdFor, anyFailed } = await import('../src/state/format.js')
  const log = []
  const v = await holdFor(Promise.resolve('x'), 400, ms => { log.push(ms); return Promise.resolve() })
  assert.equal(v, 'x'); assert.deepEqual(log, [400])
  let done = false
  const p = holdFor(Promise.resolve(1), 10, () => new Promise(r => setTimeout(r, 30))).then(() => { done = true })
  await new Promise(r => setTimeout(r, 10)); assert.equal(done, false) // a fast refresh still waits for the floor
  await p
  assert.equal(anyFailed([{ status: 'success' }, { status: 'error' }]), true)
  assert.equal(anyFailed([{ status: 'success' }, { status: 'pending' }]), false)
})

test('modelText: full id with the Hermes provider name; default is empty', () => {
  const provs = [{ slug: 'example-sub', name: 'Example Provider' }]
  assert.equal(modelText({ provider: 'example-sub', model: 'claude-sonnet-5-5[1m]' }, provs), 'Sonnet 5.5 · 1M · Example Provider')
  assert.equal(modelText({ provider: 'x', model: 'm' }, undefined), 'M · x')
  assert.equal(modelText({ model: 'm' }, provs), 'M')
  assert.equal(modelText(null, provs), '')
})

test('modelParts: real ids render the way Hermes does (name + grey tag)', () => {
  const cases = [
    ['claude-opus-5-5[1m]', 'Opus 5.5', '1M'], ['claude-sonnet-5-5[1m]', 'Sonnet 5.5', '1M'], ['claude-sonnet-5-5', 'Sonnet 5.5', ''],
    ['gpt-6-astra-900k', 'GPT-6-astra-900k', ''], ['deepseek/deepseek-v4.1-flash-1017', 'DeepSeek V4.1 Flash 1017', ''],
    ['anthropic/claude-haiku-4-5-20251101', 'Haiku 4.5', ''], ['deepseek-v4.1-flash', 'DeepSeek V4.1', 'Flash'], ['some-unknown_model', 'Some Unknown_model', '']
  ]
  for (const [id, name, tag] of cases) assert.deepEqual(modelParts(id), { name, tag }, id)
  assert.equal(modelLabel('claude-opus-5-5[1m]'), 'Opus 5.5 · 1M')
  assert.equal(modelLabel(''), '')
})

test('editChanged: false until something differs from when Edit began, false again after undo', () => {
  const s = createStore()
  assert.equal(s.editChanged(), false) // not editing
  s.beginEdit()
  assert.equal(s.editChanged(), false)
  s.removeCard('cron')
  assert.equal(s.editChanged(), true)
  s.undo()
  assert.equal(s.editChanged(), false)
})

test('whenText: day words, weekday within a week, date beyond; platformName; bytesText', async () => {
  const { whenText, platformName, bytesText } = await import('../src/state/format.js')
  const now = new Date(2026, 10, 7, 12, 0), at = (d, h = 15) => new Date(2026, 10, d, h, 40).getTime()
  assert.match(whenText('en', at(7), now), /^Today, 3:40/)
  assert.match(whenText('en', at(8), now), /^Tomorrow, 3:40/)
  assert.match(whenText('en', at(8), now, true), /^tomorrow, /)
  assert.match(whenText('en', at(6), now), /^Yesterday, /)
  assert.match(whenText('en', at(10), now), /^Tuesday, 3:40/)
  assert.match(whenText('en', at(20), now), /^Nov 20, 3:40/)
  assert.match(whenText('ar', at(8), now), /^غدا|^غدًا/)
  assert.equal(platformName('telegram'), 'Telegram'); assert.equal(platformName('api_server'), 'API Server')
  assert.equal(platformName('push'), 'Push'); assert.equal(platformName('x', { name: 'Custom' }), 'Custom'); assert.equal(platformName('my_new-bot'), 'My New Bot')
  assert.equal(bytesText('en', 494332366848, 1000), '494 GB'); assert.equal(bytesText('en', 99399163904, 1000), '99 GB'); assert.equal(bytesText('en', 16 * 2 ** 30), '16 GB'); assert.equal(bytesText('en', 8.4 * 2 ** 30), '8.4 GB'); assert.equal(bytesText('en', 460 * 2 ** 30), '460 GB')
})

test('a saved layout with the removed prefs.icons loads without it and keeps the other prefs', () => {
  const r = validate({ ...defaults(), prefs: { ...defaults().prefs, icons: 'brand', name: 'Alex' } })
  assert.equal(r.ok, true); assert.equal('icons' in r.doc.prefs, false); assert.equal(r.doc.prefs.name, 'Alex')
})

const JR = /^job-result~[a-z0-9]{6}$/

test('job-result: baseId, instance id validation, bare type resolves', () => {
  assert.equal(baseId('job-result~abc123'), 'job-result'); assert.equal(baseId('cron'), 'cron'); assert.equal(baseId(5), 5)
  assert.equal(getCard('job-result').multi, true)
  assert.equal(getCard('job-result~abc123').id, 'job-result')
  for (const bad of ['job-result~', 'job-result~ABC123', 'job-result~abc12', 'job-result~abc1234', 'job-result~abc12!', 'job-result~abc~12', 'cron~abc123', 'nope~abc123', '~abc123']) assert.equal(getCard(bad), undefined, bad)
  assert.equal(getCard('cron').multi, false)
})

test('job-result: job option sanitized', () => {
  const id = 'job-result~abc123'
  assert.deepEqual(sanitizeOptions(id, { job: 'a1b2_c-3' }), { job: 'a1b2_c-3' })
  for (const j of ['', 'a b', 'a/b', '../x', 'x'.repeat(65), 5, null, ['a']]) assert.deepEqual(sanitizeOptions(id, { job: j }), {}, String(j))
  assert.deepEqual(sanitizeOptions('cron', { job: 'abc' }), {}) // other cards have no job
})

test('job-result: addCard always makes a new instance, cap 12 per view, options sanitized', () => {
  const s = createStore()
  const a = s.addCard('job-result', undefined, { job: 'j1', evil: 1 }), b = s.addCard('job-result', 'm')
  assert.match(a, JR); assert.match(b, JR); assert.notEqual(a, b)
  const cards = s.activeView().cards
  assert.deepEqual(cards.find(c => c.id === a), { id: a, size: 'l', options: { job: 'j1' } })
  assert.equal(cards.find(c => c.id === b).size, 'm')
  assert.equal(s.addCard('job-result~zzzzzz'), true, 'an explicit valid instance id is added once')
  assert.equal(s.addCard('job-result~zzzzzz'), false)
  for (let i = 0; i < 9; i++) assert.match(s.addCard('job-result'), JR)
  assert.equal(s.activeView().cards.filter(c => baseId(c.id) === 'job-result').length, 12)
  assert.equal(s.addCard('job-result'), false, 'cap')
  assert.equal(s.toggleCard('job-result'), false, 'cap through toggle')
  s.addView('Other'); assert.match(s.addCard('job-result'), JR, 'the cap is per view')
  assert.equal(s.addCard('cron'), true); assert.equal(s.addCard('cron'), false) // normal cards unchanged
  assert.deepEqual(s.activeView().cards.at(-1).options, {}); assert.equal(s.addCard('services', 'l', { title: ' T ' }), true); assert.equal(s.activeView().cards.at(-1).options.title, 'T')
  const all = s.get().views.flatMap(v => v.cards.map(c => c.id)).filter(i => JR.test(i)); assert.equal(new Set(all).size, all.length, 'ids unique across views')
})

test('job-result: toggle semantics', () => {
  const s = createStore(); s.beginEdit()
  const id = s.toggleCard('job-result'); assert.equal(id, true)
  const inst = s.activeView().cards.find(c => JR.test(c.id)).id
  assert.equal(s.toggleCard('job-result'), true, 'the type always adds'); assert.equal(s.activeView().cards.filter(c => JR.test(c.id)).length, 2)
  assert.equal(s.toggleCard(inst), false, 'an instance removes'); assert.ok(!ids(s).includes(inst))
  assert.equal(s.toggleCard('job-result~nope'), null)
  s.undo(); assert.ok(ids(s).includes(inst), 'one undo step')
})

test('job-result: instance ids work with every card method', () => {
  const s = createStore(); const id = s.addCard('job-result', 'l', { job: 'j1' }); const v2 = s.addView('V2'); s.setActiveView('v-today')
  assert.equal(s.setSize(id, 'xl'), true); assert.equal(s.setSize(id, 's'), false)
  assert.equal(s.setOptions(id, { job: 'j2', title: 'Mine', bogus: 1 }), true)
  assert.deepEqual(s.activeView().cards.find(c => c.id === id).options, { job: 'j2', title: 'Mine' })
  assert.equal(s.setOptions(id, { job: '' }), true); assert.deepEqual(s.activeView().cards.find(c => c.id === id).options, { title: 'Mine' })
  assert.equal(s.moveCard(id, 0), true); assert.equal(ids(s)[0], id)
  assert.equal(s.resetCard(id), true); assert.deepEqual(s.activeView().cards[0], { id, size: 'l', options: {} })
  assert.equal(s.moveCardToView(id, v2), true); assert.ok(!ids(s).includes(id))
  s.setActiveView(v2); assert.equal(s.removeCard(id), true)
})

test('job-result: two instances survive export/import and sync clean; templates keep them', () => {
  const s = createStore(); const a = s.addCard('job-result', 'l', { job: 'j1' }), b = s.addCard('job-result', 'xl', { job: 'j2' })
  const want = s.get().views[0].cards.filter(c => baseId(c.id) === 'job-result')
  assert.equal(want.length, 2)
  const t = createStore(); const r = t.importJSON(s.exportJSON()); assert.equal(r.ok, true); assert.deepEqual(r.ignored, [])
  assert.deepEqual(t.get().views[0].cards.filter(c => baseId(c.id) === 'job-result'), want)
  const u = createStore(); assert.equal(u.replace(JSON.parse(s.exportJSON())).ok, true) // the sync path
  assert.deepEqual(u.get().views[0].cards.filter(c => c.id === a || c.id === b), want)
  s.saveTemplate('T'); const tpl = s.get().templates[0]; assert.deepEqual(tpl.cards.filter(c => baseId(c.id) === 'job-result'), want)
  assert.equal(validate(s.get()).doc.templates[0].cards.filter(c => baseId(c.id) === 'job-result').length, 2)
  // Applying the template elsewhere gives new instance ids (jobs kept), so no id repeats across views.
  const jr = () => s.get().views.flatMap(v => v.cards.map(c => c.id)).filter(id => baseId(id) === 'job-result')
  const v2 = s.addView('Two', tpl.id), ids = jr()
  assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(s.get().views.find(v => v.id === v2).cards.filter(c => baseId(c.id) === 'job-result').map(c => c.options.job), ['j1', 'j2'])
  s.applyTemplate(tpl.id); const again = jr(); assert.equal(new Set(again).size, again.length)
})

test('job-result: malformed ~ ids, the bare type and duplicates are dropped on load', () => {
  const doc = defaults(), good = 'job-result~abc123'
  doc.views = [{ id: 'v1', name: 'V', cards: ['job-result', 'job-result~', 'job-result~ABCDEF', 'job-result~abc~12', 'cron~abc123', good, good, 'cron'].map(id => ({ id, size: 'l', options: id === good ? { job: 'j1', x: 1 } : {} })) }]
  doc.activeView = 'v1'
  const r = parseImport(JSON.stringify(doc))
  assert.equal(r.ok, true)
  assert.deepEqual(r.doc.views[0].cards, [{ id: good, size: 'l', options: { job: 'j1' } }, { id: 'cron', size: 'l', options: {} }])
  assert.equal(r.ignored.filter(x => x.kind === 'unknownCard').length, 5)
  // more than 12 instances in one view: extras dropped
  doc.views[0].cards = Array.from({ length: 15 }, (_, i) => ({ id: `job-result~aaaa${String(i).padStart(2, '0')}`, size: 'l' }))
  assert.equal(parseImport(JSON.stringify(doc)).doc.views[0].cards.length, 12)
})

test('prefs: jobOfferDismissed is a boolean, default false', () => {
  const s = createStore()
  assert.equal(s.get().prefs.jobOfferDismissed, false)
  assert.equal(s.setPref('jobOfferDismissed', 'yes'), false); assert.equal(s.setPref('jobOfferDismissed', 1), false)
  assert.equal(s.setPref('jobOfferDismissed', true), true); assert.equal(s.get().prefs.jobOfferDismissed, true)
  assert.equal(validate({ ...defaults(), prefs: { jobOfferDismissed: 'x' } }).doc.prefs.jobOfferDismissed, false)
  assert.equal(validate({ ...defaults(), prefs: { jobOfferDismissed: true } }).doc.prefs.jobOfferDismissed, true)
})

test('withExtra appends typed text after the draft', () => {
  assert.equal(withExtra('/skill ', ''), '/skill ')
  assert.equal(withExtra('/skill ', '  \n '), '/skill ')
  assert.equal(withExtra(undefined, '   '), undefined)
  assert.equal(withExtra('/skill ', 'hi'), '/skill hi')
  assert.equal(withExtra('/skill p', ' hi '), '/skill p hi')
  assert.equal(withExtra('', 'hi'), 'hi')
  assert.equal(withExtra('/skill p', 'a\nb'), '/skill p a\nb')
})

const doc = (o = {}) => ({ schema: 1, views: [{ id: 'a', name: 'A', cards: [] }], ...o })

test('moveCardToView respects the per-view instance cap', () => {
  const s = createStore(); s.addView('B'); const b = s.get().activeView
  for (let i = 0; i < 12; i++) assert.ok(s.addCard('job-result'))
  s.setActiveView('v-today')
  const extra = s.addCard('job-result')
  assert.equal(s.moveCardToView(extra, b), false)
  assert.ok(ids(s).includes(extra), 'card stays where it was')
  const r = validate(JSON.parse(s.exportJSON()))
  assert.deepEqual(r.ignored, []); assert.equal(r.doc.views.find(v => v.id === b).cards.length, 12)
  s.setActiveView(b); s.removeCard(s.activeView().cards[0].id); s.setActiveView('v-today')
  assert.equal(s.moveCardToView(extra, b), true, 'one slot free')
})

test('limits at the trust boundary', () => {
  assert.deepEqual(parseImport('x'.repeat(4 * LIM.bytes + 1)), { ok: false, error: 'tooLarge', ignored: [] }) // text cap: 4 x, an export is indented
  assert.equal(parseImport('€'.repeat(360000)).error, 'tooLarge') // 1.08 MB, 360000 chars
  const views = n => Array.from({ length: n }, (_, i) => ({ id: `v${i}`, name: 'x', cards: [] }))
  assert.equal(validate({ schema: 1, views: views(25) }).error, 'tooManyViews')
  assert.equal(validate({ schema: 1, views: views(24) }).ok, true)
  const s = createStore(); for (let i = 0; i < 22; i++) assert.ok(s.addView('v'))
  assert.equal(s.get().views.length, 24); assert.equal(s.addView('one more'), null); assert.equal(s.get().views.length, 24)
  const t = createStore(); for (let i = 0; i < 48; i++) assert.ok(t.saveTemplate('t'))
  assert.equal(t.saveTemplate('t'), null); assert.equal(t.get().templates.length, 48)
  assert.equal(validate(doc({ templates: Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, name: 'n', cards: [] })) })).doc.templates.length, 48)
  const many = Array.from({ length: 300 }, (_, i) => `job${i}`)
  t.setPinnedCron(many); assert.equal(t.get().pinnedCron.length, 200)
  assert.equal(validate(doc({ pinnedCron: many })).doc.pinnedCron.length, 200)
  assert.deepEqual(validate(doc({ pinnedCron: ['a', 'a', 'b'] })).doc.pinnedCron, ['a', 'b'])
  const bad = validate(doc({ views: [{ id: 'a', cards: Array.from({ length: 80 }, (_, i) => ({ id: `nope${i}` })) }] }))
  assert.equal(bad.ignored.length, 50)
  const long = 'y'.repeat(41)
  assert.equal(validate(doc({ views: [{ id: 'a', name: long, cards: [] }] })).doc.views[0].name.length, 40)
  assert.equal(validate(doc({ templates: [{ id: 't', name: long, cards: [] }] })).doc.templates[0].name.length, 40)
  assert.equal(sanitizeOptions('approvals', { title: long }).title.length, 40)
  assert.equal(sanitizeOptions('usage', { providers: Array.from({ length: 60 }, (_, i) => `p${i}`) }).providers.length, 50)
  const dup = validate(doc({ views: [{ id: 'a', cards: [] }, { id: 'a', cards: [] }] })).doc.views.map(v => v.id)
  assert.equal(new Set(dup).size, 2); assert.equal(dup[0], 'a')
  const tp = validate(doc({ templates: [{ id: 'tpl-ops', name: 'x', cards: [] }, { id: 't1', name: 'a', cards: [] }, { id: 't1', name: 'b', cards: [] }, { id: 't2', builtIn: true, name: 'c', cards: [] }] })).doc.templates
  assert.deepEqual(tp.map(x => [x.id, x.name]), [['t1', 'a']])
  assert.deepEqual(validate(doc({ views: [{ id: 'a', cards: [{ id: 'approvals', options: ['x'] }] }] })).doc.views[0].cards[0].options, {})
})

test('import output stays under the backend limit', () => {
  const text = JSON.stringify(doc({ shortcuts: Array.from({ length: 5000 }, () => ({ skill: 'a' })) }))
  assert.ok(text.length < LIM.bytes)
  assert.deepEqual(parseImport(text), { ok: false, error: 'tooLarge', ignored: [] })
  assert.equal(parseImport(JSON.stringify(doc({ shortcuts: [{ skill: 'a' }] }))).ok, true)
})

test('a user export of a big doc re-imports', () => {
  const s = createStore(doc({ shortcuts: Array.from({ length: 1700 }, () => ({ skill: 'a' })) }))
  const compact = JSON.stringify(s.get()).length, out = s.exportJSON()
  assert.ok(compact > 150000 && compact < LIM.bytes && out.length > LIM.bytes, `${compact} ${out.length}`) // the export is over the old input cap
  assert.equal(createStore().importJSON(out).ok, true)
})

test('exportJSON during an edit session is the pre-edit doc', () => {
  const s = createStore(), before = s.exportJSON()
  s.beginEdit(); s.removeCard(s.activeView().cards[0].id); s.addView('Extra')
  assert.notEqual(JSON.stringify(s.get().views), JSON.stringify(JSON.parse(before).views))
  assert.equal(s.exportJSON(), before)
})

test('str cuts by code points: no U+FFFD at the cut', () => {
  const v = validate(doc({ views: [{ id: 'a', name: 'a' + '😀'.repeat(30), cards: [] }] })).doc.views[0].name
  assert.ok(v.isWellFormed() && !v.includes('\uFFFD'))
  assert.equal(Array.from(v).length, 31)
  assert.ok(validate(doc({ views: [{ id: 'a', name: 'x\ud800y', cards: [] }] })).doc.views[0].name.isWellFormed(), 'lone surrogate in the input')
})

test('names are cut on a character boundary (no lone surrogate)', () => {
  const name = 'a' + '😀'.repeat(40) // 81 UTF-16 units: a plain slice(0, 40) splits the last emoji
  const v = validate(doc({ views: [{ id: 'a', name, cards: [] }] })).doc.views[0].name
  assert.ok(v.isWellFormed(), 'well-formed')
  assert.equal(Array.from(v).length, 40)
  const s = createStore(); assert.ok(createStore().get() && s.renameView('v-today', name)); assert.ok(s.get().views[0].name.isWellFormed())
})

test('startView never dangles after Cancel', () => {
  const s = createStore(); s.beginEdit(); const v = s.addView('X')
  assert.equal(s.setPref('startView', v), true)
  assert.equal(s.persistable().prefs.startView, 'last', 'the saved copy has no such view')
  s.cancelEdit()
  assert.equal(s.get().prefs.startView, 'last')
  s.setPref('startView', 'v-ops'); s.beginEdit(); s.deleteView('v-ops')
  assert.equal(s.persistable().prefs.startView, 'v-ops', 'nothing about startView is saved mid-edit')
  s.cancelEdit()
  assert.equal(s.get().prefs.startView, 'v-ops'); assert.ok(s.get().views.some(x => x.id === 'v-ops')) // Cancel brings both back
  s.beginEdit(); s.deleteView('v-ops'); s.undo(); assert.equal(s.get().prefs.startView, 'v-ops')
  s.deleteView('v-ops'); s.commitEdit()
  assert.equal(s.get().prefs.startView, 'last') // Done: the view is gone, so is the setting
  const t = createStore(); t.setPref('startView', 'v-ops'); t.deleteView('v-ops')
  assert.equal(t.get().prefs.startView, 'last') // outside Edit it falls back at once
})

test('editChanged: switching the tab in Edit is not a change; a layout change is', () => {
  const s = createStore(); s.beginEdit()
  s.setActiveView(s.get().views[1].id); assert.equal(s.editChanged(), false)
  s.removeCard(s.activeView().cards[0].id); assert.equal(s.editChanged(), true)
  const t = createStore(); t.beginEdit(); t.addView('X'); assert.equal(t.editChanged(), true)
})

test('import: pinnedCron keeps real job ids only; a lone surrogate or odd string is dropped', () => {
  const base = JSON.parse(createStore().exportJSON())
  const r = parseImport(JSON.stringify({ ...base, pinnedCron: ['bda67b8db11d', 'ok-1.x', '\ud800', 'a b', '', 'x'.repeat(65)] }))
  assert.deepEqual(r.doc.pinnedCron, ['bda67b8db11d', 'ok-1.x'])
  const t = createStore(); t.setPinnedCron(['j1', '\ud800']); assert.deepEqual(t.get().pinnedCron, ['j1'])
})

test('cliJson survives brace noise on either side; garbage is null, never a throw', () => {
  const want = { windows: [] }
  assert.deepEqual(cliJson('warn {x} deprecated\n{"windows":[]}'), want)
  assert.deepEqual(cliJson('{"windows":[]}\nerror: {foo}'), want)
  assert.deepEqual(cliJson('warn {x}\n{"windows":[]}\nerror: {foo}'), want)
  assert.deepEqual(cliJson('{"a":{"b":1}}'), { a: { b: 1 } })
  assert.deepEqual(cliJson('warn: opts={} ignored\n{\"windows\":[]}'), want) // the longest slice, not the first that parses
  assert.deepEqual(cliJson('cfg {\"a\":1}\n{\"windows\":[]}'), want)
  assert.deepEqual(cliJson('{\n'.repeat(25) + '{\"windows\":[]}'), want)
  assert.deepEqual(cliJson('{\"windows\":[]}\n' + '}\n'.repeat(25)), want)
  for (const bad of ['{not json}', '{"a":', '{"a":{"b":1}', '} {', 'x { y } z', '{'.repeat(500) + '}'.repeat(3)]) assert.equal(cliJson(bad), null, bad)
})

test('approvals: a payload cannot override kind or session', async () => {
  const r = await gatherApprovals([{ id: 'real' }], async () => ({ approvals: [{ request_id: 'r', session: 'x', kind: 'evil' }] }))
  assert.deepEqual([r[0].kind, r[0].session], ['command', { id: 'real' }])
})

test('scheduleText: */N is "every N minutes" only when N divides 60', () => {
  const tr = (k, v) => { const m = FLAT.en[k]; return fill(typeof m === 'function' ? m(v) : m, v).replace(/[\u2068\u2069]/g, '') }
  const sch = schedule => scheduleText({ schedule }, 'en', tr)
  assert.equal(sch('*/15 * * * *'), 'Every 15 minutes')
  assert.equal(sch('*/20 * * * *'), 'Every 20 minutes'); assert.equal(sch('*/12 * * * *'), 'Every 12 minutes')
  for (const raw of ['*/45 * * * *', '*/7 * * * *', '*/25 * * * *', '*/90 * * * *', '*/60 * * * *']) assert.equal(sch(raw), raw, raw)
})
