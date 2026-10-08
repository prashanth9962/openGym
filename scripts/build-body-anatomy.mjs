// Converts the detailed muscle artwork in scripts/anatomy-src/ into frontend/src/lib/body-anatomy.js,
// the figure the By-muscle screen draws. The artwork is "Muscle anatomy" by Ryan Graves (CC BY 4.0,
// https://www.figma.com/community/file/1320468164820924031), taken from the MIT-licensed muscle_mapper
// package; see NOTICE.md. Run: node scripts/build-body-anatomy.mjs
//
// Each named muscle shape is tagged with the app muscle it belongs to (lib/muscles.js MUSCLES). The
// chest is one shape per side in the artwork, so its regions (upper, mid, lower, inner, outer) are
// cut here as clip polygons that the map draws over it.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(here, 'anatomy-src')
const OUT = path.join(here, '../frontend/src/lib/body-anatomy.js')

// id prefix -> app muscle. First match wins.
const SLUG = [
  ['pectoralis_major', 'chest'],
  ['anterior_deltoid', 'deltoids'], ['lateral_deltoid', 'deltoids'], ['posterior_deltoid', 'deltoids'],
  ['trapezius', 'trapezius'],
  ['latissimus_dorsi', 'upper-back'], ['infraspinatus', 'upper-back'],
  ['biceps_brachii', 'biceps'], ['triceps_brachii', 'triceps'], ['anconeus', 'triceps'],
  ['brachioradialis', 'forearm'], ['flexor_carpi', 'forearm'], ['flexor_digitorum', 'forearm'], ['palmaris', 'forearm'],
  ['pronator', 'forearm'], ['extensor_carpi', 'forearm'], ['extensor_digitorum_r', 'forearm'], ['extensor_digitorum_l', 'forearm'],
  ['rectus_abdominis', 'abs'], ['external_oblique', 'obliques'],
  ['gluteus_', 'gluteal'],
  ['rectus_femoris', 'quadriceps'], ['vastus_', 'quadriceps'], ['sartoris', 'hip-flexors'],
  ['biceps_femoris', 'hamstring'], ['semitendinosus', 'hamstring'], ['semimembranosus', 'hamstring'],
  ['adductor_', 'adductors'], ['gracilis', 'adductors'], ['pectineus', 'adductors'],
  ['gastrocnemius', 'calves'],
  ['tibialis_anterior', 'tibialis'], ['extensor_digitorum_longus', 'tibialis'], ['extensor_hallucis', 'tibialis'], ['fibularis', 'tibialis'],
]
const slugOf = id => SLUG.find(([p]) => id.startsWith(p))?.[1] || null

// Path bounding box from every coordinate and control point (relative and absolute commands).
function bbox(d) {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g)
  let x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0
  const xs = [], ys = [], pt = (px, py) => { xs.push(px); ys.push(py) }
  const num = () => parseFloat(toks[i++])
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++]
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase()
    const ox = rel ? x : 0, oy = rel ? y : 0
    if (C === 'Z') { x = sx; y = sy; continue }
    if (C === 'M' || C === 'L' || C === 'T') { x = ox + num(); y = oy + num(); pt(x, y); if (C === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L' } }
    else if (C === 'H') { x = ox + num(); pt(x, y) }
    else if (C === 'V') { y = oy + num(); pt(x, y) }
    else if (C === 'C') { pt(ox + num(), oy + num()); pt(ox + num(), oy + num()); x = ox + num(); y = oy + num(); pt(x, y) }
    else if (C === 'S' || C === 'Q') { pt(ox + num(), oy + num()); x = ox + num(); y = oy + num(); pt(x, y) }
    else if (C === 'A') { num(); num(); num(); num(); num(); x = ox + num(); y = oy + num(); pt(x, y) }
    else { i++ }
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

// The chest regions as polygons, as fractions of the pec's box. f = 0 at the sternum, 1 at the arm.
function chestRegions(b, cx) {
  const [bx0, by0, bx1, by1] = b, w = bx1 - bx0, h = by1 - by0, pad = 40
  const leftIsInner = (bx0 + bx1) / 2 > cx ? false : true   // the pec left of centre has its sternum edge on the right
  const innerIsLeft = !leftIsInner
  const x0 = bx0 - pad, x1 = bx1 + pad, y = f => by0 + h * f
  const xAt = f => innerIsLeft ? bx0 + w * f : bx1 - w * f
  const band = (t0, t1, b0, b1) => {   // heights at the sternum (0) and the arm (1) end
    const L = innerIsLeft ? 0 : 1, R = 1 - L, top = [t0, t1], bot = [b0, b1]
    return [[x0, y(top[L])], [x1, y(top[R])], [x1, y(bot[R])], [x0, y(bot[L])]]
  }
  const strip = (f0, f1, top, bottom) => {
    const xa = f0 <= 0 ? (innerIsLeft ? x0 : x1) : xAt(f0), xb = f1 >= 1 ? (innerIsLeft ? x1 : x0) : xAt(f1)
    return [[xa, y(top)], [xb, y(top)], [xb, y(bottom)], [xa, y(bottom)]]
  }
  const r = n => Math.round(n * 10) / 10
  const regions = {
    upper: band(-1, -1, 0.34, 0.46), mid: band(0.34, 0.46, 0.66, 0.78), lower: band(0.66, 0.78, 2, 2),
    inner: strip(0, 0.34, -1, 2), outer: strip(0.62, 1, 0.45, 2),
  }
  return Object.fromEntries(Object.entries(regions).map(([k, pts]) => [k, pts.map(p => p.map(r))]))
}

// A plain head for the front view: the artwork draws the face as exposed muscle.
const HEAD = [
  ['s', 'M242 74a6 13 0 1 0 12 0a6 13 0 1 0 -12 0ZM332 74a6 13 0 1 0 12 0a6 13 0 1 0 -12 0Z'],
  ['s', 'M293 15C268 15 251 33 251 62C251 80 255 96 263 108C271 119 281 124 293 124C305 124 315 119 323 108C331 96 335 80 335 62C335 33 318 15 293 15Z'],
  ['f', 'M270 62Q277 58 284 62M302 62Q309 58 316 62M293 66L290 84Q293 86 296 84L293 66M281 102Q293 109 305 102'],
]

function convert(file, view) {
  const text = fs.readFileSync(path.join(SRC, file), 'utf8')
  const vb = /viewBox="([^"]+)"/.exec(text)[1]
  const layers = [], stack = []
  const re = /<g id="([^"]+)"[^>]*>|<\/g>|<path\b([^>]*?)\/?>/gs
  let m
  while ((m = re.exec(text))) {
    if (m[0].startsWith('<g')) { stack.push(m[1]); continue }
    if (m[0] === '</g>') { stack.pop(); continue }
    const a = m[2], d = /\sd="([^"]+)"/.exec(a)?.[1], id = /\sid="([^"]+)"/.exec(a)?.[1]
    if (!d || id === 'underlayer') continue
    if (view === 'front' && stack.includes('face')) continue
    const stroke = /\sstroke="[^"]+"/.test(a), fill = /\sfill="([^"]+)"/.exec(a)?.[1]
    if (id) {
      const slug = slugOf(id)
      layers.push(slug ? ['m', d, slug, id] : ['n', d])        // named muscle the app tracks / one it doesn't
    } else if (stroke && !fill) layers.push(['l', d])          // outline art
    else layers.push(['s', d])                                 // silhouette and small details
  }
  if (view === 'front') {
    // the outline carries the face lines, so the plain head goes on top of everything
    layers.push(...HEAD)
  }
  return { vb: vb.replace(/^0 0 /, '0 0 '), layers }
}

const out = { front: convert('male_front_muscle_anatomy.svg', 'front'), back: convert('male_back_muscle_anatomy.svg', 'back'), chest: {} }
const cx = Number(out.front.vb.split(/\s+/)[2]) / 2
for (const side of ['l', 'r']) {
  const layer = out.front.layers.find(l => l[3] === `pectoralis_major_${side}`)
  out.chest[side] = { d: layer[1], regions: chestRegions(bbox(layer[1]), cx) }
}
const header = `// The detailed body the By-muscle screen draws: front and back, each a list of layers
//   ['m', d, muscle, id]  a muscle shape the app tracks (muscle = a MUSCLES key in muscles.js)
//   ['n', d]              a named muscle it does not track
//   ['s', d]              silhouette and small details, ['l', d] outline art, ['f', d] face lines
// plus the chest cut into regions: clip polygons over each pec (see lib/sub-muscles.js).
// Artwork: "Muscle anatomy" by Ryan Graves, CC BY 4.0, via the MIT-licensed muscle_mapper package;
// see NOTICE.md. ~300 KB, so this module is imported dynamically. Generated by
// scripts/build-body-anatomy.mjs — do not hand-edit.

`
fs.writeFileSync(OUT, header + 'export default ' + JSON.stringify(out) + '\n')
const count = v => v.layers.filter(l => l[0] === 'm').length
console.log('front', count(out.front), 'muscle shapes /', out.front.layers.length, 'layers; back', count(out.back), '/', out.back.layers.length)
console.log('chest regions', Object.keys(out.chest.l.regions).join(','), (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB')
