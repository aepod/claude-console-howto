#!/usr/bin/env node
// SKETCH. The cockpit in a terminal of its own, with no Claude Code. It shares read-model.ts with the mod and is
// read-only by construction: it has no argv table and writes nothing to the project. Needs a Node that strips TS types
// (22.18+ or 23.6+), or bundle it with esbuild.
//   node console-tui.mjs [project-dir] [--plain]
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

import { readSnapshot, summaryLines } from '../mod/hooks/read-model.ts'

const args = process.argv.slice(2)
const isPlain = args.includes('--plain')
const root = resolve(args.find(arg => !arg.startsWith('--')) ?? '.')
const REFRESH_MS = 3000

const fs = {
  read: path => readFile(path, 'utf8'),
  stat: async path => {
    const info = await stat(path).catch(() => undefined)
    return info && { size: info.size, mtimeMs: info.mtimeMs }
  },
}
const cache = new Map()
const out = process.stdout

const frame = async () => [`my-console  ${root}`, '', ...summaryLines(await readSnapshot(fs, root, cache, Date.now()))]

// A pipe and CI get one frame. No terminal and no --plain is a usage error, not garbage in a log.
if (isPlain) {
  console.log((await frame()).join('\n'))
  process.exit(0)
}
if (!out.isTTY || !process.stdin.isTTY) {
  console.error('my-console: no terminal. Use --plain for one frame.')
  process.exit(2)
}

let offset = 0
let lines = []
const draw = () => {
  const room = Math.max(1, (out.rows ?? 24) - 1)
  offset = Math.min(offset, Math.max(0, lines.length - room))
  const body = lines.slice(offset, offset + room).map(line => line.slice(0, out.columns ?? 80))
  out.write(`\x1b[H\x1b[2J${body.join('\r\n')}\x1b[${out.rows ?? 24};1H\x1b[2mj/k scroll  r refresh  q quit\x1b[0m`)
}
const refresh = async () => {
  lines = await frame()
  draw()
}
const quit = () => {
  clearInterval(timer)
  process.stdin.setRawMode(false)
  out.write('\x1b[?25h\x1b[?1049l') // always give the terminal back
  process.exit(0)
}

out.write('\x1b[?1049h\x1b[?25l') // alternate screen, hidden cursor
process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on('data', chunk => {
  const key = String(chunk)
  if (key === 'q' || key === '\x03') quit()
  else if (key === 'j') offset += 1
  else if (key === 'k') offset = Math.max(0, offset - 1)
  else if (key === 'r') void refresh()
  draw()
})
out.on('resize', draw)
process.on('SIGTERM', quit)
const timer = setInterval(() => void refresh(), REFRESH_MS)
await refresh()
