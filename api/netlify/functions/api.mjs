// Netlify Function (v2): the whole API behind /api/*. It is the same server.js that runs in Docker,
// started in serverless mode on a loopback port; each request is passed through to it. The
// environment is set before the import because server.js reads it at load.
process.env.SERVERLESS = '1';
process.env.DATA_DIR ||= '/tmp/opengym';     // the only writable place; holds nothing that must survive
process.env.MEDIA_UPLOADS ||= 'off';         // uploads need a disk; photos/videos are off in this mode
process.env.TRUST_PROXY ||= '1';

const { ready } = await import('../../server.js');

const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'host']);

export default async req => {
  const port = await ready;
  const u = new URL(req.url);
  const headers = new Headers();
  for (const [k, v] of req.headers) if (!HOP.has(k)) headers.set(k, v);
  const ip = req.headers.get('x-nf-client-connection-ip');
  if (ip) headers.set('x-forwarded-for', ip);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const r = await fetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, {
    method: req.method, headers, redirect: 'manual',
    ...(hasBody ? { body: req.body, duplex: 'half' } : {}),
  });
  const out = new Headers();
  for (const [k, v] of r.headers) if (!HOP.has(k) && k !== 'set-cookie') out.set(k, v);
  for (const c of r.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(r.body, { status: r.status, headers: out });
};

export const config = { path: '/api/*' };
