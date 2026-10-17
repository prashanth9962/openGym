/* opengym-mcp state — reads ./data/state-<uid>.json + db.json (read-only), or the same documents
   from MongoDB when MONGODB_URI is set (the api's MONGODB_URI mode, api/store.js). Cached with an
   fs.watch + mtime fallback so a session the api server just wrote is visible on the next
   tool call without a restart. */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = process.env.OPENGYM_DATA || path.join(process.cwd(), 'data')
const MONGO_URI = process.env.MONGODB_URI || ''

// MongoDB mode: the api keeps each document as { _id: 'db' | 'state:<uid>', v: <JSON text> }. The
// tools stay synchronous, so everything is fetched into the cache up front (initAsync) and again
// before each tool call (refresh); the cache is what init()/getState()/getUser() then answer from.
let _col = null
let _mongo = null
async function mongoDoc(id) {
  const d = await _col.findOne({ _id: id })
  if (!d) return null
  try { return JSON.parse(d.v) } catch (e) {
    const err = new Error(`${id} in MongoDB is not valid JSON: ${e.message}`)
    err.code = 'EIO'
    throw err
  }
}
const withDefaults = s => (s ? Object.assign({}, defaultsShape(), s) : null)

// Connects once per process and loads the db document; idempotent.
export async function connectMongo() {
  if (!MONGO_URI || _col) return
  let mod
  try { mod = await import('mongodb') } catch { throw new Error('MONGODB_URI is set but the "mongodb" package is not installed (npm install in mcp/)') }
  const client = new mod.MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
  await client.connect()
  _mongo = client
  _col = _mongo.db(process.env.MONGODB_DB || 'opengym').collection('documents')
  _db = (await mongoDoc('db')) || { users: [], creds: [], subs: [], invites: [] }
}

export async function initAsync() {
  if (!MONGO_URI || _uid !== null) return
  await connectMongo()
  const envUid = (process.env.OPENGYM_UID || '').trim()
  let uid = envUid
  if (uid) {
    if (!/^[a-zA-Z0-9_-]+$/.test(uid)) throw new Error(`OPENGYM_UID contains characters that aren't safe: ${JSON.stringify(uid)}`)
  } else {
    const ids = (await _col.find({ _id: /^state:/ }, { projection: { _id: 1 } }).toArray()).map(d => d._id.slice(6))
    const pool = ids.length ? ids : (_db.users || []).map(u => u.id)
    if (pool.length === 1) uid = pool[0]
    else if (pool.length === 0) throw new Error('no openGym users found in MongoDB — sign in at least once on a device')
    else throw ambiguousUid(pool)
  }
  _uid = uid
  _state = withDefaults(await mongoDoc('state:' + uid))
}

// The remote transport serves whichever profile the request's token belongs to. The token is made
// in Settings (api/server.js, POST /api/account/mcp-token); only its SHA-256 is stored, as
// user.mcp.h on the profile in the `db` document (an HMAC keyed by MCP_PEPPER when user.mcp.p). Returns the user id, or null for an unknown or
// revoked token. Reads the db document afresh so a revoke takes effect on the next request.
export async function uidForMcpToken(token) {
  if (!token) return null
  if (_col) _db = (await mongoDoc('db')) || _db
  const pep = String(process.env.MCP_PEPPER || '').trim()
  const pepper = pep.length >= 16 ? pep : ''
  const hash = (t, peppered) => (peppered
    ? crypto.createHmac('sha256', pepper).update(t).digest('hex')
    : crypto.createHash('sha256').update(t).digest('hex'))
  const plain = Buffer.from(hash(String(token), false))
  const keyed = pepper ? Buffer.from(hash(String(token), true)) : null
  let found = null
  for (const u of (_db?.users || [])) {
    // a hash made with the pepper can only be checked with it; without it the token just fails
    const want = u.mcp?.p ? keyed : plain
    const h = Buffer.from(String(u.mcp?.h || ''))
    // no early exit: every profile is compared, so the time does not say which one matched
    if (want && h.length === want.length && crypto.timingSafeEqual(h, want) && !u.disabled) found = u.id
  }
  return found
}

// Point the cache at `uid` (remote transport; the caller serialises requests, the cache is one
// profile at a time). Without MongoDB there is only the profile that was seeded.
export async function selectUser(uid) {
  if (!_col) { if (uid !== _uid) throw new Error('remote MCP needs MONGODB_URI'); return }
  _uid = uid
  _state = withDefaults(await mongoDoc('state:' + uid))
}

// Before each tool call: pick up what the api wrote since. A no-op for files, which getState()
// already re-reads on an mtime change.
export async function refresh() {
  if (!_col) return
  _db = (await mongoDoc('db')) || _db
  _state = withDefaults(await mongoDoc('state:' + _uid))
}

// null = no state file (brand-new account); undefined = not yet loaded.
let _state = undefined
let _db = undefined
let _uid = null
let _watcher = null
let _loadedMtime = 0    // mtimeMs we last read at — used to catch watcher omissions

// null means one thing only: the file is not there (an account that never synced from a device).
// Every other failure — no permission on the mount, a truncated or corrupt file — is a real fault,
// and reporting it as "no synced state yet, sign in from a device" sends the operator to fix the
// wrong thing while the data sits there unreadable.
function readJsonOrNull(file) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    if (e.code === 'ENOENT') return null
    // Node's own message repeats the path it was given, and that is the server's absolute path:
    // the basename identifies the file just as well.
    const base = path.basename(file)
    const err = new Error(`cannot read ${base}: ${e.code || e.name} — ${String(e.message).replaceAll(file, base)}`)
    err.code = 'EIO'
    throw err
  }
  try {
    return JSON.parse(raw)
  } catch (e) {
    const err = new Error(`${path.basename(file)} is not valid JSON: ${e.message}`)
    err.code = 'EIO'
    throw err
  }
}

function reloadDb() { _db = readJsonOrNull(path.join(DATA_DIR, 'db.json')) || { users: [], creds: [], subs: [], invites: [] } }

function stateFile(uid) {
  return path.join(DATA_DIR, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json')
}

// Pick the uid: OPENGYM_UID env, else the only state-* file, else the only user in db.json.
// Throws listing the options if ambiguous. The sanitiser on stateFile() keeps a sneaky
// '..' in OPENGYM_UID harmless.
function resolveUid() {
  const envUid = (process.env.OPENGYM_UID || '').trim()
  if (envUid) {
    if (!/^[a-zA-Z0-9_-]+$/.test(envUid)) throw new Error(`OPENGYM_UID contains characters that aren't safe in a filename: ${JSON.stringify(envUid)}`)
    return envUid
  }
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => /^state-[a-zA-Z0-9_-]+\.json$/.test(f))
    .map(f => f.replace(/^state-/, '').replace(/\.json$/, ''))
  if (files.length === 1) return files[0]
  if (files.length === 0) {
    reloadDb()
    if (_db.users.length === 1) return _db.users[0].id
    if (_db.users.length === 0) throw new Error(`no openGym users found in ${path.join(DATA_DIR, 'db.json')} — sign in at least once on a device`)
    // Multiple users in db.json but no state file yet — hit when accounts exist but none has
    // signed in on a device.
    throw ambiguousUid(_db.users.map(u => u.id))
  }
  throw ambiguousUid(files)
}

// "Which profile?" is a config question for the operator, and this message travels as a tool
// result: into the model's context and into whatever transcript it lands in. Every account id on
// the box, plus the server's absolute paths, has no business there. The count and the setting to
// change are what the model can act on; the ids and the path go to the server log on stderr,
// where the operator is already reading the startup line.
function ambiguousUid(ids) {
  console.error(`[opengym-mcp] ${ids.length} openGym profiles in ${DATA_DIR}: ${ids.join(', ')} — set OPENGYM_UID to one of them`)
  const err = new Error(`this openGym data directory holds ${ids.length} profiles — set OPENGYM_UID to the one this server should read (the ids are on the server's stderr, and in db.json under "users"[].id)`)
  err.code = 'EINVAL'
  return err
}

// Idempotent. Picks the uid, loads db.json, attaches the watcher, primes state.
export function init() {
  if (_uid !== null) return
  if (MONGO_URI) throw new Error('MongoDB is not connected yet (initAsync did not finish)')
  if (!fs.existsSync(DATA_DIR)) throw new Error(`OPENGYM_DATA dir does not exist: ${DATA_DIR}`)
  _uid = resolveUid()
  reloadDb()
  const file = stateFile(_uid)
  if (fs.existsSync(file)) {
    _state = readJsonOrNull(file)
    if (_state) _state = Object.assign({}, defaultsShape(), _state)
    try { _loadedMtime = fs.statSync(file).mtimeMs } catch {}
  }
  if (_watcher) _watcher.close()
  // fs.watch is best-effort: the api server's atomic write at PUT /api/data is the source of
  // truth, and a stale read just gets corrected on the next change or the next tool call.
  try {
    _watcher = fs.watch(file, () => {
      // On change, simply clear the cache — the next getState() will re-read. Avoids reading
      // twice if the watcher fires multiple events for one atomic-write (rename + create).
      _state = undefined
      _loadedMtime = 0
    })
    // Unref'd, or the watcher alone holds the event loop open and the process outlives the
    // client that spawned it — "exits when the LLM client disconnects" stops being true the
    // moment there is a state file to watch. Most clients kill the child anyway, but one that
    // merely closes the pipe would leak a process per session. Watching is unaffected: the
    // stdio transport is what keeps the loop alive while a client is actually attached.
    _watcher.unref()
  } catch { /* fs.watch unsupported on this platform; tools will re-read on mtime change */ }
}

// Returns the state object, or null for a fresh account that never signed in on a device.
export function getState() {
  init()
  if (_col) return _state
  const file = stateFile(_uid)
  // Re-read if the file's mtime changed since our last load — covers watcher omissions and
  // platforms with no fs.watch.
  let mtime
  try { mtime = fs.statSync(file).mtimeMs } catch {
    return _state === undefined ? null : _state
  }
  if (_state === undefined || mtime !== _loadedMtime) {
    const fresh = readJsonOrNull(file)
    if (fresh) {
      // Same shape the frontend builds on pullState — defaults merged with stored state so any
      // field the app added since the snapshot was last saved shows up undefined-safe.
      _state = Object.assign({}, defaultsShape(), fresh)
      _loadedMtime = mtime
    } else if (_state === undefined) {
      _state = null  // no state file at all — never signed in on a device
    }
  }
  return _state
}

// Returns the user record (id + name). No passkey material, no VAPID keys, no push subs.
export function getUser() {
  init()
  const u = _db.users.find(x => x.id === _uid) || { id: _uid, name: 'Profile', created: null }
  return { id: u.id, name: u.name, created: u.created || null }
}

export const dataDir = () => DATA_DIR

// Test-only: work against a passed-in state, not the disk.
export function _seedStateForTests(state) {
  _uid = 'test-uid'
  _db = { users: [{ id: _uid, name: 'Test', created: '2026-07-26T00:00:00.000Z' }], creds: [], subs: [], invites: [] }
  _state = state
  _loadedMtime = Number.MAX_SAFE_INTEGER   // never re-read from disk in a test
  if (_watcher) { _watcher.close(); _watcher = null }
}

export function _setMcpHashForTests(h, p) { _db.users[0].mcp = h === undefined ? undefined : { h, ...(p ? { p: 1 } : {}), created: 1 } }

function defaultsShape() {
  return {
    unit: 'kg', restSec: 90, sound: true, lang: 'en',
    theme: 'dark', accent: 'lime', body: 'male', targetW: null,
    bodyweight: [], routines: [], week: {}, dayPlan: {},
    exWeights: {}, workouts: [], customEx: [], gifSize: 'full',
    reminder: { on: false, time: '08:00', tz: null }
  }
}
