import { describe, test, expect } from 'vitest'
import { emptyFood, normalizeFood, addEntry, editEntry, removeEntry, dayTotals, entriesOn, rememberFood, suggestions, recentDays, mergeFood, foodSince, amount } from './food.js'

const food = () => emptyFood()

describe('amount', () => {
  test('non-negative, one decimal, junk is 0', () => {
    expect(amount('12.34')).toBe(12.3)
    expect(amount(-5)).toBe(0)
    expect(amount('abc')).toBe(0)
    expect(amount(undefined)).toBe(0)
    expect(amount(1e9)).toBe(99999)
  })
})

describe('entries', () => {
  test('add needs a name and something to count', () => {
    const f = food()
    expect(addEntry(f, '2030-01-01', { name: '  ', kcal: 100 })).toBeNull()
    expect(addEntry(f, '2030-01-01', { name: 'Water' })).toBeNull()
    const e = addEntry(f, '2030-01-01', { name: ' Eggs ', meal: 'breakfast', kcal: '156', p: 12.6 }, 5, 'a')
    expect(e).toMatchObject({ id: 'a', n: 'Eggs', meal: 'breakfast', kcal: 156, p: 12.6, t: 5 })
    expect(addEntry(f, '2030-01-01', { name: 'x', meal: 'bogus', kcal: 1 }).meal).toBe('snack')
  })
  test('totals add up', () => {
    const f = food()
    addEntry(f, 'd', { name: 'a', kcal: 100, p: 10, c: 5, f: 1 })
    addEntry(f, 'd', { name: 'b', kcal: 50.5, p: 0.5, c: 20, f: 0 })
    expect(dayTotals(entriesOn(f, 'd'))).toEqual({ kcal: 150.5, p: 10.5, c: 25, f: 1, count: 2 })
    expect(dayTotals([])).toEqual({ kcal: 0, p: 0, c: 0, f: 0, count: 0 })
  })
  test('edit stamps, remove records the removal and drops an empty day', () => {
    const f = food()
    addEntry(f, 'd', { name: 'a', kcal: 100 }, 1, 'x')
    editEntry(f, 'd', 'x', { kcal: 200, name: 'b' }, 9)
    expect(entriesOn(f, 'd')[0]).toMatchObject({ n: 'b', kcal: 200, t: 9 })
    expect(editEntry(f, 'd', 'nope', {})).toBeNull()
    expect(removeEntry(f, 'd', 'x', 20)).toBe(true)
    expect(f.log.d).toBeUndefined()
    expect(f.del.x).toBe(20)
    expect(removeEntry(f, 'd', 'x')).toBe(false)
  })
})

describe('my foods and suggestions', () => {
  test('a food is kept once per name; suggestions list mine, then recent, each once', () => {
    const f = food()
    rememberFood(f, { name: 'Oats', kcal: 150 }, 1)
    rememberFood(f, { name: 'oats', kcal: 160 }, 2)
    expect(f.mine).toHaveLength(1)
    expect(f.mine[0].kcal).toBe(160)
    addEntry(f, '2030-01-10', { name: 'Rice', kcal: 200 }, 3)
    addEntry(f, '2030-01-10', { name: 'OATS', kcal: 1 }, 4)
    addEntry(f, '2029-01-01', { name: 'Too old', kcal: 1 }, 5)
    expect(suggestions(f, '2030-01-12').map(x => x.n)).toEqual(['oats', 'Rice'])
  })
})

describe('recentDays', () => {
  test('oldest first, empty days are zero', () => {
    const f = food()
    addEntry(f, '2030-03-01', { name: 'a', kcal: 100 })
    const days = recentDays(f, '2030-03-02', 3)
    expect(days.map(d => d.d)).toEqual(['2030-02-28', '2030-03-01', '2030-03-02'])
    expect(days.map(d => d.kcal)).toEqual([0, 100, 0])
  })
})

describe('mergeFood', () => {
  const a = () => { const f = food(); addEntry(f, 'd', { name: 'phone', kcal: 1 }, 10, 'p'); return f }
  const b = () => { const f = food(); addEntry(f, 'd', { name: 'laptop', kcal: 2 }, 11, 'l'); return f }
  test('keeps what each device logged', () => {
    expect(entriesOn(mergeFood(a(), b()), 'd').map(e => e.id).sort()).toEqual(['l', 'p'])
  })
  test('of an entry both have, the later edit wins', () => {
    const x = a(), y = a()
    editEntry(y, 'd', 'p', { kcal: 99 }, 50)
    expect(entriesOn(mergeFood(x, y), 'd')[0].kcal).toBe(99)
    expect(entriesOn(mergeFood(y, x), 'd')[0].kcal).toBe(99)
  })
  test('a removal holds against the copy that still has the entry, but not against a later edit', () => {
    const t0 = Date.now() - 10000
    const mk = () => { const f = food(); addEntry(f, 'd', { name: 'phone', kcal: 1 }, t0, 'p'); return f }
    const gone = mk(); removeEntry(gone, 'd', 'p', t0 + 30)
    expect(entriesOn(mergeFood(gone, mk()), 'd')).toEqual([])
    expect(entriesOn(mergeFood(mk(), gone), 'd')).toEqual([])
    const edited = mk(); editEntry(edited, 'd', 'p', { kcal: 5 }, t0 + 40)
    expect(entriesOn(mergeFood(gone, edited), 'd')).toHaveLength(1)
  })
  test('old removal records are dropped', () => {
    const f = food(); f.del = { old: 1, fresh: Date.now() }
    expect(Object.keys(mergeFood(f, null).del)).toEqual(['fresh'])
  })
  test('targets: the last set; foods by name: the later', () => {
    const x = food(), y = food()
    x.targets = { kcal: 2000, t: 1 }; y.targets = { kcal: 2400, t: 2 }
    rememberFood(x, { name: 'Oats', kcal: 1 }, 5); rememberFood(y, { name: 'oats', kcal: 2 }, 6)
    const m = mergeFood(x, y)
    expect(m.targets.kcal).toBe(2400)
    expect(m.mine).toHaveLength(1)
    expect(m.mine[0].kcal).toBe(2)
  })
  test('tolerates missing or malformed sections and does not mutate', () => {
    const x = a(); const snap = JSON.stringify(x)
    expect(entriesOn(mergeFood(x, undefined), 'd')).toHaveLength(1)
    expect(mergeFood(null, 'junk')).toEqual(emptyFood())
    mergeFood(x, b())
    expect(JSON.stringify(x)).toBe(snap)
    expect(normalizeFood({ log: [], mine: 5 })).toEqual(emptyFood())
  })
})

describe('foodSince', () => {
  test('keeps only what was written after the reset', () => {
    const f = food()
    addEntry(f, 'd', { name: 'old', kcal: 1 }, 10, 'o')
    addEntry(f, 'd', { name: 'new', kcal: 1 }, 100, 'n')
    rememberFood(f, { name: 'Old food', kcal: 1 }, 5)
    f.targets = { kcal: 2000, t: 5 }
    f.del = { z: 1 }
    const r = foodSince(f, 50)
    expect(entriesOn(r, 'd').map(e => e.id)).toEqual(['n'])
    expect(r.mine).toEqual([])
    expect(r.targets).toBeNull()
    expect(r.del).toEqual({})
  })
})

describe('food in the profile merge', () => {
  test('two devices each log a meal and both survive; a reset elsewhere drops what it wiped', async () => {
    const { mergeStates } = await import('./sync-merge.js')
    const t0 = Date.now() - 100000
    const phone = { unit: 'kg', _ts: t0 + 10, workouts: [], routines: [], food: emptyFood() }
    const laptop = { unit: 'kg', _ts: t0 + 20, workouts: [], routines: [], food: emptyFood() }
    addEntry(phone.food, '2030-01-01', { name: 'phone meal', kcal: 100 }, t0 + 5, 'p')
    addEntry(laptop.food, '2030-01-01', { name: 'laptop meal', kcal: 200 }, t0 + 6, 'l')
    const merged = mergeStates(laptop, phone)
    expect(entriesOn(merged.food, '2030-01-01').map(e => e.id).sort()).toEqual(['l', 'p'])
    expect(mergeStates(phone, laptop).food.log['2030-01-01']).toHaveLength(2)

    // laptop reset after the phone's entry was made; the phone has not seen it
    const reset = { unit: 'kg', _ts: t0 + 50, resetAt: t0 + 40, workouts: [], routines: [], food: emptyFood() }
    addEntry(reset.food, '2030-01-02', { name: 'after reset', kcal: 5 }, t0 + 60, 'a')
    const both = mergeStates(reset, phone)
    expect(Object.values(both.food.log).flat().map(e => e.id)).toEqual(['a'])
  })
})
