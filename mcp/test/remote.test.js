// The remote (Streamable HTTP) transport: the token gate and a real MCP exchange over web-standard
// Requests, answering from a seeded state.
import { describe, beforeAll, test, expect } from 'vitest'
import { buildDemoState } from '../../frontend/src/lib/demoSeed.js'
import { _seedStateForTests } from '../src/state.js'
import { handleMcp } from '../src/remote.js'

const TOKEN = 'k'.repeat(32)
const env = { MCP_TOKEN: TOKEN }
const rpc = (path, body, headers = {}) => new Request('https://x.test' + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
  body: JSON.stringify(body),
})
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } }

beforeAll(() => _seedStateForTests(buildDemoState()))

describe('remote MCP', () => {
  test('does not exist without a long enough MCP_TOKEN', async () => {
    expect((await handleMcp(rpc('/mcp/' + TOKEN, INIT), {})).status).toBe(404)
    expect((await handleMcp(rpc('/mcp/short', INIT), { MCP_TOKEN: 'short' })).status).toBe(404)
  })

  test('refuses a missing or wrong token', async () => {
    expect((await handleMcp(rpc('/mcp', INIT), env)).status).toBe(401)
    expect((await handleMcp(rpc('/mcp/' + 'z'.repeat(32), INIT), env)).status).toBe(401)
    expect((await handleMcp(rpc('/mcp', INIT, { authorization: 'Bearer nope' }), env)).status).toBe(401)
  })

  test('serves tools with the token in the path or as a Bearer header', async () => {
    for (const r of [rpc('/mcp/' + TOKEN, { jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      rpc('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { authorization: 'Bearer ' + TOKEN })]) {
      const res = await handleMcp(r, env)
      expect(res.status).toBe(200)
      const names = (await res.json()).result.tools.map(t => t.name)
      expect(names).toContain('list_routines')
      expect(names).toContain('estimate_1rm')
    }
  })

  test('answers a tool call without a session', async () => {
    const res = await handleMcp(rpc('/mcp/' + TOKEN, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_routines', arguments: {} } }), env)
    expect(res.status).toBe(200)
    const out = JSON.parse((await res.json()).result.content[0].text)
    expect(out.routines.length).toBeGreaterThan(0)
  })
})
