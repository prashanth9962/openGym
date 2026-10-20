// The tools that change a profile: each mutation on its own (write-tools.js), and the save loop
// with its conditional write (write.js), against a seeded profile.
import { describe, test, expect, vi } from 'vitest'
import { buildDemoState } from '../../frontend/src/lib/demoSeed.js'
import { EXDB } from '../../frontend/src/lib/exercises.js'
import { WRITE_TOOLS, resolveExercise } from '../src/write-tools.js'
import { changeProfile } from '../src/write.js'

const tool = n => WRITE_TOOLS.find(t => t.name === n)
const fresh = () => { const s = buildDemoState(); s.unit = 'kg'; return s }
const lift = EXDB.find(e => e.bp !== 'cardio')

describe('resolveExercise', () => {
  test('by id and by exact name', () => {
    expect(resolveExercise(fresh(), lift.id).id).toBe(lift.id)
    expect(resolveExercise(fresh(), lift.n.toUpperCase()).id).toBe(lift.id)
  })
  test('unknown and ambiguous names say so, with candidates', () => {
    expect(() => resolveExercise(fresh(), 'zzzqqqxxx')).toThrow(/no exercise matches/)
    try { resolveExercise(fresh(), 'press'); throw new Error('no throw') } catch (e) {
      expect(e.code).toBe('EAMBIGUOUS'); expect(e.message).toMatch(/\(id /)
    }
  })
})

describe('log_bodyweight', () => {
  test('adds, then replaces the same day, keeping date order', () => {
    const S = fresh()
    expect(tool('log_bodyweight').mutate(S, { weight: 80, date: '2030-01-02' }).replaced).toBe(false)
    expect(tool('log_bodyweight').mutate(S, { weight: 79.5, date: '2030-01-02' }).replaced).toBe(true)
    const rows = S.bodyweight.filter(b => b.d === '2030-01-02')
    expect(rows).toHaveLength(1)
    expect(rows[0].w).toBe(79.5)
    expect(S.bodyweight.map(b => b.d)).toEqual([...S.bodyweight.map(b => b.d)].sort())
  })
})

describe('log_workout', () => {
  test('files a finished session on its date, with volume and a PR for a new lift', () => {
    const S = fresh()
    const before = S.workouts.length
    const r = tool('log_workout').mutate(S, {
      date: '2030-03-04', name: 'Chat session',
      exercises: [{ exercise: lift.id, sets: [{ weight: 500, reps: 5 }, { weight: 500, reps: 4, rpe: 9 }] }],
    })
    expect(S.workouts).toHaveLength(before + 1)
    const w = S.workouts.find(x => x.id === r.logged.id)
    expect(w.d).toBe('2030-03-04')
    expect(w.vol).toBe(500 * 5 + 500 * 4)
    expect(w.entries[0].sets.every(s => s.done)).toBe(true)
    expect(w._ts).toBeGreaterThan(0)
    expect(r.personal_records).toContain(lift.n)
    expect(S.workouts.map(x => x.d)).toEqual([...S.workouts.map(x => x.d)].sort())
  })
  test('refuses an unknown routine and a cardio exercise', () => {
    const cardio = EXDB.find(e => e.bp === 'cardio')
    expect(() => tool('log_workout').mutate(fresh(), { date: '2030-03-04', routine_id: 'nope', exercises: [{ exercise: lift.id, sets: [{ weight: 1, reps: 1 }] }] })).toThrow(/no routine/)
    expect(() => tool('log_workout').mutate(fresh(), { date: '2030-03-04', exercises: [{ exercise: cardio.id, sets: [{ weight: 1, reps: 1 }] }] })).toThrow(/cardio/)
  })
})

describe('save_routine', () => {
  test('creates, then updates keeping an exercise\'s other settings and dropping the rest', () => {
    const S = fresh()
    const made = tool('save_routine').mutate(S, { name: 'From chat', exercises: [{ exercise: lift.id, sets: 3, reps: 8, weight: 40 }] })
    expect(made.created).toBe(true)
    const r = S.routines.find(x => x.id === made.routine.id)
    r.ex[0].prog = 'double'
    const other = EXDB.find(e => e.bp !== 'cardio' && e.id !== lift.id)
    tool('save_routine').mutate(S, { routine_id: r.id, exercises: [{ exercise: lift.id, sets: 4, reps: 6 }, { exercise: other.id, sets: 2, reps: 12 }] })
    expect(r.ex.map(e => e.id)).toEqual([lift.id, other.id])
    expect(r.ex[0]).toMatchObject({ sets: 4, reps: 6, weight: 40, prog: 'double' })
    tool('save_routine').mutate(S, { routine_id: r.id, exercises: [{ exercise: other.id, sets: 2, reps: 12 }] })
    expect(r.ex.map(e => e.id)).toEqual([other.id])
    expect(() => tool('save_routine').mutate(S, { exercises: [] })).toThrow(/name is required/)
  })
})

describe('planning', () => {
  test('weekday plan and one-day override', () => {
    const S = fresh()
    const id = S.routines[0].id
    tool('set_week_plan').mutate(S, { weekday: 'wed', routine_ids: [id] })
    expect(S.week[3]).toEqual([id])
    tool('set_week_plan').mutate(S, { weekday: 'wed', routine_ids: [] })
    expect(S.week[3]).toBeUndefined()
    tool('set_day_override').mutate(S, { date: '2030-05-06', routine_id: 'rest' })
    expect(S.dayPlan['2030-05-06']).toBe('rest')
    tool('set_day_override').mutate(S, { date: '2030-05-06', routine_id: id })
    expect(S.dayPlan['2030-05-06']).toBe(id)
    tool('set_day_override').mutate(S, { date: '2030-05-06', routine_id: null })
    expect(S.dayPlan['2030-05-06']).toBeUndefined()
    expect(() => tool('set_week_plan').mutate(S, { weekday: 'mon', routine_ids: ['nope'] })).toThrow(/no routine/)
  })
})

describe('changeProfile', () => {
  const json = (status, body) => ({ ok: status < 300, status, json: async () => body })
  test('reads, changes a copy and PUTs it with the revision it read', async () => {
    const puts = []
    const f = vi.fn(async (url, init) => {
      if (!init?.method) return json(200, { state: { bodyweight: [] , _wid: 'w1' }, rev: 7 })
      puts.push(JSON.parse(init.body)); return json(200, { ok: true })
    })
    const out = await changeProfile('https://x.test', 'ogm_t', S => { S.bodyweight.push({ d: 'x', w: 1 }); return { done: 1 } }, f)
    expect(out).toEqual({ done: 1, saved: true })
    expect(puts[0]).toMatchObject({ baseRev: 7, baseWid: 'w1', state: { bodyweight: [{ d: 'x', w: 1 }] } })
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer ogm_t')
  })
  test('a 409 redoes the change on the newer document', async () => {
    let n = 0
    const puts = []
    const f = async (url, init) => {
      if (!init?.method) return json(200, { state: { bodyweight: [] }, rev: 1 })
      puts.push(JSON.parse(init.body))
      return n++ === 0 ? json(409, { state: { bodyweight: [{ d: 'phone', w: 5 }] }, rev: 2 }) : json(200, {})
    }
    await changeProfile('https://x.test', 't', S => { S.bodyweight.push({ d: 'chat', w: 1 }); return {} }, f)
    expect(puts[1].baseRev).toBe(2)
    expect(puts[1].state.bodyweight.map(b => b.d)).toEqual(['phone', 'chat'])
  })
  test('gives up after repeated conflicts and surfaces a refused write', async () => {
    const busy = async (u, init) => (init?.method ? json(409, { state: {}, rev: 9 }) : json(200, { state: {}, rev: 1 }))
    await expect(changeProfile('https://x.test', 't', () => ({}), busy)).rejects.toThrow(/kept changing/)
    const refused = async (u, init) => (init?.method ? json(401, {}) : json(200, { state: {}, rev: 1 }))
    await expect(changeProfile('https://x.test', 't', () => ({}), refused)).rejects.toThrow(/could not be saved \(401\)/)
  })
})
