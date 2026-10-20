/* openGym MCP server — remote (Streamable HTTP) transport, for clients that cannot spawn a local
   process, such as ChatGPT's custom connectors. handleMcp takes a web-standard Request and returns
   a Response, so it runs inside a Netlify Function (api/netlify/functions/mcp.mjs) or any other
   fetch-style host. The same read tools as the stdio server, answering from MongoDB, plus the tools that change the
   profile (write-tools.js), which save through the app's API.

   Auth: a per-profile token made in the app (Settings → Account → AI assistants), accepted in the
   URL (/mcp/<token>) or as `Authorization: Bearer <token>`. Revoking it there stops it working on
   the next request. Each request is stateless: a fresh server and transport. The state cache holds
   one profile at a time, so requests are served one after another. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { connectMongo, uidForMcpToken, selectUser } from './state.js'
import { registerTools, registerWriteTools } from './register.js'
import { changeProfile } from './write.js'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function tokenOf(req, url) {
  const m = /^\/mcp\/([^/]+)\/?$/.exec(url.pathname)
  if (m) { try { return decodeURIComponent(m[1]) } catch { return '' } }
  const h = req.headers.get('authorization') || ''
  return /^Bearer /i.test(h) ? h.slice(7).trim() : ''
}

let turn = Promise.resolve()

export async function handleMcp(req) {
  const url = new URL(req.url)
  const token = tokenOf(req, url)
  const run = turn.then(async () => {
    try { await connectMongo() } catch (e) {
      console.error('[opengym-mcp]', e.message)
      return json(503, { error: 'storage unavailable' })
    }
    const uid = await uidForMcpToken(token)
    if (!uid) return json(401, { error: 'unauthorized' })
    await selectUser(uid)
    const server = new McpServer({ name: 'opengym', version: '0.1.0' })
    registerTools(server)
    registerWriteTools(server, mutate => changeProfile(url.origin, token, mutate))
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    return transport.handleRequest(req)
  })
  turn = run.catch(() => {})
  return run
}
