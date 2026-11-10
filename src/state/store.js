// Layout + prefs + shortcuts state core. Pure: no DOM, no SDK, no storage. The caller persists
// `persistable()` on every change and feeds remote docs through `replace()`.
import { ALIASES, atCap, baseId, getCard, MAX_INSTANCES, RANGES, sanitizeOptions } from './cards.js'
import { cleanCombo } from './format.js'

export const SCHEMA = 1
// Sanity bounds at the trust boundary (import/sync). Shortcuts have none on purpose.
export const LIM = { views: 24, bytes: 262144, templates: 48, pinned: 200, history: 100, ignored: 50 }
export const REFRESH = ['15s', '30s', '1m', '5m', 'manual']
export const NAV_ICONS = ['dashboard', 'home', 'calendar', 'pulse', 'layout', 'star-empty', 'rocket', 'zap', 'checklist', 'graph']
const ID_RE = /^[\w.-]{1,64}$/
const clone = o => JSON.parse(JSON.stringify(o))
// cut by code points (a UTF-16 cut through a pair leaves U+FFFD); toWellFormed fixes a lone surrogate in the input, which the backend cannot encode as UTF-8
const str = (v, n) => { if (typeof v !== 'string') return ''; const s = Array.from(v.trim()).slice(0, n).join(''); return s.toWellFormed ? s.toWellFormed() : s }
const byteLen = s => new TextEncoder().encode(s).length
let seq = 0
export const uid = p => `${p}-${Math.random().toString(36).slice(2, 7)}${(seq++).toString(36)}`
const mk = (...a) => a.map(x => { const [id, size] = x.split(':'); return { id, size, options: {} } })

// No holes at 12 columns: each row sums to 12 (s=3, m=4, l=6, xl=12).
export const BUILTIN_TEMPLATES = [
  { id: 'tpl-overview', builtIn: true, cards: mk('approvals:l', 'recent-sessions:l', 'cron:xl', 'usage:l', 'recent-files:l') },
  { id: 'tpl-ops', builtIn: true, cards: mk('services:l', 'machine:l', 'workers:xl') },
  { id: 'tpl-minimal', builtIn: true, cards: mk('approvals:l', 'recent-sessions:l') }
]
const BUILTIN_IDS = new Set(BUILTIN_TEMPLATES.map(t => t.id))
const moveIn = (arr, i, to) => { const [x] = arr.splice(i, 1); arr.splice(Math.max(0, Math.min(arr.length, to)), 0, x) }

// Default views carry a nameKey (translated at render) and an empty name until the user renames them,
// so a user view literally named "Ops" is never translated.
export function defaults() {
  return {
    schema: SCHEMA,
    prefs: { name: '', refresh: '1m', range: 'today', navLabel: '', navIcon: 'dashboard', defaultModel: null, startView: 'last', hideGreeting: false, openKey: '', notifyApprovals: false, hideInternal: true, hintDismissed: false, jobOfferDismissed: false },
    shortcuts: [],
    shortcutsSeeded: false,
    pinnedCron: [],
    views: [
      { id: 'v-today', name: '', nameKey: 'view.today', cards: clone(BUILTIN_TEMPLATES[0].cards) },
      { id: 'v-ops', name: '', nameKey: 'view.ops', cards: clone(BUILTIN_TEMPLATES[1].cards) }
    ],
    activeView: 'v-today',
    templates: []
  }
}

// Default Quick launch: bundled + enabled skills, most used first. Labels are the skill names.
export function defaultShortcuts(skills, max = 4) {
  return (Array.isArray(skills) ? skills : [])
    .filter(s => s && s.provenance === 'bundled' && s.enabled !== false && typeof s.name === 'string')
    .sort((a, b) => (b.usage || 0) - (a.usage || 0) || a.name.localeCompare(b.name))
    .slice(0, max)
    .map(s => ({ id: uid('sc'), label: '', skill: s.name, provider: null, model: null, prompt: '', target: 'new', key: '' }))
}

class Bad extends Error {}
const bad = m => { throw new Bad(m) }

const cleanModel = v => (v && typeof v === 'object' && str(v.model, 200) ? { provider: str(v.provider, 100) || null, model: str(v.model, 200) } : null)
const PREF = { // each returns the cleaned value, or undefined when invalid
  name: v => (typeof v === 'string' ? str(v, 60) : undefined),
  refresh: v => (REFRESH.includes(v) ? v : undefined),
  range: v => (RANGES.includes(v) ? v : undefined),
  navLabel: v => (typeof v === 'string' ? str(v, 40) : undefined),
  navIcon: v => (NAV_ICONS.includes(v) ? v : undefined),
  defaultModel: v => (v === null ? null : cleanModel(v) || undefined),
  startView: v => (v === 'last' || (typeof v === 'string' && ID_RE.test(v)) ? v : undefined), // an id is checked against the views by the caller
  hideGreeting: v => (typeof v === 'boolean' ? v : undefined),
  openKey: v => (v === '' ? '' : cleanCombo(v) || undefined),
  notifyApprovals: v => (typeof v === 'boolean' ? v : undefined),
  hideInternal: v => (typeof v === 'boolean' ? v : undefined),
  hintDismissed: v => (typeof v === 'boolean' ? v : undefined),
  jobOfferDismissed: v => (typeof v === 'boolean' ? v : undefined)
}

export function cleanShortcut(x, id) {
  if (!x || typeof x !== 'object') return null
  const skill = str(x.skill, 80).replace(/^\//, ''), prompt = str(x.prompt, 2000)
  if (/\s/.test(skill) || (!skill && !prompt)) return null // a skill (one token) or free text, at least one
  const m = cleanModel(x)
  return { id, label: str(x.label, 40), skill, provider: m ? m.provider : null, model: m ? m.model : null, prompt, target: x.target === 'current' ? 'current' : 'new', key: cleanCombo(x.key) }
}

function cleanCards(list, where, ign) {
  const out = [], seen = new Set(), count = new Map(), arr = Array.isArray(list) ? list : []
  const present = new Set(arr.map(c => c && c.id))
  for (const c of arr) {
    const al = c && ALIASES.get(c.id), id = al ? al.to : c && c.id, def = getCard(id)
    if (!def || (def.multi && id === def.id)) { if (ign.length < LIM.ignored) ign.push({ kind: 'unknownCard', id: String(c && c.id).slice(0, 40), where }); continue }
    if (seen.has(id) || (al && present.has(al.to))) continue // a real card wins over its old id; an alias never counts as ignored
    if ((count.get(def.id) || 0) >= (def.multi ? MAX_INSTANCES : 1)) { if (ign.length < LIM.ignored) ign.push({ kind: 'unknownCard', id: String(id).slice(0, 40), where }); continue }
    seen.add(id); count.set(def.id, (count.get(def.id) || 0) + 1)
    const o = c.options && typeof c.options === 'object' && !Array.isArray(c.options) ? c.options : {}
    out.push({ id, size: def.sizes.includes(c.size) ? c.size : def.defaultSize, options: sanitizeOptions(id, al ? { ...o, ...al.opts(o) } : o) })
  }
  return out
}

// TRUST BOUNDARY: o is untrusted (import, backend, storage). Returns {ok, error?, ignored, doc?}; never throws.
// Accepts the earlier export format (version 6) too (same shape, minus schema/nameKey).
export function validate(o) {
  const ign = []
  try {
    if (!o || typeof o !== 'object' || Array.isArray(o)) bad('notObject')
    if (o.schema !== SCHEMA && o.version !== 6) bad('version')
    if (!Array.isArray(o.views) || !o.views.length) bad('noViews')
    if (o.views.length > LIM.views) bad('tooManyViews')
    const vids = new Set()
    const views = o.views.map((v, i) => {
      if (!v || typeof v !== 'object') bad('badView')
      const id = typeof v.id === 'string' && ID_RE.test(v.id) && !vids.has(v.id) ? v.id : uid('v')
      vids.add(id)
      const nameKey = v.nameKey === 'view.today' || v.nameKey === 'view.ops' ? v.nameKey : undefined
      const name = str(v.name, 40)
      return { id, name: name || (nameKey ? '' : `View ${i + 1}`), ...(nameKey ? { nameKey } : {}), cards: cleanCards(v.cards, name || nameKey || id, ign) }
    })
    const tids = new Set(BUILTIN_IDS), templates = []
    for (const t of Array.isArray(o.templates) ? o.templates : []) {
      if (!t || typeof t !== 'object' || t.builtIn || typeof t.id !== 'string' || !ID_RE.test(t.id) || tids.has(t.id) || templates.length >= LIM.templates) continue
      tids.add(t.id)
      templates.push({ id: t.id, name: str(t.name, 40) || 'Template', cards: cleanCards(t.cards, t.name, ign) })
    }
    const shortcuts = [], sids = new Set()
    for (const x of Array.isArray(o.shortcuts) ? o.shortcuts : []) {
      const c = cleanShortcut(x, x && typeof x.id === 'string' && ID_RE.test(x.id) && !sids.has(x.id) ? x.id : uid('sc'))
      if (c) { sids.add(c.id); shortcuts.push(c) } else if (ign.length < LIM.ignored) ign.push({ kind: 'badShortcut' })
    }
    const prefs = defaults().prefs
    if (o.prefs && typeof o.prefs === 'object') for (const k of Object.keys(PREF)) { const v = PREF[k](o.prefs[k]); if (v !== undefined) prefs[k] = v }
    if (prefs.startView !== 'last' && !vids.has(prefs.startView)) prefs.startView = 'last'
    // One key, one owner: the open-dashboard key wins, then the first shortcut that claims a combo.
    const taken = new Set(prefs.openKey ? [prefs.openKey] : [])
    for (const s of shortcuts) { if (s.key && taken.has(s.key)) s.key = ''; else if (s.key) taken.add(s.key) }
    const pinnedCron = Array.isArray(o.pinnedCron) ? [...new Set(o.pinnedCron.filter(x => typeof x === 'string' && ID_RE.test(x)))].slice(0, LIM.pinned) : []
    return {
      ok: true, ignored: ign,
      doc: { schema: SCHEMA, prefs, shortcuts, shortcutsSeeded: o.shortcutsSeeded !== false || shortcuts.length > 0, pinnedCron, views, activeView: vids.has(o.activeView) ? o.activeView : views[0].id, templates }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Bad ? e.message : 'invalid', ignored: ign }
  }
}

export function parseImport(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'empty', ignored: [] }
  // 4x: an indented export of a valid doc is bigger than the doc; the check after validate() is the real limit
  if (byteLen(text) > 4 * LIM.bytes) return { ok: false, error: 'tooLarge', ignored: [] }
  let o
  try { o = JSON.parse(text) } catch { return { ok: false, error: 'notJson', ignored: [] } }
  const r = validate(o)
  // validate expands every shortcut, so the result can outgrow the input; the backend refuses a doc over LIM.bytes
  return r.ok && byteLen(JSON.stringify(r.doc)) > LIM.bytes ? { ok: false, error: 'tooLarge', ignored: [] } : r
}

// Quick launch strip: 1-4 equal buttons, 5-8 chips, more than 8: 7 chips + More.
export const stripMode = n => (n <= 4 ? 'row' : n <= 8 ? 'wrap' : 'more')

export function createStore(initial) {
  const v = initial && validate(initial); let doc = v && v.ok ? v.doc : defaults()
  const subs = new Set()
  let edit = null // { base, undo: [], redo: [] } of {views, activeView} snapshots

  const snap = () => JSON.stringify({ views: doc.views, activeView: doc.activeView })
  // startView is not part of the undo snapshot: undo/redo leave it alone, Done/Cancel drop it when its view is gone
  const startOk = (prefs, views) => (prefs.startView === 'last' || views.some(v => v.id === prefs.startView) ? prefs : { ...prefs, startView: 'last' })
  const restore = s => { const o = JSON.parse(s); doc.views = o.views; doc.activeView = o.views.some(v => v.id === o.activeView) ? o.activeView : o.views[0].id }
  const persistable = () => { if (!edit) return doc; const b = JSON.parse(edit.base); return { ...doc, ...b, prefs: startOk(doc.prefs, b.views) } }
  // Immutable top-level: every change makes a new doc object so React/atoms see it.
  const notify = () => { doc = { ...doc }; subs.forEach(f => f(doc)) }
  const mutate = fn => {
    const before = snap(), r = fn()
    if (snap() === before) return r
    if (edit) { edit.undo.push(before); if (edit.undo.length > LIM.history) edit.undo.shift(); edit.redo.length = 0 }
    notify()
    return r
  }
  const av = () => doc.views.find(v => v.id === doc.activeView)
  const inView = (id, v = av()) => v.cards.findIndex(c => c.id === id)
  // A fresh instance id for a multi card type, unique across every view.
  const newInstance = base => { let id; do id = `${base}~${(Math.random().toString(36) + '000000').slice(2, 8)}`; while (doc.views.some(v => inView(id, v) >= 0)); return id }
  // Template cards get new instance ids, so one template applied to two views never repeats an id.
  const fromTemplate = cards => clone(cards).map(c => (getCard(c.id)?.multi ? { ...c, id: newInstance(baseId(c.id)) } : c))
  const ok = r => (notify(), r)
  // true when `key` is the open-dashboard key or another shortcut's key
  const keyTaken = (key, exceptId) => !!key && (doc.prefs.openKey === key || doc.shortcuts.some(s => s.id !== exceptId && s.key === key))

  return {
    get: () => doc,
    activeView: av,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
    // What to save: during an edit session, the pre-edit layout (Cancel must be able to return to it).
    persistable,
    replace(o) { const r = validate(o); if (!r.ok) return r; edit = null; doc = r.doc; notify(); return r },

    keyTaken,
    setPref(k, v) {
      const n = PREF[k] && PREF[k](v)
      if (n === undefined || (k === 'startView' && n !== 'last' && !doc.views.some(x => x.id === n)) || (k === 'openKey' && keyTaken(n))) return false
      doc.prefs = { ...doc.prefs, [k]: n }
      return ok(true)
    },

    addView(name, templateId = null) {
      const t = templateId ? [...BUILTIN_TEMPLATES, ...doc.templates].find(x => x.id === templateId) : null
      if (doc.views.length >= LIM.views || (templateId && !t)) return null
      const v = { id: uid('v'), name: str(name, 40) || 'View', cards: t ? fromTemplate(t.cards) : [] }
      mutate(() => { doc.views.push(v); doc.activeView = v.id })
      return v.id
    },
    // An empty name restores the default: the translated nameKey for built-in views, else "View N".
    renameView(id, name) { const v = doc.views.find(x => x.id === id); if (!v) return false; const n = str(name, 40) || (v.nameKey ? '' : `View ${doc.views.indexOf(v) + 1}`); mutate(() => { v.name = n }); return true },
    deleteView(id) {
      if (doc.views.length <= 1 || !doc.views.some(v => v.id === id)) return false
      if (!edit && doc.prefs.startView === id) doc.prefs = { ...doc.prefs, startView: 'last' } // in Edit, Done/Cancel decide
      mutate(() => { const i = doc.views.findIndex(v => v.id === id); doc.views.splice(i, 1); if (doc.activeView === id) doc.activeView = doc.views[Math.min(i, doc.views.length - 1)].id })
      return true
    },
    moveView(id, to) { const i = doc.views.findIndex(v => v.id === id); if (i < 0 || !Number.isInteger(to)) return false; mutate(() => moveIn(doc.views, i, to)); return true },
    setActiveView(id) { if (!doc.views.some(v => v.id === id) || doc.activeView === id) return false; doc.activeView = id; return ok(true) },

    // cards on the active view; false when the id/size is invalid
    moveCard(id, to) { const i = inView(id); if (i < 0 || !Number.isInteger(to)) return false; mutate(() => moveIn(av().cards, i, to)); return true },
    moveCardToView(id, viewId) {
      const i = inView(id), target = doc.views.find(v => v.id === viewId)
      if (i < 0 || !target || target === av() || inView(id, target) >= 0 || atCap(target.cards, id)) return false
      mutate(() => { const [c] = av().cards.splice(i, 1); target.cards.push(c) })
      return true
    },
    setSize(id, size) { const i = inView(id); if (i < 0 || !getCard(id).sizes.includes(size)) return false; mutate(() => { av().cards[i].size = size }); return true },
    setOptions(id, patch) { // null/'' removes a key; unknown keys/values are dropped
      const i = inView(id); if (i < 0 || !patch || typeof patch !== 'object') return false
      mutate(() => {
        const c = av().cards[i], merged = { ...c.options }
        for (const k of Object.keys(patch)) if (patch[k] === null || patch[k] === '') delete merged[k]; else merged[k] = patch[k]
        c.options = sanitizeOptions(id, merged)
      })
      return true
    },
    resetCard(id) { const i = inView(id); if (i < 0) return false; mutate(() => { const c = av().cards[i]; c.size = getCard(id).defaultSize; c.options = {} }); return true },
    // Multi card types: the bare id always makes a new instance and returns its id; false at the cap.
    addCard(id, size, options) {
      const def = getCard(id); if (!def || inView(id) >= 0) return false
      if (atCap(av().cards, id)) return false
      const nid = def.multi && id === def.id ? newInstance(id) : id
      mutate(() => { av().cards.push({ id: nid, size: def.sizes.includes(size) ? size : def.defaultSize, options: sanitizeOptions(nid, options) }) })
      return nid === id ? true : nid
    },
    removeCard(id) { const i = inView(id); if (i < 0) return false; mutate(() => { av().cards.splice(i, 1) }); return true },
    // Gallery switch: true = now on the view, false = now off it, null = unknown card. One undo step either way.
    toggleCard(id, size) { const def = getCard(id); if (!def) return null; if (def.multi && id === def.id) return !!this.addCard(id, size); return inView(id) >= 0 ? !this.removeCard(id) : this.addCard(id, size) },

    isEditing: () => !!edit,
    beginEdit() { if (edit) return false; edit = { base: snap(), undo: [], redo: [] }; return ok(true) },
    undo() { if (!edit || !edit.undo.length) return false; edit.redo.push(snap()); restore(edit.undo.pop()); return ok(true) },
    redo() { if (!edit || !edit.redo.length) return false; edit.undo.push(snap()); restore(edit.redo.pop()); return ok(true) },
    editChanged: () => !!edit && JSON.stringify(doc.views) !== JSON.stringify(JSON.parse(edit.base).views), // the layout differs from when Edit was pressed (switching the tab does not count)
    canUndo: () => !!edit && edit.undo.length > 0,
    canRedo: () => !!edit && edit.redo.length > 0,
    commitEdit() { if (!edit) return false; edit = null; doc.prefs = startOk(doc.prefs, doc.views); return ok(true) },
    cancelEdit() { if (!edit) return false; restore(edit.base); edit = null; doc.prefs = startOk(doc.prefs, doc.views); return ok(true) },

    templates: () => [...BUILTIN_TEMPLATES, ...doc.templates],
    applyTemplate(id) { const t = [...BUILTIN_TEMPLATES, ...doc.templates].find(x => x.id === id); if (!t) return false; mutate(() => { av().cards = fromTemplate(t.cards) }); return true },
    saveTemplate(name) {
      if (doc.templates.length >= LIM.templates) return null
      const t = { id: uid('tpl'), name: str(name, 40) || 'Template', cards: clone(av().cards) }
      doc.templates = [...doc.templates, t]
      return ok(t.id)
    },
    restoreTemplate(t) { if (doc.templates.length >= LIM.templates || doc.templates.some(x => x.id === t.id)) return false; doc.templates = [...doc.templates, t]; return ok(true) }, // undo of a delete
    deleteTemplate(id) { if (!doc.templates.some(t => t.id === id)) return false; doc.templates = doc.templates.filter(t => t.id !== id); return ok(true) },

    exportJSON: () => JSON.stringify(persistable(), null, 2),
    importJSON(text) { const r = parseImport(text); if (!r.ok) return r; edit = null; doc = r.doc; notify(); return r },
    // Reset layout: views only; prefs, shortcuts, pins and the user's templates stay.
    resetLayout() { const d = defaults(); edit = null; doc.views = d.views; doc.activeView = d.activeView; if (!d.views.some(v => v.id === doc.prefs.startView)) doc.prefs = { ...doc.prefs, startView: 'last' }; notify() },
    resetAll() { edit = null; doc = defaults(); notify() },

    seedShortcuts(skills) { if (doc.shortcutsSeeded) return false; doc.shortcuts = defaultShortcuts(skills); doc.shortcutsSeeded = true; return ok(true) },
    addShortcut(x) { const c = cleanShortcut(x, uid('sc')); if (!c || keyTaken(c.key)) return null; doc.shortcuts = [...doc.shortcuts, c]; doc.shortcutsSeeded = true; return ok(c.id) },
    updateShortcut(id, patch) {
      const i = doc.shortcuts.findIndex(x => x.id === id)
      const c = i >= 0 && patch && typeof patch === 'object' && cleanShortcut({ ...doc.shortcuts[i], ...patch }, id)
      if (!c || keyTaken(c.key, id)) return false
      doc.shortcuts = doc.shortcuts.map((x, j) => (j === i ? c : x))
      return ok(true)
    },
    deleteShortcut(id) { if (!doc.shortcuts.some(x => x.id === id)) return false; doc.shortcuts = doc.shortcuts.filter(x => x.id !== id); return ok(true) },
    moveShortcut(id, to) { const i = doc.shortcuts.findIndex(x => x.id === id); if (i < 0 || !Number.isInteger(to)) return false; const a = [...doc.shortcuts]; moveIn(a, i, to); doc.shortcuts = a; return ok(true) },
    movePinned(id, to) { const i = doc.pinnedCron.indexOf(id); if (i < 0 || !Number.isInteger(to)) return false; const a = [...doc.pinnedCron]; moveIn(a, i, to); doc.pinnedCron = a; return ok(true) },
    setPinnedCron(ids) {
      if (!Array.isArray(ids)) return false
      doc.pinnedCron = [...new Set(ids.filter(x => typeof x === 'string' && ID_RE.test(x)))].slice(0, LIM.pinned)
      return ok(true)
    }
  }
}
