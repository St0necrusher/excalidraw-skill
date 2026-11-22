#!/usr/bin/env node
import fs from 'node:fs'
import { setTimeout as wait } from 'node:timers/promises'
import { checkPath, commit, create, load, report } from './lib/file.mjs'
import { applyOps, expectations, Fail, unmet } from './lib/scene.mjs'

const HELP = `Usage: edit.mjs FILE [--create] [--settle MS] < ops.json

Applies a JSON array of operations to the current file as one batch: all or none.

  {"op":"add","type":"rectangle|ellipse|diamond","x":0,"y":0, "text","width","height","as", STYLE}
  {"op":"add","type":"text","x":0,"y":0,"text":"Title", "as", STYLE}
  {"op":"connect","from":ID,"to":ID, "text","as","via", STYLE}
                                               a return arrow bows out by itself
  {"op":"route","id":ARROW,"via":[[x,y],...]}  bend an arrow through points; [] straightens
  {"op":"text","id":ID,"text":"New text"}      shape, arrow or text; "" removes a label
  {"op":"move","id":ID,"x":0,"y":0}            top-left corner; label and arrows follow
  {"op":"style","id":ID, STYLE}
  {"op":"delete","id":ID}                      label goes too; arrows are detached
  {"op":"relink"}                              repairs links reported as BROKEN

  "as" names a new element so later operations in the batch can use it as an ID.
  STYLE: backgroundColor, strokeColor, fillStyle (solid|hachure|cross-hatch|zigzag),
         strokeStyle (solid|dashed|dotted), strokeWidth, roughness (0|1|2),
         opacity (0-100), rounded (true|false), fontSize

  Shapes grow to fit their text, so leave at least 100 between neighbours.
  "warnings" in the result lists layout mistakes the batch caused: fix them.

  "resized" lists existing shapes whose box changed: tell the user.

  --create     make a new file; fails if it exists
  --settle MS  how long to wait before confirming the write (default 2500)

Exit codes
  0  written and confirmed; prints the new ids
  2  invalid input; nothing written
  3  canvas busy; nothing written
  4  written, then part of it was replaced by the editor or the user; lists that part
`

async function main(args) {
  if (args.includes('--help')) return console.log(HELP)
  let file, fresh = false, settle = 2500
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--create') fresh = true
    else if (arg === '--settle') {
      settle = Number(args[++i])
      if (!Number.isInteger(settle) || settle < 0) throw new Fail('--settle takes milliseconds')
    } else if (!file && !arg.startsWith('-')) file = arg
    else throw new Fail(`unexpected argument ${arg}; see --help`)
  }
  checkPath(file)

  let ops
  try {
    ops = JSON.parse(fs.readFileSync(0, 'utf8'))
  } catch (error) {
    throw new Fail(`stdin must be a JSON array of operations: ${error.message}`)
  }

  const change = scene => {
    const before = structuredClone(scene)
    const result = applyOps(scene, ops)
    return { ...result, expected: expectations(before, scene) }
  }
  const { ids, resized, warnings, expected } = fresh ? create(file, change) : commit(file, change)

  await wait(settle)
  const replaced = unmet(load(file).scene, expected)
  console.log(JSON.stringify({ ok: !replaced.length, ids, resized, warnings, replaced }, null, 2))
  if (replaced.length) process.exitCode = 4
}

main(process.argv.slice(2)).catch(report)
