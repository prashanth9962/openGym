/* The MongoDB backend (store.js), against a real server.js in a child. Needs a database: set
   MONGODB_TEST_URI (e.g. mongodb://localhost:27017) or the file is skipped. Each run uses its
   own database name and drops it. A first start imports the data directory, a profile's state
   goes in and comes back, a stale baseRev is still a 409, and a second server on an EMPTY data
   directory sees everything — proof that nothing is read from files. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const URI = process.env.MONGODB_TEST_URI;
const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const DB = 'opengym_test_' + crypto.randomBytes(4).toString('hex');

const cookie = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
};
const H = { Cookie: cookie('u_m_1'), 'Content-Type': 'application/json' };

async function start(t, seed) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-mongo-'));
  if (seed) {
    fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
    fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
      users: [{ id: 'u_m_1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: []
    }));
  }
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MONGODB_URI: URI, MONGODB_DB: DB }
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const port = await boundPort(child, () => log);
  return { api: `http://127.0.0.1:${port}`, dataDir, kill: () => child.kill('SIGKILL') };
}

test('MongoDB backend: import, write, conflict, restart on an empty directory', { skip: !URI && 'MONGODB_TEST_URI not set' }, async t => {
  const a = await start(t, true);
  const put = (api, body) => fetch(api + '/api/data', { method: 'PUT', headers: H, body: JSON.stringify(body) });

  let r = await put(a.api, { state: { workouts: [], routines: [{ id: 'r1', name: 'A' }], unit: 'kg' } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).rev, 1);
  r = await put(a.api, { baseRev: 1, state: { workouts: [{ id: 'w1', d: '2026-10-16' }], routines: [], unit: 'kg' } });
  assert.equal((await r.json()).rev, 2);
  r = await put(a.api, { baseRev: 1, state: { workouts: [], routines: [], unit: 'lb' } });
  assert.equal(r.status, 409, 'a stale baseRev is still refused');
  assert.equal((await r.json()).rev, 2);
  assert.ok(!fs.readdirSync(a.dataDir).some(f => f.startsWith('state-')), 'no state file is written');
  a.kill();

  const b = await start(t, false);   // nothing on disk: the secret (so the cookie), the profile and the state come from MongoDB
  const got = await (await fetch(b.api + '/api/data', { headers: H })).json();
  assert.equal(got.rev, 2);
  assert.equal(got.state.workouts[0].id, 'w1');
  assert.equal((await (await fetch(b.api + '/api/data/rev', { headers: H })).json()).rev, 2);
});

test.after(async () => {
  if (!URI) return;
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(URI); await c.connect(); await c.db(DB).dropDatabase(); await c.close();
});
