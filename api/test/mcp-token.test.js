/* /api/account/mcp-token: made once for a signed-in profile, shown once, stored only as a hash,
   replaced by the next one and removed by DELETE. Real server.js in a child. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PEPPER = 'test-pepper-0123456789';
const SECRET = crypto.randomBytes(32).toString('hex');
const mintSession = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

test('mcp token: create, status, replace, revoke', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-mcptok-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
    users: [{ id: 'u_mcp_1', name: 'One', created: new Date().toISOString() }], creds: [], subs: [], invites: []
  }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MCP_SECRET: PEPPER }
  });
  let log = '';
  child.stdout.on('data', d => log += d);
  child.stderr.on('data', d => log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${await boundPort(child, () => log)}/api/account/mcp-token`;
  const as = { Cookie: `gymsid=${mintSession('u_mcp_1')}`, 'Content-Type': 'application/json' };
  const go = async (method, headers = as) => { const r = await fetch(base, { method, headers }); return { status: r.status, body: await r.json() }; };
  const stored = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8')).users[0].mcp;

  assert.equal((await go('GET', {})).status, 401);
  assert.equal((await go('POST', {})).status, 401);
  assert.deepEqual((await go('GET')).body, { on: false, created: null });

  const a = (await go('POST')).body;
  assert.match(a.token, /^ogm_[A-Za-z0-9_-]{32}$/);
  assert.equal(stored().h, crypto.createHmac('sha256', PEPPER).update(a.token).digest('hex'), 'keyed by the pepper');
  assert.equal(stored().p, 1);
  assert.ok(!fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8').includes(a.token), 'the token itself is never stored');
  assert.deepEqual((await go('GET')).body, { on: true, created: a.created });

  const b = (await go('POST')).body;
  assert.notEqual(b.token, a.token);
  assert.equal(stored().h, crypto.createHmac('sha256', PEPPER).update(b.token).digest('hex'), 'a new token replaces the old');

  assert.equal((await go('DELETE')).status, 200);
  assert.equal(stored(), undefined);
  assert.deepEqual((await go('GET')).body, { on: false, created: null });
});
