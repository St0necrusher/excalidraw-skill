// Drawing mistakes that change what a diagram says and are easy to miss in an image.
const MIN_ARROW = 24
const SHAPES = new Set(['rectangle', 'ellipse', 'diamond', 'image'])

const center = e => [e.x + e.width / 2, e.y + e.height / 2]
const pointsOf = a => a.points.map(([x, y]) => [a.x + x, a.y + y])
const distance = ([a, b], [c, d]) => Math.hypot(c - a, d - b)

// margin > 0 shrinks the shape, so touching edges don't count.
function inside(e, [x, y], margin = 0) {
  const w = e.width / 2 - margin, h = e.height / 2 - margin
  if (w <= 0 || h <= 0) return false
  const [cx, cy] = center(e), a = Math.abs(x - cx) / w, b = Math.abs(y - cy) / h
  return (e.type === 'diamond' ? a + b : e.type === 'ellipse' ? Math.hypot(a, b) : Math.max(a, b)) < 1
}

function outline(e) {
  const [cx, cy] = center(e)
  return Array.from({ length: 72 }, (_, i) => {
    const c = Math.cos((i * Math.PI) / 36), s = Math.sin((i * Math.PI) / 36)
    const k = e.type === 'diamond' ? Math.abs(c) + Math.abs(s) : e.type === 'ellipse' ? 1 : Math.max(Math.abs(c), Math.abs(s))
    return [cx + (c / k) * (e.width / 2), cy + (s / k) * (e.height / 2)]
  })
}

function overlaps(a, b) {
  if (a.x >= b.x + b.width || b.x >= a.x + a.width || a.y >= b.y + b.height || b.y >= a.y + a.height) return false
  const pa = outline(a), pb = outline(b)
  // One shape wholly inside another is a container.
  if (pa.every(p => inside(b, p)) || pb.every(p => inside(a, p))) return false
  return pa.some(p => inside(b, p, 2)) || pb.some(p => inside(a, p, 2))
}

function along(points) {
  const out = []
  for (let i = 1; i < points.length; i++) {
    const [p, q] = [points[i - 1], points[i]], steps = Math.max(2, Math.ceil(distance(p, q) / 8))
    for (let s = 0; s <= steps; s++) out.push([p[0] + ((q[0] - p[0]) * s) / steps, p[1] + ((q[1] - p[1]) * s) / steps])
  }
  return out
}

// changed: ids to report on; omit it to check the whole canvas.
export function layoutProblems(scene, changed) {
  const all = scene.elements.filter(e => !e.isDeleted), byId = new Map(all.map(e => [e.id, e]))
  const labels = new Map(all.filter(e => e.type === 'text' && e.containerId).map(e => [e.containerId, e]))
  const blocks = all.filter(e => SHAPES.has(e.type) || (e.type === 'text' && !e.containerId))
  const arrows = all.filter(e => e.type === 'arrow' && e.points?.length > 1)
  const relevant = (...es) => !changed || es.some(e => changed.has(e.id) || changed.has(labels.get(e.id)?.id))
  const name = e => {
    const text = e.type === 'text' ? e.text : labels.get(e.id)?.text
    return text ? `${e.id} ${JSON.stringify(text)}` : e.id
  }
  const found = []

  blocks.forEach((a, i) => {
    for (const b of blocks.slice(i + 1)) {
      if (relevant(a, b) && overlaps(a, b)) found.push(`${name(a)} overlaps ${name(b)}: move one`)
    }
  })

  for (const a of arrows) {
    const points = pointsOf(a), p = points[0], q = points.at(-1), samples = along(points)
    const from = byId.get(a.startBinding?.elementId), to = byId.get(a.endBinding?.elementId)
    const ends = [from, to].filter(Boolean)

    if (from && to && relevant(a, from, to) && points.length === 2) {
      const [fx, fy] = center(from), [tx, ty] = center(to)
      const forward = (q[0] - p[0]) * (tx - fx) + (q[1] - p[1]) * (ty - fy)
      if (forward <= 0 || distance(p, q) < MIN_ARROW) {
        found.push(`${a.id} has no room between ${name(from)} and ${name(to)}, so it is invisible or points backwards: move them apart`)
        continue
      }
    }

    if (points.length > 2 && relevant(a, ...ends) && distance(points.at(-2), q) < MIN_ARROW) {
      found.push(`${a.id}: last bend sits on the arrowhead, which hides it: route with that point further from the target`)
    }
    if (to && relevant(a, to)) {
      for (const b of arrows) {
        if (b.startBinding?.elementId !== to.id || distance(q, pointsOf(b)[0]) >= 12) continue
        found.push(`${a.id} arrives at the same point ${b.id} leaves ${name(to)} from: route it to another side`)
      }
    }

    const label = labels.get(a.id)
    if (label && relevant(a, label, ...ends)) {
      const length = samples.slice(1).reduce((sum, s, i) => sum + distance(samples[i], s), 0)
      const dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]), d = Math.hypot(dx, dy) || 1
      const needed = Math.min(dx ? (label.width * d) / dx : Infinity, dy ? (label.height * d) / dy : Infinity)
      if (length < needed + 16) found.push(`${name(a)}: label does not fit on the arrow: move the shapes apart or shorten it`)
    }

    for (const b of blocks) {
      if (ends.includes(b) || !relevant(a, b, ...ends)) continue
      if (inside(b, p) && inside(b, q)) continue
      if (samples.some(s => inside(b, s, 4))) found.push(`${a.id} passes through ${name(b)}: route it around or move the shape`)
    }

    for (const b of arrows) {
      if (b.id <= a.id || !relevant(a, b)) continue
      const key = e => [e.startBinding?.elementId, e.endBinding?.elementId].sort().join()
      if (!from || !to || key(a) !== key(b)) continue
      const other = along(pointsOf(b))
      if (samples.every(s => other.some(o => distance(s, o) < 16))) found.push(`${a.id} lies on ${b.id}: bend one with route`)
    }
  }
  return found
}
