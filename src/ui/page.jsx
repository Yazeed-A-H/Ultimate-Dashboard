// The dashboard page with edit mode, gallery, card settings and the new-view dialog.
import {
  atom, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  host, Input, SearchField, SegmentedControl, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Checkbox, Textarea, useQueryClient, useValue
} from '@hermes/plugin-sdk'
import { Component, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { atCap, baseId, CARDS, getCard, hasOption, RANGES } from '../state/cards.js'
import { anyFailed, comboLabel, greetingKey, holdFor, IS_MAC, isInternalJob, shortcutLabel, WARN } from '../state/format.js'
import { stripMode } from '../state/store.js'
import { BODIES, settingsHref } from './cards.jsx'
import { useCron, useModels, useSkills } from './data.js'
import { Icon } from './icon.jsx'
import { Auto, CardCtx, Confirm, ModelName, SaveInput, useReturnFocus } from './parts.jsx'
import { launch } from './quick.js'
import { $dlg, $editing, $sync, isRtl, R, useDoc, useLocale, useMounted, useT } from './runtime.js'

const $announce = atom(null) // { key, vars }: translated at render, so a locale change re-translates it
const $grab = atom(null) // { id, from } while a card is held with the keyboard
$editing.listen(on => { if (!on) { $grab.set(null); $dlg.set(null) } })
let sayOff = null
// Screen-reader line for keyboard moves: re-announced on each call, cleared after 3 s so it never goes stale.
const say = (key, vars) => {
  if (sayOff) sayOff()
  $announce.set(null)
  sayOff = R.ctx.setTimeout(() => { $announce.set({ key, vars }); sayOff = R.ctx.setTimeout(() => $announce.set(null), 3000) }, 30)
}
export const viewName = (v, t) => v.name || (v.nameKey ? t(v.nameKey) : '')
const cardTitle = (c, t, r) => c.options?.title || r?.title || t('card.' + baseId(c.id))

class Boundary extends Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  render() { return this.state.err ? this.props.fallback(this.state.err, () => this.setState({ err: null })) : this.props.children }
}

// ---------- header ----------
// Refresh: spins while the invalidated queries refetch (at least 400 ms), then a check (or warning) for 1.5 s and one screen-reader line.
function RefreshButton() {
  const t = useT(), qc = useQueryClient(), [phase, setPhase] = useState('idle'), idle = useRef(null) // idle | busy | ok | fail
  const busy = phase === 'busy'
  const go = async () => {
    if (busy) return // aria-disabled, not disabled: keyboard focus stays on the button
    idle.current?.() // a pending reset from the last run must not end this one
    setPhase('busy')
    await holdFor(qc.invalidateQueries({ queryKey: [R.ctx.source] }), 400, ms => new Promise(r => R.ctx.setTimeout(r, ms)))
    const bad = anyFailed(qc.getQueryCache().findAll({ queryKey: [R.ctx.source] }).filter(q => q.getObserversCount() > 0).map(q => q.state))
    setPhase(bad ? 'fail' : 'ok')
    say(bad ? 'act.refreshPartial' : 'act.refreshed')
    idle.current = R.ctx.setTimeout(() => setPhase('idle'), 1500)
  }
  return <Button variant="outline" size="sm" className="ht-rf" onClick={go} aria-busy={busy || undefined} aria-disabled={busy || undefined} aria-label={t(busy ? 'act.refreshing' : 'act.refresh')}><Icon name={phase === 'ok' ? 'check' : phase === 'fail' ? 'warning' : 'refresh'} className={busy ? 'ht-spin' : undefined} /><span>{t('act.refresh')}</span></Button>
}

function Header() {
  const t = useT(), locale = useLocale(), doc = useDoc(), editing = useValue($editing)
  const g = t(greetingKey(new Date().getHours()))
  const date = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  return (
    <header className="ht-hero">
      <div>
        <h1>{doc.prefs.hideGreeting ? doc.prefs.navLabel || t('nav') : doc.prefs.name ? t('greet.name', { greeting: g, name: doc.prefs.name }) : g}</h1>
        <p className="ht-date">{date}</p>
      </div>
      <div className="ht-acts">
        <div className="ht-rng" role="group" aria-label={t('range.label')}>
          {RANGES.map(r => <button key={r} type="button" aria-pressed={doc.prefs.range === r} onClick={() => R.store.setPref('range', r)}>{t('range.' + r)}</button>)}
        </div>
        <RefreshButton />
        <Button variant="outline" size="sm" onClick={() => { R.store.beginEdit(); $dlg.set({ kind: 'gallery' }) }}><Icon name="add" /><span>{t('act.cards')}</span></Button>
        <Button variant="outline" size="sm" className="ht-off" data-edit-btn="" aria-disabled={editing || undefined} onClick={() => { if (!editing) R.store.beginEdit() }}><Icon name="edit" /><span>{t('act.editLayout')}</span></Button>
        <Button variant="outline" size="sm" onClick={() => { if (R.store.isEditing()) R.store.commitEdit(); host.navigate(settingsHref()) }}><Icon name="settings-gear" /><span>{t('act.settings')}</span></Button>
      </div>
    </header>
  )
}

// ---------- quick launch ----------
function QuickLaunch() {
  const t = useT(), doc = useDoc(), skills = useSkills()
  const [extra, setExtra] = useState('')
  const go = async sc => { const r = await launch(sc, extra); if (r?.ok && extra) setExtra('') }
  useEffect(() => { if (!doc.shortcutsSeeded && skills.data?.length) R.store.seedShortcuts(skills.data) }, [doc.shortcutsSeeded, skills.data])
  const list = doc.shortcuts, mode = stripMode(list.length)
  const shown = mode === 'more' ? list.slice(0, 7) : list, rest = mode === 'more' ? list.slice(7) : []
  const label = shortcutLabel
  const model = sc => sc.model || doc.prefs.defaultModel?.model // "Hermes default" is the silent default, so it is not printed
  const desc = Object.fromEntries((skills.data || []).map(s => [s.name, s.description]))
  return (
    <section className="ht-ql" aria-labelledby="ht-ql-t">
      <div className="ht-ql-cap"><h2 id="ht-ql-t" className="ht-ql-t"><Icon name="zap" />{t('ql.title')}</h2><Button variant="ghost" size="icon-xs" aria-label={t('ql.settings')} title={t('ql.settings')} onClick={() => host.navigate(settingsHref('quick-launch'))}><Icon name="settings-gear" /></Button></div>
      {list.length ? <Textarea className="ht-textarea ht-ql-in" rows={2} dir="auto" maxLength={4000} value={extra} onChange={e => setExtra(e.target.value)} aria-label={t('ql.extraL')} placeholder={t('ql.extraP')} /> : null}
      {list.length ? (
        <div className="ht-ql-list" data-mode={mode} style={{ '--n': Math.max(1, shown.length) }}>
          {shown.map(sc => (
            <button key={sc.id} type="button" className="ht-ql-b" onClick={() => go(sc)} aria-label={t(sc.target === 'current' ? 'ql.launchCurrentL' : 'ql.launchL', { skill: label(sc) })}>
              <span className="ht-ql-ic" aria-hidden="true"><Icon name="sparkle" /></span>
              <span className="ht-ql-x"><span className="ht-ql-l"><bdi dir="auto">{label(sc)}</bdi></span><span className="ht-ql-s">{[
                sc.skill ? <bdi key="d" dir="auto">{desc[sc.skill] || `/${sc.skill}`}</bdi> : <span key="d">{t('ql.freeText')}</span>,
                sc.target === 'current' ? <span key="t">{t('s.targetCurrent')}</span> : null,
                sc.key ? <bdi key="k" dir="ltr">{comboLabel(sc.key, IS_MAC)}</bdi> : null
              ].filter(Boolean).flatMap((x, i) => (i ? [' · ', x] : [x]))}{model(sc) ? <ModelName model={model(sc)} className="ht-ql-m" /> : null}</span></span>
            </button>
          ))}
          {rest.length ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" className="ht-ql-b"><Icon name="ellipsis" /><span className="ht-ql-l">{t('ql.more')}</span></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">{rest.map(sc => <DropdownMenuItem key={sc.id} onSelect={() => go(sc)}><bdi dir="auto">{label(sc)}</bdi></DropdownMenuItem>)}</DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : (
        <p className="ht-empty" style={{ paddingInline: 0 }}>{t('ql.empty')} <button type="button" className="ht-link" onClick={() => host.navigate(settingsHref('quick-launch'))}>{t('ql.setup')}</button></p>
      )}
    </section>
  )
}

// ---------- views ----------
function ViewTabs() {
  const t = useT(), doc = useDoc()
  const tabs = useRef(null)
  const onKey = e => {
    if (e.target.getAttribute('role') !== 'tab') return // the ⋯ menu (and its portal) bubbles here too
    const keys = isRtl() ? { ArrowLeft: 1, ArrowRight: -1 } : { ArrowLeft: -1, ArrowRight: 1 }
    const d = keys[e.key], n = doc.views.length
    if (!d && e.key !== 'Home' && e.key !== 'End') return
    const i = doc.views.findIndex(v => v.id === doc.activeView), next = doc.views[e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + d + n) % n]
    e.preventDefault(); R.store.setActiveView(next.id)
    R.ctx.setTimeout(() => tabs.current?.querySelector('[aria-selected="true"]')?.focus(), 0)
  }
  return (
    <div className="ht-vbar">
      <div className="ht-vg">
        <div className="ht-vlist" role="tablist" aria-label={t('views.label')} ref={tabs} onKeyDown={onKey}>
          {doc.views.map(v => (
            <div key={v.id} className="ht-vt" role="presentation" data-active={v.id === doc.activeView || undefined}>
              <button type="button" role="tab" id={`ht-tab-${v.id}`} aria-controls="ht-grid" aria-selected={v.id === doc.activeView} tabIndex={v.id === doc.activeView ? 0 : -1} className="ht-vtab" onClick={() => R.store.setActiveView(v.id)}><bdi dir="auto">{viewName(v, t)}</bdi></button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="ht-vt-m" data-ht-vm={v.id} aria-label={t('views.menu', { name: viewName(v, t) })}><Icon name="ellipsis" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={() => $dlg.set({ kind: 'rename', id: v.id })}>{t('act.rename')}</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" disabled={doc.views.length <= 1} onSelect={() => $dlg.set({ kind: 'delete', id: v.id })}>{t('act.delete')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>))}
        </div>
        <Button variant="ghost" size="icon-xs" aria-label={t('views.add')} title={t('views.add')} onClick={() => $dlg.set({ kind: 'view' })}><Icon name="add" /></Button>
      </div>
    </div>
  )
}

// Rename / Delete for a view tab's ⋯ menu: the same store calls as Settings ▸ Layouts.
function ViewMenuDialogs() {
  const t = useT(), dlg = useValue($dlg), doc = useDoc()
  const v = dlg && (dlg.kind === 'rename' || dlg.kind === 'delete') ? doc.views.find(x => x.id === dlg.id) : null
  const [name, setName] = useState('')
  useEffect(() => { if (v && dlg.kind === 'rename') setName(viewName(v, t)) }, [dlg?.id, dlg?.kind])
  const focusBack = useReturnFocus(dlg?.kind === 'rename' && !!v, () => document.querySelector(`[data-ht-vm="${v?.id}"]`))
  if (!v) return null
  const close = () => $dlg.set(null)
  if (dlg.kind === 'delete') return <Confirm open back={() => document.querySelector(`[data-ht-vm="${v.id}"]`)} onClose={close} onConfirm={() => { close(); R.store.deleteView(v.id) }} title={t('s.deleteViewQ', { name: viewName(v, t) })} description={t('s.deleteViewD')} confirmLabel={t('act.delete')} cancelLabel={t('act.cancel')} />
  return (
    <Dialog open onOpenChange={o => { if (!o) close() }}>
      <DialogContent className="ht-dlg" onCloseAutoFocus={focusBack}>
        <DialogHeader className="ht-dh"><DialogTitle>{t('act.rename')}</DialogTitle></DialogHeader>
        <form className="ht-form" onSubmit={e => { e.preventDefault(); R.store.renameView(v.id, name); close() }}>
          <label className="ht-fld"><span className="ht-fld-l">{t('views.name')}</span><Input dir="auto" value={name} maxLength={40} onChange={e => setName(e.target.value)} autoFocus /></label>
          <DialogFooter><Button type="button" variant="outline" onClick={close}>{t('act.cancel')}</Button><Button type="submit">{t('act.save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function NewViewDialog() {
  const t = useT(), dlg = useValue($dlg), open = dlg?.kind === 'view'
  const [name, setName] = useState(''), [tpl, setTpl] = useState('__blank')
  useEffect(() => { if (open) { setName(''); setTpl('__blank') } }, [open])
  const create = () => { const id = R.store.addView(name.trim() || t('views.add'), tpl === '__blank' ? null : tpl); if (id) $dlg.set(null) }
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) $dlg.set(null) }}>
      <DialogContent className="ht-dlg">
        <DialogHeader className="ht-dh"><DialogTitle>{t('views.add')}</DialogTitle></DialogHeader>
        <form className="ht-form" onSubmit={e => { e.preventDefault(); create() }}>
          <label className="ht-fld"><span className="ht-fld-l">{t('views.name')}</span><Input dir="auto" value={name} maxLength={40} onChange={e => setName(e.target.value)} autoFocus /></label>
          <label className="ht-fld"><span className="ht-fld-l">{t('views.from')}</span>
            <Select value={tpl} onValueChange={setTpl}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__blank">{t('views.blank')}</SelectItem>
                {R.store.templates().map(x => <SelectItem key={x.id} value={x.id}>{x.builtIn ? t('tpl.' + x.id) : x.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <DialogFooter><Button type="button" variant="outline" onClick={() => $dlg.set(null)}>{t('act.cancel')}</Button><Button type="submit">{t('views.create')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ---------- edit mode ----------
function EditBar() {
  const t = useT()
  useDoc() // re-render on every change so Undo/Redo states update
  return (
    <div className="ht-editbar" role="group" aria-label={t('edit.bar')} title={t('edit.hint')}>
      <span className="ht-editbar-t">{t('edit.bar')}</span>
      <span className="ht-editbar-hint">{t('edit.hint')}</span>
      <Button size="sm" variant="outline" onClick={() => $dlg.set({ kind: 'gallery' })}><Icon name="add" /><span>{t('gal.title')}</span></Button>
      <span className="ht-sep" aria-hidden="true" />
      <Button size="sm" variant="ghost" disabled={!R.store.canUndo()} onClick={() => R.store.undo()} aria-keyshortcuts="Meta+Z Control+Z"><Icon name="discard" /><span>{t('act.undo')}</span></Button>
      <Button size="sm" variant="ghost" disabled={!R.store.canRedo()} onClick={() => R.store.redo()} aria-keyshortcuts="Shift+Meta+Z Shift+Control+Z"><Icon name="redo" /><span>{t('act.redo')}</span></Button>
      <span className="ht-sep" aria-hidden="true" />
      <Button size="sm" variant="outline" onClick={() => R.store.cancelEdit()}>{t('act.cancel')}</Button>
      <Button size="sm" onClick={() => { const changed = R.store.editChanged(); R.store.commitEdit(); if (changed) host.notify({ kind: 'success', message: t('s.done') }) }}>{t('act.done')}</Button>
    </div>
  )
}

// Scroll to a card just added; focus: move keyboard focus there (when the control that added it is gone).
const reveal = (id, focus) => R.ctx.setTimeout(() => {
  const el = document.querySelector(`.ht [data-card-id="${CSS.escape(id)}"]`)
  if (!el) return
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  if (focus) { el.tabIndex = -1; el.focus({ preventScroll: true }) }
}, 150)
const focusGrip = id => R.ctx.setTimeout(() => document.querySelector(`.ht [data-grip="${CSS.escape(id)}"]`)?.focus(), 0)

// Pointer drag (mouse + touch, one code path) with an insertion line; keyboard moves on the grip.
function startDrag(e, id) {
  if (e.button !== 0) return
  e.preventDefault()
  const grip = e.currentTarget, grid = grip.closest('.ht-grid'), card = grip.closest('[data-card-id]')
  grip.setPointerCapture(e.pointerId)
  const sx = e.clientX, sy = e.clientY
  let moved = false, target = null
  const line = document.createElement('div'); line.className = 'ht-ins'; line.hidden = true
  const ghost = document.createElement('div'); ghost.className = 'ht-ghost'; ghost.hidden = true; ghost.textContent = card.querySelector('.ht-card-t')?.textContent || id
  const host_ = grip.closest('.ht'); host_.append(line, ghost)
  const rtl = isRtl()
  const move = ev => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
    if (!moved) { moved = true; card.dataset.dragging = 'true'; ghost.hidden = false }
    // Pointer coordinates are physical, so this fixed overlay uses left/top on purpose.
    ghost.style.left = `${ev.clientX + 12}px`; ghost.style.top = `${ev.clientY + 12}px`
    const others = [...grid.querySelectorAll('[data-card-id]')].filter(n => n !== card)
    let best = null, bd = Infinity
    for (const n of others) {
      const r = n.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
      const d = inside ? -1 : Math.hypot(ev.clientX - cx, ev.clientY - cy)
      if (d < bd) { bd = d; best = { n, r, cx } }
    }
    if (!best) return
    const before = rtl ? ev.clientX > best.cx : ev.clientX < best.cx
    target = { id: best.n.dataset.cardId, before }
    const edgeX = (before !== rtl) ? best.r.left - 7 : best.r.right + 5
    Object.assign(line.style, { left: `${edgeX}px`, top: `${best.r.top}px`, width: '3px', height: `${best.r.height}px` })
    line.hidden = false
    // shortcut: autoscroll only when the pointer nears the page edges; enough for one screen of cards.
    const sc = grip.closest('.ht'), sr = sc.getBoundingClientRect()
    if (ev.clientY < sr.top + 40) sc.scrollBy(0, -16); else if (ev.clientY > sr.bottom - 40) sc.scrollBy(0, 16)
  }
  const end = () => {
    grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end)
    line.remove(); ghost.remove(); delete card.dataset.dragging
    if (moved && target) {
      const ids = R.store.activeView().cards.map(c => c.id).filter(x => x !== id)
      const to = ids.indexOf(target.id) + (target.before ? 0 : 1)
      R.store.moveCard(id, to)
      say('edit.dropped', { card: card.querySelector('.ht-card-t')?.textContent || id, pos: to + 1 })
    }
  }
  grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end)
}

function gripKey(e, id, title) {
  const grab = $grab.get(), cards = R.store.activeView().cards, i = cards.findIndex(c => c.id === id)
  if (!grab || grab.id !== id) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); $grab.set({ id, from: i }); say('edit.grabbed', { card: title }) }
    return
  }
  const dirs = isRtl() ? { ArrowLeft: 1, ArrowRight: -1, ArrowUp: -1, ArrowDown: 1 } : { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }
  if (dirs[e.key]) {
    e.preventDefault()
    const to = Math.max(0, Math.min(cards.length - 1, i + dirs[e.key]))
    if (to !== i) { R.store.moveCard(id, to); focusGrip(id) }
    say('edit.moved', { card: title, pos: to + 1, total: cards.length })
  } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); $grab.set(null); say('edit.dropped', { card: title, pos: i + 1 }) }
  else if (e.key === 'Escape') { e.preventDefault(); R.store.moveCard(id, grab.from); $grab.set(null); focusGrip(id); say('edit.cancelled') }
}

function CardMenu({ c, title }) {
  const t = useT(), doc = useDoc(), def = getCard(c.id)
  const n = R.store.activeView().cards.length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" data-ht-cm={c.id} aria-label={t('edit.menu', { card: title })}><Icon name="ellipsis" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="ht-menu">
        {def.sizes.length > 1 ? <>
          <div role="group" aria-labelledby="ht-mn-size">
            <div role="presentation" id="ht-mn-size" className="ht-sub-t" style={{ padding: '0.25rem 0.625rem' }}>{t('edit.size')}</div>
            {def.sizes.map(s => <DropdownMenuItem key={s} onSelect={() => R.store.setSize(c.id, s)}><span style={{ inlineSize: '1rem', display: 'inline-flex' }}>{c.size === s ? <Icon name="check" /> : null}</span>{t('size.' + s)}</DropdownMenuItem>)}
          </div>
          <DropdownMenuSeparator />
        </> : null}
        <div role="group" aria-labelledby="ht-mn-move">
          <div role="presentation" id="ht-mn-move" className="ht-sub-t" style={{ padding: '0.25rem 0.625rem' }}>{t('edit.moveTo')}</div>
          <DropdownMenuItem onSelect={() => { R.store.moveCard(c.id, 0); focusGrip(c.id) }}>{t('edit.first')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { R.store.moveCard(c.id, n - 1); focusGrip(c.id) }}>{t('edit.last')}</DropdownMenuItem>
          {doc.views.filter(v => v.id !== doc.activeView && !v.cards.some(x => x.id === c.id) && !atCap(v.cards, c.id)).map(v => <DropdownMenuItem key={v.id} onSelect={() => R.store.moveCardToView(c.id, v.id)}><bdi dir="auto">{viewName(v, t)}</bdi></DropdownMenuItem>)}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => $dlg.set({ kind: 'options', id: c.id })}>{t('edit.options')}</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={() => R.store.removeCard(c.id)}>{t('edit.remove')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CardInner({ c }) {
  const t = useT(), editing = useValue($editing), grab = useValue($grab)
  const def = getCard(c.id), r = BODIES[baseId(c.id)]()
  const title = cardTitle(c, t, r), hid = `ht-c-${c.id}`
  return (
    <section className="ht-card" data-card-id={c.id} data-size={c.size} data-density={c.options.density || undefined} data-grabbed={grab?.id === c.id ? 'true' : undefined} aria-labelledby={hid}>
      <div className="ht-card-h">
        {editing ? <>
          <button type="button" className="ht-grip" data-grip={c.id} aria-label={t('edit.grip', { card: title })} aria-pressed={grab?.id === c.id}
            onPointerDown={e => startDrag(e, c.id)} onKeyDown={e => gripKey(e, c.id, title)} onBlur={() => { if ($grab.get()?.id === c.id) $grab.set(null) }}><Icon name="gripper" /></button>
          <CardMenu c={c} title={title} />
        </> : null}
        <Icon name={def.icon} className="ht-hi" />
        <h2 className="ht-card-t" id={hid}><bdi dir="auto">{title}</bdi></h2>
        {r.meta ? <div className="ht-card-r">{r.meta}</div> : null}
      </div>
      <div className="ht-card-b">{r.body}</div>
      {r.foot ? <div className="ht-card-f">{r.foot}</div> : null}
    </section>
  )
}

function CardFrame({ c }) {
  const doc = useDoc(), t = useT()
  const range = hasOption(c.id, 'range') && c.options.range ? c.options.range : doc.prefs.range
  // Cards are mutated in place by the store (size/reset), so key on the values, not the object.
  const value = useMemo(() => ({ card: c, size: c.size, range, show: f => !c.options.fields || c.options.fields.includes(f) }), [c, c.size, c.options, range])
  return (
    <CardCtx.Provider value={value}>
      <Boundary fallback={(err, retry) => <section className="ht-card" data-size={c.size} data-card-id={c.id}><div className="ht-state" data-kind="error"><p className="ht-state-t">{cardTitle(c, t)}</p><p className="ht-state-d">{String(err?.message || err).slice(0, 160)}</p><Button size="sm" variant="outline" onClick={retry}>{t('act.retry')}</Button>{R.store.isEditing() ? <Button size="sm" variant="ghost" onClick={() => R.store.removeCard(c.id)}>{t('edit.remove')}</Button> : null}</div></section>}>
        <CardInner c={c} />
      </Boundary>
    </CardCtx.Provider>
  )
}

function Gallery() {
  const t = useT(), dlg = useValue($dlg), open = dlg?.kind === 'gallery'
  const [q, setQ] = useState(''), [sizes, setSizes] = useState({}), [said, setSaid] = useState('')
  useEffect(() => { if (open) { setQ(''); setSaid('') } }, [open])
  const inView = R.store.activeView().cards.map(c => baseId(c.id))
  const list = CARDS.filter(c => !q || (t('card.' + c.id) + ' ' + t('desc.' + c.id)).toLowerCase().includes(q.toLowerCase()))
  // One button per tile toggles Add / Remove in place, so keyboard focus stays on it; the line below announces the change inside the dialog (the page behind is inert).
  const toggle = (c, size) => {
    const r = c.multi ? R.store.addCard(c.id, size) : R.store.toggleCard(c.id, size), on = !!r
    if (r === null || (c.multi && !on)) return // shortcut: at the 12-instance cap nothing is announced, there is no text for it; add a key if wanted
    setSaid(t(on ? 'gal.addedL' : 'gal.removedL', { card: t('card.' + c.id) }))
    if (on) reveal(typeof r === 'string' ? r : c.id)
  }
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) $dlg.set(null) }}>
      <DialogContent className="ht-dlg sm:max-w-3xl">
        <DialogHeader className="ht-dh"><DialogTitle>{t('gal.title')}</DialogTitle><DialogDescription>{t('gal.hint')}</DialogDescription></DialogHeader>
        <SearchField placeholder={t('gal.search')} value={q} onChange={setQ} />
        <p className="ht-vh" role="status">{said}</p>
        <div className="ht-gal">
          {list.length ? list.map(c => {
            const have = inView.includes(c.id), added = have && !c.multi, size = sizes[c.id] || c.defaultSize
            return (
              <div key={c.id} className="ht-gal-i">
                <p className="ht-gal-h"><Icon name={c.icon} />{t('card.' + c.id)}</p>
                <p className="ht-gal-d">{t('desc.' + c.id)}</p>
                <div className="ht-gal-a">
                  {c.sizes.length > 1 && !added ? <div role="group" aria-label={`${t('edit.size')}: ${t('card.' + c.id)}`}><SegmentedControl options={c.sizes.map(s => ({ id: s, label: t('size.' + s) }))} value={size} onChange={s => setSizes({ ...sizes, [c.id]: s })} /></div> : <span className="ht-sec">{added ? <Icon name="check" /> : null}{added ? t('gal.added') : t('size.' + c.defaultSize)}</span>}
                  <Button size="sm" variant={added ? 'outline' : 'default'} onClick={() => toggle(c, size)} aria-label={t(added ? 'gal.removeL' : 'gal.addL', { card: t('card.' + c.id) })}>{added ? t('gal.remove') : t(have ? 'gal.addAnother' : 'act.add')}</Button>
                </div>
              </div>
            )
          }) : <p className="ht-empty">{t('gal.none')}</p>}
        </div>
        <DialogFooter><Button onClick={() => $dlg.set(null)}>{t('act.done')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Signed-in providers (no `hermes usage` run just to fill this list), ticked = shown. Nothing ticked (or all) is stored as "all" (no option).
function ProviderPick({ c }) {
  const t = useT(), usage = useModels(), all = (usage.data?.providers || []).filter(p => p.authenticated)
  const sel = c.options.providers
  const on = slug => !sel || sel.includes(slug)
  const set = (slug, yes) => { const base = sel || all.map(u => u.slug), next = yes ? [...new Set([...base, slug])] : base.filter(x => x !== slug); R.store.setOptions(c.id, { providers: next.length === all.length || !next.length ? null : next }) }
  return (
    <fieldset className="ht-fld" style={{ border: 0 }}><legend className="ht-fld-l">{t('opt.providers')}</legend>
      {usage.isLoading ? <span>{t('u.loading')}</span> : !all.length ? <span>{t('opt.noProviders')}</span> : <div className="ht-checks">
        {all.map(u => <label key={u.slug} className="ht-check"><Checkbox checked={on(u.slug)} onCheckedChange={yes => set(u.slug, !!yes)} /><Auto>{u.name || u.title || u.slug}</Auto></label>)}
      </div>}
      <span>{t('opt.providersD')}</span>
    </fieldset>
  )
}

// Warning threshold, 50-99 %. Saved when the number is valid; the field shows the default when none is set.
function WarnField({ c, k }) {
  const t = useT()
  return <label className="ht-fld"><span className="ht-fld-l">{t('opt.' + k)}</span>
    <SaveInput inputMode="numeric" dir="ltr" style={{ inlineSize: '6rem' }} saved={String(c.options[k] ?? WARN.def)} aria-describedby={`ht-w-${k}`}
      onSave={(v, auto) => { const n = Number(v); const ok = Number.isInteger(n) && n >= WARN.min && n <= WARN.max; if (!ok && auto) return; if (ok) R.store.setOptions(c.id, { [k]: n === WARN.def ? null : n }); return String(ok ? n : c.options[k] ?? WARN.def) }} />
    <span id={`ht-w-${k}`}>{t('opt.warnD')}</span></label>
}

// Cron jobs by name; one control for the card options and the first-run offer.
function JobSelect({ jobs, value, onChange, label, ...rest }) {
  const t = useT()
  if (!jobs.length) return <span>{t('jr.noJobs')}</span>
  return (
    <Select value={value || ''} onValueChange={onChange}>
      <SelectTrigger aria-label={label} {...rest}><SelectValue placeholder={t('jr.pick')} /></SelectTrigger>
      <SelectContent>{jobs.map(j => <SelectItem key={j.job_id} value={j.job_id}>{j.name || j.job_id}</SelectItem>)}</SelectContent>
    </Select>
  )
}

// One-time offer to add the first Job result card. Shown only when there is a job to show and none was added yet.
function JobOffer() {
  const t = useT(), doc = useDoc(), q = useCron(), [pick, setPick] = useState('')
  const jobs = (q.data || []).filter(j => !doc.prefs.hideInternal || !isInternalJob(j))
  if (doc.prefs.jobOfferDismissed || !jobs.length || doc.views.some(v => v.cards.some(c => baseId(c.id) === 'job-result'))) return null
  const job = jobs.some(j => j.job_id === pick) ? pick : jobs[0].job_id
  const add = () => { const id = R.store.addCard('job-result', undefined, { job }); R.store.setPref('jobOfferDismissed', true); if (id) reveal(id, true) }
  return (
    <div className="ht-banner" data-kind="hint" data-offer="job-result" role="region" aria-labelledby="ht-offer-t">
      <Icon name="sparkle" />
      <span><strong id="ht-offer-t">{t('ob.jobT')}</strong> {t('ob.jobD')}</span>
      <JobSelect jobs={jobs} value={job} onChange={setPick} label={t('opt.job')} className="ht-ctl" />
      <Button size="sm" data-act="jr-add" onClick={add}>{t('ob.jobAdd')}</Button>
      <Button size="sm" variant="ghost" data-act="jr-skip" onClick={() => R.store.setPref('jobOfferDismissed', true)}>{t('ob.skip')}</Button>
    </div>
  )
}

function CardOptions() {
  const t = useT(), dlg = useValue($dlg), cron = useCron()
  useDoc() // re-render when the doc changes
  const id = dlg?.kind === 'options' ? dlg.id : null
  const c = id ? R.store.activeView().cards.find(x => x.id === id) : null
  const focusBack = useReturnFocus(!!c, () => document.querySelector(`[data-ht-cm="${id}"]`))
  if (!c) return null
  const def = getCard(c.id), fields = def.options.find(o => o.key === 'fields')
  const sel = c.options.fields || fields?.choices || []
  return (
    <Dialog open onOpenChange={o => { if (!o) $dlg.set(null) }}>
      <DialogContent className="ht-dlg" onCloseAutoFocus={focusBack}>
        <DialogHeader className="ht-dh"><DialogTitle>{t('opt.title')}: <Auto>{cardTitle(c, t)}</Auto></DialogTitle></DialogHeader>
        <div className="ht-form">
          <label className="ht-fld"><span className="ht-fld-l">{t('opt.name')}</span><SaveInput dir="auto" saved={c.options.title || ''} placeholder={t('card.' + baseId(c.id))} maxLength={40} onSave={v => { R.store.setOptions(c.id, { title: v.trim() || null }); return v.trim() }} /></label>
          <div className="ht-fld"><span className="ht-fld-l" id="ht-o-density">{t('opt.density')}</span>
            <div role="group" aria-labelledby="ht-o-density"><SegmentedControl options={[{ id: 'comfortable', label: t('opt.comfortable') }, { id: 'compact', label: t('opt.compact') }]} value={c.options.density || 'comfortable'} onChange={v => R.store.setOptions(c.id, { density: v === 'compact' ? 'compact' : null })} /></div>
          </div>
          {fields ? <fieldset className="ht-fld" style={{ border: 0 }}><legend className="ht-fld-l">{t('opt.fields')}</legend><div className="ht-checks">
            {fields.choices.map(f => (
              <label key={f} className="ht-check"><Checkbox checked={sel.includes(f)} onCheckedChange={on => { const next = on ? [...new Set([...sel, f])] : sel.filter(x => x !== f); R.store.setOptions(c.id, { fields: next.length === fields.choices.length ? null : next }) }} />{t('f.' + f)}</label>
            ))}
          </div></fieldset> : null}
          {hasOption(c.id, 'job') ? <label className="ht-fld"><span className="ht-fld-l">{t('opt.job')}</span><JobSelect jobs={cron.data || []} value={c.options.job} onChange={job => R.store.setOptions(c.id, { job })} label={t('opt.job')} data-opt="job" /></label> : null}
          {hasOption(c.id, 'providers') ? <ProviderPick c={c} /> : null}
          {def.options.filter(o => o.type === 'pct').map(o => <WarnField key={o.key} c={c} k={o.key} />)}
          {hasOption(c.id, 'pinnedOnly') ? <div className="ht-fld"><span className="ht-fld-l" id="ht-o-show">{t('opt.show')}</span>
            <div role="group" aria-labelledby="ht-o-show"><SegmentedControl options={[{ id: 'all', label: t('opt.allJobs') }, { id: 'pinned', label: t('opt.onlyPinned') }]} value={c.options.pinnedOnly ? 'pinned' : 'all'} onChange={v => R.store.setOptions(c.id, { pinnedOnly: v === 'pinned' ? true : null })} /></div><span>{t('opt.pinnedD')}</span>
          </div> : null}
          {hasOption(c.id, 'range') ? <div className="ht-fld"><span className="ht-fld-l" id="ht-o-range">{t('opt.range')}</span>
            <div role="group" aria-labelledby="ht-o-range"><SegmentedControl options={[{ id: 'follow', label: t('range.follow') }, ...RANGES.map(r => ({ id: r, label: t('range.' + r) }))]} value={c.options.range || 'follow'} onChange={v => R.store.setOptions(c.id, { range: v === 'follow' ? null : v })} /></div>
          </div> : null}
        </div>
        <p className="ht-set-d">{t('opt.saved')}</p>
        <DialogFooter><Button variant="outline" onClick={() => R.store.resetCard(c.id)}>{t('opt.reset')}</Button><Button onClick={() => $dlg.set(null)}>{t('act.done')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DashboardPage() {
  const t = useT(), doc = useDoc(), editing = useValue($editing), msg = useValue($announce), sync = useValue($sync)
  useMounted()
  const [, tick] = useReducer(n => n + 1, 0)
  useEffect(() => R.ctx.setInterval(tick, 30000), []) // keeps "Updated 2m ago", the greeting and the date current
  // Opening the page starts on the chosen view; 'last' keeps whichever was active.
  useEffect(() => { const sv = R.store.get().prefs.startView; if (sv !== 'last' && !R.store.isEditing()) R.store.setActiveView(sv) }, [])
  // Edit mode in: focus the edit bar's first control; out: back to the Edit button. Only when focus is not somewhere else (a dialog, a field).
  const wasEditing = useRef(editing)
  useEffect(() => {
    if (wasEditing.current === editing) return
    wasEditing.current = editing
    const a = document.activeElement
    if (a && a !== document.body && !a.closest(editing ? '[data-edit-btn]' : '.ht-editbar')) return
    R.ctx.setTimeout(() => document.querySelector(editing ? '.ht-editbar button' : '.ht-hero [data-edit-btn]')?.focus(), 0)
  }, [editing])
  if (!doc) return null
  const view = doc.views.find(v => v.id === doc.activeView) || doc.views[0]
  return (
    <div className={`ht${editing ? ' ht-editing' : ''}`} data-ht-root="">
      <div className="ht-in">
        <Header />
        {sync.backend === 'off' ? <p className="ht-banner" role="status"><Icon name="plug" /><span>{t('st.backend')}</span></p> : null}
        {!doc.prefs.hintDismissed && !editing ? <p className="ht-banner" data-kind="hint" role="note"><Icon name="sparkle" /><span>{t('hint.first')}</span><Button variant="ghost" size="icon-xs" aria-label={t('act.dismiss')} title={t('act.dismiss')} onClick={() => R.store.setPref('hintDismissed', true)}><Icon name="close" /></Button></p> : null}
        {!editing ? <JobOffer /> : null}
        <QuickLaunch />
        <ViewTabs />
        {editing ? <EditBar /> : null}
        <div className="ht-grid" id="ht-grid" role="tabpanel" aria-labelledby={`ht-tab-${view.id}`}>
          {view.cards.map(c => <CardFrame key={c.id} c={c} />)}
        </div>
        {!view.cards.length ? <p className="ht-empty">{t('view.empty')} <button type="button" className="ht-link" onClick={() => { R.store.beginEdit(); $dlg.set({ kind: 'gallery' }) }}>{t('gal.title')}</button></p> : null}
      </div>
      <div className="ht-vh" aria-live="polite" role="status">{msg ? t(msg.key, msg.vars) : ''}</div>
      <Gallery />
      <CardOptions />
      <NewViewDialog />
      <ViewMenuDialogs />
    </div>
  )
}

// Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z while editing. Not while typing in a field.
export function onEditKeys(e) {
  if (!R.store.isEditing() || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || !document.querySelector('[data-ht-root]')) return
  if (e.target.closest?.('input, textarea, [contenteditable="true"]')) return
  e.preventDefault()
  if (e.shiftKey) R.store.redo(); else R.store.undo()
}
