/* The tools that change a profile, for the remote transport only (remote.js). Each one is a pure
   `mutate(S, params)` over a copy of the profile document: it edits `S` in place and returns what
   to tell the model, or throws an Error with a `code` the model can act on. Saving is not here:
   write.js reads the document through the API, runs the mutation and PUTs it back with the
   revision it read, so a change made on the phone in between is merged, never overwritten.

   Workouts go in the way the app files one logged after the fact (backfill): the same builders,
   in date order, with the PR badges worked out against the history around them. */
import { z } from 'zod'
import { uid } from '../../frontend/src/lib/format.js'
import { EXIDX, allExercises, searchExercises, isCardio } from '../../frontend/src/lib/exercises.js'
import { buildCompletedWorkout } from '../../frontend/src/lib/finish-workout.js'
import { completeBackfill } from '../../frontend/src/lib/backfill.js'
import { rebuildPrHistory } from '../../frontend/src/lib/workout-date.js'
import { stampWorkout } from '../../frontend/src/lib/sync-merge.js'
import { workoutVolume, bestWeightForEntry } from '../../frontend/src/lib/history.js'

const fail = (code, message) => Object.assign(new Error(message), { code })
const localIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').refine(
  v => { const d = new Date(v + 'T12:00:00'); return !Number.isNaN(d.getTime()) && localIso(d) === v },
  { message: 'not a date the calendar has (YYYY-MM-DD)' }
)
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

/* ---------- exercise lookup ---------- */

// An id the profile or the catalogue knows, else a search by name. A name that matches several
// exercises is an error that lists them: guessing would log the wrong lift.
export function resolveExercise(S, ref) {
  const q = String(ref || '').trim()
  if (!q) throw fail('EINVAL', 'an exercise is required (name or id)')
  const custom = (S.customEx || []).find(e => e && e.id === q)
  if (custom) return custom
  if (EXIDX[q]) return EXIDX[q]
  const all = allExercises(S)
  const norm = x => String(x || '').trim().toLowerCase()
  const exact = all.filter(e => norm(e.n) === norm(q))
  if (exact.length === 1) return exact[0]
  const found = exact.length ? exact : searchExercises(all, q)
  if (found.length === 1) return found[0]
  if (!found.length) throw fail('ENOENT', `no exercise matches "${q}" — try a simpler name`)
  const list = found.slice(0, 6).map(e => `${e.n} (id ${e.id})`).join('; ')
  throw fail('EAMBIGUOUS', `"${q}" matches ${found.length} exercises: ${list}${found.length > 6 ? '; …' : ''}. Pass the id, or a fuller name.`)
}

const nameOf = ex => ex.n || ex.id

/* ---------- the tools ---------- */

const setSchema = z.object({
  weight: z.number().min(0).max(1000).describe("Load in the profile's unit (kg or lb); 0 for bodyweight"),
  reps: z.number().int().min(1).max(500),
  rpe: z.number().min(1).max(10).optional().describe('Optional effort, 1–10'),
})
const cfgSchema = z.object({
  exercise: z.string().describe('Exercise name or id'),
  sets: z.number().int().min(1).max(20),
  reps: z.number().int().min(1).max(500),
  weight: z.number().min(0).max(1000).optional().describe("Starting load in the profile's unit"),
})

const logBodyweight = {
  name: 'log_bodyweight',
  description: "Add or replace a body-weight entry (the day's weigh-in) in the profile's unit.",
  schema: { weight: z.number().min(20).max(700), date: isoDate().optional().describe('Defaults to today') },
  mutate(S, { weight, date }) {
    const d = date || localIso(new Date())
    S.bodyweight = Array.isArray(S.bodyweight) ? S.bodyweight : []
    const have = S.bodyweight.find(b => b.d === d)
    if (have) { have.w = weight; have.t = Date.now() } else S.bodyweight.push({ d, w: weight, t: Date.now() })
    S.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
    return { logged: { date: d, weight, unit: S.unit || 'kg' }, replaced: !!have }
  },
}

const logWorkout = {
  name: 'log_workout',
  description: 'Log a finished workout after the fact: the exercises with every set done (weight × reps). It is filed on its date, counts for history, stats and 1RM, and PR badges are worked out against the rest of the history. Use list_routines / get_routine first if it followed a routine.',
  schema: {
    date: isoDate().describe('The day it was done'),
    name: z.string().max(60).optional().describe('Defaults to the routine name, else "Workout"'),
    routine_id: z.string().optional().describe('The routine it followed, from list_routines'),
    duration_minutes: z.number().int().min(1).max(600).optional().describe('Defaults to 60'),
    note: z.string().max(500).optional(),
    exercises: z.array(z.object({ exercise: z.string().describe('Exercise name or id'), sets: z.array(setSchema).min(1).max(30) })).min(1).max(30),
  },
  mutate(S, p) {
    S.workouts = Array.isArray(S.workouts) ? S.workouts : []
    const routine = p.routine_id ? (S.routines || []).find(r => r && r.id === p.routine_id) : null
    if (p.routine_id && !routine) throw fail('ENOENT', `no routine with id ${p.routine_id}`)
    const entries = p.exercises.map(x => {
      const ex = resolveExercise(S, x.exercise)
      if (isCardio(ex)) throw fail('EINVAL', `${nameOf(ex)} is a cardio exercise; log_workout takes weight × reps lifts only`)
      const sets = x.sets.map(s => ({ w: s.weight, r: s.reps, done: true, ...(s.rpe != null ? { rpe: s.rpe } : {}) }))
      return { id: ex.id, sets, target: null }
    })
    const mins = p.duration_minutes || 60
    const isToday = p.date === localIso(new Date())
    const end = isToday ? Date.now() : new Date(p.date + 'T18:00:00').getTime()
    const active = {
      id: uid(), d: p.date, start: end - mins * 60000,
      name: p.name || routine?.name || 'Workout',
      entries, routineIds: routine ? [routine.id] : [], note: p.note || '',
      backfill: {},
    }
    const w = buildCompletedWorkout(active, { end, prs: [] })
    w.vol = workoutVolume(w)
    stampWorkout(w)
    const touched = [...new Set(w.entries.map(e => e.id))]
    S.workouts = rebuildPrHistory(completeBackfill(S.workouts, active, w), touched, w)
    const filed = S.workouts.find(x => x.id === w.id) || w
    return {
      logged: { id: filed.id, date: filed.d, name: filed.name, exercises: filed.entries.map(e => ({ exercise: nameOf(resolveExercise(S, e.id)), sets: e.sets.length, top_weight: bestWeightForEntry(e) || null })), volume: filed.vol },
      personal_records: (filed.prs || []).map(id => nameOf(resolveExercise(S, id))),
    }
  },
}

const saveRoutine = {
  name: 'save_routine',
  description: "Create a routine, or change one (pass routine_id). With `exercises`, the routine holds exactly that list: exercises already in it keep their other settings (progression rule, notes) and take the new sets, reps and weight; ones left out are removed. Without `exercises` only the name changes.",
  schema: {
    routine_id: z.string().optional().describe('Omit to create a new routine'),
    name: z.string().min(1).max(60).optional(),
    exercises: z.array(cfgSchema).max(40).optional(),
  },
  mutate(S, p) {
    S.routines = Array.isArray(S.routines) ? S.routines : []
    let r = p.routine_id ? S.routines.find(x => x && x.id === p.routine_id) : null
    if (p.routine_id && !r) throw fail('ENOENT', `no routine with id ${p.routine_id}`)
    if (!r) {
      if (!p.name) throw fail('EINVAL', 'a name is required for a new routine')
      r = { id: uid(), name: p.name, emoji: 'dumbbell', ex: [] }
      S.routines.push(r)
    } else if (p.name) r.name = p.name
    if (p.exercises) {
      const old = new Map((r.ex || []).map(e => [e.id, e]))
      r.ex = p.exercises.map(c => {
        const ex = resolveExercise(S, c.exercise)
        const base = old.get(ex.id) || { id: ex.id, mode: 'reps' }
        const next = { ...base, id: ex.id, sets: c.sets, reps: c.reps }
        if (c.weight != null) next.weight = c.weight
        return next
      })
    }
    return { routine: { id: r.id, name: r.name, exercises: (r.ex || []).map(e => ({ exercise: nameOf(resolveExercise(S, e.id)), sets: e.sets, reps: e.reps, weight: e.weight ?? null })) }, created: !p.routine_id }
  },
}

const setWeekPlan = {
  name: 'set_week_plan',
  description: 'Set which routine(s) are planned on a weekday in the standing weekly plan. An empty list makes it a rest day. Does not touch a coach week or a one-day override.',
  schema: { weekday: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']), routine_ids: z.array(z.string()).max(4) },
  mutate(S, { weekday, routine_ids }) {
    for (const id of routine_ids) if (!(S.routines || []).some(r => r && r.id === id)) throw fail('ENOENT', `no routine with id ${id}`)
    S.week = S.week && typeof S.week === 'object' && !Array.isArray(S.week) ? S.week : {}
    const wd = WEEKDAYS[weekday]
    if (routine_ids.length) S.week[wd] = routine_ids; else delete S.week[wd]
    return { weekday, routines: routine_ids.map(id => S.routines.find(r => r.id === id).name) }
  },
}

const setDayOverride = {
  name: 'set_day_override',
  description: "Plan one specific date: a routine for that day, 'rest' for a rest day, or null to remove the override and fall back to the weekly plan.",
  schema: { date: isoDate(), routine_id: z.string().nullable().describe("A routine id, 'rest', or null to clear") },
  mutate(S, { date, routine_id }) {
    S.dayPlan = S.dayPlan && typeof S.dayPlan === 'object' && !Array.isArray(S.dayPlan) ? S.dayPlan : {}
    if (routine_id === null) { delete S.dayPlan[date]; return { date, override: null } }
    if (routine_id !== 'rest' && !(S.routines || []).some(r => r && r.id === routine_id)) throw fail('ENOENT', `no routine with id ${routine_id}`)
    S.dayPlan[date] = routine_id
    return { date, override: routine_id === 'rest' ? 'rest' : S.routines.find(r => r.id === routine_id).name }
  },
}

export const WRITE_TOOLS = [logBodyweight, logWorkout, saveRoutine, setWeekPlan, setDayOverride]
