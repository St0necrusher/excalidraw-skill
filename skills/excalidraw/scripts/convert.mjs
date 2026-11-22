#!/usr/bin/env node
// The official CLI, pinned and limited to its two local commands.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { report } from './lib/file.mjs'
import { Fail } from './lib/scene.mjs'

const CLI = '@excalidraw/cli@1.1.2'

try {
  const [command, input, output, extra] = process.argv.slice(2)
  if (!['render', 'mermaid'].includes(command) || !input || !output || extra) {
    throw new Fail('usage: convert.mjs render SCENE OUT.png|OUT.svg | convert.mjs mermaid IN.mmd NEW.excalidraw')
  }
  if (command === 'render' && !/\.(png|svg)$/.test(output)) throw new Fail('render writes .png or .svg only')
  if (/\.excalidraw\.(png|svg)$/.test(output)) throw new Fail('that name is an editable diagram; choose a plain .png or .svg')
  if (command === 'mermaid' && fs.existsSync(output)) {
    throw new Fail(`${output} exists; give a new path, or use edit.mjs to keep the user's layout`)
  }

  const run = spawnSync('npx', ['-y', CLI, command, input, '--out', output], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      EXCALIDRAW_NO_UPDATE_NOTIFIER: '1',
      EXCALIDRAW_FONTS_URL: 'none',
      npm_config_ignore_scripts: 'true',
      npm_config_update_notifier: 'false',
    },
  })
  if (run.error) throw run.error
  process.exitCode = run.status ?? 1
} catch (error) {
  report(error)
}
