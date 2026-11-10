#!/usr/bin/env node
// Sanitized catalog screenshots of the plugin in a real, ISOLATED Hermes (Webapp + headless Chrome, demo data only).
//
//   node tools/screenshots.mjs                 # writes docs/screenshots/*.png from the current plugin/ build
//
// Needs `hermes` on PATH (or HERMES_BIN), Google Chrome/Chromium (or CHROME), and a built plugin/desktop/plugin.js.
// Everything runs in a throwaway HERMES_HOME under HT_SHOTS_DIR (default ~/.hermes/cache/scratch/ht-shots/), which
// is wiped on every run. It never writes to ~/.hermes and refuses to run if HT_SHOTS_DIR points there. It imports the Hermes
// install's own code (HT_SHOTS_AGENT, default ~/.hermes/hermes-agent) to seed the demo sessions into the scratch home.
// Ports: HT_SHOTS_PORT (Webapp, default 9472), HT_SHOTS_CDP (Chrome debugging, default 9473).
// Output, all dark, English only: banner (1200x600: one complete row of three 'm' cards, no Hermes chrome; viewport width chosen so the row fills most of the clip), dashboard-full (README: 1440 CSS wide at 2x, full grid height),
// and the catalog gallery set, each exactly 2880x1800 = 16:10 (1440x900 CSS at 2x): dashboard, system, edit-layout, add-card (card gallery open), settings.
// Sanitizing: host name, user name and /Users/<name> paths are replaced in the DOM before each capture and the
// script aborts if any of them is still on screen. Starts a gateway, Chrome and a Webapp; stops all of them at the end.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir, hostname, userInfo } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = resolve(process.env.HT_SHOTS_DIR || join(homedir(), '.hermes', 'cache', 'scratch', 'ht-shots'))
const REAL = join(homedir(), '.hermes')
if (ROOT === REAL || ROOT === homedir() || ROOT === sep || dirname(ROOT) === REAL) throw new Error('refusing scratch dir ' + ROOT) // the dir is wiped on each run
const HH = join(ROOT, 'home'), UH = join(ROOT, 'demo'), OUT = join(REPO, 'docs', 'screenshots')
const PORT = +(process.env.HT_SHOTS_PORT || 9472), CDP = +(process.env.HT_SHOTS_CDP || 9473)
const HERMES = process.env.HERMES_BIN || 'hermes'
// Only HERMES_HOME moves: a moved HOME hides the macOS login keychain and triggers "reset keychain" prompts.
// Own gateway lock dir (default is per OS user, shared with your live gateway): without it `hermes` attaches to that gateway instead of starting the scratch one.
// HERMES_DATA_DIR_SUFFIX moves Hermes' "default root" from ~/.hermes to a nonexistent ~/.hermes<suffix>, so the Webapp's "default" profile is this
// scratch home. Without it the Webapp opens your REAL default profile (real sessions in the sidebar, onboarding screen stuck). It is not a HOME override.
const ENV = { ...process.env, HERMES_HOME: HH, HERMES_GATEWAY_LOCK_DIR: join(HH, '..', 'locks'), HERMES_DATA_DIR_SUFFIX: '-shots' }
delete ENV.HERMES_PROFILE; delete ENV.HERMES_DESKTOP_USER_DATA_DIR

const sleep = ms => new Promise(r => setTimeout(r, ms))
const hermes = (...a) => { const r = spawnSync(HERMES, a, { env: ENV, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`hermes ${a.join(' ')}: ${r.stdout}${r.stderr}`); return r.stdout }

async function stopGateway() { // only the gateway recorded in OUR home; waits until it has exited and freed the port
  let rec
  try { rec = JSON.parse(readFileSync(join(HH, 'gateway.pid'), 'utf8')) } catch { return }
  if (resolve(rec.hermes_home) !== HH) return
  const alive = () => { try { process.kill(rec.pid, 0); return true } catch { return false } }
  try { process.kill(rec.pid, 'SIGTERM') } catch {}
  for (let i = 0; i < 60 && alive(); i++) await sleep(500)
  if (alive()) process.kill(rec.pid, 'SIGKILL')
  console.log('gateway stopped', rec.pid)
}

function chromePath() {
  const c = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean)
  const p = c.find(existsSync); if (!p) throw new Error('Chrome not found, set CHROME'); return p
}

// ---------- 1. fresh isolated home with demo data ----------
await stopGateway()
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(join(HH, 'plugins'), { recursive: true }); mkdirSync(join(UH), { recursive: true }); mkdirSync(OUT, { recursive: true })
if (!existsSync(join(REPO, 'plugin', 'desktop', 'plugin.js'))) throw new Error('build the plugin first: node tools/build.mjs')
cpSync(join(REPO, 'plugin'), join(HH, 'plugins', 'ultimate-dashboard'), { recursive: true })
hermes('plugins', 'enable', 'ultimate-dashboard')
appendFileSync(join(HH, 'config.yaml'), `webapp:\n  enabled: true\n  host: 127.0.0.1\n  port: ${PORT}\n`)
// a placeholder provider (never called, no network) so Hermes' status bar reads ready instead of "Backend checking"
appendFileSync(join(HH, 'config.yaml'), 'model:\n  provider: openrouter\n  default: anthropic/claude-sonnet-4\n'); writeFileSync(join(HH, '.env'), 'OPENROUTER_API_KEY=sk-or-demo-placeholder\n')
writeFileSync(join(HH, 'release-notes.md'), '# Release notes\n- demo\n')
mkdirSync(join(ROOT, 'seed'))
const now = Date.now(), min = 6e4
// Demo files the sessions "made" (the Files made card lists MEDIA: paths that exist on disk).
const files = { 'release-notes.md': '# Release notes\n- demo\n', 'billing-refactor-plan.md': '# Billing refactor\n- demo\n', 'onboarding-guide.md': '# Onboarding\n- demo\n',
  'vector-db-comparison.md': '# Vector databases\n- demo\n', 'week-plan.md': '# Week plan\n- demo\n', 'q3-metrics.csv': 'metric,value\nsessions,42\n', 'ci-report.html': '<h1>CI report</h1>\n' }
for (const [n, c] of Object.entries(files)) writeFileSync(join(UH, n), c)
// [title, minutes ago, minutes long, model, tokens in, tokens out, tool steps [tool, args, result], question, answer, made file]
const ok = { success: true }, S = (tool, args, result = ok) => [tool, args, result]
const demo = [
  ['Review pull request', 40, 6, 'anthropic/claude-sonnet-4', 38200, 4100, [S('terminal', { command: 'git diff main --stat' }, { exit_code: 0, output: '6 files changed' }), S('read_file', { path: 'src/billing/invoice.ts' }), S('search_files', { pattern: 'TODO' })], 'Review the open pull request for the invoice rounding fix.', 'The fix is correct. Two small suggestions: add a test for zero amounts and rename `roundCents`.'],
  ['Refactor the billing module', 95, 22, 'anthropic/claude-sonnet-4', 91000, 12800, [S('read_file', { path: 'packages/billing/index.ts' }), S('patch', { path: 'packages/billing/index.ts' }), S('terminal', { command: 'pnpm test billing' }, { exit_code: 1, output: '1 failed' }), S('patch', { path: 'packages/billing/tax.ts' }), S('terminal', { command: 'pnpm test billing' }, { exit_code: 0, output: 'all passed' })], 'Split the billing module into invoices, taxes and payments.', 'Done. The module is split into three files and the billing tests pass. Plan: MEDIA:' + join(UH, 'billing-refactor-plan.md')],
  ['Write onboarding guide', 210, 14, 'anthropic/claude-sonnet-4', 24500, 6900, [S('search_files', { pattern: 'README' }), S('read_file', { path: 'docs/setup.md' }), S('write_file', { path: 'onboarding-guide.md' })], 'Write a short onboarding guide for new engineers.', 'The guide covers setup, the first pull request and who to ask. MEDIA:' + join(UH, 'onboarding-guide.md')],
  ['Research vector databases', 480, 18, 'openai/gpt-5', 52000, 9400, [S('web_search', { query: 'vector database comparison' }), S('web_search', { query: 'pgvector vs qdrant benchmarks' }), S('write_file', { path: 'vector-db-comparison.md' })], 'Compare three vector databases for our search feature.', 'pgvector fits best for now: one fewer service to run. Notes saved. MEDIA:' + join(UH, 'vector-db-comparison.md')],
  ['Fix flaky CI test', 1100, 9, 'anthropic/claude-sonnet-4', 33000, 3800, [S('terminal', { command: 'pnpm test e2e/checkout' }, { exit_code: 1, output: 'timeout' }), S('read_file', { path: 'e2e/checkout.spec.ts' }), S('patch', { path: 'e2e/checkout.spec.ts' }), S('terminal', { command: 'pnpm test e2e/checkout --repeat 20' }, { exit_code: 0, output: '20 passed' })], 'The checkout e2e test fails about one run in five. Find out why.', 'The test raced the stub server. I added a readiness wait and 20 repeat runs pass. Report: MEDIA:' + join(UH, 'ci-report.html')],
  ['Plan the week', 1500, 3, 'openai/gpt-5', 6200, 1500, [S('read_file', { path: 'notes/backlog.md' })], 'Help me plan the week.', 'Monday focus, Tuesday review, Wednesday ship. MEDIA:' + join(UH, 'week-plan.md')],
  ['Draft release notes', 2000, 5, 'anthropic/claude-sonnet-4', 14800, 2600, [S('terminal', { command: 'git log --oneline v1.4.0..HEAD' }, { exit_code: 0, output: '23 commits' }), S('write_file', { path: 'release-notes.md' })], 'Draft the release notes for 1.5.0.', 'Done. I drafted the notes. MEDIA:' + join(UH, 'release-notes.md')],
  ['Summarize meeting notes', 2900, 2, 'google/gemini-2.5-pro', 9100, 900, [], 'Summarize the meeting notes.', 'Three decisions, two open questions, one action item for each owner.'],
  ['Triage the support inbox', 4200, 11, 'anthropic/claude-sonnet-4', 28400, 5200, [S('search_files', { pattern: 'refund' }), S('write_file', { path: 'q3-metrics.csv' })], 'Triage the support inbox and count tickets by topic.', 'Sorted 37 tickets: 14 billing, 9 login, 8 bugs, 6 other. MEDIA:' + join(UH, 'q3-metrics.csv')],
  ['Migrate settings to YAML', 5800, 16, 'anthropic/claude-sonnet-4', 61000, 8700, [S('read_file', { path: 'config/settings.json' }), S('write_file', { path: 'config/settings.yaml' }), S('terminal', { command: 'pnpm lint' }, { exit_code: 0, output: 'clean' })], 'Move the settings file from JSON to YAML.', 'The settings now load from YAML and the lint passes.']
]
const rows = demo.map(([title, ago, len, model, tin, tout, steps, q, answer], n) => {
  const t0 = (now - ago * min) / 1000; let t = t0; const m = [{ role: 'user', content: q, timestamp: t }]
  steps.forEach(([tool, args, res], k) => {
    const cid = `call_${n}_${k}`; t += 20 + k
    m.push({ role: 'assistant', content: '', tool_calls: [{ id: cid, type: 'function', function: { name: tool, arguments: JSON.stringify(args) } }], timestamp: t })
    t += 4; m.push({ role: 'tool', tool_call_id: cid, tool_name: tool, content: JSON.stringify(res), timestamp: t })
  })
  m.push({ role: 'assistant', content: answer, timestamp: t + 6 })
  return { source: 'cli', cwd: UH, title, model, started_at: t0, ended_at: t0 + len * 60, end_reason: 'user_exit', input_tokens: tin, output_tokens: tout, api_call_count: steps.length + 1,
    estimated_cost_usd: +(tin * 3e-6 + tout * 15e-6).toFixed(4), cost_status: 'estimated', messages: m }
})
// Sessions: Hermes' own importer behind `hermes sessions import` and POST /api/sessions/import (the gateway's session.mutate "import",
// the full export format with tokens, cost and tool calls). Ids come from Hermes' own generator. Skill usage: Hermes' own counters (tools.skill_usage).
writeFileSync(join(ROOT, 'seed', 'sessions.json'), JSON.stringify(rows))
const AGENT = process.env.HT_SHOTS_AGENT || join(REAL, 'hermes-agent') // the Hermes install: its code and venv are only imported, all writes go to the scratch HERMES_HOME
const py = process.env.HT_SHOTS_PY || join(AGENT, 'venv', 'bin', 'python')
const seedPy = `import json, sys, uuid
from hermes_state_ids import new_session_id
from hermes_cli.gateway_session_store import session_store
rows = json.load(open(sys.argv[1]))
from tools.skill_usage import bump_use, bump_view
for n, k in [("apple-notes", 3), ("arxiv", 2), ("pdf", 2), ("google-workspace", 4), ("obsidian", 1), ("email-inbox-triage", 2), ("maps", 1)]:
    for _ in range(k): bump_use(n)
    bump_view(n)
for r in rows: r["id"] = new_session_id()
print(json.dumps(session_store().call("session.mutate", session_id=rows[0]["id"], request_id=uuid.uuid4().hex, expected_revision=0, operation="import", payload={"sessions": rows}))[:200])`
writeFileSync(join(ROOT, 'seed', 'seed.py'), seedPy)
{ const r = spawnSync(py, [join(ROOT, 'seed', 'seed.py'), join(ROOT, 'seed', 'sessions.json')], { env: { ...ENV, PYTHONPATH: AGENT }, encoding: 'utf8' }); if (r.status !== 0) throw new Error('session import failed: ' + (r.error || r.signal || '') + r.stdout + r.stderr); console.log('sessions imported:', r.stdout.trim()) }

// Memory: Hermes' built-in memory files (what its memory tool writes: entries joined by "\n§\n"); the plugin only reads them.
mkdirSync(join(HH, 'memories'), { recursive: true })
writeFileSync(join(HH, 'memories', 'MEMORY.md'), ['The repo is a pnpm workspace; run `pnpm test` before opening a pull request.', 'The billing module lives in packages/billing; amounts are stored as integer cents.', 'The checkout e2e test needs a readiness wait for the stub server.', 'Release notes follow Keep a Changelog; versions are tagged vX.Y.Z.', 'Staging deploys run from main on every merge.'].join('\n§\n'))
writeFileSync(join(HH, 'memories', 'USER.md'), ['Prefers short, direct answers with the code first.', 'Writes docs in plain English, no marketing tone.', 'Reviews pull requests in the morning and does deep work after lunch.'].join('\n§\n'))

// Scheduled jobs. Each daily time is moved 6 h later if it would fall within 3 h of now on today's date, so nothing can fire while this runs.
mkdirSync(join(HH, 'scripts'), { recursive: true })
const scripts = { 'backup-check.sh': 'Backup check: 3 snapshots, newest 4 hours old, 0 errors.', 'dependency-updates.sh': 'Dependency updates: 3 outdated packages (react 19.1 to 19.2, vite 7.0 to 7.1, zod 4.0 to 4.1).', 'weekly-cleanup.sh': 'Weekly cleanup: 14 old downloads, 220 MB can be removed.' }
for (const [f, line] of Object.entries(scripts)) writeFileSync(join(HH, 'scripts', f), `#!/bin/sh\necho "${line}"\n`)
const d = new Date(now), nowMin = d.getHours() * 60 + d.getMinutes(), today = d.getDay()
// shortcut: the 3 h window is only checked for the weekdays a job runs on today; fine because the shift is by 6 h and the jobs repeat on fixed weekdays
const when = (h, m, dow) => { const x = h * 60 + m, dist = Math.min(Math.abs(x - nowMin), 1440 - Math.abs(x - nowMin)); if (dist < 180 && (dow === '*' || dow.split(',').includes(String(today)) || (dow === '1-5' && today >= 1 && today <= 5))) h = (h + 6) % 24; return `${m} ${h} * * ${dow}` }
// [name, schedule, prompt, script]: a script job (--no-agent) never calls a model, so it can really run once; the prompt jobs stay "Never ran"
const jobs = [['Morning briefing', when(8, 0, '*'), 'Demo job: summarize the day.'], ['Inbox triage', when(9, 30, '1-5'), 'Demo job: sort the inbox.'], ['Weekly report', when(16, 0, '5'), 'Demo job: write the weekly report.'],
  ['Dependency updates', when(10, 0, '1'), null, 'dependency-updates.sh'], ['Weekly cleanup', when(18, 0, '0'), null, 'weekly-cleanup.sh'], ['Backup check', when(7, 0, '*'), null, 'backup-check.sh']]
const jobIds = [], scriptJobs = []
for (const [name, sched, prompt, script] of jobs) {
  // `create --paused` alone leaves an odd "awaiting operator approval" note; resume + pause clears it. A plain `create` would auto-start a
  // detached gateway for the profile "default" (your real home), so always create paused. Jobs are resumed only once the scratch gateway runs.
  // --deliver local: the default "origin" fails to deliver outside a chat and would show the run as a delivery failure.
  const id = /Created job: (\w+)/.exec(hermes('cron', 'create', '--paused', '--deliver', 'local', '--name', name, ...(prompt ? [sched, prompt] : ['--no-agent', '--script', script, sched])))?.[1]
  if (!id) throw new Error('job not created: ' + name)
  hermes('cron', 'resume', id); hermes('cron', 'pause', id); jobIds.push(id); if (script) scriptJobs.push(id)
}

// ---------- 2. start the Webapp (gateway) and headless Chrome ----------
const launch = hermes('webapp', '--no-open', '--skip-build').match(/http:\S+/g)?.pop()
if (!launch) throw new Error('no Webapp launch link')
// The scratch gateway is up (hermes always runs with the scratch ENV): resume the demo jobs. Their next runs are >= 3 h away, so none fires.
for (const id of jobIds) hermes('cron', 'resume', id)
// The script jobs call no model: run each once through Hermes so they have a real last run and result.
for (const id of scriptJobs) hermes('cron', 'run', id)
const chrome = spawn(chromePath(), ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${join(ROOT, 'chrome-ud')}`, '--no-first-run', '--no-default-browser-check', '--use-mock-keychain', '--password-store=basic', 'about:blank'], { stdio: 'ignore' })
let ws
try {
  let target
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find(t => t.type === 'page') } catch {} }
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => (ws.onopen = r))
  let id = 0; const pend = new Map()
  ws.onmessage = e => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id) }
  const send = (method, params = {}) => new Promise((res, rej) => { pend.set(++id, m => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id, method, params })) })
  const ev = async js => { // under load the page can navigate/reload mid-call: retry those
    for (let k = 0; ; k++) {
      try { const r = await send('Runtime.evaluate', { expression: `(async()=>{${js}})()`, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed'); return r.result.value }
      catch (e) { if (k >= 8 || !/navigated or closed|context|destroyed/i.test(e.message)) throw e; await sleep(1500) }
    } }
  const until = async (js, what, ms = 90000) => { for (let t = 0; t < ms; t += 400) { if (await ev(js).catch(() => false)) return; await sleep(400) }
    writeFileSync(join(ROOT, 'timeout.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); throw new Error(`timeout: ${what} (see ${join(ROOT, 'timeout.png')})`) }
  const view = (w, h, dsf) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: false })
  const scheme = v => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: v }] })
  const click = (sel, text) => ev(`const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.innerText.trim()===${JSON.stringify(text)}); if(!b) return false; b.click(); return true`)

  // display-only masking, kept alive by a MutationObserver; the script then aborts if a private string is still visible
  const user = userInfo().username, host = hostname(), short = host.split('.')[0]
  const mask = `(()=>{const H=${JSON.stringify([host, short].filter(s => s.length > 2))},U=${JSON.stringify(user)};
    const fix=s=>{let o=s.replace(/\\/Users\\/[^\\s\\/'"]+/g,'/Users/demo');for(const h of H)o=o.split(h).join('studio-mac');return o.split(U).join('demo')};
    const walk=n=>{const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);for(let t;(t=w.nextNode());){const f=fix(t.nodeValue);if(f!==t.nodeValue)t.nodeValue=f}};
    const run=()=>walk(document.body);run();new MutationObserver(run).observe(document.body,{subtree:true,childList:true,characterData:true})})()`
  const leak = `const t=document.body.innerText.toLowerCase();return [${JSON.stringify([host, short, user].filter(s => s.length > 2).map(s => s.toLowerCase()))}].flat().find(s=>t.includes(s))||[...t.matchAll(/\\/users\\/(\\w+)/g)].map(m=>m[1]).find(n=>n!=='demo')||''`

  await send('Page.enable'); await send('Emulation.setFocusEmulationEnabled', { enabled: true }) // the app polls backend readiness only while the page has focus
  await view(1440, 1000, 2); await scheme('dark')
  await send('Page.navigate', { url: launch })
  await until(`return document.body.innerText.includes('New session')`, 'Webapp load')
  await ev(`localStorage.setItem('hermes.desktop.pluginDecisions.v2', JSON.stringify({'ultimate-dashboard':true}))`) // the Desktop switch, opt-in by default
  await send('Page.reload'); await sleep(3000); await ev(mask)
  const ready = async hash => { // go to a route, clear first-run chrome, wait for content, hide private strings
    // re-set the hash while waiting: right after a reload the app redirects to "/" until the plugin's route exists
    await until(`if(location.hash!==${JSON.stringify(hash)}) location.hash=${JSON.stringify(hash)}; return document.body.innerText.includes(${hash.includes('settings') ? "'Your name'" : "'Review pull request'"})`, hash)
    const card = '[data-card-id="recent-sessions"]' // must show the demo sessions, not the empty text; also proves this is the scratch profile, not yours
    if (!hash.includes('settings')) await until(`const c=document.querySelector('${card}');return !!c&&c.innerText.includes('Review pull request')&&c.innerText.includes('Refactor the billing module')`, 'demo sessions in the Sessions card')
    for (let i = 0; i < 3; i++) { await ev(`for(const b of document.querySelectorAll('button')) if(/choose a provider later/i.test(b.innerText)||b.getAttribute('aria-label')==='Dismiss notification'||b.closest('.ht-banner[data-kind="hint"]')) b.click()`); await sleep(500) }
    if (!hash.includes('settings')) console.log(hash, 'sessions card:', JSON.stringify(await ev(`return document.querySelector('${card}')?.innerText`)))
    await ev(mask); await sleep(1500)
    const bad = await ev(leak); if (bad) throw new Error('private string still visible: ' + bad)
  }
  const top = () => ev(`for(const b of document.querySelectorAll('button'))if(b.getAttribute('aria-label')==='Dismiss notification')b.click();document.activeElement?.blur?.();for(const e of document.querySelectorAll('*'))if(e.scrollTop)e.scrollTop=0;scrollTo(0,0)`)
  const shot = async (name, { keepScroll, ...o } = {}) => {
    if (!keepScroll) await top()
    await sleep(700)
    const r = await send('Page.captureScreenshot', { format: 'png', ...o }); const f = join(OUT, name + '.png')
    writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('wrote', f)
  }
  for (let k = 0; ; k++) { // first boot can be slow on a loaded machine; the first-run screen can also hang at "Starting Hermes", a reload clears it
    try { await until(`for(const b of document.querySelectorAll('button')) if(/choose a provider later/i.test(b.innerText)) b.click(); return !![...document.querySelectorAll('a,button')].find(x=>x.innerText.trim()==='Dashboard')`, 'Dashboard in sidebar', 60000); break }
    catch (e) { if (k >= 3) throw e; console.log('first-run screen still up, reloading'); await send('Page.reload'); await sleep(4000); await ev(mask) }
  }

  // The script jobs' first runs happen on the gateway's next scheduler tick (up to a minute): wait for its real output file
  const ran = () => scriptJobs.filter(id => existsSync(join(HH, 'cron', 'output', id))).length
  for (let i = 0; i < 150 && ran() < scriptJobs.length; i++) await sleep(1000)
  console.log('script job outputs:', ran(), 'of', scriptJobs.length)

  // Layouts are applied with the plugin's own Settings > Layouts > Import (what a user does with an export). Views lead with cards that have data;
  // cards a scratch home cannot fill (Usage needs a signed-in provider, Workers, Needs my approval) are left out of the views, and so is Logs (the scratch gateway's real log has a kanban error in it).
  const c = (id, size, options = {}) => ({ id, size, options })
  const wk = { range: '7d' } // Activity and Job result are left out: the first is 590-780 px tall, the second is a mostly empty markdown box
  const doc = (today, ops) => ({
    schema: 1, activeView: 'v-today', shortcutsSeeded: false, shortcuts: [], pinnedCron: [], templates: [],
    prefs: { refresh: '1m', range: '7d', navIcon: 'dashboard', startView: 'v-today', hintDismissed: true, jobOfferDismissed: true, hideInternal: true },
    views: [{ id: 'v-today', nameKey: 'view.today', name: '', cards: today }, { id: 'v-ops', nameKey: 'view.ops', name: '', cards: ops }]
  })
  const main = doc([c('recent-sessions', 'l', wk), c('recent-files', 'l', wk), c('cron', 'xl'), c('health', 'm'), c('machine', 'm'), c('memory', 'm'), c('spend', 'l', wk), c('skills', 'l')],
    [c('services', 'm'), c('machine', 'm'), c('health', 'm'), c('skills', 'l'), c('spend', 'l', wk)])
  // Banner view: exactly three 'm' cards (one row). recent-sessions stays in: ready() waits for its demo rows.
  const bset = ids => doc(ids.map(i => c(i, 'm', i === 'machine' || i === 'memory' || i === 'skills' ? {} : wk)), main.views[1].cards)
  const combos = [['recent-sessions', 'spend', 'machine']]
  const applyLayout = async layout => {
    await ready('#/settings?tab=plugins&plugin=ultimate-dashboard%3Asettings&ppage=layouts').catch(() => {})
    await until(`const t=document.querySelector('textarea[aria-label="Import"]');if(!t){const b=[...document.querySelectorAll('a,button')].find(x=>x.innerText.trim()==='Layouts');b&&b.click();return false}
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(JSON.stringify(layout))});t.dispatchEvent(new Event('input',{bubbles:true}));return true`, 'Layouts import box')
    await sleep(500)
    await ev(`[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Apply'&&!x.closest('[role=alertdialog],[role=dialog]')).click()`); await sleep(800)
    await ev(`[...document.querySelectorAll('[role=alertdialog] button,[role=dialog] button')].find(x=>x.innerText.trim()==='Apply').click()`)
    await until(`return document.body.innerText.includes('Imported.')`, 'layout imported')
    await ready('#/ultimate-dashboard')
  }
  // every card needs its data before a capture: no loading skeleton, no "not available"
  const settled = () => until(`const g=document.querySelector('#ht-grid');return !!g&&!/Not available|Couldn.t|Loading|unavailable/i.test(g.innerText)&&!g.querySelector('[aria-busy="true"],.ht-skel')`, 'cards loaded')
  // scroll the page so the view tabs sit at the top: the header and Quick launch would otherwise take a third of the shot
  const toTabs = () => ev(`const g=document.querySelector('[id^=ht-tab-]');for(let e=document.querySelector('#ht-grid');e;e=e.parentElement)if(e.scrollHeight>e.clientHeight+4&&getComputedStyle(e).overflowY!=='visible'){e.scrollTop=g.getBoundingClientRect().top-e.getBoundingClientRect().top+e.scrollTop-12;break}`)
  const status = async () => { // Hermes' own status bar chip says "Backend checking" until the gateway answers its readiness probe
    await until(`return /Backend\\s*ready/i.test(document.body.innerText)`, 'status bar backend chip settled', 120000)
    console.log('status bar:', JSON.stringify(await ev(`return (document.body.innerText.match(/Backend\\s+\\w+/)||[''])[0]`)))
  }

  // banner (1200x600 = the catalog card; the plugin page centre-crops it to its middle band): ONE complete row of three 'm' cards and nothing else.
  // Cards stretch to the tallest in the row and 'm' rows are ~350 px tall, but the target height is (grid width + 24) / 2, so each combo is measured at a few
  // viewport widths in this same session; the pick is the tallest row that does not exceed the target (so no card is cut and the margins stay small).
  // Clip: x = grid left - 12, width = grid width + 24, height = width / 2, scale 1200/width, row vertically centred. Candidates go to the scratch dir only.
  const geo = () => ev(`const R=e=>{const r=e.getBoundingClientRect();return [r.left,r.top,r.width,r.height]};return {grid:R(document.querySelector('#ht-grid')),tabs:R(document.querySelector('[id^=ht-tab-]')),cs:[...document.querySelectorAll('[data-card-id]')].map(e=>[e.dataset.cardId,...R(e)])}`)
  let pick
  for (const ids of combos) {
    await applyLayout(bset(ids)); await status()
    for (const vw of [1284, 1276, 1268, 1260]) {
      await view(vw, 1600, 1); await settled(); await sleep(1500); await ev(mask); await top(); await sleep(500)
      const g = await geo(), [gx, , gw] = g.grid, PAD = 12, cw = gw + 2 * PAD, ch = cw / 2
      const tops = g.cs.map(x => x[2]), rowTop = Math.min(...tops), rowH = Math.max(...g.cs.map(x => x[4])), ok = g.cs.length === 3 && Math.max(...tops) - rowTop < 1 && cw <= 1260 && rowH <= ch
      console.log('banner candidate', ids.join('+'), 'vw', vw, 'rowTop', rowTop, 'rowH', rowH, 'target', ch, 'ok', ok, JSON.stringify(g))
      if (!ok) continue
      const y = rowTop - (ch - rowH) / 2, name = `cand-${ids.join('+')}-${vw}`
      writeFileSync(join(ROOT, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png', clip: { x: gx - PAD, y, width: cw, height: ch, scale: 1200 / cw } })).data, 'base64'))
      if (!pick || rowH / ch > pick.fill) pick = { name, fill: rowH / ch, rowH, target: ch, y, x: gx - PAD, w: cw, scale: 1200 / cw, ids, vw }
    }
  }
  if (!pick) throw new Error('no banner candidate fits')
  console.log('banner pick', JSON.stringify(pick)); cpSync(join(ROOT, pick.name + '.png'), join(OUT, 'banner.png'))
  if (process.env.HT_SHOTS_STOP === 'banner') throw new Error('stopped after the banner (HT_SHOTS_STOP)')

  await applyLayout(main); await view(1440, 1000, 2); await status(); await settled(); await sleep(1500)
  console.log('cards (id:top-bottom px):', JSON.stringify(await ev(`return [...document.querySelectorAll('[data-card-id]')].map(c=>{const r=c.getBoundingClientRect();return c.dataset.cardId+':'+Math.round(r.left)+','+Math.round(r.top)+'-'+Math.round(r.bottom)})`)))
  // dashboard.png: as tall as the grid, so the whole populated page shows
  await view(1440, 3600, 2); await sleep(1000)
  const h = await ev(`return Math.ceil(document.querySelector('#ht-grid').getBoundingClientRect().bottom+scrollY)+40`)
  await view(1440, h, 2); await sleep(1200); await ev(mask); await shot('dashboard-full')
  await view(1440, 900, 2); await sleep(1200); await ev(mask); await toTabs(); await shot('dashboard', { keepScroll: true }) // gallery size (16:10): view tabs at the top of the content area

  if (!(await click('[role=tab]', 'System'))) throw new Error('System view tab not found')
  await settled(); await sleep(1500); await ev(mask); await toTabs(); console.log('system cards:', JSON.stringify(await ev(`return [...document.querySelectorAll('[data-card-id]')].map(c=>{const r=c.getBoundingClientRect();return c.dataset.cardId+':'+Math.round(r.left)+','+Math.round(r.top)+'-'+Math.round(r.bottom)})`))); await shot('system', { keepScroll: true })
  await click('[role=tab]', 'Dashboard'); await sleep(800)

  await ready('#/settings?tab=plugins&plugin=ultimate-dashboard%3Asettings'); await shot('settings')

  await ready('#/ultimate-dashboard'); await settled()
  if (!(await click('button', 'Edit layout'))) throw new Error('Edit layout button not found')
  await sleep(1500); await ev(`for(const b of document.querySelectorAll('button')) if(b.getAttribute('aria-label')==='Dismiss notification') b.click()`); await toTabs(); await shot('edit-layout', { keepScroll: true })
  if (!(await click('button', 'Cards'))) throw new Error('Cards button not found') // opens the gallery dialog over edit mode
  await sleep(1500); await ev(mask)
  // the gallery list scrolls inside the dialog (60vh high): scroll it to the first row start where no tile is cut by its top or bottom edge
  // a tile counts as cut when an edge of the list crosses it or the next row's top sits within 2px of the list's bottom edge (a border sliver)
  const clipped = `const g=document.querySelector('.ht-gal');if(!g)return 1;const a=g.getBoundingClientRect(),b=a.bottom;return [...g.children].filter(t=>{const r=t.getBoundingClientRect();return (r.top<b+2&&r.bottom>b)||(r.top<a.top+2&&r.bottom>a.top+2)}).length`
  const rowStarts = await ev(`const g=document.querySelector('.ht-gal');return [...new Set([...g.children].map(t=>t.offsetTop-g.children[0].offsetTop))]`)
  scan: for (const o of rowStarts) for (const d of [0, -4, -8, 4, 8, 12]) { await ev(`document.querySelector('.ht-gal').scrollTop=${o + d}`); await sleep(200); if (!(await ev(clipped))) break scan }
  console.log('add-card tile tops/bottoms vs list:', JSON.stringify(await ev(`const g=document.querySelector('.ht-gal'),a=g.getBoundingClientRect();return [Math.round(a.top),Math.round(a.bottom),[...g.children].map(t=>{const r=t.getBoundingClientRect();return Math.round(r.top)+'-'+Math.round(r.bottom)})]`)))
  console.log('add-card viewport height:', await ev(`return innerHeight`), 'clipped tiles:', await ev(clipped), 'list scrollTop:', await ev(`return document.querySelector('.ht-gal').scrollTop`)); await shot('add-card', { keepScroll: true })
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`); await sleep(500)
  await click('button', 'Cancel')
} finally {
  try { ws?.close() } catch {}
  chrome.kill("SIGTERM"); await stopGateway()
}
