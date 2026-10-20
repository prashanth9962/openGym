/* Ranked exercise search, shared by the search_exercises tool and the write tools' name lookup.
   The catalogue's own search (exercises.js) filters; this orders what it found: best field match
   first, and among equals the plainer (shorter) name, so "lat pulldown" lists the lat pulldowns
   before the band and machine variants. Custom exercises of the profile are searched too. */
import { allExercises, searchScore } from '../../frontend/src/lib/exercises.js'

const norm = s => String(s || '').trim().toLowerCase()
const words = s => norm(s).split(/[^a-z0-9]+/).filter(Boolean)
// every word of the query is a whole word of the name ("lat" is in "pro lat bar", not in "lateral")
const wholeWords = (name, tokens) => tokens.length > 0 && tokens.every(t => words(name).includes(t))

export function rankExercises(S, query, { equipment, bodyPart, limit = 10 } = {}) {
  const q = norm(query)
  const tokens = words(q)
  let list = allExercises(S || {})
  if (equipment) list = list.filter(e => norm(e.eq).includes(norm(equipment)))
  if (bodyPart) list = list.filter(e => norm(e.bp).includes(norm(bodyPart)))
  const scored = list
    .map(e => ({ e, s: searchScore(e, q) + (norm(e.n) === q ? 1000 : 0) + (wholeWords(e.n, tokens) ? 200 : 0) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || String(a.e.n).length - String(b.e.n).length)
  return { total: scored.length, results: scored.slice(0, limit).map(x => x.e) }
}

export const exerciseSummary = e => ({ id: e.id, name: e.n, equipment: e.eq || null, body_part: e.bp || null, target: e.tg || null })
