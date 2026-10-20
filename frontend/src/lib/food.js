// The food log: what was eaten each day, the foods you keep to log again, and daily targets.
// Everything is one small object on the profile (S.food), logged by hand — no food database, no
// outside service:
//
//   { targets: { kcal, p, c, f, t } | null,        // daily goals; `t` = when last set
//     mine:    [{ n, kcal, p, c, f, t }],           // your foods, per serving, by name
//     log:     { 'YYYY-MM-DD': [{ id, meal, n, kcal, p, c, f, t }] },   // each entry is what was eaten
//     del:     { <entry id>: <removed at> } }       // so a removal made on one device holds on the other
//
// An entry holds the totals eaten, not a per-100g figure and a weight: "2 eggs, 156 kcal" is
// what gets typed and what gets summed. mergeFood is the one rule for two copies (sync-merge.js
// calls it), because the rest of the profile's merge would otherwise take the newer copy whole
// and drop what the other device logged meanwhile.
import { uid } from './format.js'

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']
const MINE_MAX = 300
const DEL_KEEP_MS = 180 * 86400000

export const emptyFood = () => ({ targets: null, mine: [], log: {}, del: {} })

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
// A non-negative amount to one decimal; anything else (blank, text, negative) is 0.
export const amount = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(Math.min(n, 99999) * 10) / 10 : 0 }
const mealOf = m => (MEALS.includes(m) ? m : 'snack')

// A copy of `food` with every part present and well-formed, whatever was stored.
export function normalizeFood(food) {
  const f = isMap(food) ? food : {}
  return {
    targets: isMap(f.targets) ? f.targets : null,
    mine: Array.isArray(f.mine) ? f.mine.filter(x => x && typeof x.n === 'string') : [],
    log: isMap(f.log) ? f.log : {},
    del: isMap(f.del) ? f.del : {},
  }
}

export const entriesOn = (food, iso) => (Array.isArray(food?.log?.[iso]) ? food.log[iso].filter(e => e && e.id != null) : [])

export function dayTotals(entries) {
  const sum = { kcal: 0, p: 0, c: 0, f: 0, count: 0 }
  for (const e of entries || []) {
    sum.kcal += amount(e.kcal); sum.p += amount(e.p); sum.c += amount(e.c); sum.f += amount(e.f); sum.count++
  }
  for (const k of ['kcal', 'p', 'c', 'f']) sum[k] = Math.round(sum[k] * 10) / 10
  return sum
}

// Adds an entry to `iso`. Mutates `food` (a draft inside store.update) and returns the entry, or
// null when there is no name or nothing to count.
export function addEntry(food, iso, { meal, name, kcal, p, c, f }, now = Date.now(), id = uid()) {
  const n = String(name || '').trim().slice(0, 80)
  const e = { id, meal: mealOf(meal), n, kcal: amount(kcal), p: amount(p), c: amount(c), f: amount(f), t: now }
  if (!n || !(e.kcal || e.p || e.c || e.f)) return null
  if (!isMap(food.log)) food.log = {}
  if (!Array.isArray(food.log[iso])) food.log[iso] = []
  food.log[iso].push(e)
  return e
}

// Changes an entry in place and stamps it, so the merge keeps this version over an older one.
export function editEntry(food, iso, id, change, now = Date.now()) {
  const e = entriesOn(food, iso).find(x => x.id === id)
  if (!e) return null
  if ('name' in change) { const n = String(change.name || '').trim().slice(0, 80); if (n) e.n = n }
  if ('meal' in change) e.meal = mealOf(change.meal)
  for (const k of ['kcal', 'p', 'c', 'f']) if (k in change) e[k] = amount(change[k])
  e.t = now
  return e
}

export function removeEntry(food, iso, id, now = Date.now()) {
  const list = entriesOn(food, iso)
  if (!list.some(e => e.id === id)) return false
  const rest = list.filter(e => e.id !== id)
  if (rest.length) food.log[iso] = rest; else delete food.log[iso]
  if (!isMap(food.del)) food.del = {}
  food.del[id] = now
  return true
}

// Keeps a food for logging again: replaces the one with the same name (case-insensitive).
export function rememberFood(food, { name, kcal, p, c, f }, now = Date.now()) {
  const n = String(name || '').trim().slice(0, 80)
  if (!n) return
  if (!Array.isArray(food.mine)) food.mine = []
  const key = n.toLowerCase()
  const row = { n, kcal: amount(kcal), p: amount(p), c: amount(c), f: amount(f), t: now }
  const i = food.mine.findIndex(x => String(x.n).toLowerCase() === key)
  if (i >= 0) food.mine[i] = row; else food.mine.push(row)
  if (food.mine.length > MINE_MAX) { food.mine.sort((a, b) => (b.t || 0) - (a.t || 0)); food.mine.length = MINE_MAX }
}

// What to offer when adding: your saved foods, then what was logged recently that is not saved,
// newest first, each once by name.
export function suggestions(food, iso, days = 21, limit = 12) {
  const out = new Map()
  const add = x => { const k = String(x.n).toLowerCase(); if (!out.has(k)) out.set(k, { n: x.n, kcal: x.kcal, p: x.p, c: x.c, f: x.f }) }
  ;[...(food?.mine || [])].sort((a, b) => (b.t || 0) - (a.t || 0)).forEach(add)
  const from = new Date(iso + 'T12:00:00'); from.setDate(from.getDate() - days)
  const lo = from.getFullYear() + '-' + String(from.getMonth() + 1).padStart(2, '0') + '-' + String(from.getDate()).padStart(2, '0')
  Object.keys(food?.log || {}).filter(d => d >= lo).sort().reverse()
    .forEach(d => entriesOn(food, d).slice().sort((a, b) => (b.t || 0) - (a.t || 0)).forEach(add))
  return [...out.values()].slice(0, limit)
}

// The last `n` days up to and including `iso`, oldest first: { d, kcal, p, c, f, count }.
export function recentDays(food, iso, n = 7) {
  const out = []
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() - (n - 1))
  for (let i = 0; i < n; i++) {
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    out.push({ d: k, ...dayTotals(entriesOn(food, k)) })
    d.setDate(d.getDate() + 1)
  }
  return out
}

// Two copies of the food section, merged: every entry either has, minus what either removed after
// it was last edited; of an entry both have, the later-edited one; your foods by name the same
// way; the targets last set. Never mutates its arguments.
export function mergeFood(a, b) {
  const x = normalizeFood(a), y = normalizeFood(b)
  const del = {}
  for (const src of [x.del, y.del]) for (const [id, at] of Object.entries(src)) del[id] = Math.max(del[id] || 0, Number(at) || 0)
  const now = Date.now()
  for (const [id, at] of Object.entries(del)) if (now - at > DEL_KEEP_MS) delete del[id]
  const log = {}
  for (const iso of new Set([...Object.keys(x.log), ...Object.keys(y.log)])) {
    const byId = new Map()
    for (const e of [...entriesOn(x, iso), ...entriesOn(y, iso)]) {
      const have = byId.get(e.id)
      if (!have || (e.t || 0) > (have.t || 0)) byId.set(e.id, e)
    }
    const kept = [...byId.values()].filter(e => !(del[e.id] >= (e.t || 0))).map(e => ({ ...e }))
    if (kept.length) log[iso] = kept
  }
  const mine = new Map()
  for (const m of [...x.mine, ...y.mine]) {
    const k = String(m.n).toLowerCase()
    if (!mine.has(k) || (m.t || 0) > (mine.get(k).t || 0)) mine.set(k, m)
  }
  const targets = (Number(y.targets?.t) || 0) > (Number(x.targets?.t) || 0) ? y.targets : (x.targets || y.targets)
  return { targets: targets ? { ...targets } : null, mine: [...mine.values()].map(m => ({ ...m })), log, del }
}

// What a copy that has not seen a reset still contributes after it: only what was written after
// `at` (sync-merge.js sinceReset). The reset wiped the rest.
export function foodSince(food, at) {
  const f = normalizeFood(food)
  const after = v => (Number(v) || 0) > at
  const log = {}
  for (const [iso, list] of Object.entries(f.log)) {
    const kept = (Array.isArray(list) ? list : []).filter(e => e && after(e.t))
    if (kept.length) log[iso] = kept
  }
  return { targets: after(f.targets?.t) ? f.targets : null, mine: f.mine.filter(m => after(m.t)), log, del: {} }
}
