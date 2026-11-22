#!/usr/bin/env node
import { checkPath, load, report } from './lib/file.mjs'
import { describe } from './lib/scene.mjs'

try {
  const file = process.argv[2]
  checkPath(file)
  console.log(describe(load(file).scene))
} catch (error) {
  report(error)
}
