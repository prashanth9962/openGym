// Where the API keeps its documents: the data directory (the default, as it has always been) or
// MongoDB, chosen by MONGODB_URI. Four kinds of document live here — the session `secret`, `db`
// (profiles, passkeys, invites), `vapid` (push keys) and one `state:<uid>` per profile; uploads,
// the audit log and the Coach's config stay files either way.
//
// Reads are synchronous in both backends, because the server's routes were written that way and
// rely on it (PUT /api/data compares and writes with nothing awaited in between). The Mongo
// backend gets there by holding every document in memory after init() and writing each change
// through to the database: set() updates memory at once and resolves when MongoDB has it, so a
// route that awaits it only answers "saved" once the database says so. One API process owns the
// data, as it does with files.
import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './durable.js';

const safeUid = s => s.replace(/[^a-zA-Z0-9_-]/g, '');

// key -> file name inside the data directory ('db.bak' is db.json.bak, as it always was)
function fileOf(key) {
  if (key === 'db' || key.startsWith('db.')) return 'db.json' + key.slice(2);
  if (key.startsWith('state:')) return 'state-' + safeUid(key.slice(6)) + '.json';
  if (key === 'vapid') return 'vapid.json';
  return key;
}

// A conditional write lost the race: another instance saved this document since it was read.
export class StoreConflict extends Error {
  constructor(key) { super('write conflict on ' + key); this.code = 'CONFLICT'; this.key = key; }
}

export const stateKey = uid => 'state:' + safeUid(uid);

function fileStore(dir) {
  const file = key => path.join(dir, fileOf(key));
  return {
    kind: 'files',
    async init() { fs.mkdirSync(dir, { recursive: true }); },
    // null when there is no such document; throws when it exists and cannot be read
    get(key) {
      try { return fs.readFileSync(file(key), 'utf8'); }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    // A cheap token that changes whenever the document does; null when it does not exist.
    stamp(key) {
      try { const st = fs.statSync(file(key)); return st.mtimeMs + ':' + st.size; } catch { return null; }
    },
    set(key, text, mode) { atomicWrite(file(key), text, mode); return Promise.resolve(); },
    del(key) { try { fs.unlinkSync(file(key)); } catch { /* already gone */ } return Promise.resolve(); },
    async close() {},
  };
}

async function mongoStore(uri, dir, serverless = false) {
  let mongodb;
  try { mongodb = await import('mongodb'); }
  catch { throw new Error('MONGODB_URI is set but the "mongodb" package is not installed (npm install in api/)'); }
  const client = new mongodb.MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  // A cold start can meet a network that is not quite up yet: a couple of tries before giving up.
  for (let attempt = 1; ; attempt++) {
    try { await client.connect(); break; }
    catch (e) { if (attempt >= 3) throw e; console.error('mongodb: connect failed, retrying:', String(e.message).split('\n')[0]); await new Promise(r => setTimeout(r, 800 * attempt)); }
  }
  const col = client.db(process.env.MONGODB_DB || 'opengym').collection('documents');
  const mem = new Map();      // key -> text
  const ver = new Map();      // key -> write counter (the stamp)
  const chain = new Map();    // key -> last write in flight, so a key's writes reach MongoDB in order
  const bump = key => ver.set(key, (ver.get(key) || 0) + 1);

  // Serverless: no instance owns the data, so nothing is loaded up front and memory is only what
  // the current request pulled in (refresh). Each document carries a version `n`; a write names the
  // version it read and loses (StoreConflict) if another instance has saved since.
  const nv = new Map();       // key -> version this instance last read or wrote (absent = 0)
  const pending = new Set();  // writes in flight, for settle()
  const load = d => { mem.set(d._id, d.v); nv.set(d._id, d.n || 0); ver.set(d._id, d.n || 0); };
  const unload = key => { mem.delete(key); nv.delete(key); ver.delete(key); };
  const refresh = async keys => {
    await Promise.all(keys.map(async key => { const d = await col.findOne({ _id: key }); d ? load(d) : unload(key); }));
  };
  if (!serverless) for await (const d of col.find({})) { mem.set(d._id, d.v); bump(d._id); }
  // First start on MongoDB with an existing data directory: bring its documents across once, so
  // nobody loses their profiles, history or signed-in sessions by switching backends.
  if (!serverless && mem.size === 0 && dir && fs.existsSync(dir)) {
    const files = fileStore(dir);
    const names = fs.readdirSync(dir);
    const keys = ['secret', 'db', 'db.bak', 'vapid'];
    for (const n of names) {
      const m = /^state-([a-zA-Z0-9_-]+)\.json$/.exec(n);
      if (m) keys.push('state:' + m[1]);
    }
    let n = 0;
    for (const key of keys) {
      let text; try { text = files.get(key); } catch { continue; }
      if (text == null) continue;
      await col.replaceOne({ _id: key }, { _id: key, v: text, t: new Date() }, { upsert: true });
      mem.set(key, text); bump(key); n++;
    }
    if (n) console.log(`mongodb: imported ${n} documents from ${dir}`);
  }

  const write = (key, op) => {
    const run = (chain.get(key) || Promise.resolve()).catch(() => {}).then(op);
    chain.set(key, run);
    return run;
  };
  if (serverless) {
    const failures = [];
    const write = (key, op, quiet) => {
      const run = (chain.get(key) || Promise.resolve()).catch(() => {}).then(op);
      chain.set(key, run);
      pending.add(run);
      const done = () => pending.delete(run);
      run.then(done, e => { done(); if (!quiet) failures.push(e); });
      return run;
    };
    return {
      kind: 'mongodb',
      serverless: true,
      async init() {},
      get(key) { return mem.has(key) ? mem.get(key) : null; },
      stamp(key) { return mem.has(key) ? ver.get(key) : null; },
      refresh,
      // every state document: the admin screens read other profiles' data
      async refreshStates() {
        for (const key of [...mem.keys()]) if (key.startsWith('state:')) unload(key);
        for await (const d of col.find({ _id: /^state:/ })) load(d);
      },
      // `quiet`: the caller handles a failure itself (eph.js retries), so settle() does not report it
      set(key, text, mode, quiet) {
        mem.set(key, text);
        return write(key, async () => {
          const n0 = nv.get(key) || 0;
          const doc = { _id: key, v: text, n: n0 + 1, t: new Date() };
          if (n0 === 0) {
            try { await col.insertOne(doc); }
            catch (e) { throw e.code === 11000 ? new StoreConflict(key) : e; }
          } else {
            const r = await col.replaceOne({ _id: key, n: n0 }, doc);
            if (!r.matchedCount) throw new StoreConflict(key);
          }
          nv.set(key, n0 + 1); ver.set(key, n0 + 1);
        }, quiet);
      },
      del(key) {
        unload(key);
        return write(key, () => col.deleteOne({ _id: key })).then(() => {});
      },
      // Resolves to the first error of the writes made so far (a StoreConflict, or the database
      // being down), or null when all of them landed. The request answers 503 on an error.
      async settle() {
        await Promise.allSettled([...pending]);
        return failures.splice(0)[0] || null;
      },
      async close() { await Promise.allSettled([...chain.values()]); await client.close(); },
    };
  }
  return {
    kind: 'mongodb',
    async init() {},
    get(key) { return mem.has(key) ? mem.get(key) : null; },
    stamp(key) { return mem.has(key) ? ver.get(key) : null; },
    set(key, text) {
      const before = mem.has(key) ? mem.get(key) : null;
      mem.set(key, text); bump(key);
      return write(key, () => col.replaceOne({ _id: key }, { _id: key, v: text, t: new Date() }, { upsert: true }))
        .catch(e => {
          // The database refused it: do not keep an answer in memory that was never saved.
          if (mem.get(key) === text) { if (before == null) mem.delete(key); else mem.set(key, before); bump(key); }
          throw e;
        });
    },
    del(key) {
      mem.delete(key); bump(key);
      return write(key, () => col.deleteOne({ _id: key })).then(() => {});
    },
    async close() { await Promise.allSettled([...chain.values()]); await client.close(); },
  };
}

export async function openStore({ dir, uri, serverless = false }) {
  const s = uri ? await mongoStore(uri, dir, serverless) : fileStore(dir);
  await s.init();
  return s;
}
