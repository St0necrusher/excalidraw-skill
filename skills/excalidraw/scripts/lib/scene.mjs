import { randomInt, randomUUID } from 'node:crypto'
import { layoutProblems } from './layout.mjs'

export class Fail extends Error {
  constructor(message, exitCode = 2) {
    super(message)
    this.exitCode = exitCode
  }
}

const SHAPES = ['rectangle', 'ellipse', 'diamond']
const GAP = 6
// How far a second arrow between the same two shapes bows out.
const BOW = 90
// Average Excalifont glyph width. The editor measures exactly when text is next edited.
const GLYPH = 0.58

const number = v => Number.isFinite(v)
const string = v => typeof v === 'string'
const positive = v => number(v) && v > 0
const path = v => Array.isArray(v) && v.every(p => Array.isArray(p) && p.length === 2 && p.every(number))
const oneOf = (...values) => v => values.includes(v)

const STYLE = {
  backgroundColor: string,
  strokeColor: string,
  fillStyle: oneOf('solid', 'hachure', 'cross-hatch', 'zigzag'),
  strokeStyle: oneOf('solid', 'dashed', 'dotted'),
  strokeWidth: positive,
  roughness: oneOf(0, 1, 2),
  opacity: v => number(v) && v >= 0 && v <= 100,
  rounded: v => typeof v === 'boolean',
  fontSize: positive,
}
// [required fields, optional fields]
const OPS = {
  add: [{ type: oneOf(...SHAPES, 'text'), x: number, y: number }, { as: string, text: string, width: positive, height: positive, ...STYLE }],
  connect: [{ from: string, to: string }, { as: string, text: string, via: path, ...STYLE }],
  route: [{ id: string, via: path }, {}],
  text: [{ id: string, text: string }, {}],
  move: [{ id: string, x: number, y: number }, {}],
  style: [{ id: string }, STYLE],
  delete: [{ id: string }, {}],
  relink: [{}, {}],
}

function validate(ops) {
  if (!Array.isArray(ops)) throw new Fail('expected a JSON array of operations on stdin')
  ops.forEach((op, i) => {
    if (!Object.hasOwn(OPS, op?.op ?? '')) throw new Fail(`op ${i}: unknown op ${JSON.stringify(op?.op)}; see --help`)
    const [required, optional] = OPS[op.op]
    for (const key of Object.keys(required)) {
      if (!(key in op)) throw new Fail(`op ${i} (${op.op}): missing "${key}"`)
    }
    const rules = { ...required, ...optional }
    for (const [key, value] of Object.entries(op)) {
      if (key === 'op') continue
      if (!Object.hasOwn(rules, key)) throw new Fail(`op ${i} (${op.op}): unknown field "${key}"`)
      if (!rules[key](value)) throw new Fail(`op ${i} (${op.op}): bad ${key}: ${JSON.stringify(value)}`)
    }
  })
}

const live = scene => scene.elements.filter(e => !e.isDeleted)
const center = e => [e.x + e.width / 2, e.y + e.height / 2]
const endsOf = e => [e.startBinding?.elementId, e.endBinding?.elementId].filter(Boolean)
const hostsOf = e => [e.containerId, ...endsOf(e)].filter(Boolean)

function edgePoint(shape, [tx, ty]) {
  const [cx, cy] = center(shape), dx = tx - cx, dy = ty - cy
  const a = Math.abs(dx) / Math.max(shape.width / 2, 1), b = Math.abs(dy) / Math.max(shape.height / 2, 1)
  const r = (shape.type === 'diamond' ? a + b : shape.type === 'ellipse' ? Math.hypot(a, b) : Math.max(a, b)) || 1
  const gap = GAP / (Math.hypot(dx, dy) || 1)
  return [cx + dx * (1 / r + gap), cy + dy * (1 / r + gap)]
}

export function applyOps(scene, ops) {
  validate(ops)
  const els = scene.elements
  const ids = {}, warnings = new Set(), resized = new Set()
  const existing = new Set(els.map(e => e.id))

  const touch = (e, props = {}) =>
    Object.assign(e, props, { version: (e.version ?? 0) + 1, versionNonce: randomInt(1, 2 ** 31 - 1), updated: Date.now() })

  function get(ref) {
    const id = Object.hasOwn(ids, ref) ? ids[ref] : ref
    const e = els.find(x => x.id === id && !x.isDeleted)
    if (!e) throw new Fail(`no element "${ref}"; run read.mjs for current ids`)
    return e
  }
  function editable(ref) {
    const e = get(ref)
    if (e.locked) throw new Fail(`${e.id} is locked by the user; ask them to unlock it`)
    return e
  }
  const labelOf = host => els.find(t => !t.isDeleted && t.type === 'text' && t.containerId === host.id)

  function create(type, props) {
    const e = {
      id: `${type}-${randomUUID().slice(0, 8)}`, type, x: 0, y: 0, width: 0, height: 0, angle: 0,
      strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid',
      roughness: 1, opacity: 100, groupIds: [], frameId: null, index: null, roundness: null,
      seed: randomInt(1, 2 ** 31 - 1), version: 1, versionNonce: randomInt(1, 2 ** 31 - 1), isDeleted: false,
      boundElements: [], updated: Date.now(), link: null, locked: false, ...props,
    }
    els.push(e)
    return e
  }
  function createText(props) {
    return create('text', {
      text: '', originalText: '', fontSize: 20, fontFamily: 5, lineHeight: 1.25,
      textAlign: 'left', verticalAlign: 'top', containerId: null, autoResize: true, ...props,
    })
  }
  function bind(host, child) {
    if (host.boundElements?.some(b => b.id === child.id)) return
    touch(host, { boundElements: [...(host.boundElements ?? []), { id: child.id, type: child.type }] })
  }

  function placeLabel(host) {
    const t = labelOf(host)
    if (!t) return
    let [cx, cy] = center(host)
    if (host.type === 'arrow') {
      const p = host.points, l = p[Math.floor((p.length - 1) / 2)], r = p[Math.ceil((p.length - 1) / 2)]
      cx = host.x + (l[0] + r[0]) / 2
      cy = host.y + (l[1] + r[1]) / 2
    }
    touch(t, { x: cx - t.width / 2, y: cy - t.height / 2 })
  }

  // Slides the ends along their shapes and leaves the bends where the user put them.
  function route(arrow) {
    const abs = arrow.points.map(([x, y]) => [arrow.x + x, arrow.y + y]), bends = abs.slice(1, -1)
    const from = arrow.startBinding && els.find(e => e.id === arrow.startBinding.elementId && !e.isDeleted)
    const to = arrow.endBinding && els.find(e => e.id === arrow.endBinding.elementId && !e.isDeleted)
    const p = from ? edgePoint(from, bends[0] ?? (to ? center(to) : abs.at(-1))) : abs[0]
    const q = to ? edgePoint(to, bends.at(-1) ?? (from ? center(from) : p)) : abs.at(-1)
    const points = [p, ...bends, q].map(([x, y]) => [x - p[0], y - p[1]])
    const span = i => Math.max(...points.map(v => v[i])) - Math.min(...points.map(v => v[i]))
    touch(arrow, { x: p[0], y: p[1], width: span(0), height: span(1), points })
    placeLabel(arrow)
    if (arrow.elbowed) warnings.add(`${arrow.id}: elbow arrow rerouted, check its right angles in the image`)
  }
  function reroute(shape) {
    for (const a of live(scene)) if (a.type === 'arrow' && endsOf(a).includes(shape.id)) route(a)
  }
  function move(e, x, y) {
    touch(e, { x, y })
    placeLabel(e)
    reroute(e)
  }

  function bend(arrow, via) {
    const p = [arrow.x + arrow.points[0][0], arrow.y + arrow.points[0][1]]
    const q = [arrow.x + arrow.points.at(-1)[0], arrow.y + arrow.points.at(-1)[1]]
    touch(arrow, {
      x: p[0], y: p[1], elbowed: false, roundness: via.length ? { type: 2 } : null,
      points: [p, ...via, q].map(([x, y]) => [x - p[0], y - p[1]]),
    })
    route(arrow)
  }
  // A second arrow between two shapes bows out instead of hiding the first.
  function bow(from, to) {
    const n = live(scene).filter(a => a.type === 'arrow' && endsOf(a).includes(from.id) && endsOf(a).includes(to.id)).length
    if (!n) return []
    const [fx, fy] = center(from), [tx, ty] = center(to), d = Math.hypot(tx - fx, ty - fy) || 1
    return [[(fx + tx) / 2 + ((ty - fy) / d) * BOW * n, (fy + ty) / 2 - ((tx - fx) / d) * BOW * n]]
  }

  function remove(e) {
    const gone = new Set([e.id, labelOf(e)?.id].filter(Boolean))
    for (const x of els) {
      if (x.isDeleted) continue
      if (gone.has(x.id)) {
        touch(x, { isDeleted: true })
        continue
      }
      if (x.boundElements?.some(b => gone.has(b.id))) touch(x, { boundElements: x.boundElements.filter(b => !gone.has(b.id)) })
      if (gone.has(x.frameId)) touch(x, { frameId: null })
      for (const key of ['startBinding', 'endBinding']) if (gone.has(x[key]?.elementId)) touch(x, { [key]: null })
    }
  }

  function measure(t, text) {
    const lines = text.split('\n')
    return {
      width: Math.max(...lines.map(l => [...l].length)) * t.fontSize * GLYPH,
      height: lines.length * t.fontSize * (t.lineHeight ?? 1.25),
    }
  }
  function setText(target, text) {
    const host = target.containerId ? get(target.containerId) : target
    if (host.type === 'text') {
      if (!text) throw new Fail(`${host.id}: free text cannot be empty; delete it instead`)
      touch(host, { text, originalText: text, ...measure(host, text) })
      return reroute(host)
    }
    if (![...SHAPES, 'arrow'].includes(host.type)) throw new Fail(`${host.id}: a ${host.type} has no label`)
    let t = labelOf(host)
    if (!text) return t && remove(t)
    if (!t) {
      t = createText({ containerId: host.id, textAlign: 'center', verticalAlign: 'middle' })
      bind(host, t)
    }
    const size = measure(t, text)
    touch(t, { text, originalText: text, ...size })
    if (host.type !== 'arrow') {
      const k = host.type === 'rectangle' ? 1 : host.type === 'diamond' ? 2 : 1.42
      const width = Math.max(host.width, size.width * k + 24), height = Math.max(host.height, size.height * k + 20)
      if (width > host.width || height > host.height) {
        const x = host.x - (width - host.width) / 2, y = host.y - (height - host.height) / 2
        if (existing.has(host.id)) resized.add(`${host.id} grew to fit its text around its centre, so its corner moved`)
        touch(host, { width, height })
        return move(host, x, y)
      }
    }
    placeLabel(host)
  }

  function style(e, op) {
    const props = {}
    for (const key of Object.keys(STYLE)) {
      if (!(key in op) || key === 'rounded' || key === 'fontSize') continue
      props[key] = op[key]
    }
    if ('rounded' in op) props.roundness = op.rounded ? { type: e.type === 'rectangle' ? 3 : 2 } : null
    if (Object.keys(props).length) touch(e, props)
    if ('fontSize' in op) {
      const t = e.type === 'text' ? e : labelOf(e)
      if (!t) throw new Fail(`${e.id}: no text to set fontSize on`)
      touch(t, { fontSize: op.fontSize })
      setText(e, t.originalText ?? t.text)
    }
  }

  function remember(name, e) {
    if (!name) return
    if (Object.hasOwn(ids, name) || els.some(x => x.id === name)) throw new Fail(`name "${name}" is already taken`)
    Object.defineProperty(ids, name, { value: e.id, enumerable: true })
  }

  const run = {
    add(op) {
      let e
      if (op.type === 'text') {
        if (!op.text) throw new Fail('add text: "text" must not be empty')
        e = createText({ x: op.x, y: op.y })
        setText(e, op.text)
      } else {
        e = create(op.type, { x: op.x, y: op.y, width: op.width ?? 180, height: op.height ?? 80 })
        if (op.text) setText(e, op.text)
      }
      style(e, op)
      move(e, op.x, op.y)
      remember(op.as, e)
    },
    connect(op) {
      const from = get(op.from), to = get(op.to)
      if (from === to) throw new Fail('connect: from and to are the same element')
      for (const e of [from, to]) {
        if (e.type === 'arrow' || e.containerId) throw new Fail(`${e.id}: connect shapes, not arrows or their labels`)
      }
      const via = op.via ?? bow(from, to)
      const a = create('arrow', {
        points: [[0, 0], [0, 0]], elbowed: false, startArrowhead: null, endArrowhead: 'arrow',
        startBinding: { elementId: from.id, focus: 0, gap: GAP }, endBinding: { elementId: to.id, focus: 0, gap: GAP },
      })
      bind(from, a)
      bind(to, a)
      route(a)
      if (via.length) bend(a, via)
      if (op.text) setText(a, op.text)
      style(a, op)
      remember(op.as, a)
    },
    text: op => setText(editable(op.id), op.text),
    move(op) {
      const e = editable(op.id)
      if (e.type === 'arrow' || e.containerId) throw new Fail(`${e.id}: move the shape; arrows and labels follow it`)
      move(e, op.x, op.y)
    },
    route(op) {
      const e = editable(op.id)
      if (e.type !== 'arrow') throw new Fail(`${e.id}: route takes an arrow`)
      bend(e, op.via)
    },
    style: op => style(editable(op.id), op),
    delete: op => remove(editable(op.id)),
    relink() {
      for (const child of live(scene)) {
        for (const id of hostsOf(child)) {
          const host = els.find(e => e.id === id && !e.isDeleted)
          if (host) bind(host, child)
        }
      }
    },
  }

  const versions = new Map(els.map(e => [e.id, e.version]))
  for (const op of ops) run[op.op](op)
  const changed = new Set(els.filter(e => !versions.has(e.id) || versions.get(e.id) !== e.version).map(e => e.id))
  return { ids, resized: [...resized], warnings: [...warnings, ...layoutProblems(scene, changed)] }
}

export function brokenLinks(scene) {
  const all = live(scene), byId = new Map(all.map(e => [e.id, e])), broken = []
  for (const e of all) {
    for (const id of hostsOf(e)) {
      if (!byId.has(id)) broken.push(`${e.id} points at missing ${id}`)
      else if (!byId.get(id).boundElements?.some(b => b.id === e.id)) broken.push(`${id} does not list ${e.id} (fix: relink)`)
    }
  }
  return broken
}

// What must still be true once the editor has had time to merge and save.
// Derived geometry is left out: the editor recomputes it.
function facts(e) {
  if (!e || e.isDeleted) return { exists: false }
  const out = { exists: true }
  for (const key of ['backgroundColor', 'strokeColor', 'fillStyle', 'strokeStyle', 'strokeWidth', 'roughness', 'opacity', 'fontSize']) out[key] = e[key]
  out.rounded = !!e.roundness
  if (e.type === 'text') out.text = e.originalText ?? e.text
  else if (e.type !== 'arrow') Object.assign(out, { x: e.x, y: e.y })
  out.from = e.startBinding?.elementId
  out.to = e.endBinding?.elementId
  return out
}
const same = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1 : a === b

export function expectations(before, after) {
  const was = new Map(before.elements.map(e => [e.id, e])), expected = []
  for (const e of after.elements) {
    const old = was.get(e.id), prior = facts(old), next = facts(e)
    for (const [key, value] of Object.entries(next)) {
      if (!same(prior[key], value)) expected.push({ id: e.id, key, value })
    }
    if (e.isDeleted) continue
    for (const b of e.boundElements ?? []) {
      if (!old?.boundElements?.some(x => x.id === b.id)) expected.push({ id: e.id, key: 'link', value: b.id })
    }
  }
  return expected
}

export function unmet(scene, expected) {
  const byId = new Map(scene.elements.map(e => [e.id, e]))
  return expected.filter(({ id, key, value }) =>
    key === 'link' ? !byId.get(id)?.boundElements?.some(b => b.id === value) : !same(facts(byId.get(id))[key], value))
}

export function describe(scene) {
  const all = live(scene), byId = new Map(all.map(e => [e.id, e])), labels = new Map()
  const q = value => JSON.stringify(value ?? '')
  for (const t of all) if (t.type === 'text' && t.containerId) labels.set(t.containerId, t.originalText ?? t.text)
  const textOf = e => e?.type === 'text' ? e.originalText ?? e.text : labels.get(e?.id)
  const end = binding => binding ? `${binding.elementId} ${q(textOf(byId.get(binding.elementId)))}` : 'UNBOUND'

  const lines = all.filter(e => !(e.type === 'text' && byId.has(e.containerId))).map(e => {
    if (e.type === 'arrow') return `arrow ${e.id}: ${end(e.startBinding)} -> ${end(e.endBinding)} label=${q(textOf(e))}`
    const box = [e.x, e.y, e.width, e.height].map(Math.round)
    return `${e.type} ${e.id}: ${q(textOf(e))} at=${box[0]},${box[1]} size=${box[2]}x${box[3]} fill=${e.backgroundColor}${e.locked ? ' LOCKED' : ''}`
  })
  if (!lines.length) lines.push('(empty canvas)')
  return [...lines, ...brokenLinks(scene).map(b => `BROKEN ${b}`), ...layoutProblems(scene).map(p => `LAYOUT ${p}`)].join('\n')
}
