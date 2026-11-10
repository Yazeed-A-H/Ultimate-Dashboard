// Plugin-wide runtime: the store, its persistence (ctx.storage now, backend sync after), and the
// translator. One instance per register(); everything here is torn down by ctx disposers.
import { atom, host, useI18n, usePluginI18n, useValue } from '@hermes/plugin-sdk'
import { useCallback, useEffect } from 'react'
import { fill } from '../state/format.js'
import { createStore, validate } from '../state/store.js'
import { saveWithRetry } from '../state/sync.js'

export const ID = 'ultimate-dashboard'
export const R = { ctx: null, store: null, mounts: 0 } // mounts: dashboard page / settings pages on screen (the /state poll only runs then)
export const $doc = atom(null)
export const $editing = atom(false)
export const $dlg = atom(null) // dashboard page dialog: { kind: 'gallery' | 'options' | 'view' | 'rename' | 'delete', id? }
// backend: 'unknown' | 'on' | 'off'
export const $sync = atom({ backend: 'unknown', version: null, error: null })

const KEY = 'doc'
let rev = 0, upd, saveTimer = null, lastSaved = '', saving = false, pending = false, lastPull = 0

export const restRetry = (path, opts) => R.ctx.rest(path, { timeoutMs: 15000, ...opts })

// clean: the backend confirmed this doc at `rev`; a reopened window that was closed offline must not drop its change.
// base: the last confirmed doc, so that window still merges onto the other window's copy. upd: its updated_at.
function persistLocal(doc) {
  try { R.ctx.storage.set(KEY, { rev, doc, clean: JSON.stringify(doc) === lastSaved, base: lastSaved, upd }) } catch { /* storage full: backend copy still saves */ }
}

async function pushNow() {
  if ($sync.get().backend !== 'on') return
  if (saving) { pending = true; return }
  const ctx = R.ctx, doc = R.store.persistable(), body = JSON.stringify(doc)
  if (body === lastSaved) { $sync.set({ ...$sync.get(), error: null }); return } // back on the saved doc: a stale 'too large' goes
  // The backend refuses more than 256 KB (413); retrying on every pull would never succeed.
  if (new TextEncoder().encode(body).length > 262144) { $sync.set({ ...$sync.get(), error: 'document too large (256 KB)' }); return }
  saving = true
  try {
    // On conflict, keep the server's value for every top-level section this window left alone since its last synced copy.
    // shortcut: a conflict while editing is parked as before, and the save after Done writes the whole doc.
    const base = lastSaved ? JSON.parse(lastSaved) : {}
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b), obj = v => v && typeof v === 'object' && !Array.isArray(v)
    const mergeOnto = server => {
      if (!server) return doc
      if (R.store.isEditing()) return null
      const out = { ...server }
      for (const k of Object.keys(doc)) {
        if (same(doc[k], base[k])) continue
        if (k === 'prefs' && obj(doc[k]) && obj(server[k]) && obj(base[k])) { // prefs are independent keys: another window's pref survives
          out[k] = { ...server[k] }
          for (const p of Object.keys(doc[k])) if (base[k][p] !== undefined && !same(doc[k][p], base[k][p])) out[k][p] = doc[k][p] // a key the base lacks (older version) is not a change
        } else out[k] = doc[k]
      }
      const v = validate(out) // a per-key merge can break a cross-section rule (dangling startView, duplicate key): then save the whole local doc
      return v.ok ? v.doc : doc
    }
    const r = await saveWithRetry(b => restRetry('/state', { method: 'PUT', body: b }), rev, doc, mergeOnto)
    if (R.ctx !== ctx) return // disabled and re-enabled meanwhile: this answer belongs to the old instance
    if (r.ok) {
      // A merged doc is now the server's copy: show it here too, unless the user changed something meanwhile.
      // Then keep the old rev: the next save conflicts and merges only the new change instead of overwriting the other window.
      if (!(r.merged && JSON.stringify(R.store.persistable()) === body && !R.store.isEditing() && adopt(r.rev, r.doc))) { if (!r.merged) rev = r.rev; lastSaved = body; persistLocal(R.store.persistable()) }
      $sync.set({ ...$sync.get(), error: null })
    }
    // Mid-edit, keep the user's session and save again after Done/Cancel; the old rev stays so that save conflicts and merges.
    else if (r.conflict && R.store.isEditing()) pending = true
    else if (r.conflict) {
      if (adopt(r.rev, r.doc)) host.notify({ kind: 'warning', message: R.t('sync.conflict') })
      else $sync.set({ ...$sync.get(), error: 'backend document rejected' })
    }
  } catch (e) {
    if (R.ctx === ctx) $sync.set({ ...$sync.get(), error: String(e?.message || e).slice(0, 200) })
  } finally {
    if (R.ctx !== ctx) return
    saving = false
    if (pending) { pending = false; if (!R.store.isEditing()) schedule() } // Done/Cancel notify the store, and that schedules the save
  }
}

function schedule() {
  if (saveTimer) saveTimer()
  saveTimer = R.ctx.setTimeout(() => { saveTimer = null; pushNow() }, 400)
}

function adopt(newRev, doc, at) {
  const r = R.store.replace(doc)
  if (!r.ok) return false
  rev = newRev; upd = at
  lastSaved = JSON.stringify(R.store.persistable())
  persistLocal(R.store.get())
  $editing.set(false)
  return true
}

// The backend copy wins whenever its rev differs, unless this window holds a change the backend never confirmed.
export async function pull() {
  lastPull = Date.now()
  const ctx = R.ctx
  try {
    const r0 = rev, l0 = lastSaved, s0 = saving
    const remote = await restRetry('/state')
    if (R.ctx !== ctx) return
    const health = $sync.get().version ? null : await restRetry('/health').catch(() => null)
    if (R.ctx !== ctx) return
    $sync.set({ ...$sync.get(), backend: 'on', version: health?.version ?? $sync.get().version, error: null })
    if (rev !== r0 || lastSaved !== l0 || saving !== s0) return // a save finished meanwhile: this snapshot is older than our own PUT
    const rrev = remote.rev || 0, mine = JSON.stringify(R.store.persistable())
    // Another rev or updated_at is this gateway's truth (another window saved, a switched gateway, a restored state.json): adopt it.
    // The same rev and updated_at with other content, or an empty backend, gets this window's copy (last writer wins).
    if (remote.doc && JSON.stringify(remote.doc) === mine) { rev = rrev; lastSaved = mine; upd = remote.updated_at; persistLocal(R.store.persistable()) } // the backend already has our copy
    else if (remote.doc && mine === lastSaved && (rrev !== rev || remote.updated_at !== upd)) { if (!R.store.isEditing() && !saving && !saveTimer && !pending && !adopt(rrev, remote.doc, remote.updated_at)) $sync.set({ ...$sync.get(), error: 'backend document rejected' }) }
    else {
      // An unconfirmed local change keeps its base rev: the save conflicts and merges onto the server copy (an empty backend just takes ours).
      if (!remote.doc) { rev = rrev; lastSaved = '' }
      schedule()
    }
  } catch (e) {
    if (R.ctx !== ctx) return
    const msg = String(e?.message || e)
    // 404: the route is not mounted (backend not installed/enabled); anything else is transient.
    $sync.set({ ...$sync.get(), backend: /^404\b/.test(msg) ? 'off' : $sync.get().backend, error: msg.slice(0, 200) })
  }
}

export function start(ctx) {
  R.ctx = ctx
  R.t = (k, v) => fill(ctx.i18n.t(k, v || {}), v)
  rev = 0; upd = undefined; lastSaved = ''; saving = false; pending = false; saveTimer = null
  $editing.set(false); $dlg.set(null) // module state outlives disable -> enable
  const saved = ctx.storage.get(KEY, null)
  if (saved && typeof saved.rev === 'number') { rev = saved.rev; upd = saved.upd }
  R.store = createStore(saved?.doc)
  if (saved?.clean !== false) lastSaved = JSON.stringify(R.store.persistable()) // fresh, or confirmed by the backend
  else if (typeof saved.base === 'string') lastSaved = saved.base // unconfirmed change: the merge base
  $doc.set(R.store.get())
  const off = R.store.subscribe(doc => {
    $doc.set(doc)
    $editing.set(R.store.isEditing())
    persistLocal(R.store.persistable())
    schedule()
  })
  ctx.onDispose(off)
  pull()
  ctx.setInterval(() => { if (!document.hidden && R.mounts > 0) pull() }, 30000)
  ctx.addEventListener(window, 'focus', () => { if (Date.now() - lastPull > 5000) pull() })
}

// Call from the dashboard page and the settings pages: while one is on screen the doc is pulled every 30 s, and once on mount.
export function useMounted() {
  useEffect(() => { R.mounts++; if (Date.now() - lastPull > 5000) pull(); return () => { R.mounts-- } }, [])
}

// Translator: t(key, vars) -> string with {name} filled; falls back to the key's English.
export function useT() {
  const tr = usePluginI18n(ID)
  const { locale } = useI18n()
  return useCallback((key, vars) => fill(tr(key, vars || {}), vars), [tr, locale])
}

// Number/date locale: Hermes' language with Latin digits (matches the app's own figures).
export function useLocale() {
  const { locale } = useI18n()
  return String(locale || 'en').startsWith('ar') ? 'ar-u-nu-latn' : String(locale || 'en')
}
// The SDK knows each language's direction; the document attribute is the fallback (older hosts) and what the CSS follows.
export const isRtl = () => { const o = host.i18n?.languageOptions?.().find(l => l.id === document.documentElement.lang); return o ? !!o.rtl : document.documentElement.dir === 'rtl' }

export const useDoc = () => useValue($doc)
