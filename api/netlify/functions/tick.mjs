// Netlify scheduled function: once a minute it asks the API to send what is due — the daily
// reminders, the missed-workout nudges and rest-timer alerts. Needs CRON_SECRET (16+ characters),
// the same value the API checks.
process.env.SERVERLESS = '1';
process.env.DATA_DIR ||= '/tmp/opengym';
process.env.MEDIA_UPLOADS ||= 'off';

const { ready } = await import('../../server.js');

export default async () => {
  const port = await ready;
  const r = await fetch(`http://127.0.0.1:${port}/api/internal/tick`, {
    method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET || '' },
  });
  if (!r.ok) console.error('tick refused:', r.status);
};

export const config = { schedule: '* * * * *' };
