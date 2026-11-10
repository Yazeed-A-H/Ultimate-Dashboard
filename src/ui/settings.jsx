// Settings ▸ Plugins ▸ Ultimate Dashboard: General (landing), Quick launch, Pinned scheduled jobs, Layouts.
import {
  Button, Checkbox, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DropdownMenu,
  DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, host, Input, ListRow, ModelCatalogMenu, ModelMenuCloseContext,
  SearchField, SegmentedControl, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, ToggleRow, useValue, writeClipboardText
} from '@hermes/plugin-sdk'
import { useEffect, useMemo, useRef, useState } from 'react'
import { comboFromEvent, comboLabel, IS_MAC, isInternalJob, scheduleRaw, scheduleText, shortcutDraft, shortcutLabel, modelText } from '../state/format.js'
import { NAV_ICONS, REFRESH } from '../state/store.js'
import { useCron, useModels, useSkills } from './data.js'
import { Icon } from './icon.jsx'
import { viewName } from './page.jsx'
import { Confirm, ModelName, SaveInput, latin, useReturnFocus } from './parts.jsx'
import { $sync, R, useDoc, useLocale, useMounted, useT } from './runtime.js'

const Sec = ({ title, desc, children }) => <section className="ht-set-sec">{title ? <h3>{title}</h3> : null}{desc ? <p className="ht-set-d">{desc}</p> : null}{children}</section>
const Wrap = ({ children }) => { useMounted(); return <div className="ht ht-set" style={{ blockSize: 'auto', overflow: 'visible' }}>{children}</div> }

// Up / down pair. aria-disabled (not disabled) at the ends, so the button that was just pressed keeps keyboard focus.
function MoveBtns({ i, n, name, onMove }) {
  const t = useT()
  return <>
    <Button size="icon-xs" variant="ghost" className="ht-off" aria-disabled={i === 0 || undefined} onClick={() => { if (i > 0) onMove(i - 1) }} aria-label={`${t('act.moveUp')}: ${name}`}><Icon name="arrow-up" /></Button>
    <Button size="icon-xs" variant="ghost" className="ht-off" aria-disabled={i === n - 1 || undefined} onClick={() => { if (i < n - 1) onMove(i + 1) }} aria-label={`${t('act.moveDown')}: ${name}`}><Icon name="arrow-down" /></Button>
  </>
}

// Text pref: saves on blur, Enter or after a short pause.
function TextPref({ k, placeholder, max, label }) {
  const doc = useDoc()
  return <SaveInput saved={doc.prefs[k]} aria-label={label} placeholder={placeholder} maxLength={max} dir="auto" className="ht-ctl" onSave={v => { R.store.setPref(k, v) }} />
}

// Records a Cmd/Ctrl combo. Hermes owns its built-in keys and wins a clash; this plugin only refuses its own duplicates.
function KeyField({ value, onChange, exceptId, label }) {
  const t = useT(), [rec, setRec] = useState(false), [err, setErr] = useState('')
  useEffect(() => {
    if (!rec) return
    R.recording = true // Hermes' dispatcher sees the keys first; our own shortcuts must not fire while one is being recorded
    const on = e => {
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return
      if (e.key === 'Tab') { setRec(false); return } // focus moves on, so recording ends with it
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setRec(false); setErr(''); return }
      if (e.key === 'Backspace' && !e.metaKey && !e.ctrlKey && !e.altKey) { setRec(false); setErr(''); onChange(''); return }
      const c = comboFromEvent(e, IS_MAC)
      if (!c) setErr(t('s.keyNeeds'))
      else if (c !== value && R.store.keyTaken(c, exceptId)) setErr(t('s.keyTaken'))
      else { setErr(''); setRec(false); onChange(c) }
    }
    const off = R.ctx.addEventListener(window, 'keydown', on, true)
    return () => { off(); R.recording = false }
  }, [rec, exceptId])
  return (
    <span className="ht-keyf">
      <span className="ht-keyf-r">
        <kbd className="ht-kbd" dir="auto" aria-live="polite" data-rec={rec || undefined}>{rec ? t('s.keyPress') : value ? comboLabel(value, IS_MAC) : t('s.keyNone')}</kbd>
        <Button type="button" size="sm" variant="outline" aria-pressed={rec} onClick={() => { setRec(!rec); setErr('') }} aria-label={`${label}: ${rec ? t('s.keyStop') : t('s.keyRecord')}`}>{rec ? t('s.keyStop') : t('s.keyRecord')}</Button>
        {value && !rec ? <Button type="button" size="sm" variant="ghost" onClick={() => { onChange(''); setErr('') }} aria-label={`${label}: ${t('s.keyClear')}`}>{t('s.keyClear')}</Button> : null}
      </span>
      {err ? <span className="ht-keyf-e" role="alert">{err}</span> : null}
    </span>
  )
}

export function General() {
  const t = useT(), doc = useDoc(), sync = useValue($sync)
  const startOpts = [{ id: 'last', label: t('s.startLast') }, ...doc.views.map(v => ({ id: v.id, label: viewName(v, t) }))]
  return (
    <Wrap>
      <ListRow title={t('s.name')} description={t('s.nameD')} action={<TextPref k="name" max={60} label={t('s.name')} />} />
      <ListRow title={t('s.refresh')} description={t('s.refreshD')} action={
        <Select value={doc.prefs.refresh} onValueChange={v => R.store.setPref('refresh', v)}>
          <SelectTrigger className="ht-ctl" aria-label={t('s.refresh')}><SelectValue className="ht-sv" /></SelectTrigger>
          <SelectContent>{REFRESH.map(r => <SelectItem key={r} value={r}>{t('r.' + r)}</SelectItem>)}</SelectContent>
        </Select>} />
      <ListRow title={t('s.start')} description={t('s.startD')} action={
        <Select value={doc.prefs.startView} onValueChange={v => R.store.setPref('startView', v)}>
          <SelectTrigger className="ht-ctl" aria-label={t('s.start')}><SelectValue className="ht-sv" /></SelectTrigger>
          <SelectContent>{startOpts.map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}</SelectContent>
        </Select>} />
      <ToggleRow label={t('s.showGreet')} description={t('s.showGreetD')} checked={!doc.prefs.hideGreeting} onChange={on => R.store.setPref('hideGreeting', !on)} />
      <ListRow title={t('s.openKey')} description={latin(t('s.openKeyD'))} action={<KeyField value={doc.prefs.openKey} onChange={k => R.store.setPref('openKey', k)} label={t('s.openKey')} />} />
      <ToggleRow label={t('s.notify')} description={t('s.notifyD')} checked={doc.prefs.notifyApprovals} onChange={on => R.store.setPref('notifyApprovals', on)} />
      <ListRow title={t('s.navLabel')} description={t('s.navLabelD', { def: t('nav') })} action={<TextPref k="navLabel" placeholder={t('nav')} max={40} label={t('s.navLabel')} />} />
      <ListRow title={t('s.navIcon')} action={
        <Select value={doc.prefs.navIcon} onValueChange={v => R.store.setPref('navIcon', v)}>
          <SelectTrigger className="ht-ctl" aria-label={t('s.navIcon')}><SelectValue className="ht-sv" /></SelectTrigger>
          <SelectContent>{NAV_ICONS.map(n => <SelectItem key={n} value={n}><span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}><i className={`codicon codicon-${n}`} aria-hidden="true" />{t('icon.' + n)}</span></SelectItem>)}</SelectContent>
        </Select>} />
      <ListRow title={t('s.tips')} description={t('s.tipsD')} action={<Button size="sm" variant="outline" className="ht-off" aria-disabled={!(doc.prefs.hintDismissed || doc.prefs.jobOfferDismissed) || undefined} onClick={() => { if (!(doc.prefs.hintDismissed || doc.prefs.jobOfferDismissed)) return; R.store.setPref('hintDismissed', false); R.store.setPref('jobOfferDismissed', false); host.notify({ kind: 'success', message: t('s.done') }) }}>{t('s.tipsShow')}</Button>} />
      <ListRow title={t('s.sync')} description={[sync.backend === 'on' ? t('s.syncOn', { v: sync.version || '?' }) : sync.backend === 'off' ? t('st.backend') : t('st.loading'), sync.error && sync.backend !== 'off' ? t('s.syncErr', { err: sync.error }) : ''].filter(Boolean).join(' ')} />
      <ListRow title={t('s.about')} description={t('s.aboutD')} />
    </Wrap>
  )
}

// Hermes' own catalog menu (SDK): provider groups, search, keyboard, current mark; a copy would drift from the composer.
function ModelSelect({ value, onChange, label }) {
  const t = useT(), models = useModels(), [open, setOpen] = useState(false)
  const cur = value?.model ? { model: value.model, provider: value.provider || '' } : { model: '', provider: '' }
  const text = modelText(value, models.data?.providers) || t('s.hermesDefault')
  const pick = (model, provider) => onChange({ provider: provider || null, model })
  // Effort / speed edits are not stored on a shortcut; choosing one inside a row still picks that model.
  const controller = { allowSpeed: false, applyPreset: () => {}, presetFor: () => ({}), current: { effort: '', fast: false, ...cur }, select: pick, setOptions: (_, row) => pick(row.model, row.provider) }
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="ht-model-btn" aria-label={`${label}: ${text}`} title={text}>
          <bdi dir="auto">{text}</bdi><Icon name="chevron-down" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-0">
        <ModelMenuCloseContext.Provider value={() => setOpen(false)}>
          <ModelCatalogMenu controller={controller} header={
            <DropdownMenuItem onSelect={() => onChange(null)} aria-current={!cur.model || undefined}>
              <span style={{ flex: 1 }}>{t('s.hermesDefault')}</span>{cur.model ? null : <Icon name="check" />}
            </DropdownMenuItem>} />
        </ModelMenuCloseContext.Provider>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ShortcutDialog({ sc, onClose }) {
  const t = useT(), skills = useSkills(), focusBack = useReturnFocus(true) // mounted only while open
  const [skill, setSkill] = useState(sc?.skill || ''), [label, setLabel] = useState(sc?.label || '')
  const [model, setModel] = useState(sc?.model ? { provider: sc.provider, model: sc.model } : null), [prompt, setPrompt] = useState(sc?.prompt || '')
  const [target, setTarget] = useState(sc?.target || 'new'), [key, setKey] = useState(sc?.key || '')
  const [q, setQ] = useState('')
  const list = (skills.data || []).filter(s => s.enabled !== false && (!q || `${s.name} ${s.description || ''}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 80)
  const stop = list.some(s => s.name === skill) ? skill : '' // the one tab stop of the list: the chosen skill, else "No skill"
  const pickKey = e => { // Arrows, Home, End move between options; Enter / Space choose (they click the focused button)
    const els = [...e.currentTarget.querySelectorAll('[role=option]')], i = els.indexOf(document.activeElement)
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : -1
    if (i < 0 || n < 0) return
    e.preventDefault(); els[Math.max(0, Math.min(els.length - 1, n))].focus()
  }
  const save = () => {
    const x = { skill, label, prompt, target, key, provider: model?.provider || null, model: model?.model || null }
    const ok = sc ? R.store.updateShortcut(sc.id, x) : R.store.addShortcut(x)
    if (ok) onClose()
  }
  return (
    <Dialog open onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="ht-dlg ht-dlg-form" onCloseAutoFocus={focusBack}>
        <DialogHeader className="ht-dh"><DialogTitle>{t(sc ? 's.editShortcut' : 's.addShortcut')}</DialogTitle></DialogHeader>
        <form className="ht-form ht-form-sticky" onSubmit={e => { e.preventDefault(); save() }}>
          <div className="ht-form-body">
            <label className="ht-fld"><span className="ht-fld-l">{t('s.prompt')}</span><Textarea className="ht-textarea ht-prompt" value={prompt} maxLength={2000} rows={4} dir="auto" autoFocus onChange={e => setPrompt(e.target.value)} aria-describedby="ht-pr-d" /><span id="ht-pr-d">{t('s.promptD')}</span></label>
            <div className="ht-fld"><span className="ht-fld-l" id="ht-sk-l">{t('s.skill')}</span>
              <SearchField placeholder={t('s.skillSearch')} value={q} onChange={setQ} />
              <div className="ht-list-pick" role="listbox" aria-labelledby="ht-sk-l" onKeyDown={pickKey}>
                <button type="button" role="option" tabIndex={stop === '' ? 0 : -1} aria-selected={!skill} onClick={() => setSkill('')}><span>{t('s.noSkill')}</span>{skill ? null : <Icon name="check" className="ht-pick-ck" />}</button>
                {list.map(s => <button type="button" role="option" key={s.name} tabIndex={s.name === stop ? 0 : -1} aria-selected={s.name === skill} title={s.description ? `/${s.name}: ${s.description}` : `/${s.name}`} onClick={() => setSkill(s.name)}><bdi dir="ltr">/{s.name}</bdi>{s.name === skill ? <Icon name="check" className="ht-pick-ck" /> : null}{s.description ? <small dir="auto">{s.description}</small> : null}</button>)}
              </div>
            </div>
            <label className="ht-fld"><span className="ht-fld-l">{t('s.label')}</span><Input dir="auto" value={label} maxLength={40} placeholder={shortcutLabel({ skill, prompt })} onChange={e => setLabel(e.target.value)} /><span>{t('s.labelD')}</span></label>
            {skill || prompt.trim() ? <div className="ht-fld"><span className="ht-fld-l">{t('s.preview')}</span><p className="ht-prev" dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{shortcutDraft({ skill, prompt: prompt.trim() })}</p></div> : <p className="ht-set-d" role="status">{t('s.needsContent')}</p>}
            <details className="ht-adv">
              <summary>{t('s.advanced')}</summary>
              <div className="ht-form">
                <div className="ht-fld"><span className="ht-fld-l">{t('s.model')}</span><ModelSelect value={model} onChange={setModel} label={t('s.model')} /></div>
                <div className="ht-fld"><span className="ht-fld-l" id="ht-sc-target">{t('s.target')}</span>
                  <div role="group" aria-labelledby="ht-sc-target"><SegmentedControl options={[{ id: 'new', label: t('s.targetNew') }, { id: 'current', label: t('s.targetCurrent') }]} value={target} onChange={setTarget} /></div><span>{t('s.targetD')}</span></div>
                <div className="ht-fld"><span className="ht-fld-l">{t('s.key')}</span><KeyField value={key} onChange={setKey} exceptId={sc?.id} label={t('s.key')} /><span>{t('s.keyD')}</span></div>
              </div>
            </details>
          </div>
          <DialogFooter className="ht-form-foot"><Button type="button" variant="outline" onClick={onClose}>{t('act.cancel')}</Button><Button type="submit" disabled={!skill && !prompt.trim()}>{t('act.save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function QuickLaunchPage() {
  const t = useT(), doc = useDoc(), [edit, setEdit] = useState(null) // null | 'new' | shortcut
  const list = doc.shortcuts
  const removeShortcut = (sc, i) => {
    if (!R.store.deleteShortcut(sc.id)) return
    // The key may have been given to another shortcut meanwhile; then it comes back without it.
    const undo = () => { const id = R.store.addShortcut(sc) || R.store.addShortcut({ ...sc, key: '' }); if (id) R.store.moveShortcut(id, i) }
    host.notify({ kind: 'info', message: t('s.removed', { name: shortcutLabel(sc) }), durationMs: 8000, action: { label: t('act.undo'), onClick: undo } })
  }
  return (
    <Wrap>
      <ListRow title={t('s.defModel')} description={t('s.defModelD')} action={<ModelSelect value={doc.prefs.defaultModel} onChange={m => R.store.setPref('defaultModel', m)} label={t('s.defModel')} />} />
      <Sec title={t('s.shortcuts')} desc={t('s.shortcutsD')}>
        {list.length ? <ol aria-label={t('s.shortcuts')}>{list.map((sc, i) => (
          <li key={sc.id} className="ht-sc">
            <Icon name="sparkle" />
            <span className="ht-sc-x"><span className="ht-sc-l"><bdi dir="auto">{shortcutLabel(sc)}</bdi></span><span className="ht-sc-m"><bdi dir="auto" style={{ whiteSpace: 'pre-wrap' }}>{shortcutDraft(sc).trim().slice(0, 120)}</bdi>{sc.model ? <> · <ModelName model={sc.model} /></> : null}{sc.target === 'current' ? ` · ${t('s.targetCurrent')}` : ''}{sc.key ? <> · <bdi dir="ltr">{comboLabel(sc.key, IS_MAC)}</bdi></> : null}</span></span>
            <MoveBtns i={i} n={list.length} name={shortcutLabel(sc)} onMove={j => R.store.moveShortcut(sc.id, j)} />
            <Button size="sm" variant="ghost" onClick={() => setEdit(sc)} aria-label={`${t('act.edit')}: ${shortcutLabel(sc)}`}>{t('act.edit')}</Button>
            <Button size="sm" variant="ghost" onClick={() => removeShortcut(sc, i)} aria-label={`${t('act.delete')}: ${shortcutLabel(sc)}`}><Icon name="trash" /></Button>
          </li>))}</ol> : <p className="ht-set-d">{t('s.noShortcuts')}</p>}
        <div><Button size="sm" onClick={() => setEdit('new')}><Icon name="add" /><span>{t('s.addShortcut')}</span></Button></div>
      </Sec>
      {edit ? <ShortcutDialog sc={edit === 'new' ? null : edit} onClose={() => setEdit(null)} /> : null}
    </Wrap>
  )
}

export function PinnedPage() {
  const t = useT(), locale = useLocale(), doc = useDoc(), cron = useCron(), [q, setQ] = useState('')
  const hide = doc.prefs.hideInternal, pins = new Set(doc.pinnedCron), all = cron.data || []
  // Internal one-shot jobs leave the pick list, but a job you already pinned stays (so it can be unpinned).
  const jobs = all.filter(j => (!hide || !isInternalJob(j) || pins.has(j.job_id)) && (!q || `${j.name} ${scheduleRaw(j)} ${scheduleText(j, locale, t)}`.toLowerCase().includes(q.toLowerCase())))
  const toggle = (id, on) => R.store.setPinnedCron(on ? [...doc.pinnedCron, id] : doc.pinnedCron.filter(x => x !== id))
  const byId = new Map(all.map(j => [j.job_id, j]))
  return (
    <Wrap>
      <ToggleRow label={t('s.hideInt')} description={t('s.hideIntD')} checked={hide} onChange={on => R.store.setPref('hideInternal', on)} />
      <Sec desc={t('s.pinnedD')}>
        <SearchField variant="box" placeholder={t('s.searchJobs')} value={q} onChange={setQ} />
        {cron.isLoading ? <p className="ht-set-d">{t('st.loading')}</p> : cron.error ? <p className="ht-set-d">{t('st.error')}: {String(cron.error.message || cron.error)}</p> : !all.length ? <p className="ht-set-d">{t('s.noJobs')}</p> : (
          <div className="ht-list-pick" style={{ maxBlockSize: '28rem' }}>
            {jobs.map(j => (
              <label key={j.job_id} className="ht-job">
                <Checkbox checked={pins.has(j.job_id)} onCheckedChange={on => toggle(j.job_id, !!on)} />
                <span className="ht-job-x"><bdi dir="auto">{j.name || j.job_id}</bdi><small className="ht-sec" dir="auto" title={scheduleRaw(j)}>{scheduleText(j, locale, t)}</small></span>
              </label>))}
          </div>)}
      </Sec>
      <Sec title={t('s.order')} desc={t('s.orderD')}>
        {doc.pinnedCron.length ? <ol aria-label={t('s.order')}>{doc.pinnedCron.map((id, i) => {
          const name = byId.get(id)?.name || id
          return (
            <li key={id} className="ht-sc">
              <span className="ht-sc-x"><span className="ht-sc-l"><bdi dir="auto">{name}</bdi></span></span>
              <MoveBtns i={i} n={doc.pinnedCron.length} name={name} onMove={j => R.store.movePinned(id, j)} />
            </li>)
        })}</ol> : <p className="ht-set-d">{t('s.noPinned')}</p>}
      </Sec>
    </Wrap>
  )
}

function ViewRow({ v, i, n, confirm, say }) {
  const t = useT(), name = viewName(v, t)
  // An empty name restores the default (translated for built-in views) and the field shows it.
  const save = val => { R.store.renameView(v.id, val); return viewName(v, t) }
  return (
    <li className="ht-sc">
      <span className="ht-sc-x"><SaveInput dir="auto" saved={name} maxLength={40} aria-label={`${t('act.rename')}: ${name}`} onSave={save} /></span>
      <MoveBtns i={i} n={n} name={name} onMove={j => { if (R.store.moveView(v.id, j)) say(t('edit.moved', { card: name, pos: j + 1, total: n })) }} />
      <Button size="sm" variant="ghost" disabled={n <= 1} onClick={e => { const b = e.currentTarget, ol = b.closest('ol'); confirm(t('s.deleteViewQ', { name }), t('s.deleteViewD'), t('act.delete'), () => R.store.deleteView(v.id), () => (b.isConnected ? null : ol.querySelector('input'))) }} aria-label={`${t('act.delete')}: ${name}`}><Icon name="trash" /></Button>
    </li>
  )
}

export function LayoutsPage() {
  const t = useT(), doc = useDoc()
  const [tplName, setTplName] = useState(''), [exportText, setExportText] = useState(''), [imp, setImp] = useState('')
  const [said, setSaid] = useState('')
  const [impMsg, setImpMsg] = useState(null), [ask, setAsk] = useState(null) // the one open confirmation: { title, description, label, run }
  const back = useRef(null) // where focus goes when the opener is gone (a deleted row); the dialog reads it after `ask` is cleared
  const confirm = (title, description, label, run, focus) => { back.current = focus; setAsk({ title, description, label, run }) }
  const done = () => host.notify({ kind: 'success', message: t('s.done') })
  const active = doc.views.find(v => v.id === doc.activeView)
  const doExport = async () => {
    const json = R.store.exportJSON()
    try { await writeClipboardText(json); setExportText(''); host.notify({ kind: 'success', message: t('s.copied') }) } catch { setExportText(json) }
  }
  const tryImport = () => {
    const r = R.store.importJSON(imp)
    if (!r.ok) { setImpMsg({ kind: 'error', text: t('imp.' + r.error) }); return }
    setImp(''); setImpMsg({ kind: 'ok', text: t('s.imported') + (r.ignored.length ? ' ' + t('s.ignored', { n: r.ignored.length }) : '') })
  }
  const tpls = useMemo(() => R.store.templates(), [doc.templates])
  const removeTemplate = x => {
    if (!R.store.deleteTemplate(x.id)) return
    host.notify({ kind: 'info', message: t('s.removed', { name: x.name }), durationMs: 8000, action: { label: t('act.undo'), onClick: () => R.store.restoreTemplate(x) } })
  }
  return (
    <Wrap>
      <Sec title={t('s.views')} desc={t('s.viewsD')}>
        <ol>{doc.views.map((v, i) => <ViewRow key={v.id} v={v} i={i} n={doc.views.length} confirm={confirm} say={m => { setSaid(m); R.ctx.setTimeout(() => setSaid(''), 3000) }} />)}</ol>
        <div className="ht-vh" role="status" aria-live="polite">{said}</div>
      </Sec>
      <Sec title={t('s.templates')} desc={t('s.templatesD')}>
        <ul>{tpls.map(x => (
          <li key={x.id} className="ht-sc">
            <span className="ht-sc-x"><span className="ht-sc-l">{x.builtIn ? t('tpl.' + x.id) : <bdi dir="auto">{x.name}</bdi>}</span></span>
            <Button size="sm" variant="outline" onClick={() => confirm(t('s.applyTplQ', { name: active ? viewName(active, t) : '' }), t('s.applyTplD'), t('s.applyTpl'), () => { R.store.applyTemplate(x.id); done() })} aria-label={`${t('s.applyTpl')}: ${x.builtIn ? t('tpl.' + x.id) : x.name}`}>{t('s.applyTpl')}</Button>
            {x.builtIn ? null : <Button size="sm" variant="ghost" onClick={() => removeTemplate(x)} aria-label={`${t('act.delete')}: ${x.name}`}><Icon name="trash" /></Button>}
          </li>))}</ul>
        <form style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }} onSubmit={e => { e.preventDefault(); if (R.store.saveTemplate(tplName || viewName(active, t))) { setTplName(''); host.notify({ kind: 'success', message: t('s.done') }) } }}>
          <Input dir="auto" value={tplName} maxLength={40} placeholder={viewName(active, t)} aria-label={t('s.tplName')} onChange={e => setTplName(e.target.value)} style={{ inlineSize: '16rem', maxInlineSize: '100%' }} />
          <Button size="sm" type="submit"><Icon name="save" /><span>{t('s.saveTpl')}</span></Button>
        </form>
      </Sec>
      <Sec title={t('s.export')} desc={t('s.exportD')}>
        <div><Button size="sm" variant="outline" onClick={doExport}><Icon name="copy" /><span>{t('s.export')}</span></Button></div>
        {exportText ? <><p className="ht-set-d" role="status">{t('s.copyFail')}</p><Textarea className="ht-textarea" readOnly value={exportText} onFocus={e => e.target.select()} autoFocus aria-label={t('s.export')} /></> : null}
      </Sec>
      <Sec title={t('s.import')} desc={t('s.importD')}>
        <Textarea className="ht-textarea" value={imp} onChange={e => { setImp(e.target.value); setImpMsg(null) }} aria-label={t('s.import')} dir="ltr" />
        {impMsg ? <p className="ht-set-d" role={impMsg.kind === 'error' ? 'alert' : 'status'}><Icon name={impMsg.kind === 'error' ? 'warning' : 'check'} /> {impMsg.text}</p> : null}
        <div><Button size="sm" disabled={!imp.trim()} onClick={() => confirm(t('s.import'), t('s.importWarn'), t('act.apply'), tryImport)}>{t('act.apply')}</Button></div>
      </Sec>
      <Sec title={t('s.reset')}>
        <ListRow title={t('s.resetLayout')} description={t('s.resetLayoutD')} action={<Button size="sm" variant="outline" onClick={() => confirm(t('s.resetLayoutQ'), t('s.resetLayoutD'), t('s.resetLayout'), () => { R.store.resetLayout(); done() })}>{t('s.resetLayout')}</Button>} />
        <ListRow title={t('s.resetAll')} description={t('s.resetAllD')} action={<Button size="sm" variant="destructive" onClick={() => confirm(t('s.resetAllQ'), t('s.resetAllD'), t('s.resetAll'), () => { R.store.resetAll(); done() })}>{t('s.resetAll')}</Button>} />
      </Sec>
      <Confirm open={!!ask} back={() => back.current?.()} onClose={() => setAsk(null)} onConfirm={() => { const run = ask.run; setAsk(null); run() }} title={ask?.title} description={ask?.description} confirmLabel={ask?.label} cancelLabel={t('act.cancel')} />
    </Wrap>
  )
}
