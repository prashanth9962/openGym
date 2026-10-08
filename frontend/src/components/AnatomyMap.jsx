import { useEffect, useState } from 'react'
import { MUSCLE_NAME, levelsOf } from '../lib/muscles.js'
import { REGION_SHAPES, REGION_CUT } from '../lib/sub-muscles.js'
import { t } from '../lib/i18n.js'

// The detailed body: front and back with each muscle (and head of a muscle) as its own shape.
// Used where you pick a muscle or a part of one; the Stats maps still use the simpler BodyMap.
//
// A muscle shape is tinted by how hard it was worked, like BodyMap. `selected` lights a whole
// muscle; with `region` as well, only that region is lit and the rest of the muscle is dimmed:
// a head of the shoulder, biceps or triceps is a shape of its own, a chest region is a cut over
// the pec (lib/body-anatomy.js `chest`), and a region with no shape (brachialis) lights the
// whole muscle. The artwork is male only, whichever body the profile uses.
//
// ~230 KB of geometry, so it is fetched on first render, as BodyMap does.

let CACHE = null
let PENDING = null

function useAnatomy() {
  const [data, setData] = useState(CACHE)
  useEffect(() => {
    if (CACHE) return
    let alive = true
    PENDING = PENDING || import('../lib/body-anatomy.js').then(m => (CACHE = m.default))
    PENDING.then(d => { if (alive) setData(d) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return data
}

const SIDES = { 'pectoralis_major_l': 'l', 'pectoralis_major_r': 'r' }

function View({ view, chest, levels, onMuscle, selected, region, uid }) {
  const shapeIds = selected && region ? REGION_SHAPES[region] : null
  const cut = selected === 'chest' && region ? REGION_CUT[region] : null
  const regional = !!(shapeIds || cut)
  const pick = slug => onMuscle ? () => onMuscle(slug) : undefined
  const state = (slug, id) => {
    if (selected !== slug) return ''
    if (!regional) return ' am-sel'
    return shapeIds && shapeIds.some(p => id.startsWith(p)) ? ' am-sel' : ' am-in'
  }
  return (
    <svg className="am-v" viewBox={view.vb} aria-hidden="true">
      {view.layers.map((layer, i) => {
        const [kind, d, slug, id] = layer
        if (kind === 's') return <path key={i} className="bm-sil" d={d} />
        if (kind === 'l') return <path key={i} className="am-l" d={d} />
        if (kind === 'f') return <path key={i} className="am-f" d={d} />
        if (kind === 'n') return <path key={i} className="bm-m l0" d={d} />
        const side = SIDES[id]
        return <g key={i}>
          <path className={'bm-m l' + (levels[slug] || 0) + state(slug, id)} d={d}
            onClick={pick(slug)} data-muscle={slug}>
            <title>{t(MUSCLE_NAME[slug])}</title>
          </path>
          {cut && side && chest && <>
            <clipPath id={`${uid}-${side}`}><polygon points={chest[side].regions[cut].map(p => p.join(',')).join(' ')} /></clipPath>
            <path className="bm-m am-sel" d={d} clipPath={`url(#${uid}-${side})`} style={{ pointerEvents: 'none' }} />
          </>}
        </g>
      })}
    </svg>
  )
}

let seq = 0
/**
 * <AnatomyMap selected="biceps" region="biceps-long" onMuscle={slug => …} load={{ chest: 12 }} />
 */
export default function AnatomyMap({ load = {}, thresholds, onMuscle, selected, region, className = '' }) {
  const data = useAnatomy()
  const [uid] = useState(() => 'am' + ++seq)
  const levels = levelsOf(load, thresholds)
  return (
    <div className={'bodymap ' + className}>
      {data ? <>
        <View view={data.front} chest={data.chest} levels={levels} onMuscle={onMuscle} selected={selected} region={region} uid={uid + 'f'} />
        <View view={data.back} chest={data.chest} levels={levels} onMuscle={onMuscle} selected={selected} region={region} uid={uid + 'b'} />
      </> : <div className="bm-ph" aria-hidden="true" />}
    </div>
  )
}
