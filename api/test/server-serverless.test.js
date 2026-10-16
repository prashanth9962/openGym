/* Serverless mode (SERVERLESS=1): two separate server processes — two function instances —
   share one MongoDB and nothing else. Needs MONGODB_TEST_URI, skipped without it. */
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
const DB = 'opengym_sl_' + crypto.randomBytes(4).toString('hex');
const CRON = 'cron-secret-' + crypto.randomBytes(8).toString('hex');
const cookie = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
};
const H = { Cookie: cookie('u_s_1'), 'Content-Type': 'application/json' };

async function seed() {
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(URI); await c.connect();
  const col = c.db(DB).collection('documents');
  await col.insertMany([
    { _id: 'secret', v: SECRET, n: 1 },
    { _id: 'db', n: 1, v: JSON.stringify({ users: [{ id: 'u_s_1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: [] }) },
  ]);
  await c.close();
}

async function instance(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-sl-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SERVERLESS: '1', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost',
      MONGODB_URI: URI, MONGODB_DB: DB, MEDIA_UPLOADS: 'off', CRON_SECRET: CRON }
  });
  let log = '';
  child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const port = await boundPort(child, () => log);
  return `http://127.0.0.1:${port}`;
}
const put = (api, body) => fetch(api + '/api/data', { method: 'PUT', headers: H, body: JSON.stringify(body) });
const doc = (extra = {}) => ({ state: { workouts: [], routines: [], unit: 'kg', ...extra } });

test('serverless: two instances share one database', { skip: !URI && 'MONGODB_TEST_URI not set' }, async t => {
  await seed();
  const A = await instance(t), B = await instance(t);

  let r = await put(A, doc({ unit: 'kg' }));
  assert.equal(r.status, 200);
  const got = await (await fetch(B + '/api/data', { headers: H })).json();
  assert.equal(got.rev, 1, 'a write on one instance is read on the other at once');

  r = await put(B, { ...doc({ unit: 'lb' }), baseRev: 1 });
  assert.equal((await r.json()).rev, 2);
  r = await put(A, { ...doc({ unit: 'kg' }), baseRev: 1 });
  assert.equal(r.status, 409, 'a stale baseRev is refused on the other instance too');

  // both instances read rev 2 and save at the same moment: exactly one wins
  const [x, y] = await Promise.all([put(A, { ...doc({ unit: 'kg' }), baseRev: 2 }), put(B, { ...doc({ unit: 'lb' }), baseRev: 2 })]);
  const codes = [x.status, y.status].sort();
  assert.equal(codes[0], 200, 'one save lands');
  assert.ok(codes[1] === 409 || codes[1] === 503, `the other is refused, got ${codes[1]}`);
  const rev = (await (await fetch(A + '/api/data/rev', { headers: H })).json()).rev;
  assert.equal(rev, 3, 'only the winner advanced the revision');
});

test('serverless: a pairing code made on one instance is redeemed on another, once', { skip: !URI && 'MONGODB_TEST_URI not set' }, async t => {
  const A = await instance(t), B = await instance(t);
  const { code } = await (await fetch(A + '/api/pair/create', { method: 'POST', headers: H, body: '{}' })).json();
  assert.ok(code);
  const redeem = api => fetch(api + '/api/pair/redeem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const first = await redeem(B);
  assert.equal(first.status, 200);
  assert.ok((await first.json()).token);
  assert.equal((await redeem(A)).status, 400, 'a code works once, across instances');
});

test('serverless: the tick route needs the cron secret', { skip: !URI && 'MONGODB_TEST_URI not set' }, async t => {
  const A = await instance(t);
  assert.equal((await fetch(A + '/api/internal/tick', { method: 'POST' })).status, 404);
  assert.equal((await fetch(A + '/api/internal/tick', { method: 'POST', headers: { 'x-cron-secret': 'nope' } })).status, 404);
  assert.equal((await fetch(A + '/api/internal/tick', { method: 'POST', headers: { 'x-cron-secret': CRON } })).status, 200);
});

test.after(async () => {
  if (!URI) return;
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(URI); await c.connect(); await c.db(DB).dropDatabase(); await c.close();
});
