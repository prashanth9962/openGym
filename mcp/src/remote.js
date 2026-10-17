/* openGym MCP server — remote (Streamable HTTP) transport, for clients that cannot spawn a local
   process, such as ChatGPT's custom connectors. handleMcp takes a web-standard Request and returns
   a Response, so it runs inside a Netlify Function (api/netlify/functions/mcp.mjs) or any other
   fetch-style host. Read-only, same tools as the stdio server, answering from MongoDB.

   Auth: a long secret in MCP_TOKEN. It is accepted in the URL (/mcp/<token>), because ChatGPT's
   connector form has no header field for "no authentication" servers, or as a Bearer header. With
   MCP_TOKEN unset or shorter than 24 characters the endpoint does not exist (404). Each request is
   stateless: a fresh server and transport, so nothing is kept between calls but the MongoDB
   connection. */
import crypto from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { initAsync, init } from './state.js'
import { registerTools } from './register.js'

const sha = s => crypto.createHash('sha256').update(String(s)).digest()
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b))
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function tokenOf(req, url) {
  const m = /^\/mcp\/([^/]+)\/?$/.exec(url.pathname)
  if (m) { try { return decodeURIComponent(m[1]) } catch { return '' } }
  const h = req.headers.get('authorization') || ''
  return /^Bearer /i.test(h) ? h.slice(7).trim() : ''
}

export async function handleMcp(req, env = process.env) {
  const secret = (env.MCP_TOKEN || '').trim()
  if (secret.length < 24) return new Response('Not found', { status: 404 })
  const url = new URL(req.url)
  if (!same(tokenOf(req, url), secret)) return json(401, { error: 'unauthorized' })

  try {
    await initAsync()   // connects on the first request of an instance, then a no-op
    init()
  } catch (e) {
    console.error('[opengym-mcp]', e.message)
    return json(503, { error: 'storage unavailable' })
  }

  const server = new McpServer({ name: 'opengym', version: '0.1.0' })
  registerTools(server)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  return transport.handleRequest(req)
}
