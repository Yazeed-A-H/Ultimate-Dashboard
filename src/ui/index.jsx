// Ultimate Dashboard desktop plugin entry. Everything is registered through ctx so disable/unload
// removes it: contributions, settings pages, timers, listeners, the stylesheet and query cache.
import { KEYBINDS_AREA, PALETTE_AREA, queryClient, ROUTES_AREA, SIDEBAR_NAV_AREA, host } from '@hermes/plugin-sdk'
import { shortcutLabel } from '../state/format.js'
import { CSS } from './css.js'
import { $clarify } from './data.js'
import { BUNDLES } from './i18n.js'
import { onEditKeys, DashboardPage } from './page.jsx'
import { visible } from './parts.jsx'
import { launch } from './quick.js'
import { $doc, ID, R, start } from './runtime.js'
import { General, LayoutsPage, PinnedPage, QuickLaunchPage } from './settings.jsx'

const PATH = '/ultimate-dashboard'

export default {
  id: ID,
  name: 'Ultimate Dashboard',
  description: 'A customizable dashboard: approvals, running sessions, scheduled jobs, usage, services, machine, files and Workers.',
  register(ctx) {
    ctx.i18n.register(BUNDLES)

    const style = document.createElement('style')
    style.id = 'ultimate-dashboard-css'
    style.textContent = CSS
    document.head.append(style)
    ctx.onDispose(() => style.remove())
    ctx.onDispose(() => queryClient.removeQueries({ queryKey: [ctx.source] }))

    start(ctx)

    ctx.register({ id: 'page', area: ROUTES_AREA, data: { path: PATH }, render: () => <DashboardPage /> })

    // Sidebar row + palette command + settings pages carry translated strings, so they are
    // re-registered on a locale change or when the user renames the row.
    let off = null, sig = ''
    const labels = () => {
      const p = $doc.get()?.prefs || {}
      const next = `${ctx.i18n.t('nav')}|${p.navLabel}|${p.navIcon}`
      if (next === sig) return
      sig = next
      if (off) off()
      const t = k => ctx.i18n.t(k)
      const offs = [
        ctx.registerMany([
          { id: 'nav', area: SIDEBAR_NAV_AREA, data: { codicon: p.navIcon || 'dashboard', label: p.navLabel || t('nav'), path: PATH } },
          { id: 'open', area: PALETTE_AREA, data: { id: 'ultimate-dashboard.open', label: `${t('title')}: ${p.navLabel || t('nav')}`, keywords: ['today', 'dashboard', 'hermes'], run: () => host.navigate(PATH) } }
        ]),
        ctx.registerSettingsPage?.({
          id: 'settings', title: 'Ultimate Dashboard', icon: 'dashboard', render: () => <General />,
          children: [
            { id: 'quick-launch', title: t('s.quick'), render: () => <QuickLaunchPage /> },
            { id: 'pinned-cron', title: t('s.pinned'), render: () => <PinnedPage /> },
            { id: 'layouts', title: t('s.layouts'), render: () => <LayoutsPage /> }
          ]
        })
      ]
      off = () => offs.forEach(f => f && f())
    }
    labels()
    ctx.i18n.onLocaleChange(() => { sig = ''; labels() })
    ctx.onDispose($doc.listen(() => labels()))
    ctx.onDispose(() => { if (off) off() })

    ctx.addEventListener(document, 'keydown', onEditKeys)

    // Keyboard shortcuts go through Hermes' own keybinding registry (KEYBINDS_AREA): Hermes resolves clashes
    // with its built-in keys (it wins), runs Cmd/Ctrl chords even while typing, and lists them under
    // Settings > Keyboard Shortcuts, where the user can rebind them. Re-registered when keys or labels change.
    let offKeys = null, keySig = ''
    const keys = () => {
      const d = $doc.get()
      if (!d) return
      const items = d.shortcuts.filter(s => s.key).map(s => ({ id: s.id, key: s.key, label: shortcutLabel(s) }))
      const next = JSON.stringify([ctx.i18n.t('title'), d.prefs.openKey, items])
      if (next === keySig) return
      keySig = next
      if (offKeys) offKeys()
      const group = ctx.i18n.t('title'), reg = (id, label, key, run) => ({ id, area: KEYBINDS_AREA, data: { id: `ultimate-dashboard.${id}`, label: `${group}: ${label}`, category: 'view', defaults: [key], run } })
      offKeys = ctx.registerMany([
        ...(d.prefs.openKey ? [reg('open-key', ctx.i18n.t('nav'), d.prefs.openKey, () => { if (!R.recording) host.navigate(PATH) })] : []),
        // Same as clicking the shortcut: the text is typed, never sent.
        ...items.map(i => reg(`sc.${i.id}`, i.label, i.key, () => { if (R.recording) return; const sc = $doc.get()?.shortcuts.find(x => x.id === i.id); if (sc) void launch(sc) }))
      ])
    }
    keys()
    ctx.i18n.onLocaleChange(() => { keySig = ''; keys() })
    ctx.onDispose($doc.listen(keys))
    ctx.onDispose(() => { if (offKeys) offKeys() })

    // Clarify questions only arrive as events; approvals re-fetch on their events.
    // A new approval may come from a session the active list has not seen yet: refresh both.
    const refetch = () => { queryClient.invalidateQueries({ queryKey: [ctx.source, 'active'] }); queryClient.invalidateQueries({ queryKey: [ctx.source, 'approvals'] }) }
    ctx.onEvent('clarify.request', ev => {
      const sid = ev.session_id || ev.payload?.session_id
      if (sid) $clarify.set({ ...$clarify.get(), [sid]: { request_id: ev.payload?.request_id || ev.payload?.prompt_id, question: ev.payload?.question || '' } })
      queryClient.invalidateQueries({ queryKey: [ctx.source, 'active'] })
    })
    // Optional toast for a new approval, at most one per request_id (the event can be replayed on reconnect).
    const told = new Set()
    ctx.onEvent('approval.request', ev => {
      refetch()
      const p = ev.payload || {}, rid = p.request_id
      if (!$doc.get()?.prefs.notifyApprovals || !rid || told.has(rid)) return
      told.add(rid)
      if (told.size > 200) told.delete(told.values().next().value)
      const text = visible(String(p.description || p.tool_name || '').slice(0, 120))
      host.notify({ kind: 'info', message: text ? ctx.i18n.t('ap.newT', { text }) : ctx.i18n.t('ap.new') })
    })
    ctx.onEvent('approval.cancelled', refetch)
    // A job ran or changed: the list and every Job result card re-read.
    ctx.onEvent('cron.changed', () => { queryClient.invalidateQueries({ queryKey: [ctx.source, 'cron'] }); queryClient.invalidateQueries({ queryKey: [ctx.source, 'job-output'] }) })
    ctx.onEvent('message.complete', ev => {
      const sid = ev.session_id
      if (sid && $clarify.get()[sid]) { const c = { ...$clarify.get() }; delete c[sid]; $clarify.set(c) }
      refetch()
    })
  }
}
