// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import AnatomyMap from './AnatomyMap.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container, root
beforeAll(() => import('../lib/body-anatomy.js'))
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

async function renderMap(props = {}) {
  await act(async () => { root.render(<AnatomyMap {...props} />) })
  await vi.waitFor(() => expect(container.querySelectorAll('.am-v')).toHaveLength(2))
}
const sel = () => [...container.querySelectorAll('.am-sel')]
const lit = slug => sel().filter(p => p.dataset.muscle === slug)

describe('AnatomyMap', () => {
  it('draws a front and a back with the muscle shapes tagged by app muscle', async () => {
    await renderMap()
    const muscles = new Set([...container.querySelectorAll('[data-muscle]')].map(p => p.dataset.muscle))
    for (const m of ['chest', 'deltoids', 'biceps', 'triceps', 'quadriceps', 'hamstring', 'gluteal', 'calves', 'trapezius']) expect(muscles.has(m), m).toBe(true)
  })

  it('lights every shape of a picked muscle', async () => {
    await renderMap({ selected: 'biceps' })
    expect(lit('biceps').length).toBeGreaterThanOrEqual(4)   // long and short head, left and right
  })

  it('lights one head of the biceps and dims the other', async () => {
    await renderMap({ selected: 'biceps', region: 'biceps-short' })
    expect(lit('biceps')).toHaveLength(2)
    expect(container.querySelectorAll('.am-in').length).toBe(2)
  })

  it('lights the rear delts on the back view only', async () => {
    await renderMap({ selected: 'deltoids', region: 'rear-delt' })
    const [front, back] = container.querySelectorAll('.am-v')
    expect(front.querySelectorAll('.am-sel')).toHaveLength(0)
    expect(back.querySelectorAll('.am-sel')).toHaveLength(2)
  })

  it('cuts a chest region out of the pec: the pec is dimmed and a clipped copy is lit', async () => {
    await renderMap({ selected: 'chest', region: 'inner-chest' })
    expect(container.querySelectorAll('.am-in')).toHaveLength(2)
    expect(container.querySelectorAll('path[clip-path]')).toHaveLength(2)
    expect(container.querySelectorAll('clipPath polygon')).toHaveLength(2)
  })

  it('lights the whole muscle for a region that has no shape (brachialis)', async () => {
    await renderMap({ selected: 'biceps', region: 'brachialis' })
    expect(lit('biceps').length).toBeGreaterThanOrEqual(4)
  })

  it('reports a click on a shape as that muscle', async () => {
    const onMuscle = vi.fn()
    await renderMap({ onMuscle })
    act(() => { container.querySelector('[data-muscle="chest"]').dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onMuscle).toHaveBeenCalledWith('chest')
  })

  it('shades by load like the other maps', async () => {
    await renderMap({ load: { chest: 10, biceps: 1 } })
    expect(container.querySelector('[data-muscle="chest"]').getAttribute('class')).toMatch(/\bl4\b/)
  })
})
