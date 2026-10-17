/* Registers the read-only tools on an McpServer. Shared by the stdio entry point (index.js) and
   the remote HTTP one (remote.js), so both answer from the same handlers. */
import { TOOLS } from './tools.js'
import { refresh } from './state.js'

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
