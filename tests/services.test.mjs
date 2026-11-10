import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mcpState, mcpSummary, platformState, PLATFORM_OK } from '../src/state/services.js'
import { evaluateHealth } from '../src/state/health.js'

test('platformState: connected, attention, paused, fatal, unknown, missing', () => {
  assert.equal(platformState({ state: 'connected' }), 'connected')
  assert.equal(platformState({ state: 'connected', needs_attention: true }), 'connected')
  assert.equal(platformState({ state: 'retrying', needs_attention: true }), 'attention')
  assert.equal(platformState({ state: 'fatal' }), 'attention')
  assert.equal(platformState({ state: 'paused' }), 'paused')
  assert.equal(platformState({ state: 'starting' }), 'pending')
  assert.equal(platformState(undefined), 'pending')
  assert.equal(platformState(null), 'pending')
})

test('mcpState: every status maps; disabled and sign-in win', () => {
  const st = (status, x) => mcpState({ status, ...x })
  assert.equal(st('connected'), 'ok')
  assert.equal(st('connecting'), 'connecting')
  assert.equal(st('lazy'), 'lazy')
  assert.equal(st('configured'), 'idle')
  assert.equal(st('failed'), 'failed')
  assert.equal(st('failed', { needs_auth: true }), 'auth')
  assert.equal(st('connected', { disabled: true }), 'off')
  assert.equal(st('disabled'), 'off')
  assert.equal(mcpState(undefined), 'idle')
})

test('mcpSummary counts; bad input is empty', () => {
  const r = mcpSummary([{ status: 'connected' }, { status: 'connected' }, { status: 'failed' }, { status: 'failed', needs_auth: true }, { status: 'lazy' }, { status: 'disabled' }])
  assert.deepEqual(r, { connected: 2, failing: 1, needsAuth: 1, total: 6 })
  assert.deepEqual(mcpSummary(undefined), { connected: 0, failing: 0, needsAuth: 0, total: 0 })
})

test('Services chip and Health light agree on every platform state', () => {
  const states = ['connected', 'running', 'ok', 'disabled', 'starting', 'connecting', 'retrying', 'paused', 'fatal', 'disconnected', 'stopped', 'error', 'CONNECTED', 'weird', '', undefined]
  for (const state of states) for (const needs_attention of [false, true]) {
    const v = { state, needs_attention }
    const health = evaluateHealth({ status: { gateway_running: true, gateway_state: 'running', gateway_platforms: { p: v } }, cron: [] }).items.some(i => i.kind === 'platform')
    const chip = platformState(v), fine = chip === 'connected' || chip === 'off'
    assert.equal(health, !fine, `${state} ${needs_attention}: health=${health} chip=${chip}`)
  }
  assert.equal(platformState({ state: 'disabled' }), 'off')
  for (const k of ['connected', 'running', 'ok', 'disabled']) assert.ok(PLATFORM_OK.has(k))
})
