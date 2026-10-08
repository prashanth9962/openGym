// @vitest-environment happy-dom
// Issue #71 (the same rule Library and the exercise picker already keep): choosing a body part
// after picking an equipment type must not reset the equipment filter back to "any equipment"
// when the new body part still has exercises under it. MuscleExplorer used to clear it on every
// body-part tap regardless — the only one of the three exercise browsers that did.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import MuscleExplorer from './MuscleExplorer.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null }
  state.snapshot = () => ({ S: state.S, user: null, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})

const mounted = []
function render(props = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<MuscleExplorer {...props} />))
  return host
}
const chipByText = (host, text) =>
  [...host.querySelectorAll('.chips .chip')].find(b => b.textContent.trim() === text)
const muscleChip = (host, label) =>
  [...host.querySelectorAll('.chips .chip')].find(b => b.textContent.startsWith(label))
const isOn = el => el.className.split(/\s+/).includes('on')

beforeEach(() => {
  mocks.S = {
    unit: 'kg', lang: 'en', body: 'male', routines: [], workouts: [], customEx: [], exWeights: {},
    equipProfiles: [], activeEquipId: null, equipFilterOn: false, favEx: [],
  }
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

describe('MuscleExplorer body-part chips keep the equipment filter', () => {
  // Biceps has dumbbell exercises under both "lower arms" and "upper arms" in the catalog, the
  // same shape as issue #71's original repro (lower arms/upper arms + dumbbell).
  it('keeps the dumbbell filter when switching from lower arms to upper arms', () => {
    const host = render()
    act(() => { muscleChip(host, 'Biceps').click() })
    act(() => { chipByText(host, 'Include secondary').click() })

    act(() => { chipByText(host, 'lower arms').click() })
    const dumbbell = chipByText(host, 'dumbbell')
    expect(dumbbell, 'dumbbell chip should be offered under lower arms').toBeTruthy()
    act(() => { dumbbell.click() })
    expect(isOn(chipByText(host, 'dumbbell'))).toBe(true)

    act(() => { chipByText(host, 'upper arms').click() })
    expect(isOn(chipByText(host, 'upper arms'))).toBe(true)
    const dumbbellAfter = chipByText(host, 'dumbbell')
    expect(dumbbellAfter, 'dumbbell chip should still be present under upper arms').toBeTruthy()
    expect(isOn(dumbbellAfter)).toBe(true)
    expect(isOn(chipByText(host, 'Any equipment'))).toBe(false)
  })

  // "All" body parts is the one chip that does clear the equipment filter — it spans every
  // body part, so there is no "still valid here" question to answer.
  it('"All" body parts still clears the equipment filter', () => {
    const host = render()
    act(() => { muscleChip(host, 'Biceps').click() })
    act(() => { chipByText(host, 'Include secondary').click() })
    act(() => { chipByText(host, 'lower arms').click() })
    act(() => { chipByText(host, 'dumbbell').click() })
    expect(isOn(chipByText(host, 'dumbbell'))).toBe(true)

    act(() => { chipByText(host, 'All').click() })
    expect(isOn(chipByText(host, 'Any equipment'))).toBe(true)
  })
})

describe('MuscleExplorer search: the × and live count the Library has (#338)', () => {
  function type(el, value) {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  it('shows a count while narrowed and a × that empties only the text', () => {
    const host = render()
    act(() => { muscleChip(host, 'Biceps').click() })
    const input = host.querySelector('.search input')
    const count = () => host.querySelector('.search .search-count')
    const clear = () => host.querySelector('.search .clear')
    const rows = () => host.querySelectorAll('.list .item').length
    expect(count()).toBeNull()
    expect(clear()).toBeNull()
    act(() => type(input, 'curl'))
    expect(clear().getAttribute('aria-label')).toBe('Clear')
    expect(Number(count().textContent)).toBeGreaterThan(0)
    expect(rows()).toBe(Math.min(40, Number(count().textContent)))
    act(() => clear().click())
    expect(input.value).toBe('')
    expect(clear()).toBeNull()
    expect(count()).toBeNull()
    act(() => { chipByText(host, 'upper arms').click() })
    expect(count()).toBeTruthy()
    expect(clear()).toBeNull()
  })
})

describe('MuscleExplorer primary vs secondary muscles', () => {
  const rows = host => [...host.querySelectorAll('.list .item .ss')].map(n => n.textContent)

  it('lists only exercises that target the muscle until "Include secondary" is chosen', () => {
    const host = render()
    act(() => { muscleChip(host, 'Biceps').click() })
    expect(isOn(chipByText(host, 'Primary only'))).toBe(true)
    expect(rows(host).length).toBeGreaterThan(0)
    expect(rows(host).every(r => r.startsWith('Primary target'))).toBe(true)

    const primaryCount = Number(muscleChip(host, 'Biceps').textContent.replace(/\D/g, ''))
    act(() => { chipByText(host, 'Include secondary').click() })
    expect(Number(muscleChip(host, 'Biceps').textContent.replace(/\D/g, ''))).toBeGreaterThan(primaryCount)
    // primaries are listed first
    const all = rows(host)
    expect(all[0].startsWith('Primary target')).toBe(true)
  })
})

describe('MuscleExplorer regions of a muscle', () => {
  const names = host => [...host.querySelectorAll('.list .item .tt')].map(n => n.textContent.toLowerCase())

  it('narrows chest to upper, mid or lower chest, and the whole muscle brings everything back', () => {
    const host = render()
    act(() => { muscleChip(host, 'Chest').click() })
    const all = names(host).length
    act(() => { muscleChip(host, 'Upper chest').click() })
    const upper = names(host)
    expect(upper.length).toBeGreaterThan(0)
    expect(upper.every(n => /incline|upper|low to high|reverse/.test(n))).toBe(true)
    act(() => { muscleChip(host, 'Lower chest').click() })
    expect(names(host).every(n => /decline|dip|lower|high to low|pullover/.test(n))).toBe(true)
    act(() => { chipByText(host, 'Whole muscle').click() })
    expect(names(host).length).toBe(all)
  })

  it('offers regions for biceps, triceps and shoulders but not for abs', () => {
    const host = render()
    for (const [muscle, region] of [['Biceps', 'Brachialis'], ['Triceps', 'Long head'], ['Shoulders', 'Rear delts']]) {
      act(() => { muscleChip(host, muscle).click() })
      expect(chipByText(host, 'Whole muscle'), muscle).toBeTruthy()
      expect([...host.querySelectorAll('.chips .chip')].some(b => b.textContent.startsWith(region)), region).toBe(true)
      act(() => { muscleChip(host, muscle).click() })
    }
    act(() => { muscleChip(host, 'Abs').click() })
    expect(chipByText(host, 'Whole muscle')).toBeFalsy()
  })
})
