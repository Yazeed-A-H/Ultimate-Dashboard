// Shared bits for cards: data states, time/number helpers, small presentational pieces.
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, host, Input, useValue } from '@hermes/plugin-sdk'
import { Children, createContext, useContext, useEffect, useRef, useState } from 'react'
import { modelParts, nearLimit, pct, shortDuration, WARN, whenText } from '../state/format.js'
import { sparkPoints } from '../state/spark.js'
import { isNoBackend } from './data.js'
import { Icon } from './icon.jsx'
import { $sync, R, useLocale, useT } from './runtime.js'

// Closing returns focus to `back()` (an opener that unmounts, like a menu item) or to the element focused when it opened. Pass the result as onCloseAutoFocus.
export function useReturnFocus(open, back) {
  const from = useRef(null)
  // Cleared in onCloseAutoFocus, not on `open` going false: Radix runs that callback after the render that closes the dialog.
  if (open && !from.current) from.current = document.activeElement
  return e => { e.preventDefault(); const el = back?.() || from.current; from.current = null; if (el?.isConnected) el.focus() }
}

// A destructive confirm composed from SDK parts (not ConfirmDialog, whose header can't be styled without app selectors). Opens on Confirm, like ConfirmDialog.
export function Confirm({ open, onClose, onConfirm, title, description, confirmLabel, cancelLabel, back }) {
  const ok = useRef(null), focusBack = useReturnFocus(open, back)
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="ht-dlg" onOpenAutoFocus={e => { e.preventDefault(); ok.current?.focus() }} onCloseAutoFocus={focusBack}>
        <DialogHeader className="ht-dh"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" onClick={onClose}>{cancelLabel}</Button><Button variant="destructive" ref={ok} onClick={onConfirm}>{confirmLabel}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const CardCtx = createContext(null) // { card, size, range, show(field), limit }
export const useCard = () => useContext(CardCtx)

export const toMs = v => (v == null || v === '' ? null : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v) || null)

const nfs = {} // one formatter per locale
export function useTime() {
  const t = useT(), locale = useLocale()
  const nf = nfs[locale] ||= new Intl.NumberFormat(locale)
  const ago = v => { const ms = toMs(v); if (!ms) return '—'; const s = (Date.now() - ms) / 1000; return s < 45 ? t('st.now') : t('st.ago', { t: shortDuration(locale, s) }) }
  const dur = sec => (sec == null ? '—' : shortDuration(locale, sec))
  const when = (v, lower) => { const ms = toMs(v); return ms ? whenText(locale, ms, new Date(), lower) : '—' }
  return { ago, dur, when, n: x => nf.format(x), p: x => nf.format(pct(x) ?? 0), locale }
}

// `wait` is a visible line for slow loads (plan usage takes seconds); screen readers always get "Loading…".
export function Skel({ wait }) {
  const t = useT()
  return <div><div className="ht-skel" aria-hidden="true"><span /><span /><span /></div>{wait ? <p className="ht-state-d ht-wait">{wait}</p> : <span className="ht-vh">{t('st.loading')}</span>}</div>
}

export function StateBox({ kind, icon, title, desc, action }) {
  return (
    <div className="ht-state" data-kind={kind} role={kind === 'error' ? 'alert' : undefined}>
      {icon ? <Icon name={icon} className="ht-hi" /> : null}
      <p className="ht-state-t">{title}</p>
      {desc ? <p className="ht-state-d">{desc}</p> : null}
      {action || null}
    </div>
  )
}

// One row that opens a session: Sessions, Files made and Workers history all use it. Put the `key` on the call.
export const LinkRow = ({ id, title, children }) => <li><button type="button" className="ht-row-link" onClick={() => { if (id) host.openSession(id) }} title={title}>{children}<Icon name="chevron-right" className="ht-sec" /></button></li>

export const Empty = ({ text }) => <p className="ht-empty">{text}</p>

// Renders a react-query result: loading, no-backend, unavailable, error, then children(data).
// `backend`: the card needs the plugin backend; when it is off the page shows one banner (DashboardPage), the card only says "Not available".
export function Q({ q, children, wait, backend }) {
  const t = useT(), sync = useValue($sync)
  if (backend && sync.backend === 'off') return <Empty text={t('st.unavailable')} />
  if (q.isLoading || (q.isPending && q.fetchStatus !== 'idle')) return <Skel wait={wait} />
  if (q.error && q.data === undefined) {
    if (isNoBackend(q.error)) return <Empty text={t('st.unavailable')} />
    return <StateBox kind="error" icon="warning" title={t('st.error')} desc={String(q.error?.message || q.error).slice(0, 160)} action={<Button size="sm" variant="outline" onClick={() => q.refetch()}>{t('act.retry')}</Button>} />
  }
  if (q.data && q.data.available === false) return <StateBox kind="unavailable" icon="warning" title={t('st.unavailable')} desc={q.data.reason} />
  if (q.data === undefined) return <Skel wait={wait} />
  return children(q.data)
}

// Footer line for a query: "Updated 2m ago", or the stale marker when the last refetch failed.
export function Updated({ q, extra }) {
  const t = useT(), { ago } = useTime()
  if (!q?.dataUpdatedAt) return extra ? <>{extra}</> : null
  const stale = !!q.error
  return <>{extra}<span data-stale={stale ? 'true' : undefined}>{t(stale ? 'st.stale' : 'st.updated', { t: ago(q.dataUpdatedAt) })}</span></>
}

export function Tone({ tone, children, title }) { return <span className="ht-st" data-tone={tone} title={title}><span className="ht-dot" aria-hidden="true" />{children}</span> }

export function Bar({ value, label, warn = WARN.def }) {
  const v = pct(value) ?? 0
  return <div className="ht-bar" data-warn={v >= warn ? 'true' : undefined} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label}><span style={{ inlineSize: `${v}%` }} /></div>
}

// Decorative: the Bar next to it carries the accessible value. Time runs left to right in RTL too.
export const Spark = ({ values, warn, title }) => <span dir="ltr" aria-hidden="true" title={title}><svg className="ht-spark" viewBox="0 0 100 24" preserveAspectRatio="none" data-warn={values.at(-1) >= (warn ?? WARN.def) ? 'true' : undefined}><polyline points={sparkPoints(values, 100, 24)} /></svg></span>

export function Near({ value, k = 'u.near', warn = WARN.def }) {
  const t = useT()
  return nearLimit(value, warn) ? <span className="ht-warnb"><Icon name="warning" /><span>{t(k)}</span></span> : null
}

// With `onClick`, a button: it navigates (`expanded` undefined) or toggles a list (`expanded` = current state, then reads "Show less").
export function More({ n, className = 'ht-more', onClick, expanded }) {
  const t = useT()
  if (!(n > 0)) return null
  if (!onClick) return <p className={className}>{t('more.n', { n })}</p>
  return <p className={className}><button type="button" className="ht-link" onClick={onClick}>{expanded ? t('more.less') : t('more.n', { n })}{expanded === undefined ? <Icon name="chevron-right" /> : null}</button></p>
}

// A row's secondary line: the fields that are present, joined by a dot. A real element, not ::before, so it sits right next to LTR model names in RTL.
export const Meta = ({ children }) => <p className="ht-rw-m">{Children.toArray(children).flatMap((c, i) => (i ? [<span key={'d' + i} className="ht-sep-d" aria-hidden="true">·</span>, c] : [c]))}</p>

// LTR island for machine strings (commands, model ids) inside RTL text.
export const Ltr = ({ children, className }) => <bdi dir="ltr" className={className}>{children}</bdi>
// A model id the way Hermes shows it ("Opus 5.5" + grey "· 1M"), isolated LTR; the raw id stays in the tooltip.
export const ModelName = ({ model, className }) => { const { name, tag } = modelParts(model); return <bdi dir="ltr" className={className} title={model}>{name}{tag ? <span className="ht-mn-t"> · {tag}</span> : null}</bdi> }
export const Auto = ({ children, title }) => <bdi dir="auto" title={title}>{children}</bdi>

// Name field that saves on blur, on Enter, and ~800 ms after the last keystroke. An empty value is only
// saved on blur/Enter, so pausing while retyping does not wipe the name. `onSave(v)` may return the text to
// show afterwards (e.g. the restored default name). The debounced save passes `auto = true` so a field can ignore
// a half-typed value instead of resetting it.
export function SaveInput({ saved, onSave, ...rest }) {
  const [v, setV] = useState(saved)
  const keep = next => cur => (cur.trim() === next ? cur : next) // the store trims: mid-typing, do not write that back over a typed trailing space
  useEffect(() => setV(keep(saved)), [saved])
  const save = (val, auto) => {
    if (val === saved) return
    const r = onSave(val, auto)
    if (auto) { if (typeof r === 'string') setV(keep(r)) } else setV(typeof r === 'string' ? r : val.trim())
  }
  useEffect(() => {
    if (v === saved || !v.trim()) return
    return R.ctx.setTimeout(() => save(v, true), 800) // scoped timer: returns its own disposer
  }, [v])
  return <Input {...rest} value={v} onChange={e => setV(e.target.value)} onBlur={() => save(v)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(v) } }} />
}

// Latin product words (and the word before them) stay on one line, so "Hermes." never wraps alone.
export const latin = s => s.split(/((?:\S+\s)?\b(?:Cmd|Ctrl|Hermes|Windows|Linux)\b\S*)/).map((x, i) => i % 2 ? <bdi key={i} dir="auto" style={{ whiteSpace: 'nowrap' }}>{x}</bdi> : x)

// Agent-written text the user decides on: bidi overrides/isolates are shown as \u{..}, not applied. ZWNJ/ZWJ/LRM/RLM/ALM stay (Persian, Arabic, emoji need them).
// strict (a command): also zero-width spaces, soft hyphen, invisible operators, variation selectors and tag characters.
export const visible = (s, strict = false) => String(s ?? '').replace(strict ? /[\u202A-\u202E\u2066-\u2069\u200B\u2060\uFEFF\u00AD\u2061-\u2064\u206A-\u206F\uFE00-\uFE0F\u{E0000}-\u{E007F}]/gu : /[\u202A-\u202E\u2066-\u2069]/g, c => '\\u{' + c.codePointAt(0).toString(16) + '}')
