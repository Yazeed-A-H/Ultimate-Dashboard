// One component per card id. Each returns { meta, body, foot } through <Frame> (page.jsx renders
// the header, edit controls and footer). Data only from real doors; never sample data.
import { APPROVAL_RESPOND_TIMEOUT_MS, Button, host, pluginSettingsHref, SegmentedControl, Streamdown, useQueryClient } from '@hermes/plugin-sdk'
import { useEffect, useRef, useState } from 'react'
import { burn } from '../state/burn.js'
import { bytesText, CRON_STATUSES, isFailed, isInternalJob, isOff, platformName, rangeStart, sortWindows, usageText, WARN, scheduleRaw, scheduleText, isDelivery, cronSt } from '../state/format.js'
import { upcomingRuns } from '../state/cronweek.js'
import { mcpState, mcpSummary, platformState } from '../state/services.js'
import { evaluateHealth } from '../state/health.js'
import { LOG_FILES, maskSecrets } from '../state/logs.js'
import { liveView, toolKey } from '../state/live.js'
import { jobAnswer, webUrl } from '../state/jobanswer.js'
import { launch } from './quick.js'
import { qk, useActive, useActivity, useApprovals, useCron, useDelegation, useFiles, useHealth, useJobOutput, useLive, useLogs, useMachine, machineHistory, useMcp, useMemory, useRecentSessions, useSpend, useSkills, useSkillsUsage, useRefresh, useStatus, useUsage, useWorkerHistory, useWorkers } from './data.js'
import { byDate, GROUPS, skillCounts, unusedSkills } from '../state/skills.js'
import { compact, costLabel, money } from '../state/spend.js'
import { Icon } from './icon.jsx'
import { Auto, Bar, Empty, LinkRow, Ltr, Meta, ModelName, More, Near, Q, Spark, StateBox, Tone, Updated, toMs, useCard, useTime, visible } from './parts.jsx'
import { memHigh, memPct } from '../state/memory.js'
import { $dlg, R, useDoc, useLocale, useT } from './runtime.js'

const LIM = { s: 1, m: 3, l: 5, xl: 8 }
const cols = size => (size === 'xl' ? '2' : undefined)

// `more`: where the "+N more" button goes (a Hermes page); without it the button expands the list in place.
function List({ items, render, empty, limit, more }) {
  const { size } = useCard(), [all, setAll] = useState(false)
  if (!items.length) return <Empty text={empty} />
  const lim = limit || LIM[size] || 5
  return <><ul className="ht-rows" data-cols={cols(size)}>{(all ? items : items.slice(0, lim)).map(render)}</ul><More n={items.length - lim} onClick={more || (() => setAll(!all))} expanded={more ? undefined : all} /></>
}

// Known provider strings are translated, anything else is shown as given.
const trUsage = (t, label, detail) => { const r = usageText(label, detail); return r ? t(r[0], r[1]) : label }
const pickProviders = (rows, o) => (o.providers ? rows.filter(u => o.providers.includes(u.slug)) : rows)
const windows = rows => (rows || []).flatMap(u => (u.windows || []).filter(w => typeof w.used_percent === 'number'))
const risk = u => Math.max(0, ...windows([u]).map(w => w.used_percent)) // highest window of a provider
const topWindow = rows => windows(rows).reduce((a, w) => (!a || w.used_percent > a.used_percent ? w : a), null)

// High load: any of CPU, memory or disk at or over its own threshold (default 90).
const machineHigh = (m, o) => m.cpu_percent >= (o.warnCpu ?? WARN.def) || m.memory.percent >= (o.warnMem ?? WARN.def) || m.disk.percent >= (o.warnDisk ?? WARN.def)

// ---------- approvals ----------
// Approve/Reject stay off for a moment after a row appears or changes place, so a click aimed at one row cannot land on another.
const SETTLE_MS = 600

function ApprovalRow({ a, index }) {
  const t = useT(), { ago } = useTime(), { show } = useCard(), qc = useQueryClient()
  const [busy, setBusy] = useState(false), [settling, setSettling] = useState(true)
  useEffect(() => { setSettling(true); return R.ctx.setTimeout(() => setSettling(false), SETTLE_MS) }, [index])
  const off = busy || settling
  const title = a.session.title || a.session.id
  const text = visible(a.kind === 'command' ? (a.command || a.description || '') : (a.question || t('ap.waiting')), a.kind === 'command')
  const respond = async choice => {
    if (choice !== 'once' && choice !== 'deny') return
    setBusy(true)
    try {
      // Explicit click, one request_id, once|deny only.
      const r = await host.request('approval.respond', { session_id: a.session.id, request_id: a.request_id, choice }, APPROVAL_RESPOND_TIMEOUT_MS)
      // Canonical gateways answer {status: 'resolved' | 'already_resolved'}; legacy ones {resolved: n}.
      if (r && (r.status === 'resolved' || r.resolved > 0)) host.notify({ kind: 'success', message: t(choice === 'once' ? 'ap.approved' : 'ap.rejected', { text: text.slice(0, 80) }) })
      else host.notify({ kind: 'warning', message: t('ap.gone') })
    } catch (e) {
      host.notify({ kind: 'error', message: t('ap.failed', { err: String(e?.message || e).slice(0, 120) }) })
    } finally {
      await Promise.all([qc.invalidateQueries({ queryKey: qk('approvals') }), qc.invalidateQueries({ queryKey: qk('active') })])
      setBusy(false)
    }
  }
  return (
    <li className="ht-row">
      <div className="ht-rw">
        <p className="ht-rw-t">
          {show('kind') ? <span className="ht-tag" data-tone={a.kind === 'command' ? 'accent' : undefined}>{t(a.kind === 'command' ? 'ap.command' : 'ap.question')}</span> : null}
          {a.kind === 'command' ? <Ltr className="ht-ap-cmd">{text}</Ltr> : <Auto>{text}</Auto>}
        </p>
        {show('age') ? <span className="ht-rw-time">{ago(a.session.last_active)}</span> : null}
        {show('session') ? <Meta><Auto>{title}</Auto>{a.kind === 'command' && a.description && a.command ? <Auto>{visible(a.description)}</Auto> : null}</Meta> : null}
      </div>
      <div className="ht-ap-act">
        <Button size="sm" variant="ghost" onClick={() => host.openSession(a.session.id)} aria-label={t('ap.openL', { title })}>{t('ap.open')}</Button>
        {a.kind === 'command' ? <>
          <Button size="sm" variant="outline" disabled={off} onClick={() => respond('deny')} aria-label={t('ap.rejectL', { text })}>{t('ap.reject')}</Button>
          <Button size="sm" disabled={off} onClick={() => respond('once')} aria-label={t('ap.approveL', { text })}>{t('ap.approve')}</Button>
        </> : null}
      </div>
    </li>
  )
}

export function Approvals() {
  const t = useT(), { n } = useTime(), q = useApprovals()
  return {
    meta: q.data?.length ? <span className="ht-count">{n(q.data.length)}</span> : null,
    body: <Q q={q}>{d => <List items={d} limit={Infinity} empty={t('ap.none')} render={(a, i) => <ApprovalRow key={a.kind + a.request_id} a={a} index={i} />} />}</Q>,
    foot: <Updated q={q} />
  }
}

// ---------- sessions: working now on top, then recent. Waiting ones belong to Approvals. ----------
const RUN_STATUSES = ['working', 'streaming', 'starting', 'resuming', 'waiting', 'idle'] // keys run.status.*; t() returns the key itself for a missing one
const runTone = s => (s === 'waiting' ? 'warn' : s === 'idle' ? undefined : 'accent')

export function RecentSessions() {
  const t = useT(), { n, ago } = useTime(), { show, range } = useCard(), q = useRecentSessions(), act = useActive()
  const since = rangeStart(range) * 1000
  const byId = new Map((q.data || []).map(r => [r.id, r]))
  const working = (act.data || []).filter(s => s.status && s.status !== 'idle' && s.status !== 'waiting').map(s => ({ ...byId.get(s.id), ...s }))
  const wid = new Set(working.map(s => s.id))
  return {
    meta: working.length ? <span className="ht-count" title={t('ses.working')}>{n(working.length)}</span> : null,
    body: <Q q={q}>{rows => <List items={[...working, ...rows.filter(s => !wid.has(s.id) && (toMs(s.last_active || s.started_at) || 0) >= since)]} empty={t('ses.none')} render={s => (
      <LinkRow key={s.id} id={s.id}>
        <div className="ht-rw">
          <p className="ht-rw-t"><Auto>{s.title || s.preview || t(s.message_count || wid.has(s.id) ? 'ses.untitled' : 'ses.new')}</Auto></p>
          {show('time') ? <span className="ht-rw-time">{ago(s.last_active || s.started_at)}</span> : null}
          <Meta>{wid.has(s.id) && show('status') ? <Tone tone={runTone(s.status)}>{RUN_STATUSES.includes(s.status) ? t('run.status.' + s.status) : s.status}</Tone> : null}{show('messages') && s.message_count != null ? <span>{t('f.messages')}: {n(s.message_count || 0)}</span> : null}{show('model') && s.model ? <ModelName model={s.model} /> : null}</Meta>
        </div>
      </LinkRow>)} />}</Q>,
    foot: <Updated q={q} />
  }
}

// ---------- cron ----------
const cronTone = j => { const st = cronSt(j); return isOff(j) ? undefined : st === 'ok' ? 'ok' : st ? (isFailed(st) ? 'bad' : 'warn') : undefined }
// Known statuses are translated; an unknown one gets a generic label and its raw value in the tooltip only.
// Delivery states (delivery_queued, delivery_failed) happen after the run, so they are a separate chip; the run itself reads OK.
function CronStatus({ j }) {
  const t = useT(), off = isOff(j), dlv = !off && isDelivery(j.last_status)
  const st = cronSt(j)
  const label = off ? t('cron.paused') : !st ? t('cron.unknown') : CRON_STATUSES.includes(st) ? t('cron.st.' + st) : isFailed(st) ? t('cron.err') : t('cron.st.other')
  return <>
    <Tone tone={cronTone(j)} title={!off && st && !CRON_STATUSES.includes(st) ? String(st) : undefined}>{label}</Tone>
    {dlv ? <span className="ht-tag" data-tone={isFailed(j.last_status) ? 'bad' : 'warn'}>{t('cron.st.' + j.last_status)}</span> : null}
  </>
}
const note = j => j.last_error || j.last_fire_error || j.last_delivery_error || (j.last_delivery_unverified ? R.t('cron.unverified') : '') || j.paused_reason || ''

function JobRow({ j }) {
  const t = useT(), locale = useLocale(), { when } = useTime(), { show } = useCard()
  return (
    <li className="ht-row" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
      <div className="ht-rw">
        <p className="ht-rw-t"><Auto>{j.name || j.job_id}</Auto></p>
        <span className="ht-rw-time ht-rw-st"><CronStatus j={j} /></span>
        <Meta>
          {show('schedule') ? <Auto title={scheduleRaw(j)}>{scheduleText(j, locale, t)}</Auto> : null}
          {show('last') ? <span>{j.last_run_at ? t('cron.last', { t: when(j.last_run_at) }) : t('cron.never')}</span> : null}
          {show('next') && j.next_run_at ? <span>{t('cron.next', { t: when(j.next_run_at) })}</span> : null}
        </Meta>
      </div>
    </li>
  )
}

// Next 7 days under the xl table: one block per local day, `time  job`; frequent jobs get one "Every ..." line instead of a run each.
function Week({ jobs }) {
  const t = useT(), locale = useLocale(), now = Date.now(), day0 = new Date(now).setHours(0, 0, 0, 0)
  const fmt = (o, ms) => new Intl.DateTimeFormat(locale, o).format(ms)
  const all = jobs.map(j => ({ j, ...upcomingRuns(j, now) }))
  const freq = all.filter(x => x.frequent), items = all.flatMap(x => x.runs.map(ms => ({ ms, j: x.j }))).sort((a, b) => a.ms - b.ms)
  const days = []
  for (const x of items.slice(0, 40)) {
    const k = Math.floor((new Date(x.ms).setHours(0, 0, 0, 0) - day0) / 864e5 + 0.5)
    ;(days.at(-1)?.k === k ? days.at(-1) : days[days.push({ k, ms: x.ms, rows: [] }) - 1]).rows.push(x)
  }
  const label = d => {
    const date = fmt({ weekday: 'long', month: 'short', day: 'numeric' }, d.ms), rel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(d.k, 'day')
    return d.k < 2 ? t('cron.day', { rel: rel.charAt(0).toLocaleUpperCase(locale) + rel.slice(1), date }) : date
  }
  return (
    <div className="ht-wk">
      <h3 className="ht-sub-t">{t('cron.week')}</h3>
      {freq.map(x => <p key={x.j.job_id} className="ht-rw-m ht-wk-r">{t('cron.freq', { what: scheduleText(x.j, locale, t), name: x.j.name || x.j.job_id })}</p>)}
      {!days.length && !freq.length ? <Empty text={t('cron.weekNone')} /> : null}
      {days.map(d => <section key={d.k}>
        <p className="ht-wk-d">{label(d)}</p>
        {d.rows.map(x => <p key={x.j.job_id + x.ms} className="ht-wk-r"><time dateTime={new Date(x.ms).toISOString()}>{fmt({ hour: 'numeric', minute: '2-digit' }, x.ms)}</time><Auto>{x.j.name || x.j.job_id}</Auto></p>)}
      </section>)}
      <More n={items.length - 40} onClick={openCron} />
    </div>
  )
}

// Problems first (failed or paused), then the soonest next run; jobs without one go last.
const cronProblem = j => (isOff(j) || cronTone(j) === 'bad' || cronTone(j) === 'warn' ? 0 : 1)
const nextAt = j => toMs(j.next_run_at) ?? Infinity

// Hermes' own Scheduled jobs page: through its action when this host has it, else the route.
const nav = (action, route) => { if (!R.ctx.runAction?.(action)?.ok) host.navigate(route) }
const openCron = () => nav('nav.cron', '/cron')

export function Cron() {
  const t = useT(), locale = useLocale(), { when } = useTime(), { size, show, card } = useCard(), q = useCron(), doc = useDoc()
  const pins = doc.pinnedCron, only = !!card.options.pinnedOnly
  const link = <button type="button" className="ht-link" onClick={openCron}>{t('cron.all')}<Icon name="chevron-right" /></button>
  const rank = j => { const i = pins.indexOf(j.job_id); return i < 0 ? pins.length : i }
  // Pinned jobs first (in your order), then by the rule above. Internal one-shot jobs stay off the card unless pinned.
  const pick = jobs => jobs
    .filter(j => (only ? pins.includes(j.job_id) : !doc.prefs.hideInternal || !isInternalJob(j) || pins.includes(j.job_id)))
    .sort((a, b) => rank(a) - rank(b) || cronProblem(a) - cronProblem(b) || nextAt(a) - nextAt(b))
  return {
    meta: link,
    body: <Q q={q}>{list => {
      const jobs = pick([...list])
      if (!list.length) return <Empty text={t('cron.none')} />
      if (!jobs.length) return only ? <StateBox icon="pinned" title={t('pc.empty')} desc={t('pc.hint')} action={<Button size="sm" variant="outline" onClick={() => host.navigate(settingsHref('pinned-cron'))}>{t('pc.pin')}</Button>} /> : <Empty text={t('cron.none')} />
      if (size !== 'xl') return <List items={jobs} empty="" more={openCron} render={j => <JobRow key={j.job_id} j={j} />} />
      return (
        <div className="ht-tw"><table className="ht-dt">
          <thead><tr><th scope="col">{t('card.cron')}</th><th scope="col">{t('f.status')}</th>{show('schedule') ? <th scope="col">{t('f.schedule')}</th> : null}{show('last') ? <th scope="col">{t('f.last')}</th> : null}{show('next') ? <th scope="col">{t('f.next')}</th> : null}{show('note') ? <th scope="col">{t('f.note')}</th> : null}</tr></thead>
          <tbody>{jobs.slice(0, LIM.xl).map(j => (
            <tr key={j.job_id}>
              <th scope="row"><Auto>{j.name || j.job_id}</Auto></th>
              <td><span className="ht-lb">{t('f.status')}</span><span className="ht-rw-st"><CronStatus j={j} /></span></td>
              {show('schedule') ? <td><span className="ht-lb">{t('f.schedule')}</span><Auto title={scheduleRaw(j)}>{scheduleText(j, locale, t)}</Auto></td> : null}
              {show('last') ? <td className="ht-nw"><span className="ht-lb">{t('f.last')}</span>{j.last_run_at ? when(j.last_run_at) : t('cron.never')}</td> : null}
              {show('next') ? <td className="ht-nw"><span className="ht-lb">{t('f.next')}</span>{when(j.next_run_at)}</td> : null}
              {show('note') ? <td data-empty={note(j) ? undefined : ''}><span className="ht-lb">{t('f.note')}</span><span className="ht-clamp ht-dt-n" title={note(j)}><Auto>{note(j)}</Auto></span></td> : null}
            </tr>))}</tbody>
        </table><More n={jobs.length - LIM.xl} onClick={openCron} /><More n={jobs.length - 5} className="ht-more ht-more-n" onClick={openCron} />{show('week') ? <Week jobs={jobs} /> : null}</div>
      )
    }}</Q>,
    foot: <Updated q={q} />
  }
}

// ---------- job result ----------
// Job output is untrusted text: `rehypePlugins={[]}` drops the raw-HTML plugin (tags show as text; tables and lists still work),
// images become plain text so nothing loads, and only http(s) links are clickable (any other scheme stays text).
// Desktop denies a bare target=_blank (nothing opens), so the click goes through ctx.os.openExternal; when that resolves false the link opens as a plain new tab. Without ctx.os the native new tab runs.
const MD = {
  a: ({ href, children }) => { const u = webUrl(href); return u ? <a href={u} target="_blank" rel="noopener noreferrer" onClick={e => { const os = R.ctx?.os; if (!os?.openExternal) return; e.preventDefault(); void os.openExternal(u).then(ok => ok || window.open(u, '_blank', 'noopener,noreferrer')) }}>{children}</a> : <span>{children}</span> },
  img: ({ alt }) => <span>{alt}</span>
}

function JobText({ text, truncated }) {
  const t = useT(), { size } = useCard(), box = useRef(null), [open, setOpen] = useState(false), [over, setOver] = useState(false)
  useEffect(() => {
    const el = box.current
    if (open || !el) return
    const measure = () => setOver(el.scrollHeight > el.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure) // a narrower card wraps the text taller than the clamp, after the first measure
    ro.observe(el)
    return () => ro.disconnect()
  }, [text, open, size])
  return <>
    <div className="ht-jr-md" data-size={size} data-open={open ? 'true' : undefined} ref={box} dir="auto"><Streamdown mode="static" controls={false} rehypePlugins={[]} components={MD}>{text}</Streamdown></div>
    {over || open ? <button type="button" className="ht-link ht-jr-more" onClick={() => setOpen(!open)}>{t(open ? 'jr.less' : 'jr.more')}</button> : null}
    {truncated ? <p className="ht-state-d">{t('jr.truncated')}</p> : null}
  </>
}

export function JobResult() {
  const t = useT(), { ago, when } = useTime(), { card } = useCard(), id = card.options.job, cron = useCron()
  const job = (cron.data || []).find(j => j.job_id === id)
  const q = useJobOutput(cron.isSuccess && !job ? null : id) // a deleted job is not polled
  const base = { title: job?.name || undefined, foot: null }
  if (!id) return { ...base, meta: null, body: <StateBox icon="pinned" title={t('jr.pick')} desc={t('jr.pickD')} action={<Button size="sm" variant="outline" onClick={() => $dlg.set({ kind: 'options', id: card.id })}>{t('jr.choose')}</Button>} /> }
  if (cron.isSuccess && !job) return { ...base, meta: null, body: <Empty text={t('jr.gone')} /> }
  const at = q.data?.latest && (q.data.latest.mtime || q.data.latest.at) // mtime is exact; the file name is in Hermes' timezone, not the browser's
  const ans = q.data?.latest ? jobAnswer(q.data.latest.text, q.data.latest.truncated) : ''
  return {
    ...base,
    meta: job ? <CronStatus j={job} /> : null,
    body: <div className="ht-jr" data-jr={card.id}>{job?.prompt_preview?.trim() ? <p className="ht-jr-d" dir="auto" title={job.prompt_preview}>{job.prompt_preview}</p> : null}<Q q={q} backend>{d => {
      if (!d.runs || !d.latest) return <Empty text={t('jr.none')} />
      return ans ? <JobText text={ans} truncated={d.latest.truncated} /> : d.latest.truncated ? <p className="ht-state-d">{t('jr.truncated')}</p> : <Empty text={t('jr.silent')} />
    }}</Q></div>,
    foot: <Updated q={q} extra={<>{at ? <span>{t('jr.ranAt', { time: ago(at) })}</span> : null}{ans ? <Button size="sm" variant="ghost" aria-label={t('jr.chatL', { job: job?.name || id })} onClick={() => void launch({ prompt: `${job?.name || id} · ${when(at)}\n\n${ans}` })}>{t('jr.chat')}</Button> : null}<Button size="sm" variant="ghost" onClick={openCron}>{t('jr.open')}</Button></>} />
  }
}

// ---------- usage ----------
// One line under the bar from the average pace; at M only the session window and only the "limit" case.
function Pace({ w, compact, t, p, dur }) {
  const b = burn(w)
  if (!b || (compact && (b.state !== 'limit' || !/session/i.test(w.label)))) return null
  return <p className="ht-rw-m">{b.state === 'limit' ? <Tone tone="warn">{t('u.pace.limit', { a: dur(b.limitS), b: dur(b.shortS) })}</Tone> : t('u.pace.ok', { p: p(b.endPct) + '%' })}</p>
}

function Provider({ u, compact, warn }) {
  const t = useT(), { p, when, dur } = useTime()
  const ws = sortWindows(u.windows) // compact (size M) shows the first = session window
  return (
    <li className="ht-us">
      <p className="ht-us-h"><Auto>{u.name || u.title}</Auto></p>
      {(compact ? ws.slice(0, 1) : ws).map(w => (
        <div className="ht-us-w" key={w.label}>
          <p className="ht-us-l"><span><Auto>{trUsage(t, w.label)}</Auto></span><span className="ht-us-v">{t('u.used', { p: p(w.used_percent) + '%' })}{w.resets_at && !compact ? ` · ${t('u.resets', { t: when(w.resets_at, true) })}` : ''}</span></p>
          <Bar value={w.used_percent} warn={warn} label={`${u.name || u.title} ${trUsage(t, w.label)}`} />
          <Pace w={w} compact={compact} t={t} p={p} dur={dur} />
          {w.detail && !compact ? <p className="ht-rw-m"><Auto>{trUsage(t, w.detail, true)}</Auto></p> : null}
        </div>
      ))}
    </li>
  )
}

export function Usage() {
  const t = useT(), { size, card } = useCard(), q = useUsage(card.options.providers)
  const rows = (q.data || []).length ? [...pickProviders(q.data, card.options)].sort((a, b) => risk(b) - risk(a)) : []
  const top = topWindow(rows)
  return {
    meta: top ? <Near value={top.used_percent} warn={card.options.warn} /> : null,
    body: <Q q={q} wait={t('u.loading')}>{() => rows.length ? <ul className="ht-rows" data-cols={cols(size)}>{rows.map(u => <Provider key={u.slug} u={u} compact={size === 'm'} warn={card.options.warn} />)}</ul> : <Empty text={t('u.none')} />}</Q>,
    foot: <Updated q={q} />
  }
}

// ---------- services / machine ----------
// MCP servers: a summary at size m, one chip per server (8 at most) from l. Names only, never urls or errors.
function McpChips({ servers }) {
  const t = useT(), { size } = useCard()
  if (size === 'm') {
    const r = mcpSummary(servers)
    return <dd className="ht-chips">
      <Tone tone={r.connected ? 'ok' : undefined}>{t('svc.mcpOk', { n: r.connected })}</Tone>
      {r.failing ? <Tone tone="bad">{t('svc.mcpFail', { n: r.failing })}</Tone> : null}
      {r.needsAuth ? <Tone tone="bad">{t('svc.mcpAuth', { n: r.needsAuth })}</Tone> : null}
    </dd>
  }
  const tone = { ok: 'ok', failed: 'bad', auth: 'bad', connecting: 'warn' }
  const word = { failed: 'svc.failed', auth: 'svc.auth', connecting: 'svc.pending', lazy: 'svc.lazy', off: 'svc.off' }
  return <dd><span className="ht-chips">{servers.slice(0, 8).map((x, i) => {
    const st = mcpState(x), tools = st === 'ok' || st === 'lazy' ? t('svc.tools', { n: x.tools || 0 }) : null
    return <Tone key={i} tone={tone[st]}><span className={st === 'off' ? 'ht-sec' : undefined}><Auto>{x.name}</Auto>{[word[st] && t(word[st]), tools].filter(Boolean).map(w => ' · ' + w)}</span></Tone>
  })}</span><More n={servers.length - 8} onClick={goSkills} /></dd>
}

export function Services() {
  const t = useT(), q = useStatus(), mcp = useMcp()
  return {
    body: <Q q={q}>{s => {
      const plats = Object.entries(s.gateway_platforms || {})
      return (
        <dl>
          <div className="ht-kv-r"><dt>{t('svc.gateway')}</dt><dd><Tone tone={s.gateway_running ? 'ok' : 'bad'}>{s.gateway_running ? t('svc.running') : t('svc.stopped')}</Tone></dd></div>
          {plats.length ? <div className="ht-kv-r"><dt>{t('svc.platforms')}</dt><dd className="ht-chips">{plats.map(([k, v]) => { const st = platformState(v); return <Tone key={k} tone={{ connected: 'ok', attention: 'bad', paused: 'warn', pending: 'warn' }[st]} title={typeof v?.error_message === 'string' && v.error_message ? v.error_message : t('svc.' + st)}><Auto>{platformName(k, v)}</Auto>{st === 'connected' ? <span className="ht-vh"> {t('svc.connected')}</span> : <span className="ht-sec"> · {t('svc.' + st)}</span>}</Tone> })}</dd></div> : null}
          {mcp.isSuccess && mcp.data.length ? <div className="ht-kv-r"><dt>{t('svc.mcp')}</dt><McpChips servers={mcp.data} /></div> : null}
          {s.version ? <div className="ht-kv-r"><dt>{t('svc.version')}</dt><dd><Ltr className="ht-mono">{s.version}</Ltr></dd></div> : null}
        </dl>
      )
    }}</Q>,
    foot: <Updated q={q} />
  }
}

export function Machine() {
  const t = useT(), { p, dur, locale } = useTime(), { show, card } = useCard(), q = useMachine(), manual = useRefresh() === false
  const o = card.options, m = q.data, h = machineHistory()
  // One line per tile once there are 3 samples; manual refresh gives one sample per click, so no line there.
  const spark = (buf, warn) => (!manual && buf.length >= 3 ? <Spark values={buf.map(s => s[1])} warn={warn} title={t('m.hist', { n: dur(buf.at(-1)[0] - buf[0][0]) })} /> : null)
  const tile = (k, label, v, bar, warn, of, ofKey = 'm.of', base, line) => (show(k) ? <div className="ht-tile" key={k}><span className="ht-tile-l">{label}</span><span className="ht-tile-v">{v}</span>{of?.total ? <span className="ht-tile-s">{t(ofKey, { a: bytesText(locale, of.used, base), b: bytesText(locale, of.total, base) })}</span> : null}{bar != null ? <Bar value={bar} warn={warn} label={label} /> : null}{line}</div> : null)
  return {
    meta: m && m.memory && machineHigh(m, o) ? <Near value={100} k="m.high" /> : null,
    body: <Q q={q} backend>{m => <div className="ht-tiles" title={m.hostname ? t('m.host', { host: m.hostname }) : undefined}>
      {tile('cpu', t('m.cpu'), `${p(m.cpu_percent)}%`, m.cpu_percent, o.warnCpu, undefined, undefined, undefined, spark(h.cpu, o.warnCpu))}
      {tile('memory', t('m.memory'), `${p(m.memory.percent)}%`, m.memory.percent, o.warnMem, m.memory, undefined, undefined, spark(h.mem, o.warnMem))}
      {tile('disk', t('m.disk'), bytesText(locale, m.disk.free ?? m.disk.total - m.disk.used, 1000), m.disk.percent, o.warnDisk, m.disk, 'm.freeOf', 1000)}
      {tile('uptime', t('m.uptime'), dur(m.uptime_s), null)}
    </div>}</Q>,
    foot: <Updated q={q} />
  }
}

// ---------- health ----------
// One light for the whole page: the chip is the level, the rows are what to fix, worst first. Reasons are fixed phrases (no error text).
const HEALTH_GO = { cron: () => nav('nav.cron', '/cron'), messaging: () => nav('nav.messaging', '/messaging'), capabilities: () => nav('nav.capabilities', '/capabilities') }
const HEALTH_TONE = { ok: 'ok', warn: 'warn', bad: 'bad' }

export function Health() {
  const t = useT(), { size } = useCard(), q = useHealth()
  const h = q.data ? evaluateHealth(q.data) : null
  const nm = i => i.name || t(i.kind === 'gateway' ? 'svc.gateway' : 'm.disk')
  return {
    meta: h ? <Tone tone={HEALTH_TONE[h.level]}>{t('hl.' + h.level)}</Tone> : null,
    body: <Q q={q}>{() => <>
      {size === 's'
        ? <p className="ht-sec">{h.items.length ? t('hl.count', { n: h.items.length }) : t('hl.none')}</p>
        : <List items={h.items} empty={t('hl.none')} render={i => (
          <li className="ht-row" key={`${i.kind}-${i.name}-${i.detail}`} style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
            <div className="ht-rw">
              <p className="ht-rw-t"><Auto>{nm(i)}</Auto></p>
              <span className="ht-rw-time ht-rw-st"><Tone tone={i.sev === 2 ? 'bad' : 'warn'}>{t(`hl.${i.kind}.${i.detail}`)}</Tone></span>
              {i.fix ? <p className="ht-rw-m"><button type="button" className="ht-link" onClick={HEALTH_GO[i.fix]} aria-label={t('hl.openL', { name: nm(i) })}>{t('hl.open')}<Icon name="chevron-right" /></button></p> : null}
            </div>
          </li>
        )} />}
      {h.unchecked.length ? <p className="ht-sec">{t('hl.unchecked', { what: h.unchecked.map(k => t(k === 'status' ? 'svc.gateway' : 'card.cron')).join(', ') })}</p> : null}
    </>}</Q>,
    foot: <Updated q={q} />
  }
}

// ---------- agent memory: MEMORY.md and USER.md use against their limits (numbers only, never the text) ----------
const MEM_FILES = [['memory', 'mem.agent'], ['user', 'mem.user']]

export function Memory() {
  const t = useT(), { ago, n } = useTime(), { size } = useCard(), q = useMemory()
  return {
    meta: q.data?.files ? <Near value={memHigh(q.data.files)} /> : null,
    body: <Q q={q} backend>{d => <>
      <div className="ht-tiles">{MEM_FILES.map(([k, key]) => {
        const f = d.files[k], label = t(key)
        return (
          <div className="ht-tile" key={k}>
            <span className="ht-tile-l">{label}</span>
            {f.enabled ? <span className="ht-tile-v">{t('m.of', { a: n(f.chars), b: n(f.limit) })}</span> : <span className="ht-tile-v"><Tone>{t('mem.off')}</Tone></span>}
            {f.enabled ? <Bar value={memPct(f)} label={label} /> : null}
            <span className="ht-tile-s">{f.chars ? t('mem.edited', { t: ago(f.mtime) }) : t('mem.empty')}</span>
            {size === 'l' && f.entries ? <span className="ht-tile-s">{t('mem.entries', { n: f.entries })}</span> : null}
          </div>
        )
      })}</div>
      {size === 'l' && d.provider ? <dl><div className="ht-kv-r"><dt>{t('mem.provider')}</dt><dd><Ltr>{d.provider}</Ltr></dd></div></dl> : null}
    </>}</Q>,
    foot: <Updated q={q} />
  }
}

// ---------- files / workers ----------
const fileIcon = ext => (/^(png|jpe?g|gif|webp|svg|mp4|mov|mp3|wav)$/.test(ext) ? 'file-media' : /^(html?|js|ts|py|css|json|sh|mjs)$/.test(ext) ? 'file-code' : 'file')

export function RecentFiles() {
  const t = useT(), { ago, n } = useTime(), { show, range } = useCard(), q = useFiles(range)
  return {
    meta: q.data?.total != null ? <span className="ht-count">{n(q.data.total) + (q.data.truncated ? '+' : '')}</span> : null,
    body: <Q q={q} backend>{d => <List items={d.files} empty={t('files.none')} render={f => (
      <LinkRow key={f.path} id={f.session_id} title={f.path}>
        <span className="ht-f-r">
          <span className="ht-f-i" aria-hidden="true"><Icon name={fileIcon(f.ext)} /></span>
          <span className="ht-rw" style={{ flex: 1 }}>
            <span className="ht-rw-t"><Ltr>{f.name}</Ltr></span>
            {show('time') ? <span className="ht-rw-time">{ago(f.created_at)}</span> : null}
            <Meta>{show('type') && f.ext ? <span className="ht-mono">{f.ext}</span> : null}{show('session') && f.session_title ? <Auto>{f.session_title}</Auto> : null}</Meta>
          </span>
        </span>
      </LinkRow>)} />}</Q>,
    foot: <Updated q={q} />
  }
}

export function Workers() {
  const t = useT(), { ago, dur, n } = useTime(), { show, range, size } = useCard()
  const now = useDelegation(), hist = useWorkers(range)
  const active = now.data?.active || []
  // A running task is not history yet. delegation.status and the sessions table share no id, so also match the parent chat + start time (real data: < 1 s apart).
  const isRunning = h => !h.ended_at && active.some(a => [a.id, a.delegation_id, a.session_id, a.subagent_id].includes(h.id) || (a.owner_agent_session_id && a.owner_agent_session_id === h.parent_session_id && Math.abs(a.started_at - h.started_at) < 5))
  const status = w => (w.ended_at ? (isFailed(w.end_reason) ? <Tone tone="bad">{t('wk.failed')}</Tone> : <Tone tone="ok">{t('wk.done')}</Tone>) : <Tone tone="accent">{t('wk.running')}</Tone>)
  return {
    meta: active.length ? <span className="ht-count">{n(active.length)}</span> : null,
    body: <>
      {active.length ? <><h3 className="ht-sub-t">{t('wk.now')}</h3><ul className="ht-rows">{active.slice(0, LIM[size]).map((w, i) => (
        <li className="ht-row" key={w.id || w.delegation_id || i}><div className="ht-rw"><p className="ht-rw-t ht-clamp" style={{ '--lines': 2 }} title={w.goal || w.task || w.title || w.id}><Auto>{w.goal || w.task || w.title || w.id}</Auto></p><span className="ht-rw-time"><Tone tone="accent">{t('wk.running')}</Tone></span><p className="ht-rw-m">{w.model ? <ModelName model={w.model} /> : null}</p></div></li>
      ))}</ul><h3 className="ht-sub-t">{t('wk.history')}</h3></> : null}
      <Q q={hist} backend>{d => <List items={d.workers.filter(w => !isRunning(w))} empty={t('wk.none')} render={w => (
        <LinkRow key={w.id} id={w.parent_session_id || w.id}>
          <div className="ht-rw">
            <p className="ht-rw-t ht-clamp" title={w.title || w.id}>{show('task') ? <Auto>{w.title || w.id}</Auto> : <ModelName model={w.model} />}</p>
            <span className="ht-rw-time">{show('status') ? status(w) : null}</span>
            <Meta><span>{ago(w.started_at)}</span>{show('elapsed') && w.ended_at ? <span>{dur(w.ended_at - w.started_at)}</span> : null}{w.model ? <ModelName model={w.model} /> : null}</Meta>
          </div>
        </LinkRow>)} />}</Q>
    </>,
    foot: <Updated q={hist} />
  }
}

// ---------- logs ----------
// Lines are text nodes only, in an LTR block; file and level are local state (never saved or synced).
const LOG_LINES = { m: 10, l: 25, xl: 50 }, LV = { WARNING: 'warn', ERROR: 'bad', CRITICAL: 'bad', DEBUG: 'muted' }
export function Logs() {
  const t = useT(), { size } = useCard(), [file, setFile] = useState('agent'), [lv, setLv] = useState('ALL')
  const level = size === 'm' ? 'ALL' : lv // the level filter is l/xl only
  const q = useLogs(file, level, LOG_LINES[size] || 25), box = useRef(null)
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [q.data])
  const shown = q.data?.available === false ? { ...q, data: { available: false, reason: t('lg.noApi') } } : q
  const seg = (ids, key, value, set) => <div role="group" aria-label={t(key)}><SegmentedControl options={ids.map(([id, k]) => ({ id, label: t(k) }))} value={value} onChange={set} /></div>
  return {
    body: <>
      <div className="ht-lg-bar">
        {seg(LOG_FILES.map(f => [f, 'lg.' + f]), 'lg.file', file, setFile)}
        {size !== 'm' ? seg([['ALL', 'lg.all'], ['WARNING', 'lg.warn'], ['ERROR', 'lg.err']], 'lg.level', lv, setLv) : null}
      </div>
      <Q q={shown}>{rows => rows.length ? (
        <div className="ht-lg" dir="ltr" data-size={size} ref={box} tabIndex={0} role="region" aria-label={file + '.log'}>
          {rows.map((r, i) => {
            const s = size === 'm' ? r.text.replace(/^\d{4}-\d{2}-\d{2}[T ]/, '') : r.text, at = r.at < 0 ? -1 : r.at - (r.text.length - s.length)
            return <p className="ht-lg-r" key={i} data-lv={LV[r.level]}>{at < 0 ? s : <>{s.slice(0, at)}<span className="ht-lg-l">{r.level}</span>{s.slice(at + r.level.length)}</>}</p>
          })}
        </div>
      ) : <Empty text={t(level === 'ALL' ? 'lg.empty' : 'lg.emptyLv')} />}</Q>
    </>,
    foot: <Updated q={q} extra={q.data?.length ? <><Ltr>{file}.log</Ltr><span>{t('lg.lines', { n: q.data.length })}</span></> : null} />
  }
}

// ---------- skills ----------
const SK_GROUP = { yours: 'sk.yours', builtin: 'sk.builtin', hub: 'sk.hub' }
const goSkills = () => nav('nav.capabilities', '/capabilities')

export function Skills() {
  const t = useT(), { ago, n } = useTime(), { show, size } = useCard(), q = useSkills(), u = useSkillsUsage()
  const dates = u.data?.available ? u.data.skills : null, top = size === 'xl' ? 5 : 3
  const sec = (key, rows) => (show(key) && rows.length ? <><h3 className="ht-sub-t">{t('f.' + key)}</h3><List items={rows} limit={top} empty="" more={goSkills} render={r => (
    <li className="ht-row" key={r.name}><div className="ht-rw"><p className="ht-rw-t"><Auto>{r.name}</Auto></p><span className="ht-rw-time">{ago(r.at)}</span></div></li>)} /></> : null)
  return {
    body: <Q q={q}>{list => {
      if (!list.length) return <Empty text={t('sk.none')} />
      const { total, counts, known } = skillCounts(list), unused = known && show('unused') ? unusedSkills(list) : []
      return <>
        <p className="ht-sk-h"><span>{t('sk.total', { n: total })}</span>{known && show('unused') ? <span>{t('sk.unused', { n: unused.length })}</span> : null}
          {GROUPS.filter(g => counts[g]).map(g => <span className="ht-rw-m" key={g}>{n(counts[g])} {t(SK_GROUP[g])}</span>)}</p>
        {size === 'm' ? null : <>
          {sec('recent', dates ? byDate(list, dates, 'used') : [])}
          {sec('added', dates ? byDate(list, dates, 'added') : [])}
          {!dates && !u.isFetching && (show('recent') || show('added')) ? <p className="ht-state-d">{t('sk.dates')}</p> : null}
          {size === 'xl' && unused.length ? <><h3 className="ht-sub-t">{t('f.unused')}</h3><List items={unused} empty="" more={goSkills} render={s => <li className="ht-row" key={s.name}><div className="ht-rw"><p className="ht-rw-t"><Auto>{s.name}</Auto></p></div></li>} /></> : null}
        </>}
      </>
    }}</Q>,
    foot: <Updated q={q} />
  }
}

// ---------- spend ----------
// The money cell: est. cost, or a tag when the plan includes it or the price is unknown. Never "spent".
function Cost({ c, m }) {
  const t = useT(), { locale } = useTime(), { kind } = costLabel(m)
  return kind === 'included' ? <span className="ht-tag">{t('sp.included')}</span> : kind === 'unknown' ? <span className="ht-tag">{t('sp.unknown')}</span> : <Ltr>{money(locale, c)}</Ltr>
}

export function Spend() {
  const t = useT(), { n, locale } = useTime(), { size, range } = useCard(), q = useSpend(range)
  const tok = x => t('sp.tokN', { n: compact(locale, x) })
  return {
    meta: q.data?.totals ? <span className="ht-count">{n(q.data.totals.sessions)}</span> : null,
    body: <Q q={q} backend>{d => {
      if (!d.models.length) return <Empty text={t('sp.none')} />
      const un = costLabel(d.totals).unpriced
      return <>
        <div className="ht-tiles">
          <div className="ht-tile" title={t('sp.tokensD')}><span className="ht-tile-l">{t('sp.tokens')}</span><span className="ht-tile-v">{compact(locale, d.totals.tokens)}</span></div>
          <div className="ht-tile" title={t('sp.costD')}><span className="ht-tile-l">{t('sp.cost')}</span><span className="ht-tile-v"><Ltr>{money(locale, d.totals.cost)}</Ltr></span>{un ? <span className="ht-tile-s">{t('sp.unpriced', { n: un })}</span> : null}</div>
        </div>
        <List items={d.models} limit={size === 'm' ? 3 : 6} empty="" render={m => (
          <li className="ht-row" key={m.model}>
            <div className="ht-rw">
              <p className="ht-rw-t"><ModelName model={m.model} /></p>
              <span className="ht-rw-time" title={t('sp.costD')}><Cost c={m.cost} m={m} /></span>
              <Meta><span>{tok(m.tokens)}</span>{costLabel(m).unpriced && costLabel(m).kind === 'est' ? <span>{t('sp.unpriced', { n: costLabel(m).unpriced })}</span> : null}</Meta>
              {size !== 'm' ? <Bar value={d.totals.tokens ? (m.tokens / d.totals.tokens) * 100 : 0} label={m.model} /> : null}
            </div>
          </li>)} />
        {size === 'xl' && d.top.length ? <>
          <h3 className="ht-sub-t">{t('sp.top')}</h3>
          <ul className="ht-rows">{d.top.map(s => (
            <LinkRow key={s.id} id={s.id}>
              <div className="ht-rw">
                <p className="ht-rw-t"><Auto>{s.title || t('ses.untitled')}</Auto></p>
                <span className="ht-rw-time" title={t('sp.costD')}><Cost c={s.cost} m={{ sessions: 1, included: +(s.cost_status === 'included'), unknown: +(s.cost_status === 'unknown') }} /></span>
                <Meta><ModelName model={s.model} /><span>{tok(s.tokens)}</span></Meta>
              </div>
            </LinkRow>))}</ul>
        </> : null}
      </>
    }}</Q>,
    foot: <Updated q={q} />
  }
}

export function Activity() {
  const t = useT(), { ago, n, p } = useTime(), { range, size } = useCard(), q = useActivity(range)
  return {
    body: <Q q={q} backend>{d => d.calls ? <>
      <p className="ht-sk-h">{t('act.calls', { n: d.calls })} · <Tone tone={d.failed ? 'bad' : 'ok'}>{t('act.failed', { n: d.failed })}{d.failed ? ` (${p(100 * d.failed / d.calls)}%)` : ''}</Tone></p>
      <List items={d.tools} render={x => (
        <li className="ht-row" key={x.tool}><div className="ht-rw">
          <p className="ht-rw-t ht-mono"><Ltr>{x.tool}</Ltr></p>
          <span className="ht-rw-time">{x.failed ? <Tone tone="bad">{t('m.of', { a: n(x.failed), b: n(x.calls) })}</Tone> : n(x.calls)}</span>
        </div></li>)} />
      {size === 'm' ? null : <><h3 className="ht-sub-t">{t('act.recent')}</h3>
        <List items={d.feed} render={(f, i) => (
          <LinkRow key={`${f.session_id}-${f.at}-${i}`} id={f.session_id}>
            <div className="ht-rw">
              <p className="ht-rw-t ht-mono"><Ltr>{f.tool}</Ltr></p>
              <span className="ht-rw-time"><Tone tone={f.ok ? 'ok' : 'bad'}>{t(f.ok ? 'act.ok' : 'act.fail')}</Tone></span>
              <Meta><span>{ago(f.at)}</span>{f.session_title ? <Auto>{f.session_title}</Auto> : null}</Meta>
            </div>
          </LinkRow>)} /></>}
    </> : <Empty text={t('act.none')} />}</Q>,
    foot: <Updated q={q} />
  }
}

// ---------- live tasks: one block per Main chat. A row per lane (who | one bar for a Worker, a count for Main | time); the bar fills with elapsed time toward this Worker's usual duration. Worker previews are Hermes' own redacted one-liners, Main shows tool names only. ----------
const LV_TONE = { running: 'accent', done: 'ok', failed: 'bad' }
const stepLabel = (t, name) => { const k = toolKey(name); return k ? t('lv.t.' + k) : <Ltr>{name}</Ltr> }

function Lane({ lane, sec }) {
  const t = useT(), { dur } = useTime(), run = lane.state === 'running', live = run || lane.state === 'waiting', w = lane.kind === 'worker', now = lane.now, u = run ? lane.usual : null
  const name = lane.title || (w ? '' : t('ses.untitled')), bad = lane.blocks.filter(b => !b.ok).length
  const status = run ? (lane.late ? t('lv.late') : now ? stepLabel(t, now.tool) : t('lv.thinking')) : lane.state === 'waiting' ? t('lv.waiting') : lane.state === 'done' || lane.state === 'failed' ? t(lane.state === 'done' ? 'wk.done' : 'wk.failed') : null
  const secs = (live ? sec.t1 : lane.end) - lane.start, pct = u && !lane.late ? Math.min(100, (sec.t1 - lane.start) / u.hi * 100) : 100
  const tip = t('lv.stripL', { ok: lane.blocks.length - bad, failed: bad }) + (u ? `. ${t('lv.usual', { a: dur(u.lo), b: dur(u.hi), n: u.n })}` : '')
  const info = [w ? `${t('lv.worker', { n: lane.index + 1 })} · ${lane.model || '—'}` : '', Number.isFinite(lane.steps) ? t('lv.steps', { n: lane.steps }) : ''].filter(Boolean).join(' · ')
  const body = <>
    <span className="ht-lv-who">
      <Tone tone={LV_TONE[lane.state]} />
      <span className="ht-lv-n">
        <span className="ht-lv-t" title={info ? `${name}\n${info}` : name}><Auto>{name}</Auto></span>
        {status ? <span className="ht-lv-m" title={w && now?.text ? `${now.tool} · ${maskSecrets(now.text)}` : undefined}>{status}</span> : null}
      </span>
    </span>
    {w ? <span className="ht-lv-bar" role="img" aria-label={tip} title={tip}><span className="ht-lv-f" aria-hidden="true" data-late={lane.late ? '' : undefined} data-none={run && !u ? '' : undefined} style={{ inlineSize: `${pct}%` }} /></span>
      : <span className="ht-lv-of">{sec.total ? t('lv.ofDone', { done: sec.done, n: sec.total }) : ''}</span>}
    <span className="ht-lv-tm">{Number.isFinite(secs) ? dur(secs) : ''}</span>
  </>
  return <li className="ht-lv-li">{sec.main ? <button type="button" className="ht-lv-r" data-state={lane.state} data-w={w ? '' : undefined} onClick={() => host.openSession(sec.id)}>{body}</button> : <div className="ht-lv-r" data-state={lane.state} data-w={w ? '' : undefined}>{body}</div>}</li>
}

// Never a percentage of the whole task or an ETA: Hermes gives no total. A Worker's bar only compares its elapsed time with how long this user's earlier Workers took.
const Section = ({ s }) => <div className="ht-lv-s"><ul className="ht-lv-l">{[s.main, ...s.workers].filter(Boolean).map(l => <Lane key={l.key} lane={l} sec={s} />)}</ul></div>

export function Live() {
  const t = useT(), { n } = useTime(), q = useLive(), act = useActive(), hist = useWorkerHistory().data?.workers
  const v = q.data?.available ? liveView(q.data, act.data, hist) : null
  return {
    meta: v?.running ? <span className="ht-count">{n(v.running)}</span> : null,
    body: <Q q={q} backend>{d => {
      const w = v || liveView(d, act.data, hist)
      return <>
        {w.sections.map(s => <Section key={s.id} s={s} />)}
        {!w.sections.length ? <Empty text={t('lv.none')} /> : null}
        {w.last ? <><h3 className="ht-sub-t">{t('lv.last')}</h3><Section s={w.last} /></> : null}
      </>
    }}</Q>,
    foot: <Updated q={q} />
  }
}

export const settingsHref = page => pluginSettingsHref('ultimate-dashboard', page)

export const BODIES = { approvals: Approvals, 'recent-sessions': RecentSessions, cron: Cron, usage: Usage, 'recent-files': RecentFiles, services: Services, machine: Machine, workers: Workers, 'job-result': JobResult, health: Health, logs: Logs, memory: Memory, skills: Skills, spend: Spend, activity: Activity, live: Live }
