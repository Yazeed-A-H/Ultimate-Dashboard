import { test } from 'node:test'
import assert from 'node:assert/strict'
import { liveView, toolKey, usual } from '../src/state/live.js'
import { CARDS, getCard } from '../src/state/cards.js'
import { FLAT } from '../src/ui/i18n.js'

test('toolKey: known tools, mcp prefix, browser_*, unknown -> null (the card shows the raw name)', () => {
  for (const k of ['terminal', 'execute_code', 'read_file', 'search_files', 'patch', 'write_file', 'web_search', 'web_extract', 'delegate_task', 'skill_view', 'vision_analyze']) assert.equal(toolKey(k), k)
  assert.equal(toolKey('browser_exec'), 'browser'); assert.equal(toolKey('mcp__playwright__browser_navigate'), 'browser'); assert.equal(toolKey('mcp__my_srv__read_file'), 'read_file')
  for (const k of ['process_manage', 'tool_call', 'mcp__x__unknown', '', null, undefined, 'Terminal']) assert.equal(toolKey(k), null)
})

test('every mapped tool has plain words in both languages, and the card is registered last, l and xl, one instance', () => {
  for (const k of ['terminal', 'execute_code', 'read_file', 'search_files', 'patch', 'write_file', 'web_search', 'web_extract', 'browser', 'delegate_task', 'skill_view', 'vision_analyze']) for (const l of ['en', 'ar']) assert.equal(typeof FLAT[l]['lv.t.' + k], 'string', `${l} ${k}`)
  const c = CARDS.at(-1)
  assert.deepEqual([c.id, c.sizes, c.defaultSize, c.multi], ['live', ['l', 'xl'], 'l', false]); assert.equal(getCard('live'), c)
  assert.equal(FLAT.en['lv.steps']({ n: 1 }), '1 step'); assert.equal(FLAT.en['lv.steps']({ n: 3 }), '3 steps')
  assert.deepEqual([1, 2, 3, 11].map(n => FLAT.ar['lv.steps']({ n })), ['خطوة واحدة', 'خطوتان', '3 خطوات', '11 خطوة'])
})

const task = (i, status, extra) => ({ index: i, goal: 'g' + i, model: 'm', started: 100, ended: null, status, steps: 1, truncated: false, now: null, last: [], ...extra })
const grp = (id, parent, running, tasks, started = 100) => ({ id, started, completed: null, running, parent, tasks })
const main = (id, extra) => ({ id, title: id, source: 'desktop', last_at: 1, steps: 2, turn_at: 90, now: null, last: [], ...extra })
const blk = (at, secs, ok = true, tool = 'terminal') => ({ at, secs, ok, tool })
const view = (groups, mains = [], active = [], at = 200) => liveView({ at, groups, mains }, active)

test('liveView: a running batch is one section, its Main lane waiting while only Workers run, worker states from the status', () => {
  const v = view([grp('d1', 's1', true, [task(0, 'running'), task(1, 'completed', { ended: 150 }), task(2, 'interrupted', { ended: 160 }), task(3, 'stalled', { ended: 170 })])], [main('s1')])
  assert.equal(v.sections.length, 1); assert.equal(v.last, null)
  const [s] = v.sections
  assert.deepEqual([s.id, s.main.state, s.main.kind, s.running], ['s1', 'waiting', 'main', true])
  assert.deepEqual(s.workers.map(w => [w.kind, w.key, w.state, w.end]), [['worker', 'd1:0', 'running', null], ['worker', 'd1:1', 'done', 150], ['worker', 'd1:2', 'failed', 160], ['worker', 'd1:3', 'failed', 170]])
  assert.equal(v.running, 1) // only the running Worker; the waiting Main is not counted
})

test('liveView: Main runs on a pending tool call or an active session that is not idle/waiting; now.tool = the first pending name', () => {
  const g = [grp('d1', 's1', true, [task(0, 'running')])]
  const m = view(g, [main('s1', { now: { at: 150, tools: ['delegate_task', 'terminal'] } })]).sections[0].main
  assert.deepEqual([m.state, m.now], ['running', { at: 150, tool: 'delegate_task' }])
  assert.equal(view(g, [main('s1')], [{ id: 's1', status: 'working' }]).sections[0].main.state, 'running')
  assert.equal(view(g, [main('s1')], [{ id: 's1', status: 'working' }]).sections[0].main.now, null)
  for (const status of ['idle', 'waiting']) assert.equal(view(g, [main('s1')], [{ id: 's1', status }]).sections[0].main.state, 'waiting')
  assert.equal(view([grp('d1', 's1', false, [task(0, 'completed', { ended: 150 })])], [main('s1')]).last.main.state, 'idle') // every Worker is done: not waiting for any
})

test('liveView: two groups under one parent form one section, Workers ordered by batch start then index', () => {
  const v = view([grp('d2', 's1', true, [task(0, 'running', { started: 150 })], 150), grp('d1', 's1', true, [task(1, 'running'), task(0, 'running')], 100)], [main('s1')])
  assert.equal(v.sections.length, 1)
  assert.deepEqual(v.sections[0].workers.map(w => w.key), ['d1:0', 'd1:1', 'd2:0'])
  assert.equal(v.running, 3)
})

test('liveView: a group without a parent is its own section with no Main; a Main without a group is a section without Workers', () => {
  const v = view([grp('d1', null, true, [task(0, 'running')]), grp('d2', 's2', true, [task(0, 'running', { started: 120 })], 120)], [main('s2', { turn_at: 110 }), main('s3', { turn_at: 190, now: { at: 195, tools: ['terminal'] } }), main('s4')])
  assert.deepEqual(v.sections.map(s => [s.id, s.main?.key ?? null, s.workers.length]), [['s3', 's3', 0], ['s2', 's2', 1], ['d1', null, 1]]) // s4 is idle: no section shown
})

test('liveView: t0 = earliest lane start, t1 = live.at while running; Main start = turn_at, else first block, else first Worker start', () => {
  const g = [grp('d1', 's1', true, [task(0, 'running', { started: 120 })], 120)]
  const at = (m) => view(g, [m], [], 300).sections[0]
  assert.deepEqual([at(main('s1')).t0, at(main('s1')).t1, at(main('s1')).main.start], [90, 300, 90])
  assert.equal(at(main('s1', { turn_at: null, last: [blk(100, 5)] })).main.start, 100)
  assert.equal(at(main('s1', { turn_at: null })).main.start, 120)
})

test('liveView: an ended section ends at its latest lane end or block end; lanes keep {at,secs,ok,tool} blocks', () => {
  const w = task(0, 'completed', { started: 100, ended: 180, last: [blk(110, 20), blk(140, 5, false, 'patch')] })
  const f = task(1, 'interrupted', { started: 100, ended: null, last: [blk(120, 30, true, 'read_file')] }) // no end: last block end
  const s = view([grp('d1', 's1', false, [w, f])], [main('s1', { turn_at: 95, last: [blk(96, 100, true, 'delegate_task')] })], [], 300).last
  assert.deepEqual([s.t0, s.t1, s.running], [95, 196, false])
  assert.deepEqual(s.workers.map(x => x.end), [180, 150]); assert.equal(s.main.end, 196)
  assert.deepEqual(s.workers[0].blocks, [blk(110, 20), blk(140, 5, false, 'patch')])
})

test('liveView: `last` only when nothing runs, the ended section with the newest t1 that has a Worker; running = number of running lanes', () => {
  const done = (id, parent, ended, started = 100) => grp(id, parent, false, [task(0, 'completed', { started, ended })], started)
  const ended = [done('a', 's1', 150), done('b', 's9', 190)]
  const v = view(ended, [main('s1'), main('s7')])
  assert.deepEqual([v.sections, v.last.id, v.last.t1, v.running], [[], 's9', 190, 0])
  assert.equal(view(ended, [main('s1', { now: { at: 190, tools: ['terminal'] } })]).last, null) // a chat is still working
  assert.equal(view([...ended, grp('run', null, true, [task(0, 'running')])]).last, null)
  assert.equal(view([], [main('s7')]).last, null) // a quiet chat alone has no Workers
  assert.deepEqual(liveView({ groups: [], mains: [] }, []), { sections: [], last: null, running: 0 })
  assert.deepEqual(liveView(undefined, undefined), { sections: [], last: null, running: 0 })
})

test('liveView: a main running and its worker count both; newest section first', () => {
  const v = view([grp('o', 's1', true, [task(0, 'running')], 100), grp('n', 's2', true, [task(0, 'running', { started: 150 })], 150)],
    [main('s1', { now: { at: 190, tools: ['terminal'] } }), main('s2', { turn_at: 150 })])
  assert.deepEqual(v.sections.map(s => s.id), ['s2', 's1']); assert.equal(v.running, 3)
})

const row = (secs, extra) => ({ model: 'm', started_at: 1000, ended_at: 1000 + secs, end_reason: 'completed', ...extra })
const rows = (model, ...secs) => secs.map(s => row(s, { model }))

test('usual: quartiles by index floor((n-1)*q), the same model when it has 5 rows, else all, under 5 -> null, failed and unfinished rows ignored', () => {
  assert.deepEqual(usual(rows('m', 50, 10, 40, 20, 30, 60, 70, 80, 90), 'm'), { lo: 30, hi: 70, n: 9 }) // sorted 10..90: index 2 and 6
  assert.deepEqual(usual(rows('m', 10, 20, 30, 40, 50, 60), 'm'), { lo: 20, hi: 40, n: 6 }) // floor(5 * .25) = 1, floor(5 * .75) = 3
  assert.deepEqual(usual(rows('m', 10, 20, 30, 40, 50), 'm'), { lo: 20, hi: 40, n: 5 })
  const mixed = [...rows('a', 1, 2, 3, 4, 5), ...rows('b', 100, 200, 300, 400, 500)]
  assert.deepEqual(usual(mixed, 'b'), { lo: 200, hi: 400, n: 5 }) // same model wins
  assert.deepEqual(usual([...rows('a', 1, 2, 3), ...rows('b', 100, 200)], 'c'), { lo: 2, hi: 100, n: 5 }) // fewer than 5 of 'c': all rows
  assert.deepEqual(usual([...rows('a', 1, 2, 3, 4), ...rows('b', 10)], 'a'), { lo: 2, hi: 4, n: 5 }) // 4 of 'a' < 5: all five rows
  assert.equal(usual(rows('m', 10, 20, 30, 40), 'm'), null)
  const noisy = [...rows('m', 10, 20, 30, 40), row(50, { end_reason: 'error' }), row(60, { end_reason: 'interrupted_failed' }), row(5, { ended_at: null }), row(0), row(-5)]
  assert.equal(usual(noisy, 'm'), null) // only 4 usable rows
  assert.equal(usual([...noisy, row(70)], 'm').n, 5)
  assert.equal(usual(undefined, 'm'), null); assert.equal(usual([], 'm'), null)
})

test('liveView with history: running Workers get `usual`/`late`; the section gets total and done', () => {
  const hist = rows('m', 120, 180, 240, 300, 360) // lo 180, hi 300 (index 1 and 3)
  const sec = (tasks, h = hist) => liveView({ at: 1000, groups: [grp('d1', 's1', true, tasks, 900)], mains: [main('s1')] }, [], h).sections[0]
  const s = sec([task(0, 'running', { started: 940 }), task(1, 'running', { started: 900 }), task(2, 'completed', { started: 900, ended: 950 }), task(3, 'interrupted', { started: 900, ended: 960 })])
  assert.deepEqual(s.workers.map(w => [w.usual?.hi ?? null, w.late]), [[300, false], [300, false], [null, false], [null, false]]) // ended Workers: no estimate
  assert.deepEqual([s.total, s.done, s.t1], [4, 2, 1000])
  assert.deepEqual([s.main.usual, s.main.late], [null, false])
  const l = sec([task(0, 'running', { started: 940 }), task(1, 'running', { started: 600 })]) // the second is 400 s in: past 300
  assert.deepEqual(l.workers.map(w => w.late), [false, true])
  assert.equal(sec([task(0, 'running', { started: 700 })]).workers[0].late, false) // exactly 300 s in: not yet late
})

test('liveView without history: no estimate; an ended section counts its Workers', () => {
  for (const h of [undefined, null, [], rows('m', 1, 2, 3, 4)]) {
    const s = liveView({ at: 1000, groups: [grp('d1', 's1', true, [task(0, 'running', { started: 940 }), task(1, 'completed', { started: 900, ended: 950 })], 900)], mains: [main('s1')] }, [], h).sections[0]
    assert.deepEqual([s.workers[0].usual, s.workers[0].late, s.t1, s.total, s.done], [null, false, 1000, 2, 1])
  }
  const e = liveView({ at: 1000, groups: [grp('d1', 's1', false, [task(0, 'completed', { started: 900, ended: 950 }), task(1, 'interrupted', { started: 900, ended: 970 })], 900)], mains: [main('s1')] }, [], rows('m', 120, 180, 240, 300, 360)).last
  assert.deepEqual([e.t1, e.total, e.done], [970, 2, 2])
})

test('liveView: a running chat shows only the current turn batches (a still-running older one stays); an ended chat or a Main without turn_at keeps all', () => {
  const old = (running, ended = 150) => grp('old', 's1', running, [running ? task(0, 'running', { started: 20 }) : task(0, 'completed', { started: 20, ended })], 20), cur = grp('cur', 's1', true, [task(0, 'running', { started: 100 })], 100)
  const a = view([old(false), cur], [main('s1', { turn_at: 90 })]).sections[0] // old ended before the turn: dropped
  assert.deepEqual([a.workers.map(w => w.key), a.total, a.done, a.t0], [['cur:0'], 1, 0, 90])
  const b = view([old(true), cur], [main('s1', { turn_at: 90 })]).sections[0] // old still runs: kept
  assert.deepEqual([b.workers.map(w => w.key), b.total, b.t0], [['old:0', 'cur:0'], 2, 20])
  const c = view([old(false, 30), grp('b', 's1', false, [task(0, 'completed', { started: 40, ended: 60 })], 40)], [main('s1', { turn_at: 90 })])
  assert.deepEqual([c.sections.length, c.last.workers.length, c.last.total], [0, 2, 2]) // not running: both ended batches kept
  const d = view([old(false), cur], [main('s1', { turn_at: null })]).sections[0]
  assert.deepEqual([d.workers.length, d.total, d.done], [2, 2, 1])
})
