// Quick launch: the shortcut's text typed in a composer, never sent. Target 'new' (default):
// a new chat. With a model:
// session.create {model, provider} -> openSession -> setDraft. Without one, or if that fails:
// newChat -> setDraft('new') and a toast naming the model to pick by hand.
import { host } from '@hermes/plugin-sdk'
import { modelLabel, shortcutDraft, withExtra } from '../state/format.js'
import { R } from './runtime.js'

const sleep = ms => new Promise(res => R.ctx.setTimeout(res, ms))

// The composer mounts a moment after navigation; setDraft answers false until then. A chat that is already
// on screen resets its composer a beat after newChat(), which would wipe a draft set at once, so the text
// must still be there after a short wait before it counts as typed.
async function typeDraft(address, text) {
  for (let i = 0; i < 30; i++) {
    if (await host.composer.setDraft(address, text)) {
      await sleep(300)
      if ((await host.composer.getDraft(address)) === text) { host.composer.focus(address); return true }
    } else await sleep(150)
  }
  return false
}

// Target 'current': the draft goes in front of whatever is typed in the chat that is open now
// (host.state.focusedStoredSessionId). On the dashboard page or Settings that chat is not on screen, so it is opened first.
// No chat open (a fresh draft): new chat plus a toast. Nothing is submitted.
async function launchCurrent(sc, extra) {
  const sid = host.state.focusedStoredSessionId.get(), draft = withExtra(shortcutDraft(sc), extra)
  if (!sid) { host.notify({ kind: 'info', message: R.t('ql.noChat') }); return launchNew(sc, extra) }
  const put = async () => ((await host.composer.getDraft(sid))?.trim() ? host.composer.insertText(sid, draft, { mode: 'prefix' }) : host.composer.setDraft(sid, draft))
  let ok = await put()
  if (!ok) {
    await host.openSession(sid)
    for (let i = 0; i < 30 && !ok; i++) { ok = await put(); if (!ok) await sleep(150) }
  }
  if (ok) host.composer.focus(sid); else host.notify({ kind: 'warning', message: R.t('ql.noComposer') })
  return { ok, bound: true, current: true }
}

// After one of the first 3 launches, say once that the text was typed, not sent (counted on this device).
function hintTyped() {
  try {
    const n = R.ctx.storage.get('launches', 0)
    if (n >= 3) return
    R.ctx.storage.set('launches', n + 1)
    host.notify({ kind: 'info', message: R.t('ql.typed') })
  } catch { /* storage full: no hint */ }
}

// A second click or key repeat while one launch runs (or within 500 ms after it) would open a second chat.
// The guard belongs to its ctx: after disable -> enable a launch that was cut off cannot block the new one.
let guard = null // { ctx, until }
export async function launch(sc, extra = '') {
  if (guard?.ctx === R.ctx && Date.now() < guard.until) return { ok: false, bound: false }
  const g = guard = { ctx: R.ctx, until: Infinity }
  try {
    // An older host without the composer API: a new chat and a toast, the user types the text.
    if (!host.composer) { host.newChat(); host.notify({ kind: 'warning', message: R.t('ql.noComposerApi') }); return { ok: false, bound: false } }
    const r = await (sc.target === 'current' ? launchCurrent(sc, extra) : launchNew(sc, extra))
    if (r.ok) hintTyped()
    return r
  } catch {
    host.notify({ kind: 'warning', message: R.t('ql.noComposer') })
    return { ok: false, bound: false }
  } finally { g.until = Date.now() + 500 }
}

async function launchNew(sc, extra) {
  const prefs = R.store.get().prefs
  const m = sc.model ? { provider: sc.provider, model: sc.model } : prefs.defaultModel
  const draft = withExtra(shortcutDraft(sc), extra)
  if (m && m.model) {
    try {
      const r = await host.request('session.create', { model: m.model, ...(m.provider ? { provider: m.provider } : {}) })
      const id = r && (r.stored_session_id || r.session_id)
      if (!id) throw new Error('no session id')
      await host.openSession(id)
      if (await typeDraft(id, draft)) return { ok: true, bound: true }
    } catch { /* fall through to a plain new chat */ }
  }
  host.newChat()
  const ok = await typeDraft('new', draft)
  if (m && m.model) host.notify({ kind: 'warning', message: R.t('ql.modelMissing', { model: modelLabel(m.model) }) })
  return { ok, bound: false }
}
