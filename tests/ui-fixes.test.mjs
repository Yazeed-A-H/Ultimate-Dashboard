// Static guards for the dashboard page / cards fixes; the behaviour needs a real window.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FLAT } from '../src/ui/i18n.js'

const ui = f => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/ui', f), 'utf8')
const [page, cards, parts, css, settings] = ['page.jsx', 'cards.jsx', 'parts.jsx', 'css.js', 'settings.jsx'].map(ui)

test('view tab keys are ignored unless they come from a tab (⋯ menu bubbles through the tablist)', () => {
  assert.match(page, /const onKey = e => \{\s*if \(e\.target\.getAttribute\('role'\) !== 'tab'\) return/)
})

test('the page re-renders every 30 s through ctx (relative times, greeting, date)', () => {
  assert.match(page, /useEffect\(\(\) => R\.ctx\.setInterval\(tick, 30000\), \[\]\)/)
})

test('gallery resets its search on open, not on close', () => {
  assert.match(page, /useEffect\(\(\) => \{ if \(open\) \{ setQ\(''\); setSaid\(''\) \} \}, \[open\]\)/)
  assert.doesNotMatch(page, /onOpenChange=\{o => \{ if \(!o\) \{ \$dlg\.set\(null\); setQ/)
})

test('cron chip and sort share one tone; approvals show every row', () => {
  assert.equal((cards.match(/const cronTone =/g) || []).length, 1)
  assert.match(cards, /<Tone tone=\{cronTone\(j\)\}/)
  assert.match(cards, /<List items=\{d\} limit=\{Infinity\}/)
})

test('autosave passes auto=true and WarnField ignores an invalid debounced value', () => {
  assert.match(parts, /save\(v, true\)/)
  assert.match(page, /onSave=\{\(v, auto\) => \{[^}]*if \(!ok && auto\) return/)
})

test('every ht- class used in a literal className exists in the CSS', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/ui')
  const used = new Set()
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.jsx'))) for (const m of ui(f).matchAll(/className="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (/^ht-[\w-]+$/.test(c)) used.add(c)
  assert.ok(used.size > 50, 'found the class names')
  assert.deepEqual([...used].filter(c => !new RegExp(`\\.${c}(?![\\w-])`).test(css)), [])
  assert.doesNotMatch(cards, /ht-kpi-s/)
})

test('the move-to-view menu hides a view that already holds the most instances', () => {
  assert.match(page, /!atCap\(v\.cards, c\.id\)\)\.map\(v => <DropdownMenuItem key=\{v\.id\} onSelect=\{\(\) => R\.store\.moveCardToView/)
})

test('smaller leftovers: no raw run.status fallback, no unused helpers, no void doc', () => {
  assert.doesNotMatch(cards, /t\('run\.status\.' \+ s\.status\) \|\|/)
  assert.doesNotMatch(page, /void doc/)
  assert.doesNotMatch(parts, /\bnf, n:/)
  assert.doesNotMatch(page, /useUsage/) // the provider list must not spawn `hermes usage`
})

// UI review fixes. Layout and focus need a real window; these keep the code that fixes them from being undone.
test('Next 7 days: frequent lines span the row, long names wrap, menu titles get the --ht-* vars', () => {
  assert.match(css, /\.ht-wk > \.ht-rw-m \{ grid-area: auto \/ 1 \/ auto \/ -1; \}/)
  assert.match(css, /\.ht-wk-r > :not\(time\) \{ min-inline-size: 0; overflow-wrap: anywhere; \}/)
  assert.match(css, /^\.ht, \.ht-dlg, \.ht-menu \{/m)
  assert.match(page, /<DropdownMenuContent align="start" className="ht-menu">/)
  assert.doesNotMatch(page, /<p className="ht-sub-t"/) // a <p> inside role=menu
})

test('SaveInput does not write the store\'s trimmed value back over a typed trailing space', () => {
  assert.match(parts, /const keep = next => cur => \(cur\.trim\(\) === next \? cur : next\)/)
  assert.match(parts, /useEffect\(\(\) => setV\(keep\(saved\)\), \[saved\]\)/)
  assert.match(parts, /if \(auto\) \{ if \(typeof r === 'string'\) setV\(keep\(r\)\) \}/) // an onSave that returns the trimmed text (card title, view name) goes the same way
})

test('Job result re-measures "Show more" when the card resizes', () => {
  assert.match(cards, /new ResizeObserver\(measure\)/)
  assert.match(cards, /typeof ResizeObserver === 'undefined'/)
  assert.match(cards, /return \(\) => ro\.disconnect\(\)/)
})

test('every SegmentedControl sits in a named group, and nothing passes it a dead aria-label', () => {
  let n = 0
  for (const s of [page, cards, settings]) {
    for (const m of s.matchAll(/<SegmentedControl/g)) { n++; assert.match(s.slice(Math.max(0, m.index - 140), m.index), /<div role="group" aria-label(ledby)?=[^>]*>$/) }
  }
  assert.equal(n, 6)
  assert.doesNotMatch(cards, /<SegmentedControl[^>]*aria-label/)
})

test('Rename, Card settings and a deleted Settings view give focus back', () => {
  assert.equal((page.match(/onCloseAutoFocus=\{focusBack\}/g) || []).length, 2)
  assert.match(page, /data-ht-cm=\{c\.id\}/) // the ⋯ trigger Card settings returns to
  assert.match(settings, /<Confirm open=\{!!ask\} back=\{\(\) => back\.current\?\.\(\)\}/)
  assert.match(settings, /b\.isConnected \? null : ol\.querySelector\('input'\)/)
  assert.match(settings, /className="ht-dlg ht-dlg-form" onCloseAutoFocus=\{focusBack\}/) // the shortcut dialog
})

test('a11y wording: current-chat shortcut label, Health link names, one name per +N more, group not toolbar', () => {
  assert.match(page, /t\(sc\.target === 'current' \? 'ql\.launchCurrentL' : 'ql\.launchL'/)
  assert.match(cards, /aria-label=\{t\('hl\.openL', \{ name: nm\(i\) \}\)\}/)
  assert.doesNotMatch(parts, /aria-expanded=\{expanded\}/) // the name already flips to "Show less"
  assert.doesNotMatch(cards, /aria-expanded/) // same for Job result's Show more
  assert.doesNotMatch(page, /role="toolbar"/)
  for (const k of ['ql.launchCurrentL', 'hl.openL', 'cron.day']) for (const l of ['en', 'ar']) assert.equal(typeof FLAT[l][k], 'string', `${l} ${k}`)
})

test('job result links: the click goes through ctx.os.openExternal and falls back on its false, never through the raw bridge', () => {
  assert.doesNotMatch(cards, /window\.hermesDesktop/)
  assert.match(cards, /os\.openExternal\(u\)\.then\(ok => ok \|\| window\.open\(u, '_blank', 'noopener,noreferrer'\)\)/)
})

test('sub-headings are h3 under the h2 card titles; the day label separator comes from i18n', () => {
  assert.doesNotMatch(cards, /<p className="ht-sub-t"/)
  assert.equal((cards.match(/<h3 className="ht-sub-t">/g) || []).length, 8)
  assert.match(page, /<h2 className="ht-card-t"/)
  assert.match(cards, /t\('cron\.day', \{ rel:/)
  assert.doesNotMatch(cards, /\+ ', '/)
  assert.equal(FLAT.en['cron.day'], '{rel}, {date}')
  assert.equal(FLAT.ar['cron.day'], '{rel}، {date}') // Arabic comma
})
