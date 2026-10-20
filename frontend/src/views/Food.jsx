// Food: what you ate each day, logged by hand, against daily targets. The data is S.food
// (lib/food.js) — a food you eat often is kept once and tapped to log again, nothing is looked up
// anywhere. Days step back and forward; each meal lists its entries, and an entry is tapped to
// change or remove.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { MEALS, normalizeFood, entriesOn, dayTotals, addEntry, editEntry, removeEntry, rememberFood, suggestions, recentDays, amount } from '../lib/food.js'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'

const ui = () => useUI.getState()
const change = fn => useStore.getState().update(s => { s.food = normalizeFood(s.food); fn(s.food) })
const MEAL_NAME = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snacks' }
const shift = (iso, n) => {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}
const macros = e => `P ${fmtNum(e.p)} · C ${fmtNum(e.c)} · F ${fmtNum(e.f)}`

function Bar({ value, goal, color = 'var(--accent, #9be564)' }) {
  const pct = goal > 0 ? Math.min(100, Math.round(value / goal * 100)) : 0
  return <div style={{ height: 8, borderRadius: 4, background: 'var(--sep)', overflow: 'hidden' }}>
    <div style={{ width: pct + '%', height: '100%', background: value > goal && goal > 0 ? 'var(--red)' : color }} />
  </div>
}

function Num({ label, value, onChange, unit }) {
  return <label style={{ flex: 1, minWidth: 0 }}>
    <div className="muted small" style={{ marginBottom: 4 }}>{label}{unit ? ` (${unit})` : ''}</div>
    <input className="input" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} placeholder="0" />
  </label>
}

// Adding an entry to `iso` under `meal`, or changing `entry`.
function EntrySheet({ iso, meal, entry, close }) {
  const S = useStore(s => s.S)
  const food = normalizeFood(S.food)
  const [m, setM] = useState(entry?.meal || meal)
  const [name, setName] = useState(entry?.n || '')
  const [kcal, setKcal] = useState(entry ? String(entry.kcal || '') : '')
  const [p, setP] = useState(entry ? String(entry.p || '') : '')
  const [c, setC] = useState(entry ? String(entry.c || '') : '')
  const [f, setF] = useState(entry ? String(entry.f || '') : '')
  const [keep, setKeep] = useState(!entry)
  const [err, setErr] = useState(null)
  const fill = x => { setName(x.n); setKcal(String(x.kcal || '')); setP(String(x.p || '')); setC(String(x.c || '')); setF(String(x.f || '')) }
  const ideas = entry ? [] : suggestions(food, iso)
  const save = ev => {
    ev.preventDefault()
    const row = { name, meal: m, kcal, p, c, f }
    if (!name.trim() || !(amount(kcal) || amount(p) || amount(c) || amount(f))) { setErr(t('Add a name and at least calories or a macro.')); return }
    change(fd => {
      if (entry) editEntry(fd, iso, entry.id, row); else addEntry(fd, iso, row)
      if (keep) rememberFood(fd, row)
    })
    close()
  }
  const remove = () => { change(fd => removeEntry(fd, iso, entry.id)); close() }
  return <>
    <h3>{entry ? t('Edit food') : t('Add food')}</h3>
    {ideas.length > 0 && <div style={{ marginBottom: 12 }}>
      <div className="muted small" style={{ marginBottom: 6 }}>{t('Your foods and recent ones')}</div>
      <div className="chips">{ideas.map(x => <button key={x.n} type="button" className="chip nocap" onClick={() => fill(x)}>{x.n} <span className="dim">{fmtNum(x.kcal)}</span></button>)}</div>
    </div>}
    <form onSubmit={save} noValidate>
      <input className="input" placeholder={t('What did you eat? e.g. 2 eggs and toast')} maxLength={80} value={name} onChange={e => setName(e.target.value)} />
      <div className="chips" style={{ margin: '10px 0' }}>
        {MEALS.map(x => <button key={x} type="button" className={'chip nocap' + (m === x ? ' on' : '')} aria-pressed={m === x} onClick={() => setM(x)}>{t(MEAL_NAME[x])}</button>)}
      </div>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <Num label={t('Calories')} unit="kcal" value={kcal} onChange={setKcal} />
        <Num label={t('Protein')} unit="g" value={p} onChange={setP} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <Num label={t('Carbs')} unit="g" value={c} onChange={setC} />
        <Num label={t('Fat')} unit="g" value={f} onChange={setF} />
      </div>
      {!entry && <label className="row" style={{ gap: 8, margin: '12px 0 0', alignItems: 'center' }}>
        <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} /> <span className="small">{t('Keep in my foods to log again')}</span>
      </label>}
      {err && <div className="small" role="alert" style={{ color: 'var(--red)', marginTop: 10 }}>{err}</div>}
      <div style={{ height: 12 }} />
      <Button type="submit" variant="primary">{t('Save')}</Button>
    </form>
    {entry && <><div style={{ height: 8 }} /><button type="button" className="btn danger" onClick={remove}>{t('Remove')}</button></>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" onClick={close}>{t('Cancel')}</Button>
  </>
}

function TargetsSheet({ close }) {
  const cur = normalizeFood(useStore(s => s.S).food).targets || {}
  const [kcal, setKcal] = useState(String(cur.kcal || ''))
  const [p, setP] = useState(String(cur.p || ''))
  const [c, setC] = useState(String(cur.c || ''))
  const [f, setF] = useState(String(cur.f || ''))
  const save = ev => {
    ev.preventDefault()
    const targets = { kcal: amount(kcal), p: amount(p), c: amount(c), f: amount(f), t: Date.now() }
    change(fd => { fd.targets = (targets.kcal || targets.p || targets.c || targets.f) ? targets : null })
    close()
  }
  return <>
    <h3>{t('Daily targets')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Leave a field empty to skip it.')}</div>
    <form onSubmit={save} noValidate>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <Num label={t('Calories')} unit="kcal" value={kcal} onChange={setKcal} />
        <Num label={t('Protein')} unit="g" value={p} onChange={setP} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <Num label={t('Carbs')} unit="g" value={c} onChange={setC} />
        <Num label={t('Fat')} unit="g" value={f} onChange={setF} />
      </div>
      <div style={{ height: 12 }} />
      <Button type="submit" variant="primary">{t('Save')}</Button>
    </form>
    <div style={{ height: 8 }} />
    <Button variant="ghost" onClick={close}>{t('Cancel')}</Button>
  </>
}

export default function Food() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const food = normalizeFood(S.food)
  const today = todayISO()
  const [iso, setIso] = useState(today)
  const entries = entriesOn(food, iso)
  const total = dayTotals(entries)
  const goal = food.targets
  const days = recentDays(food, iso, 7)
  const open = (meal, entry) => ui().openSheet(close => <EntrySheet iso={iso} meal={meal} entry={entry} close={close} />)

  return <>
    <div className="hdr"><div><h1>{t('Food')}</h1></div>
      <Button size="sm" icon="target" onClick={() => ui().openSheet(close => <TargetsSheet close={close} />)}>{goal ? t('Targets') : t('Set targets')}</Button>
    </div>
    <div className="card row between" style={{ alignItems: 'center', padding: '8px 10px' }}>
      <button className="iconbtn" onClick={() => setIso(shift(iso, -1))} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
      <div style={{ textAlign: 'center' }}>
        <b>{iso === today ? t('Today') : fmtDate(iso, true)}</b>
        {iso !== today && <div><button className="btn plain" style={{ fontSize: 12, padding: 0 }} onClick={() => setIso(today)}>{t('Back to today')}</button></div>}
      </div>
      <button className="iconbtn" onClick={() => setIso(shift(iso, 1))} disabled={iso >= today} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
    </div>

    <div className="card">
      <div className="row between" style={{ alignItems: 'baseline', marginBottom: 6 }}>
        <div className="big">{fmtNum(total.kcal)} <span className="muted" style={{ fontSize: '1rem' }}>{goal?.kcal ? `/ ${fmtNum(goal.kcal)} ` : ''}kcal</span></div>
        {goal?.kcal > 0 && <span className="small muted">{total.kcal <= goal.kcal ? t('{0} left', fmtNum(Math.round(goal.kcal - total.kcal))) : t('{0} over', fmtNum(Math.round(total.kcal - goal.kcal)))}</span>}
      </div>
      {goal?.kcal > 0 && <Bar value={total.kcal} goal={goal.kcal} />}
      <div className="row" style={{ gap: 12, marginTop: 12 }}>
        {[['Protein', 'p'], ['Carbs', 'c'], ['Fat', 'f']].map(([label, k]) => <div key={k} style={{ flex: 1, minWidth: 0 }}>
          <div className="small muted">{t(label)}</div>
          <div><b>{fmtNum(total[k])}</b><span className="muted small"> {goal?.[k] ? `/ ${fmtNum(goal[k])} ` : ''}g</span></div>
          {goal?.[k] > 0 && <Bar value={total[k]} goal={goal[k]} />}
        </div>)}
      </div>
    </div>

    {MEALS.map(m => {
      const list = entries.filter(e => e.meal === m)
      const sub = dayTotals(list)
      return <div key={m} className="card">
        <div className="row between" style={{ alignItems: 'center', marginBottom: list.length ? 6 : 0 }}>
          <h2 style={{ margin: 0 }}>{t(MEAL_NAME[m])} {list.length > 0 && <span className="muted small">{fmtNum(sub.kcal)} kcal</span>}</h2>
          <Button size="sm" icon="plus" onClick={() => open(m)}>{t('Add')}</Button>
        </div>
        {list.map(e => <div key={e.id} className="row between" style={{ padding: '9px 2px', borderTop: '1px solid var(--sep)', alignItems: 'center', gap: 8 }} {...tappable(() => open(m, e))}>
          <div style={{ minWidth: 0 }}><div style={{ overflowWrap: 'anywhere' }}>{e.n}</div><div className="muted small">{macros(e)}</div></div>
          <b style={{ flexShrink: 0 }}>{fmtNum(e.kcal)}</b>
        </div>)}
      </div>
    })}

    {days.some(d => d.count) && <div className="card">
      <h2 style={{ marginTop: 0 }}>{t('Last 7 days')}</h2>
      {days.map(d => <div key={d.d} className="row between small" style={{ padding: '4px 0', gap: 8 }}>
        <span className="muted" style={{ width: 90, flexShrink: 0 }}>{fmtDate(d.d)}</span>
        <div style={{ flex: 1 }}><Bar value={d.kcal} goal={goal?.kcal || Math.max(...days.map(x => x.kcal), 1)} /></div>
        <span style={{ width: 56, textAlign: 'right', flexShrink: 0 }}>{d.count ? fmtNum(d.kcal) : '–'}</span>
      </div>)}
    </div>}
    <div className="dim small" style={{ margin: '4px 2px 16px' }}>{t('Calories and macros are what you type in. Nothing is looked up or sent anywhere.')}</div>
  </>
}
