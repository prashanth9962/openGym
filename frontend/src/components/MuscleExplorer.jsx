import { useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { BODYPARTS, allExercises, equipmentOf, searchExercises } from '../lib/exercises.js'
import { activeProfile, exAvailable } from '../lib/equipment.js'
import { bestWeightFor } from '../lib/history.js'
import { fmtNum, exCount } from '../lib/format.js'
import { MUSCLES, MUSCLE_NAME, musclesOf } from '../lib/muscles.js'
import { SUB_MUSCLES, SUB_MUSCLE_NAME, subMusclesOf } from '../lib/sub-muscles.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import AnatomyMap from './AnatomyMap.jsx'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { isFav, sortFavouritesFirst } from '../lib/favourites.js'

// One explorer for the Library and every catalogue picker. Supplying `onPick` turns
// a result into a selection; without it the explorer behaves like the normal Library.
export default function MuscleExplorer({ onPick, onDetail, onPlan }) {
  const S = useStore(s => s.S)
  const [selected, setSelected] = useState(null)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [eq, setEq] = useState('')
  const [sub, setSub] = useState('')   // a region of the picked muscle (upper chest, rear delts…); '' = the whole muscle
  const [shown, setShown] = useState(40)
  const [withSecondary, setWithSecondary] = useState(false)   // also list exercises that only train the muscle as a secondary
  const [showAll, setShowAll] = useState(false)   // ignore the active equipment profile for this session
  // Same rule as the Library and the picker: the active equipment profile narrows the catalogue
  // (and the per-muscle counts) unless the user asks for everything.
  const profile = activeProfile(S)
  const catalog = useMemo(() => {
    const all = allExercises(S)
    return (profile && !showAll) ? all.filter(e => exAvailable(S, e)) : all
  }, [S.customEx, S.equipFilterOn, S.activeEquipId, S.equipProfiles, showAll])
  // musclesOf weights a primary 1 and a supporting muscle less, so `=== 1` is "primary target".
  const trains = (e, m) => withSecondary ? !!musclesOf(e)[m] : musclesOf(e)[m] === 1
  const counts = useMemo(() => Object.fromEntries(MUSCLES.map(m => [m,
    catalog.filter(e => trains(e, m)).length
  ])), [catalog, withSecondary])
  const pick = muscle => { setSelected(muscle === selected ? null : muscle); setSub(''); setEq(''); setShown(40) }
  const inMuscle = selected ? catalog.filter(e => trains(e, selected)) : []
  const subs = (selected && SUB_MUSCLES[selected]) || []
  const subCounts = Object.fromEntries(subs.map(r => [r, inMuscle.filter(e => subMusclesOf(e, selected).includes(r)).length]))
  const targeted = sub ? inMuscle.filter(e => subMusclesOf(e, selected).includes(sub)) : inMuscle
  const base = searchExercises(targeted.filter(e => !bp || e.bp === bp), q)
  const eqOpts = equipmentOf(base)
  const eqOn = eqOpts.includes(eq) ? eq : ''
  // Favourites float to the top of whatever the filters left (issue #6), the rest keeps its order.
  const exercises = sortFavouritesFirst(eqOn ? base.filter(e => e.eq === eqOn) : base, S)
    .map((e, i) => [e, i]).sort((a, b) => (musclesOf(b[0])[selected] === 1) - (musclesOf(a[0])[selected] === 1) || a[1] - b[1]).map(x => x[0])
  const choose = ex => onPick ? onPick(ex) : onDetail(ex)
  // The live count and the × of the Library's search (#338): the count while a search or a
  // filter narrows the muscle's list, the × while there is text.
  const narrowed = !!(q.trim() || bp || eqOn)

  return <>
    {profile && <div className="small dim row" style={{ margin: '-4px 2px 10px', gap: 6, alignItems: 'center' }}>
      <Icon name="kettlebell" style={{ fontSize: 13 }} />
      {showAll ? t('Showing all equipment') : t('Showing what you have in "{0}"', profile.name)}
      <button className="chip nocap" style={{ marginInlineStart: 'auto', padding: '3px 10px', fontSize: 12 }} onClick={() => { setShowAll(v => !v); setEq(''); setShown(40) }}>
        {showAll ? t('Filter by "{0}"', profile.name) : t('Show all equipment')}
      </button>
    </div>}
    <div className="card">
      <AnatomyMap className="tappable" selected={selected} region={sub} onMuscle={pick} />
      <div className="chips" style={{ marginTop: 10 }}>
        {MUSCLES.map(m => <button key={m} className={'chip' + (selected === m ? ' on' : '')}
          aria-pressed={selected === m} onClick={() => pick(m)}>
          {t(MUSCLE_NAME[m])} <span className="dim">{counts[m]}</span>
        </button>)}
      </div>
      <div className="small dim" style={{ marginTop: 8 }}>{t('Body artwork by Ryan Graves, CC BY 4.0')}</div>
    </div>

    {!selected && onPick && <div className="empty"><div className="ico"><Icon name="figureStrength" /></div>{t('Choose a muscle to see exercises that train it.')}</div>}

    {selected && <>
      <div className="row between" style={{ margin: '2px 0 10px' }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Exercises for {0}', t(MUSCLE_NAME[selected]))}</h4>
        <Button size="sm" variant="ghost" onClick={() => pick(selected)}>{t('Clear selection')}</Button>
      </div>
      {subs.length > 0 && <div className="chips" style={{ marginBottom: 10 }}>
        <button className={'chip nocap' + (!sub ? ' on' : '')} aria-pressed={!sub} onClick={() => { setSub(''); setEq(''); setShown(40) }}>{t('Whole muscle')}</button>
        {subs.map(r => <button key={r} className={'chip nocap' + (sub === r ? ' on' : '')} aria-pressed={sub === r}
          onClick={() => { setSub(sub === r ? '' : r); setEq(''); setShown(40) }}>{t(SUB_MUSCLE_NAME[r])} <span className="dim">{subCounts[r]}</span></button>)}
      </div>}
      <div className="chips" style={{ marginBottom: 10 }}>
        <button className={'chip nocap' + (!withSecondary ? ' on' : '')} aria-pressed={!withSecondary} onClick={() => { setWithSecondary(false); setShown(40) }}>{t('Primary only')}</button>
        <button className={'chip nocap' + (withSecondary ? ' on' : '')} aria-pressed={withSecondary} onClick={() => { setWithSecondary(true); setShown(40) }}>{t('Include secondary')}</button>
      </div>
      <div className={'search' + (narrowed ? ' has-count' : '') + (q ? ' has-clear' : '')} style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
        <input className="input" placeholder={t('Search…')} value={q} onChange={e => { setQ(e.target.value); setShown(40) }} />
        {narrowed && <span className="search-count" role="status" aria-label={exCount(exercises.length)}>{fmtNum(exercises.length)}</span>}
        {q && <button className="clear" onClick={() => { setQ(''); setShown(40) }} aria-label={t('Clear')}><Icon name="xmark" /></button>}
      </div>
      {/* Changing body part keeps the equipment filter (issue #71, same rule as Library): the
          eqOn fallback above drops it only for this view if the new body part has nothing under
          it, without forgetting the choice. "All" clears it, since it spans every body part. */}
      <div className="chips" style={{ marginBottom: eqOpts.length > 1 ? 8 : 12 }}>
        <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setEq(''); setShown(40) }}>{t('All')}</button>
        {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setShown(40) }}>{t(b)}</button>)}
      </div>
      {eqOpts.length > 1 && <div className="chips" style={{ marginBottom: 12 }}>
        <button className={'chip nocap' + (!eqOn ? ' on' : '')} onClick={() => { setEq(''); setShown(40) }}>{t('Any equipment')}</button>
        {eqOpts.map(x => <button key={x} className={'chip' + (eqOn === x ? ' on' : '')} onClick={() => { setEq(x); setShown(40) }}>{t(x)}</button>)}
      </div>}
      <div className="list">
        {exercises.slice(0, shown).map(e => {
          const best = bestWeightFor(S, e.id)
          const primary = musclesOf(e)[selected] === 1
          return <div key={e.id} className="item" {...tappable(() => choose(e))}>
            <Thumb ex={e} />
            <div className="grow"><div className={`tt ${exerciseNameClass(e)}`}>{isFav(S, e.id) && <Icon name="starFill" className="fav-star" />}{exerciseNameFor(e)}</div><div className="ss">{t(primary ? 'Primary target' : 'Also trains')} · <span className="capitalize">{t(MUSCLE_NAME[e.tg] || e.tg || e.bp)} · {t(e.eq)}</span></div></div>
            {onPick ? <Icon name="plus" className="chev" /> : <>
              {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
              <Button size="sm" variant="tinted" icon="plus" onClick={ev => { ev.stopPropagation(); onPlan(e) }}>{t('Plan')}</Button>
            </>}
          </div>
        })}
        {exercises.length === 0 && <div className="empty"><div className="ico"><Icon name="magnifier" /></div>{t('No match')}</div>}
      </div>
      {exercises.length > shown && <><div style={{ height: 10 }} /><Button onClick={() => setShown(s => s + 40)}>{t('Show more')}</Button></>}
    </>}
  </>
}
