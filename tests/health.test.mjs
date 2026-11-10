import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateHealth } from '../src/state/health.js'

const up = { gateway_running: true, gateway_state: 'running' }
const run = (o = {}) => evaluateHealth({ status: up, cron: [], ...o })
const one = (o, kind) => run(o).items.filter(i => i.kind === kind)
const job = (o = {}) => ({ job_id: 'j1', name: 'Backup', schedule: '0 4 * * *', enabled: true, ...o })

test('level: all clear and missing required sources', () => {
  assert.deepEqual(run(), { level: 'ok', items: [], unchecked: [] })
  assert.deepEqual(evaluateHealth({ cron: [] }), { level: 'unknown', items: [], unchecked: ['status'] })
  assert.deepEqual(evaluateHealth({ status: up }), { level: 'unknown', items: [], unchecked: ['cron'] })
  assert.deepEqual(evaluateHealth().unchecked, ['status', 'cron'])
  // optional sources never matter
  assert.equal(run({ mcp: undefined, usage: undefined }).level, 'ok')
  // a problem outranks "unknown"
  assert.equal(evaluateHealth({ status: { gateway_running: false } }).level, 'bad')
})

test('gateway', () => {
  for (const [status, sev, detail] of [
    [{ gateway_running: false }, 2, 'down'],
    [{ gateway_running: true, gateway_state: 'startup_failed' }, 2, 'down'],
    [{ gateway_running: true, gateway_state: 'degraded' }, 1, 'stale'],
    [{ gateway_running: true, gateway_state: 'running', gateway_heartbeat_stale_s: 30 }, 1, 'stale']
  ]) assert.deepEqual(evaluateHealth({ status, cron: [] }).items[0], { sev, kind: 'gateway', name: '', detail, fix: 'messaging' })
  for (const s of ['draining', 'starting', null]) assert.equal(run({ status: { ...up, gateway_state: s } }).level, 'ok', String(s))
  // gateway down: platforms are not listed on top of it
  const down = evaluateHealth({ status: { gateway_running: false, gateway_platforms: { telegram: { state: 'fatal' } } }, cron: [] })
  assert.deepEqual(down.items.map(i => i.kind), ['gateway'])
})

test('platforms', () => {
  const plat = gateway_platforms => one({ status: { ...up, gateway_platforms } }, 'platform').map(i => [i.name, i.sev, i.detail])
  assert.deepEqual(plat({ telegram: { state: 'connected' }, discord: { state: 'disabled' }, slack: { state: 'ok' } }), [])
  assert.deepEqual(plat({ telegram: { state: 'fatal' } }), [['Telegram', 2, 'fatal']])
  assert.deepEqual(plat({ telegram: { state: 'retrying', needs_attention: true } }), [['Telegram', 2, 'retrying']])
  assert.deepEqual(plat({ telegram: { state: 'retrying' } }), [['Telegram', 1, 'retrying']])
  assert.deepEqual(plat({ telegram: { state: 'paused' } }), [['Telegram', 1, 'paused']])
  assert.deepEqual(plat({ whatsapp_work: { state: 'disconnected' } }), [['Whatsapp Work', 1, 'unknown']])
  assert.equal(one({ status: { ...up, gateway_platforms: { telegram: { state: 'fatal' } } } }, 'platform')[0].fix, 'messaging')
})

test('cron', () => {
  const sev = j => one({ cron: [job(j)] }, 'cron').map(i => [i.sev, i.detail])
  assert.deepEqual(sev({ last_status: 'ok' }), [])
  assert.deepEqual(sev({}), []) // never ran
  assert.deepEqual(sev({ last_status: 'error' }), [[2, 'failed']])
  assert.deepEqual(sev({ last_status: 'delivery_failed', last_error: 'x' }), [[2, 'failed']])
  assert.deepEqual(sev({ last_status: 'delivery_failed' }), [])
  assert.deepEqual(sev({ last_status: 'blocked_config' }), [[1, 'other']])
  assert.deepEqual(sev({ last_status: 'cancelled' }), [[1, 'other']])
  // isFailed (/err|fail/) matches 'interrupted' (int-err-upted), so it is red, same as the Cron card's chip
  assert.deepEqual(sev({ last_status: 'interrupted' }), [[2, 'failed']])
  assert.deepEqual(sev({ last_status: 'error', enabled: false }), []) // paused is a choice
  assert.deepEqual(sev({ last_status: 'error', state: 'paused' }), [])
  assert.deepEqual(sev({ last_status: 'error', name: 'hermes-mobile-device-access-0a1b2c3d', schedule: 'once in 1m' }), [])
  assert.equal(one({ cron: [job({ last_status: 'error' })] }, 'cron')[0].fix, 'cron')
  assert.equal(one({ cron: [job({ last_status: 'error', name: '' })] }, 'cron')[0].name, 'j1')
})

test('mcp', () => {
  const m = (o) => one({ mcp: [{ name: 's', transport: 'http', status: 'connected', ...o }] }, 'mcp').map(i => [i.sev, i.detail, i.fix])
  assert.deepEqual(m({ needs_auth: true }), [[1, 'auth', 'capabilities']])
  assert.deepEqual(m({ needs_auth: true, transport: 'stdio' }), [[1, 'auth', 'capabilities']])
  assert.deepEqual(m({ status: 'failed' }), [[1, 'failed', 'capabilities']])
  assert.deepEqual(m({ status: 'failed', transport: 'stdio' }), [])
  for (const status of ['connecting', 'lazy', 'configured', 'disabled', 'connected']) assert.deepEqual(m({ status }), [], status)
})

test('disk', () => {
  const d = pressure => one({ status: { ...up, disk: { pressure } } }, 'disk').map(i => [i.sev, i.detail, i.fix])
  assert.deepEqual(d('critical'), [[2, 'critical', null]])
  assert.deepEqual(d('elevated'), [[1, 'elevated', null]])
  assert.deepEqual(d('unknown'), [])
  assert.deepEqual(d('ok'), [])
  assert.deepEqual(d(undefined), [])
})

test('usage', () => {
  const u = (...p) => one({ usage: [{ slug: 'a', name: 'Alpha', windows: p.map(used_percent => ({ used_percent })) }] }, 'usage').map(i => [i.sev, i.detail, i.name])
  assert.deepEqual(u(89), [])
  assert.deepEqual(u(90), [[1, 'near', 'Alpha']])
  assert.deepEqual(u(10, 100), [[2, 'full', 'Alpha']])
  assert.deepEqual(u(undefined, null), [])
  assert.deepEqual(one({ usage: [{ slug: 'a', windows: [{ used_percent: 95 }] }] }, 'usage')[0].name, 'a')
  assert.deepEqual(one({ usage: [{ slug: 'a' }] }, 'usage'), [])
})

test('ranking', () => {
  const r = evaluateHealth({
    status: { ...up, disk: { pressure: 'critical' }, gateway_platforms: { telegram: { state: 'retrying' } } },
    cron: [job({ name: 'B', last_status: 'error' }), job({ job_id: 'j2', name: 'A', last_status: 'error' }), job({ job_id: 'j3', name: 'W', last_status: 'cancelled' })],
    mcp: [{ name: 'm', transport: 'http', needs_auth: true }],
    usage: [{ slug: 'u', name: 'U', windows: [{ used_percent: 95 }] }]
  })
  assert.deepEqual(r.items.map(i => `${i.sev}${i.kind}${i.name}`), ['2cronA', '2cronB', '2disk', '1platformTelegram', '1cronW', '1mcpm', '1usageU'])
  assert.equal(r.level, 'bad')
  const g = evaluateHealth({ status: { gateway_running: false }, cron: [job({ last_status: 'error' })] })
  assert.deepEqual(g.items.map(i => i.kind), ['gateway', 'cron'])
  assert.equal(run({ usage: [{ slug: 'u', windows: [{ used_percent: 91 }] }] }).level, 'warn')
})

test('privacy: free text from the inputs never reaches the result', () => {
  const S = 'SECRET-sentinel'
  const r = evaluateHealth({
    status: { gateway_running: true, gateway_state: 'degraded', gateway_exit_reason: S, disk: { pressure: 'critical', path: S }, gateway_platforms: { telegram: { state: 'fatal', error_message: S, error_code: S } } },
    cron: [job({ last_status: 'error', last_error: S, last_fire_error: S, prompt: S })],
    mcp: [{ name: 'm', transport: 'http', status: 'failed', error: S, url: S }],
    usage: []
  })
  assert.ok(r.items.length >= 5)
  assert.doesNotMatch(JSON.stringify(r), /SECRET/)
})
