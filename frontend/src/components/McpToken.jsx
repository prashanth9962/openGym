// Settings → Account → AI assistants: the token that lets an LLM client without a local process
// (ChatGPT's custom connectors) read and update this profile through the remote MCP endpoint, /mcp. The
// server makes it (api/server.js, POST /api/account/mcp-token), keeps only its hash, and shows it
// here once; making a new one replaces the old, revoking removes it.
import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { dateLocale } from '../lib/i18n-core.js'
import { api } from '../lib/api.js'
import { copyText } from '../lib/clipboard.js'
import { Row, Button } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const errStyle = { color: 'var(--red)', marginTop: 10 }
const mcpUrl = token => `${location.origin}/mcp/${token}`

export function McpTokenRow() {
  return <Row icon="key" iconTint="var(--indigo)" title={t('AI assistants (MCP)')} accessory="chevron"
    subtitle={t('Let ChatGPT or another AI app read and update your training data.')}
    onClick={() => ui().openSheet(close => <McpTokenSheet close={close} />)} />
}

export function McpTokenSheet({ close }) {
  const [st, setSt] = useState(null)        // { on, created }
  const [fresh, setFresh] = useState(null)  // the token, only until this sheet closes
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { api('/api/account/mcp-token').then(setSt).catch(e => setErr(e.message)) }, [])
  const run = async (method, then) => {
    if (busy) return
    setBusy(true); setErr(null)
    try { then(await api('/api/account/mcp-token', { method })) } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  const make = () => run('POST', r => { setFresh(r.token); setSt({ on: true, created: r.created }) })
  const revoke = () => run('DELETE', () => { setFresh(null); setSt({ on: false, created: null }) })
  const copy = async text => { if (await copyText(text)) toast(t('Copied')) }
  return <>
    <h3>{t('AI assistants (MCP)')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('A token lets an AI app that cannot run on your computer, such as ChatGPT, read your routines, workouts, body weight and 1RMs, and log workouts and weigh-ins, edit routines and plan your week. It cannot delete anything. Anyone who has the token can read and change your data, so keep it private.')}
    </div>
    {!st ? <div className="muted small">{err || '…'}</div> : fresh ? <>
      <div className="small" style={{ marginBottom: 8 }}>{t('Copy it now. It is shown only once.')}</div>
      <div className="card" dir="ltr" style={{ wordBreak: 'break-all', fontFamily: 'monospace', fontSize: 13, padding: 12 }}>{fresh}</div>
      <div style={{ height: 10 }} />
      <Button icon="copy" variant="primary" onClick={() => copy(fresh)}>{t('Copy token')}</Button>
      <div style={{ height: 8 }} />
      <Button icon="link" onClick={() => copy(mcpUrl(fresh))}>{t('Copy connector address')}</Button>
      <div className="dim small" style={{ marginTop: 10 }}>
        {t('Connector address: {0}', `${location.origin}/mcp/<token>`)}
        {' '}{t('If the app has a field for a token or API key, use {0} as the address and paste the token there.', `${location.origin}/mcp`)}
      </div>
    </> : <>
      <div className="small" style={{ marginBottom: 12 }}>
        {st.on ? t('A token exists, made on {0}. It cannot be shown again.', new Date(st.created).toLocaleDateString(dateLocale())) : t('No token yet.')}
      </div>
      <Button variant="primary" disabled={busy} onClick={make}>{st.on ? t('Make a new token (the old one stops working)') : t('Make a token')}</Button>
      {st.on && <><div style={{ height: 8 }} /><button type="button" className="btn danger" disabled={busy} onClick={revoke}>{t('Revoke token')}</button></>}
    </>}
    {err && st && <div className="small" role="alert" style={errStyle}>{err}</div>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" onClick={close}>{t('Done')}</Button>
  </>
}
