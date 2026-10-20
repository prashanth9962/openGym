/* Saving a change made by a write tool: through the app's own API, as the token's profile, so
   the same rules apply as for the app itself — a conditional write on the revision it read, the
   merge stamps, the write ids. A 409 means another device wrote in between: the document that came
   back with it is the new base and the change is made again on top (the tools are small, so the
   redo is exact). The token reaches only /api/data (api/server.js, MCP_ROUTES). */
const TRIES = 4

export async function changeProfile(origin, token, mutate, fetchImpl = globalThis.fetch) {
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
  const get = async () => {
    const r = await fetchImpl(`${origin}/api/data`, { headers })
    if (!r.ok) throw Object.assign(new Error(`could not read the profile (${r.status})`), { code: 'EIO' })
    return r.json()
  }
  let { state, rev } = await get()
  for (let i = 0; i < TRIES; i++) {
    const next = structuredClone(state || {})
    const summary = mutate(next)
    const r = await fetchImpl(`${origin}/api/data`, {
      method: 'PUT', headers,
      body: JSON.stringify({ state: next, baseRev: rev || 0, baseWid: state?._wid }),
    })
    if (r.ok) return { ...summary, saved: true }
    if (r.status === 409) { const cur = await r.json(); state = cur.state; rev = cur.rev; continue }
    throw Object.assign(new Error(`the profile could not be saved (${r.status})`), { code: 'EIO' })
  }
  throw Object.assign(new Error('the profile kept changing on another device; try again'), { code: 'ECONFLICT' })
}
