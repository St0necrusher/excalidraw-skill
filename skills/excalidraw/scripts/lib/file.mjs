import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Fail } from './scene.mjs'

const LOCK_TIMEOUT = 10_000
export const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const format = scene => JSON.stringify(scene, null, 2) + '\n'

export function checkPath(file) {
  if (!/\.excalidraw(\.json)?$/.test(file ?? '')) {
    throw new Fail('expected a .excalidraw or .excalidraw.json file; for .png and .svg ask the user for an .excalidraw copy')
  }
}

export function load(file) {
  // The editor may be halfway through a save, so retry a partial read.
  for (let attempt = 1; ; attempt++) {
    const raw = fs.readFileSync(file, 'utf8')
    try {
      const scene = JSON.parse(raw)
      if (Array.isArray(scene.elements)) return { raw, scene }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
    }
    if (attempt === 10) throw new Fail(`not an Excalidraw scene: ${file}`)
    sleep(50)
  }
}

// Serialises agents that use these scripts. The editor doesn't take this lock,
// which is why commit() also compares the file just before writing.
function locked(file, work) {
  const key = createHash('sha1').update(fs.realpathSync(file)).digest('hex')
  const lock = path.join(os.tmpdir(), `excalidraw-edit-${key}.lock`)
  const started = Date.now()
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' })
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (Date.now() - started > LOCK_TIMEOUT) throw new Fail(`another edit holds ${lock}; delete it if that process is gone`, 3)
      sleep(25)
    }
  }
  try {
    return work()
  } finally {
    fs.rmSync(lock, { force: true })
  }
}

export function commit(file, change) {
  return locked(file, () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { raw, scene } = load(file)
      const result = change(scene)
      if (fs.readFileSync(file, 'utf8') === raw) {
        fs.writeFileSync(file, format(scene))
        return result
      }
      sleep(100)
    }
    throw new Fail('the canvas keeps changing; nothing written, try again when the user pauses', 3)
  })
}

export function create(file, change) {
  const scene = { type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements: [], appState: { viewBackgroundColor: '#ffffff' }, files: {} }
  const result = change(scene)
  try {
    fs.writeFileSync(file, format(scene), { flag: 'wx' })
  } catch (error) {
    if (error.code === 'EEXIST') throw new Fail(`${file} exists; edit it without --create`)
    throw error
  }
  return result
}

export function report(error) {
  console.error(error instanceof Fail || error.code ? `error: ${error.message}` : error.stack)
  process.exitCode = error instanceof Fail ? error.exitCode : error.code ? 2 : 1
}
