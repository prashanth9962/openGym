import { describe, expect, it } from 'vitest'
import { EXDB } from './exercises-data.js'
import { SUB_MUSCLES, SUB_MUSCLE_NAME, subMusclesOf, hasSubMuscles } from './sub-muscles.js'

const named = n => ({ n })

describe('sub-muscle regions from exercise names', () => {
  it('places the textbook cases', () => {
    expect(subMusclesOf(named('barbell incline bench press'), 'chest')).toEqual(['upper-chest'])
    expect(subMusclesOf(named('barbell decline bench press'), 'chest')).toEqual(['lower-chest'])
    expect(subMusclesOf(named('barbell bench press'), 'chest')).toEqual(['mid-chest'])
    expect(subMusclesOf(named('cable cross-over'), 'chest')).toEqual(['inner-chest'])
    expect(subMusclesOf(named('dumbbell fly'), 'chest')).toEqual(['outer-chest'])
    expect(subMusclesOf(named('lever pec deck fly'), 'chest')).toEqual(['inner-chest'])
    expect(subMusclesOf(named('dumbbell lateral raise'), 'deltoids')).toEqual(['side-delt'])
    expect(subMusclesOf(named('dumbbell front raise'), 'deltoids')).toEqual(['front-delt'])
    expect(subMusclesOf(named('dumbbell front lateral raise'), 'deltoids')).toEqual(['front-delt'])
    expect(subMusclesOf(named('cable rear delt row'), 'deltoids')).toEqual(['rear-delt'])
    expect(subMusclesOf(named('dumbbell hammer curl'), 'biceps')).toEqual(['brachialis'])
    expect(subMusclesOf(named('barbell preacher curl'), 'biceps')).toEqual(['biceps-short'])
    expect(subMusclesOf(named('dumbbell incline curl'), 'biceps')).toEqual(['biceps-long'])
    expect(subMusclesOf(named('cable overhead triceps extension'), 'triceps')).toEqual(['triceps-long'])
    expect(subMusclesOf(named('cable pushdown'), 'triceps')).toEqual(['triceps-lateral', 'triceps-medial'])
  })

  it('says nothing for stretches, unknown muscles and missing exercises', () => {
    expect(subMusclesOf(named('chest stretch'), 'chest')).toEqual([])
    expect(subMusclesOf(named('sit-up'), 'abs')).toEqual([])
    expect(subMusclesOf(null, 'chest')).toEqual([])
    expect(hasSubMuscles('chest')).toBe(true)
    expect(hasSubMuscles('abs')).toBe(false)
  })

  it('names every region and covers most of the catalogue\'s primary exercises', () => {
    for (const regions of Object.values(SUB_MUSCLES)) for (const r of regions) expect(SUB_MUSCLE_NAME[r]).toBeTruthy()
    const tg = { chest: 'pectorals', deltoids: 'delts', biceps: 'biceps', triceps: 'triceps' }
    for (const [parent, target] of Object.entries(tg)) {
      const list = EXDB.filter(e => e.tg === target)
      const placed = list.filter(e => subMusclesOf(e, parent).length).length
      expect(placed / list.length, parent).toBeGreaterThan(0.65)
    }
  })
})
