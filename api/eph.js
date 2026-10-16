// Short-lived shared state for serverless mode: the sign-in challenges, device-pairing codes and
// pending rest-timer alerts that the server otherwise keeps in Maps. With several instances (or an
// instance that is frozen between requests) a Map is no good — the request that finishes a sign-in
// is rarely the one that began it — so they live in one MongoDB document, `eph`.
//
// hydrate() fills the Maps from the document at the start of a request and remembers what it
// loaded; flush() at the end writes back only what this request changed (added, changed, removed
// entries) on top of the document as it is by then, retrying when another instance got in first.
// A request that touched none of them writes nothing.
import { StoreConflict } from './store.js';

const KEY = 'eph';

export function createEph({ store, maps }) {
  let snap = {};   // name -> Map(key -> JSON of the value as loaded)
  const parse = () => { try { return JSON.parse(store.get(KEY) || '{}') || {}; } catch { return {}; } };

  function hydrate() {
    const doc = parse();
    snap = {};
    for (const [name, map] of Object.entries(maps)) {
      map.clear();
      snap[name] = new Map();
      for (const [k, v] of Object.entries(doc[name] || {})) { map.set(k, v); snap[name].set(k, JSON.stringify(v)); }
    }
  }

  function diff() {
    const out = {};
    let any = false;
    for (const [name, map] of Object.entries(maps)) {
      const before = snap[name] || new Map();
      const put = {}, drop = [];
      for (const [k, v] of map) if (before.get(k) !== JSON.stringify(v)) { put[k] = v; any = true; }
      for (const k of before.keys()) if (!map.has(k)) { drop.push(k); any = true; }
      out[name] = { put, drop };
    }
    return any ? out : null;
  }

  async function flush(now = Date.now()) {
    const d = diff();
    if (!d) return;
    for (let attempt = 0; attempt < 6; attempt++) {
      const doc = parse();
      for (const [name, { put, drop }] of Object.entries(d)) {
        const cur = doc[name] || {};
        // A one-time entry (a pairing code, a challenge) that was there when this request began and
        // is gone from a newer version was used by another instance first: this use must fail.
        for (const k of drop) { if (attempt > 0 && !(k in cur)) throw new StoreConflict(KEY); delete cur[k]; }
        Object.assign(cur, put);
        for (const [k, v] of Object.entries(cur)) if (v && v.exp && v.exp < now) delete cur[k];   // expired
        doc[name] = cur;
      }
      try {
        await store.set(KEY, JSON.stringify(doc), undefined, true);
        return;
      } catch (e) {
        if (!(e instanceof StoreConflict)) throw e;
        await store.refresh([KEY]);   // someone else saved: apply our changes to their version
      }
    }
    throw new StoreConflict(KEY);
  }

  return { hydrate, flush };
}
