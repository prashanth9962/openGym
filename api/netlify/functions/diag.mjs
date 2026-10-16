// Diagnostic for a deployment that cannot reach MongoDB. Behind CRON_SECRET (404 without it) and
// it never prints a credential: only whether the variable is set, its host, and what connecting
// from here does. GET /diag-opengym with the header x-cron-secret.
export default async req => {
  const want = process.env.CRON_SECRET || '';
  if (want.length < 16 || req.headers.get('x-cron-secret') !== want) return new Response('not found', { status: 404 });
  const raw = process.env.MONGODB_URI || '';
  const uri = raw.trim().replace(/^["']|["']$/g, '');
  const info = {
    node: process.version,
    uriSet: !!raw,
    trailingSpace: raw !== raw.trim(),
    quoted: /^["']/.test(raw),
    scheme: uri.split(':')[0],
    host: (uri.split('@')[1] || '').split(/[/?]/)[0],
    hasPlaceholder: /<|>|PASSWORD|YOURCLUSTER/i.test(uri),
    origin: process.env.ORIGIN || null,
    rpId: process.env.RP_ID || null,
  };
  try { info.egressIp = (await (await fetch('https://api.ipify.org')).text()).trim(); } catch (e) { info.egressIp = 'unknown: ' + e.message; }
  const t0 = Date.now();
  try {
    const { MongoClient } = await import('mongodb');
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await c.connect();
    info.ping = await c.db('admin').command({ ping: 1 });
    await c.close();
  } catch (e) { info.error = e.name + ': ' + String(e.message).split('\n')[0].slice(0, 200); }
  info.ms = Date.now() - t0;
  return Response.json(info);
};

export const config = { path: '/diag-opengym' };
