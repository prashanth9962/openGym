/* Registers the read-only tools on an McpServer. Shared by the stdio entry point (index.js) and
   the remote HTTP one (remote.js), so both answer from the same handlers. */
import { TOOLS } from './tools.js'
import { refresh } from './state.js'
import { WRITE_TOOLS } from './write-tools.js'

export function registerTools(server) {
  for (const t of TOOLS) {
    server.tool(
      t.name,
      t.description,
      t.schema,
      async (params) => {
        try {
          await refresh()
          const result = t.handler(params || {})
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        } catch (err) {
          const code = err.code || 'ERROR'
          return {
            isError: true,
            content: [{ type: 'text', text: `${code}: ${err.message}` }]
          }
        }
      }
    )
  }
}

// The tools that change the profile. `save(mutate)` applies one to the stored document and says
// what happened; it is only handed over by the remote transport, so stdio stays read-only.
export function registerWriteTools(server, save) {
  for (const t of WRITE_TOOLS) {
    server.tool(t.name, t.description, t.schema, async (params) => {
      try {
        const result = await save(S => t.mutate(S, params || {}))
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: `${err.code || 'ERROR'}: ${err.message}` }] }
      }
    })
  }
}
