// Static guards over the source and the built bundle.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLAT } from '../src/ui/i18n.js'
import { CRON_STATUSES, usageText } from '../src/state/format.js'
import { build } from 'esbuild'
import { options } from '../tools/build-options.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const allSrc = fs.readdirSync(path.join(root, 'src/state')).map(f => fs.readFileSync(path.join(root, 'src/state', f), 'utf8'))
const src = fs.readdirSync(path.join(root, 'src/ui')).filter(f => /\.(jsx?|mjs)$/.test(f) && !f.endsWith('.gen.js')).map(f => [f, fs.readFileSync(path.join(root, 'src/ui', f), 'utf8')])
const bundle = fs.readFileSync(path.join(root, 'plugin/desktop/plugin.js'), 'utf8')

test('no hard-coded colours in UI source', () => {
  for (const [f, s] of src) {
    const code = s.replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(code, /#[0-9a-fA-F]{3,8}\b(?![\w-])/, `${f}: hex colour`)
    assert.doesNotMatch(code, /\b(rgba?|hsla?|oklch)\(/, `${f}: colour function`)
    assert.doesNotMatch(code, /:\s*(white|black|red|green|blue|yellow|orange|gray|grey)\b/, `${f}: named colour`)
  }
})

test('bundle imports only the three allowed specifiers', () => {
  const specs = [...bundle.matchAll(/\bimport\s*[{*\w][^;"']*?from\s*["']([^"']+)["']/g)].map(m => m[1])
  assert.deepEqual([...new Set(specs)].sort(), ['@hermes/plugin-sdk', 'react', 'react/jsx-runtime'])
})

test('timers and listeners go through ctx (no leaks on disable)', () => {
  for (const [f, s] of src) {
    assert.doesNotMatch(s, /(?<![.\w])(window\.)?set(Interval|Timeout)\(/, `${f}: raw timer`)
    assert.doesNotMatch(s, /(window|document)\.addEventListener\(/, `${f}: global listener`)
    assert.doesNotMatch(s, /localStorage|sessionStorage/, `${f}: direct web storage`)
  }
})

test('approvals: only once/deny, always with a request_id', () => {
  const all = src.map(([, s]) => s).join('\n')
  const calls = [...all.matchAll(/approval\.respond'[^)]*\)/g)].map(m => m[0])
  assert.ok(calls.length >= 1)
  for (const c of calls) { assert.match(c, /request_id/); assert.doesNotMatch(c, /\ball\b|always|'session'/) }
  assert.doesNotMatch(all, /choice:\s*'(always|session)'/)
  assert.doesNotMatch(all, /composer\.submit\(/, 'Quick launch must never send')
})

test('no physical left/right in the stylesheet except the drag overlay', () => {
  const css = fs.readFileSync(path.join(root, 'src/ui/css.js'), 'utf8')
  assert.doesNotMatch(css, /(margin|padding|border)-(left|right)|\b(left|right)\s*:|text-align:\s*(left|right)/)
})

test('every English key has an Arabic string, and back', () => {
  const en = Object.keys(FLAT.en), ar = new Set(Object.keys(FLAT.ar))
  assert.deepEqual(en.filter(k => !ar.has(k)), [])
  assert.deepEqual([...ar].filter(k => !(k in FLAT.en)), [])
})

test('every t() key used in the UI exists', () => {
  const used = new Set()
  for (const [, s] of src) for (const m of s.matchAll(/\bt\('([\w.-]+)'/g)) if (!m[1].endsWith('.')) used.add(m[1])
  const missing = [...used].filter(k => !(k in FLAT.en))
  assert.deepEqual(missing, [])
})

test('every cron status, usage label and plural has en + ar text', () => {
  for (const s of [...CRON_STATUSES, 'other']) for (const l of ['en', 'ar']) assert.equal(typeof FLAT[l]['cron.st.' + s], 'string', `${l} cron.st.${s}`)
  for (const label of ['Weekly', 'Session', 'Current week', 'Current session', 'API key quota', 'Fable week']) for (const l of ['en', 'ar']) assert.ok(FLAT[l][usageText(label)[0]], `${l} ${label}`)
  assert.ok(FLAT.en[usageText('$1 of $2 remaining', true)[0]])
  for (const l of ['en', 'ar']) assert.ok(FLAT[l]['ses.new'] && FLAT[l]['u.loading'] && FLAT[l]['st.backend'], l)
})

test('sources keep the promises (new-chat label, quiet backend card, loading line, never sends)', () => {
  const by = Object.fromEntries(src)
  assert.match(by['cards.jsx'], /'ses\.new'/, '0-message sessions say New chat')
  assert.match(by['parts.jsx'], /backend && sync\.backend === 'off'/, 'a backend card is quiet when the backend is off')
  assert.match(by['page.jsx'], /sync\.backend === 'off' \? <p className="ht-banner"/, 'one banner on the page')
  assert.doesNotMatch(by['parts.jsx'], /t\('st\.backend'\)/, 'no per-card backend box')
  for (const c of ['Machine', 'RecentFiles', 'Workers', 'Activity']) assert.match(by['cards.jsx'].split(`export function ${c}(`)[1]?.split('\nexport ')[0] || '', /<Q q=\{(q|hist)\} backend/, `${c} is a backend card`)
  assert.match(by['cards.jsx'], /<Q q=\{q\} wait=\{t\('u\.loading'\)\}/, 'usage cards show the loading line')
  assert.doesNotMatch(by['quick.js'].replace(/\/\/.*$/gm, ''), /submit|prompt\.|send/i, 'Quick launch never sends')
  assert.match(by['index.jsx'], /KEYBINDS_AREA/, 'keys go through the Hermes keybinding registry')
})

test('approvals fail loudly, settle before Approve/Reject, no KPI card code left', () => {
  const data = fs.readFileSync(path.join(root, 'src/ui/data.js'), 'utf8'), cards = src.find(([f]) => f === 'cards.jsx')[1]
  assert.match(data, /gatherApprovals\(/, 'every approval.pending failing is an error (state.test), not "all clear"')
  assert.match(data, /\.sort\(oldestFirst\)/, 'deterministic order')
  assert.match(cards, /SETTLE_MS = 600/); assert.match(cards, /disabled=\{off\}/)
  assert.doesNotMatch(cards, /Kpi|KWait|PinnedCron|function Running/)
  assert.equal([...cards.matchAll(/choice: 'once'|respond\('once'\)/g)].length >= 1, true)
})

test('card ids, view names and removed i18n keys', () => {
  for (const k of ['card.k-wait', 'card.running', 'card.pinned-cron', 'wait.c', 'u.top', 's.range', 's.hideGreet', 's.backend', 'act.customize']) assert.equal(k in FLAT.en, false, k)
  assert.equal(FLAT.en['view.ops'], 'System'); assert.equal(FLAT.ar['view.ops'], 'النظام')
  assert.equal(FLAT.en['act.editLayout'], 'Edit layout'); assert.equal(FLAT.en['act.settings'], 'Settings')
  for (const l of ['en', 'ar']) for (const id of ['approvals', 'recent-sessions', 'cron', 'usage', 'recent-files', 'services', 'machine', 'workers', 'job-result', 'health', 'logs', 'memory', 'skills', 'spend', 'activity']) assert.ok(FLAT[l]['card.' + id] && FLAT[l]['desc.' + id], `${l} ${id}`)
})

// Keys built at run time (`t('card.' + id)`): used when their prefix is one of these. Everything else must appear as a literal.
const DYNAMIC = ['run.status.', 'cron.st.', 'svc.', 'card.', 'desc.', 'range.', 'tpl.', 'size.', 'opt.', 'f.', 'r.', 'icon.', 'imp.', 'greet.', 'view.', 'u.w.', 'u.d.', 'hl.']
test('every i18n key is used (literally or by a known dynamic prefix)', () => {
  const text = [...src.map(([, s]) => s), ...allSrc].join('\n')
  const unused = Object.keys(FLAT.en).filter(k => !DYNAMIC.some(p => k.startsWith(p)) && !text.includes(`'${k}'`) && !text.includes(`"${k}"`) && !['nav', 'title'].includes(k))
  assert.deepEqual(unused, [])
})

test('Arabic copy uses Hermes\' own terms and no glued Latin article', () => {
  const ar = Object.values(FLAT.ar).filter(v => typeof v === 'string').join('\n')
  assert.doesNotMatch(ar, /سكل|الـ [A-Za-z]|▸|مهام cron|وcron/)
  for (const w of ['المهارة', 'المهام المجدولة', 'البوابة', 'الواجهة الخلفية', 'العمّال', 'الفترة', 'محرّر الرسائل']) assert.ok(ar.includes(w), w)
  assert.equal(FLAT.ar['greet.night'], FLAT.ar['greet.evening']); assert.equal(FLAT.en['greet.night'], FLAT.en['greet.evening'])
})

test('plural strings take the raw number (formatting happens in the message)', () => {
  for (const l of ['en', 'ar']) { assert.equal(typeof FLAT[l]['more.n'], 'function', l); assert.equal(typeof FLAT[l]['s.ignored'], 'function', l) }
  assert.equal(FLAT.en['more.n']({ n: 1234 }), '+1,234 more'); assert.equal(FLAT.ar['more.n']({ n: 1234 }), '\u2066+1,234\u2069 أخرى')
  assert.equal(FLAT.en['s.ignored']({ n: 1 }), '1 unknown item was skipped.')
})

test('bundle is minified and small', () => {
  assert.ok(bundle.length < 256 * 1024, `bundle ${bundle.length} bytes`)
  assert.ok(bundle.split('\n').length < 1000)
})

test('the sources keep the a11y and cost promises', () => {
  const by = Object.fromEntries(src), data = by['data.js']
  assert.match(data, /gatherUsage\(/); assert.match(data, /every === false \? false : 10 \* 60e3/, 'manual: no usage timer')
  assert.match(data, /placeholderData: prev => prev/, 'last usage stays while the next loads')
  assert.match(data, /s\.status && s\.status !== 'idle'/, 'approval.pending only for sessions that are not idle')
  assert.match(data, /15e3 : 60e3/, 'approvals: 15 s while one waits, else 60 s')
  assert.match(by['runtime.js'], /R\.mounts > 0/, 'the /state poll runs only while a page is on screen')
  assert.match(by['page.jsx'], /'Home'[\s\S]*'End'/, 'view tabs: Home / End')
  assert.doesNotMatch(by['parts.jsx'], /role="status"><div className="ht-skel"/, 'no live region per loading card')
  assert.match(by['cards.jsx'], /runAction\?\.\(action\)\?\.ok\) host\.navigate\(route\)[\s\S]*nav\('nav\.cron', '\/cron'\)/, 'cron link falls back to the route')
  assert.match(by['quick.js'], /!host\.composer/, 'old hosts without a composer API')
  assert.match(by['css.js'], /\(pointer: coarse\)[\s\S]*\.ht-link[\s\S]*2\.75rem/)
})

test('refresh button: busy spin respects reduced motion, announces via the live region', () => {
  const css = src.find(([f]) => f === 'css.js')[1], page = src.find(([f]) => f === 'page.jsx')[1]
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.ht-spin \{ animation: none/)
  assert.match(page, /aria-busy=\{busy/)
  for (const k of ['act.refreshed', 'act.refreshPartial', 'act.refreshing']) for (const l of ['en', 'ar']) assert.equal(typeof FLAT[l][k], 'string')
})

test('our dialogs follow the direction, one control width, Done/tips feedback wired', () => {
  const css = fs.readFileSync(path.join(root, 'src/ui/css.js'), 'utf8')
  assert.match(css, /\.ht-dlg \.ht-dh[^{]*\{ text-align: start/)
  assert.match(css, /--ht-ctl:/)
  assert.doesNotMatch(css, /\[data-slot/) // Hermes plugin catalog: desktop plugins stay inside the SDK surface
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'plugin/desktop/plugin.js'), 'utf8'), /\[data-slot|ht-cfm|ConfirmDialog/)
  for (const f of ['page.jsx', 'settings.jsx']) assert.match(src.find(([n]) => n === f)[1], /<Confirm open/) // confirms compose Dialog parts (.ht-dh via Confirm)
  const all = src.map(([, s]) => s).join('\n')
  assert.doesNotMatch(all, /inlineSize: '1[246]rem'.*aria-label/) // Settings controls share .ht-ctl
  assert.match(all, /editChanged\(\)/)
  assert.match(all, /setPref\('hintDismissed', false\)/)
})

test('the committed bundle is what tools/build.mjs builds from src/ now', async () => {
  const { outputFiles } = await build({ ...options, write: false, logLevel: 'silent' })
  assert.equal(outputFiles[0].text, bundle, 'plugin/desktop/plugin.js is stale: run node tools/build.mjs')
})

test('confirm dialogs: title clears the close X, focus goes to the destructive button and back to the opener', () => {
  const css = fs.readFileSync(path.join(root, 'src/ui/css.js'), 'utf8'), get = f => src.find(([n]) => n === f)[1]
  assert.match(css, /\.ht-dlg \.ht-dh \{ padding-inline-end: 1\.75rem/) // Hermes pins the X to the physical right
  assert.match(css, /\[dir='rtl'\] \.ht-dlg \.ht-dh \{ padding-inline: 1\.75rem 0/)
  const parts = get('parts.jsx')
  assert.match(parts, /onOpenAutoFocus=\{e => \{ e\.preventDefault\(\); ok\.current\?\.focus\(\)/)
  assert.match(parts, /onCloseAutoFocus=/)
  assert.doesNotMatch(parts, /autoFocus onClick/)
  assert.match(get('page.jsx'), /data-ht-vm=\{v\.id\}/) // the ⋯ trigger the view-delete confirm returns to
})

test('approval text: bidi/invisible controls are shown escaped, and respond() takes only once/deny', () => {
  const parts = src.find(([f]) => f === 'parts.jsx')[1], cards = src.find(([f]) => f === 'cards.jsx')[1], index = src.find(([f]) => f === 'index.jsx')[1]
  const visible = new Function(parts.match(/export const visible = (.*)/)[1].replace(/^/, 'return '))()
  assert.equal(visible('rm\u202E fdp.txt\u2069 \u200B'), 'rm\\u{202e} fdp.txt\\u{2069} \u200B')
  assert.equal(visible('rm\u202E fdp.txt\u2069 \u200B', true), 'rm\\u{202e} fdp.txt\\u{2069} \\u{200b}')
  assert.equal(visible(null), ''); assert.equal(visible('ls -la'), 'ls -la')
  assert.match(cards, /const text = visible\([^\n]*a\.kind === 'command'\)\n/); assert.match(cards, /visible\(a\.description\)/)
  assert.match(index, /visible\(String\(p\.description/)
  assert.match(cards, /if \(choice !== 'once' && choice !== 'deny'\) return/)
})

test('approval text: Arabic/Persian/emoji joiners survive in both tiers; bidi overrides are escaped in both; invisible spacers only in the command tier', () => {
  const parts = src.find(([f]) => f === 'parts.jsx')[1]
  const visible = new Function(parts.match(/export const visible = (.*)/)[1].replace(/^/, 'return '))()
  for (const s of ['می\u200cخواهید', 'README\u200f؟', 'a\u200eb', 'a\u061cb', '👨\u200d👩\u200d👧']) for (const strict of [false, true]) assert.equal(visible(s, strict), s)
  for (const c of ['\u202e', '\u2067', '\u2069']) for (const strict of [false, true]) assert.equal(visible('a' + c, strict), 'a\\u{' + c.codePointAt(0).toString(16) + '}')
  for (const c of ['\u200b', '\u{e0041}', '\u00ad', '\ufeff']) { assert.equal(visible('a' + c), 'a' + c); assert.equal(visible('a' + c, true), 'a\\u{' + c.codePointAt(0).toString(16) + '}') }
})

test('untrusted job output and quick launch stay inert', () => {
  const cards = src.find(([f]) => f === 'cards.jsx')[1], all = src.map(([, s]) => s).join('\n')
  assert.match(cards, /<Streamdown[^>]*rehypePlugins=\{\[\]\}[^>]*components=\{MD\}/)
  assert.match(cards, /const MD = \{ a: .*img: /)
  assert.doesNotMatch(all, /host\.request\('[^']*submit/); assert.doesNotMatch(all, /composer\.submit\(/)
})

test('sidebar label and first view name are Dashboard / لوحة التحكم', () => {
  assert.equal(FLAT.en.nav, 'Dashboard'); assert.equal(FLAT.ar.nav, 'لوحة التحكم')
  assert.equal(FLAT.en['view.today'], 'Dashboard'); assert.equal(FLAT.ar['view.today'], 'لوحة التحكم')
})
