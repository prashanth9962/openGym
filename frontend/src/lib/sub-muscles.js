// Finer regions inside the muscles the body map draws as one piece: which part of the chest,
// which head of the shoulder, biceps or triceps an exercise leans on.
//
// The exercise dataset only knows whole muscles ("pectorals", "delts", "biceps"), so the region
// is read from the exercise name — incline, lateral raise, preacher, overhead — which is how
// lifters talk about it too. It is a rule of thumb, not anatomy data: an exercise that says
// nothing specific gets the region(s) it conventionally hits (a flat press is mid chest), and
// one the rules can't place gets none, so it only ever appears under the whole muscle.
// The By-muscle map lights the region you pick (components/AnatomyMap.jsx); the other screens
// still work with whole muscles.

// parent muscle (a key of MUSCLES in muscles.js) -> its regions, in display order
export const SUB_MUSCLES = {
  chest: ['upper-chest', 'mid-chest', 'lower-chest', 'inner-chest', 'outer-chest'],
  deltoids: ['front-delt', 'side-delt', 'rear-delt'],
  biceps: ['biceps-long', 'biceps-short', 'brachialis'],
  triceps: ['triceps-long', 'triceps-lateral', 'triceps-medial'],
}

// English display names; these strings are the i18n keys, like MUSCLE_NAME in muscles.js.
export const SUB_MUSCLE_NAME = {
  'upper-chest': 'Upper chest', 'mid-chest': 'Mid chest', 'lower-chest': 'Lower chest',
  'inner-chest': 'Inner chest', 'outer-chest': 'Outer chest',
  'front-delt': 'Front delts', 'side-delt': 'Side delts', 'rear-delt': 'Rear delts',
  'biceps-long': 'Long head (outer)', 'biceps-short': 'Short head (inner)', brachialis: 'Brachialis',
  'triceps-long': 'Long head', 'triceps-lateral': 'Lateral head', 'triceps-medial': 'Medial head',
}

const has = (name, re) => re.test(name)

const RULES = {
  chest: name => {
    if (has(name, /stretch/)) return []
    const out = new Set()
    if (has(name, /incline|upper chest|low[- ]to[- ]high|reverse[- ]grip (incline|bench)/)) out.add('upper-chest')
    if (has(name, /decline|dips?\b|lower chest|high[- ]to[- ]low|pullover/)) out.add('lower-chest')
    if (has(name, /cross[- ]?over|pec deck|squeeze|svend|hex|close[- ]grip|butterfly|machine fly|cable (standing |seated )?fly|middle fly/)) out.add('inner-chest')
    if (has(name, /wide|dumbbell (incline |decline )?fly|flye|lying fly|stretch fly|band fly/)) out.add('outer-chest')
    if (!out.size && has(name, /press|push[- ]?up|bench|fly/)) out.add('mid-chest')
    return [...out]
  },
  deltoids: name => {
    if (has(name, /stretch/)) return []
    if (has(name, /rear|rever[sc]e? fly|reverse flye|revers fly|face pull|bent[- ]over (lateral|raise|fly)|reverse pec deck/)) return ['rear-delt']
    if (has(name, /arnold/)) return ['front-delt', 'side-delt']
    if (has(name, /front (lateral )?raise|forward raise|front shoulder raise/)) return ['front-delt']
    if (has(name, /lateral|side raise|upright row|leaning/)) return ['side-delt']
    if (has(name, /front raise|overhead|shoulder press|military|push press|handstand|bench press|incline|push[- ]?up|dips?\b/)) return ['front-delt']
    return []
  },
  biceps: name => {
    if (has(name, /stretch/)) return []
    if (has(name, /hammer|reverse|zottman|cross[- ]?body|brachialis|rope/)) return ['brachialis']
    if (has(name, /preacher|concentration|spider|close[- ]grip|scott|drag/)) return ['biceps-short']
    if (has(name, /incline|bayesian|behind|wide[- ]grip|standing/)) return ['biceps-long']
    if (has(name, /curl|chin[- ]?up|pull[- ]?up|row/)) return ['biceps-long', 'biceps-short']
    return []
  },
  triceps: name => {
    if (has(name, /stretch/)) return []
    if (has(name, /overhead|skull|french|behind (the )?head|lying (triceps )?extension|pullover|incline/)) return ['triceps-long']
    if (has(name, /reverse[- ]grip|underhand/)) return ['triceps-medial']
    if (has(name, /pushdown|pressdown|push[- ]down|kickback|dips?\b|close[- ]grip|diamond|bench press/)) return ['triceps-lateral', 'triceps-medial']
    if (has(name, /extension|press|push[- ]?up/)) return ['triceps-lateral', 'triceps-long']
    return []
  },
}

// The regions of `parent` an exercise leans on, in display order; empty when the exercise does
// not train `parent` at all or the name doesn't say. Pass only exercises that train the parent
// (callers already hold `musclesOf(e)[parent]`).
export const subMusclesOf = (ex, parent) => {
  const rule = RULES[parent]
  if (!rule || !ex) return []
  const hit = rule(String(ex.n || '').toLowerCase())
  return SUB_MUSCLES[parent].filter(s => hit.includes(s))
}

export const hasSubMuscles = parent => Object.hasOwn(SUB_MUSCLES, parent)

// What the detailed map lights for a region. Deltoid, biceps and triceps regions are real shapes in
// the artwork (matched by id prefix); the chest regions are cuts over the pec (key into
// body-anatomy.js `chest.<side>.regions`). A region in neither (brachialis, not drawn) lights the
// whole muscle.
export const REGION_SHAPES = {
  'front-delt': ['anterior_deltoid'], 'side-delt': ['lateral_deltoid'], 'rear-delt': ['posterior_deltoid'],
  'biceps-long': ['biceps_brachii_caput_longum'], 'biceps-short': ['biceps_brachii_caput_breve'],
  'triceps-long': ['triceps_brachii_caput_longum'], 'triceps-lateral': ['triceps_brachii_caput_laterale'], 'triceps-medial': ['triceps_brachii_caput_mediale'],
}
export const REGION_CUT = {
  'upper-chest': 'upper', 'mid-chest': 'mid', 'lower-chest': 'lower', 'inner-chest': 'inner', 'outer-chest': 'outer',
}
