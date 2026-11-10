// Services card logic: gateway platform chips and MCP server chips (pure, no React).

// States that need no attention; health.js uses the same set, so the chip and the Health light agree.
export const PLATFORM_OK = new Set(['connected', 'running', 'ok', 'disabled'])

// One platform entry of GET /api/status -> 'connected' | 'off' (disabled on purpose) | 'attention' | 'paused' | 'pending'. A fatal state needs attention.
export function platformState(v) {
  const st = String(v?.state || '').toLowerCase()
  if (st === 'disabled') return 'off'
  if (PLATFORM_OK.has(st)) return 'connected'
  if (v?.needs_attention || st === 'fatal') return 'attention'
  return st === 'paused' ? 'paused' : 'pending'
}

// One server of mcp.servers.status -> 'off' | 'auth' | 'failed' | 'connecting' | 'lazy' | 'ok' | 'idle' ('configured', never started).
export function mcpState(s) {
  if (s?.disabled || s?.status === 'disabled') return 'off'
  if (s?.needs_auth) return 'auth'
  if (s?.status === 'failed') return 'failed'
  if (s?.status === 'connecting') return 'connecting'
  if (s?.status === 'lazy') return 'lazy'
  return s?.status === 'connected' || s?.connected ? 'ok' : 'idle'
}

export function mcpSummary(servers) {
  const list = Array.isArray(servers) ? servers : []
  const n = st => list.filter(s => mcpState(s) === st).length
  return { connected: n('ok'), failing: n('failed'), needsAuth: n('auth'), total: list.length }
}
