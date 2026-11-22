import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const scripts = fileURLToPath(new URL('../skills/excalidraw/scripts/', import.meta.url))
const script = name => path.join(scripts, name)
const load = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const byId = (file, id) => load(file).elements.find(e => e.id === id)
const edit = (file, ops, ...flags) =>
  spawnSync(process.execPath, [script('edit.mjs'), file, '--settle', '0', ...flags], { input: JSON.stringify(ops), encoding: 'utf8' })

function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excalidraw-skill-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return path.join(dir, 'd.excalidraw')
}
function created(t, ops = []) {
  const file = temp(t)
  const r = edit(file, ops, '--create')
  assert.equal(r.status, 0, r.stderr)
  return { file, ids: JSON.parse(r.stdout).ids }
}
function ok(file, ops) {
  const r = edit(file, ops)
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
const box = (as, x = 0, y = 0, text = as, more = {}) => ({ op: 'add', as, type: 'rectangle', x, y, text, ...more })
const pair = [box('a', 0, 0, 'Первый'), box('b', 500, 0, 'Второй'), { op: 'connect', as: 'ab', from: 'a', to: 'b', text: 'ведёт' }]

test('arrows and labels are linked in both directions', t => {
  const { file, ids } = created(t, pair)
  const a = byId(file, ids.a), arrow = byId(file, ids.ab)
  assert.equal(arrow.startBinding.elementId, ids.a)
  assert.equal(arrow.endBinding.elementId, ids.b)
  assert.ok(a.boundElements.some(b => b.id === ids.ab))
  assert.ok(byId(file, ids.b).boundElements.some(b => b.id === ids.ab))
  const label = load(file).elements.find(e => e.containerId === ids.a)
  assert.equal(label.text, 'Первый')
  assert.ok(a.boundElements.some(b => b.id === label.id))
})

test('moving a shape keeps bends drawn by the user', t => {
  const { file, ids } = created(t, pair)
  const d = load(file), arrow = d.elements.find(e => e.id === ids.ab)
  arrow.points = [[0, 0], [100, 170], arrow.points.at(-1)]
  const bend = [arrow.x + 100, arrow.y + 170]
  fs.writeFileSync(file, JSON.stringify(d))
  ok(file, [{ op: 'move', id: ids.a, x: -100, y: -100 }])
  const after = byId(file, ids.ab)
  assert.equal(after.points.length, 3)
  assert.ok(Math.abs(after.x + after.points[1][0] - bend[0]) < 1e-6)
  assert.ok(Math.abs(after.y + after.points[1][1] - bend[1]) < 1e-6)
})

test('text that fits changes nothing except its label', t => {
  const { file, ids } = created(t, pair)
  const before = load(file).elements
  ok(file, [{ op: 'text', id: ids.a, text: 'Да' }])
  const changed = load(file).elements.filter((e, i) => JSON.stringify(e) !== JSON.stringify(before[i]))
  assert.equal(changed.length, 1)
  assert.equal(changed[0].containerId, ids.a)
})

test('longer text grows a shape around its centre', t => {
  const { file, ids } = created(t, pair)
  const before = byId(file, ids.a)
  ok(file, [{ op: 'text', id: ids.a, text: 'Очень длинная подпись блока на схеме' }])
  const after = byId(file, ids.a)
  assert.ok(after.width > before.width)
  assert.ok(Math.abs(after.x + after.width / 2 - (before.x + before.width / 2)) < 1e-6)
})

test('a new shape keeps the requested corner when its text grows it', t => {
  const { file, ids } = created(t, [box('a', 10, 20, 'Очень длинная подпись блока на схеме')])
  assert.equal(byId(file, ids.a).x, 10)
  assert.equal(byId(file, ids.a).y, 20)
})

test('empty text removes the label', t => {
  const { file, ids } = created(t, pair)
  ok(file, [{ op: 'text', id: ids.a, text: '' }])
  assert.ok(!load(file).elements.some(e => !e.isDeleted && e.containerId === ids.a))
})

test('delete takes the label and detaches arrows', t => {
  const { file, ids } = created(t, pair)
  ok(file, [{ op: 'delete', id: ids.a }])
  assert.ok(byId(file, ids.a).isDeleted)
  assert.ok(load(file).elements.find(e => e.containerId === ids.a).isDeleted)
  assert.equal(byId(file, ids.ab).startBinding, null)
})

test('font size and colour change through style', t => {
  const { file, ids } = created(t, pair)
  ok(file, [{ op: 'style', id: ids.a, backgroundColor: '#b2f2bb', fontSize: 28 }])
  assert.equal(byId(file, ids.a).backgroundColor, '#b2f2bb')
  assert.equal(load(file).elements.find(e => e.containerId === ids.a).fontSize, 28)
})

test('relink repairs a lost back-reference', t => {
  const { file, ids } = created(t, pair)
  const d = load(file)
  d.elements.find(e => e.id === ids.a).boundElements = []
  fs.writeFileSync(file, JSON.stringify(d))
  ok(file, [{ op: 'relink' }])
  assert.ok(byId(file, ids.a).boundElements.some(b => b.id === ids.ab))
})

test('an invalid batch writes nothing', t => {
  const { file, ids } = created(t, pair)
  const before = fs.readFileSync(file, 'utf8')
  for (const bad of [
    { op: 'text', id: 'missing', text: 'x' },
    { op: 'explode' },
    { op: 'move', id: ids.a, x: '10', y: 0 },
    { op: 'style', id: ids.a, label: 'silently dropped' },
    { op: 'connect', from: ids.a, to: ids.a },
    { op: 'move', id: ids.ab, x: 0, y: 0 },
  ]) {
    assert.equal(edit(file, [{ op: 'text', id: ids.b, text: 'не записать' }, bad]).status, 2, JSON.stringify(bad))
    assert.equal(fs.readFileSync(file, 'utf8'), before)
  }
})

test('locked elements belong to the user', t => {
  const { file, ids } = created(t, pair)
  const d = load(file)
  d.elements.find(e => e.id === ids.a).locked = true
  fs.writeFileSync(file, JSON.stringify(d))
  assert.equal(edit(file, [{ op: 'move', id: ids.a, x: 1, y: 1 }]).status, 2)
})

test('create never overwrites, editing never creates', t => {
  const { file } = created(t, pair)
  const before = fs.readFileSync(file, 'utf8')
  assert.equal(edit(file, [], '--create').status, 2)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
  const other = temp(t)
  assert.equal(edit(other, [box('x')]).status, 2)
  assert.ok(!fs.existsSync(other))
})

test('embedded png and svg scenes are refused', t => {
  for (const suffix of ['.png', '.svg']) assert.equal(edit(temp(t) + suffix, [], '--create').status, 2)
})

test('a change made during editing survives', async t => {
  const { commit } = await import(script('lib/file.mjs'))
  const { file, ids } = created(t, pair)
  let calls = 0
  commit(file, d => {
    if (++calls === 1) {
      const other = load(file)
      other.elements.find(e => e.id === ids.b).x = 999
      fs.writeFileSync(file, JSON.stringify(other))
    }
    d.elements.find(e => e.id === ids.a).x = 111
  })
  assert.equal(calls, 2)
  assert.equal(byId(file, ids.a).x, 111)
  assert.equal(byId(file, ids.b).x, 999)
})

test('parallel agents all land', async t => {
  const { file } = created(t)
  const codes = await Promise.all(Array.from({ length: 16 }, (_, i) => new Promise(resolve => {
    const p = spawn(process.execPath, [script('edit.mjs'), file, '--settle', '0'], { stdio: ['pipe', 'ignore', 'ignore'] })
    p.on('close', resolve)
    p.stdin.end(JSON.stringify([box(`n${i}`, i * 250)]))
  })))
  assert.deepEqual(codes, Array(16).fill(0))
  assert.equal(load(file).elements.filter(e => e.type === 'rectangle').length, 16)
})

test('a write the editor dropped is reported', async t => {
  const { file, ids } = created(t, pair)
  const before = fs.readFileSync(file, 'utf8')
  const p = spawn(process.execPath, [script('edit.mjs'), file, '--settle', '1500'], { stdio: ['pipe', 'ignore', 'ignore'] })
  const closed = new Promise(resolve => p.on('close', resolve))
  p.stdin.end(JSON.stringify([{ op: 'text', id: ids.a, text: 'потеряется' }]))
  for (let i = 0; i < 300 && fs.readFileSync(file, 'utf8') === before; i++) await new Promise(r => setTimeout(r, 10))
  fs.writeFileSync(file, before)
  assert.equal(await closed, 4)
})

test('read is compact and flags loose or broken links', t => {
  const { file, ids } = created(t, pair)
  const d = load(file)
  d.elements.find(e => e.id === ids.a).boundElements = []
  d.elements.find(e => e.id === ids.ab).endBinding = null
  fs.writeFileSync(file, JSON.stringify(d))
  const r = spawnSync(process.execPath, [script('read.mjs'), file], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /"Первый"/)
  assert.match(r.stdout, /UNBOUND/)
  assert.match(r.stdout, /BROKEN/)
})

test('mermaid conversion never overwrites a diagram', t => {
  const { file } = created(t, pair)
  const before = fs.readFileSync(file, 'utf8')
  const r = spawnSync(process.execPath, [script('convert.mjs'), 'mermaid', 'in.mmd', file], { encoding: 'utf8' })
  assert.equal(r.status, 2)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
})

const editJson = (file, ops, ...flags) => {
  const r = edit(file, ops, ...flags)
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

test('a shape grown into its neighbour is reported, with the arrow it inverts', t => {
  const file = temp(t)
  const r = editJson(file, [
    box('charge', 520, 360, 'charge(order)\nStripe', { width: 200, height: 80 }),
    { op: 'add', as: 'pay', type: 'diamond', x: 250, y: 335, width: 220, height: 130, text: 'payment.ok?' },
    { op: 'connect', from: 'charge', to: 'pay' },
  ], '--create')
  assert.ok(r.warnings.some(w => w.includes('overlaps') && w.includes(r.ids.pay)), r.warnings.join('\n'))
  assert.ok(r.warnings.some(w => w.includes('no room')), r.warnings.join('\n'))
})

test('a return arrow bows away from the arrow it answers', t => {
  const file = temp(t)
  const r = editJson(file, [box('a', 0, 0), box('b', 0, 350), { op: 'connect', from: 'a', to: 'b', text: 'нет' }, { op: 'connect', as: 'back', from: 'b', to: 'a' }], '--create')
  const back = byId(file, r.ids.back)
  assert.equal(back.points.length, 3)
  assert.ok(Math.abs(back.points[1][0]) > 30)
  assert.deepEqual(r.warnings, [])
})

test('route bends an arrow through given points and straightens it again', t => {
  const { file, ids } = created(t, pair)
  ok(file, [{ op: 'route', id: ids.ab, via: [[340, 250]] }])
  let a = byId(file, ids.ab)
  assert.deepEqual([a.x + a.points[1][0], a.y + a.points[1][1]].map(Math.round), [340, 250])
  ok(file, [{ op: 'route', id: ids.ab, via: [] }])
  a = byId(file, ids.ab)
  assert.equal(a.points.length, 2)
})

test('arrows lying on each other are reported', t => {
  const r = editJson(temp(t), [box('a'), box('b', 0, 350), { op: 'connect', from: 'a', to: 'b' }, { op: 'connect', from: 'b', to: 'a', via: [] }], '--create')
  assert.ok(r.warnings.some(w => w.includes('lies on')), r.warnings.join('\n'))
})

test('an arrow through a third shape is reported', t => {
  const r = editJson(temp(t), [box('a'), box('middle', 300), box('b', 600), { op: 'connect', from: 'a', to: 'b' }], '--create')
  assert.ok(r.warnings.some(w => w.includes('passes through')), r.warnings.join('\n'))
})

test('a label longer than its arrow is reported', t => {
  const r = editJson(temp(t), [box('a'), box('b', 240), { op: 'connect', from: 'a', to: 'b', text: 'длинная подпись' }], '--create')
  assert.ok(r.warnings.some(w => w.includes('label does not fit')), r.warnings.join('\n'))
})

test('a container around shapes is not an overlap', t => {
  const r = editJson(temp(t), [box('zone', -50, -50, '', { width: 900, height: 250 }), box('a'), box('b', 500), { op: 'connect', from: 'a', to: 'b' }], '--create')
  assert.deepEqual(r.warnings, [])
})

test('problems the edit did not touch are not repeated', t => {
  const { file } = created(t, [box('a'), box('b', 50)])
  assert.deepEqual(ok(file, [box('c', 900)]).warnings, [])
})

test('a bend on top of the arrow head is reported', t => {
  const r = editJson(temp(t), [
    { op: 'add', as: 'd', type: 'diamond', x: 261, y: 54, width: 372, height: 146 },
    box('wait', 357, 340, 'Ждём', { width: 180, height: 54 }),
    { op: 'connect', from: 'wait', to: 'd', via: [[640, 367], [640, 127]] },
  ], '--create')
  assert.ok(r.warnings.some(w => w.includes('arrowhead')), r.warnings.join('\n'))
})

test('opposite arrows sharing one point on a shape are reported', t => {
  const r = editJson(temp(t), [
    box('hub', 0, 0), box('right', 500, 0), box('far', 900, 0, 'far', { y: 400 }),
    { op: 'connect', from: 'hub', to: 'right' },
    { op: 'connect', from: 'far', to: 'hub', via: [[420, 40]] },
  ], '--create')
  assert.ok(r.warnings.some(w => w.includes('same point')), r.warnings.join('\n'))
})

test('growing a shape of the user is reported, growing a new one is not', t => {
  const { file, ids } = created(t, pair)
  const r = ok(file, [{ op: 'text', id: ids.a, text: 'Очень длинная подпись блока на схеме' }, box('n', 0, 400, 'Тоже очень длинная подпись нового блока')])
  assert.equal(r.resized.length, 1)
  assert.match(r.resized[0], new RegExp(`${ids.a}.*centre`))
})
