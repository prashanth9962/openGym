// The remote (Streamable HTTP) transport: the per-profile token gate and a real MCP exchange over
// web-standard Requests, answering from a seeded state.
import crypto from 'node:crypto'
import { describe, beforeAll, test, expect } from 'vitest'
import { buildDemoState } from '../../frontend/src/lib/demoSeed.js'
import { _seedStateForTests, _setMcpHashForTests } from '../src/state.js'
import { handleMcp } from '../src/remote.js'

const TOKEN = 'ogm_' + 'k'.repeat(32)
const rpc = (path, body, headers = {}) => new Request('https://x.test' + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
  body: JSON.stringify(body),
})
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } }

beforeAll(() => {
  _seedStateForTests(buildDemoState())
  _setMcpHashForTests(crypto.createHash('sha256').update(TOKEN).digest('hex'))
})

describe('remote MCP', () => {
  test('refuses a missing or wrong token', async () => {
    expect((await handleMcp(rpc('/mcp', INIT))).status).toBe(401)
    expect((await handleMcp(rpc('/mcp/ogm_' + 'z'.repeat(32), INIT))).status).toBe(401)
    expect((await handleMcp(rpc('/mcp', INIT, { authorization: 'Bearer nope' }))).status).toBe(401)
  })

  test('serves tools with the token in the path or as a Bearer header', async () => {
    for (const r of [rpc('/mcp/' + TOKEN, { jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      rpc('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { authorization: 'Bearer ' + TOKEN })]) {
      const res = await handleMcp(r)
      expect(res.status).toBe(200)
      const names = (await res.json()).result.tools.map(t => t.name)
      expect(names).toContain('list_routines')
      expect(names).toContain('estimate_1rm')
    }
  })

  test('answers a tool call without a session', async () => {
    const res = await handleMcp(rpc('/mcp/' + TOKEN, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_routines', arguments: {} } }))
    expect(res.status).toBe(200)
    const out = JSON.parse((await res.json()).result.content[0].text)
    expect(out.routines.length).toBeGreaterThan(0)
  })

  test('a revoked token stops working', async () => {
    _setMcpHashForTests(undefined)
    expect((await handleMcp(rpc('/mcp/' + TOKEN, INIT))).status).toBe(401)
    _setMcpHashForTests(crypto.createHash('sha256').update(TOKEN).digest('hex'))
    expect((await handleMcp(rpc('/mcp/' + TOKEN, INIT))).status).toBe(200)
  })

  test('a peppered hash only matches while MCP_SECRET is set to the same value', async () => {
    const pepper = 'pepper-pepper-pepper-123'
    _setMcpHashForTests(crypto.createHmac('sha256', pepper).update(TOKEN).digest('hex'), true)
    expect((await handleMcp(rpc('/mcp/' + TOKEN, INIT))).status).toBe(401)   // no pepper in the environment
    process.env.MCP_SECRET = pepper
    try {
      expect((await handleMcp(rpc('/mcp/' + TOKEN, INIT))).status).toBe(200)
      process.env.MCP_SECRET = 'a-different-pepper-value'
      expect((await handleMcp(rpc('/mcp/' + TOKEN, INIT))).status).toBe(401)
    } finally { delete process.env.MCP_SECRET }
    _setMcpHashForTests(crypto.createHash('sha256').update(TOKEN).digest('hex'))
  })
})
