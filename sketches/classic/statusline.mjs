#!/usr/bin/env node
// SKETCH. A status line command: Claude Code pipes session JSON to stdin and shows what this prints.
// It runs constantly, so: no network, no CLI on the hot path, a cache for anything slow, always exit 0.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CACHE_MS = 10_000

const readStdin = () => {
  try {
    if (process.stdin.isTTY) return {}
    const raw = readFileSync(0, 'utf8').trim()
    return raw.startsWith('{') ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
const readJson = path => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}
const clean = text => String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 40)

function gitBranch(dir, stateDir) {
  const cachePath = join(stateDir, 'statusline-cache.json')
  try {
    if (Date.now() - statSync(cachePath).mtimeMs < CACHE_MS) return readJson(cachePath)?.branch ?? null
  } catch {
    // no cache yet
  }
  let branch = null
  try {
    branch = execFileSync('git', ['-C', dir, 'branch', '--show-current'], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    // not a repo
  }
  try {
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(cachePath, JSON.stringify({ branch }))
  } catch {
    // a read-only project still gets a line
  }
  return branch
}

const session = readStdin()
const dir = session.workspace?.current_dir ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const stateDir = join(dir, '.my-console')
const status = readJson(join(stateDir, 'status.json'))
const parts = [
  session.model?.display_name && clean(session.model.display_name),
  gitBranch(dir, stateDir),
  typeof session.cost?.total_cost_usd === 'number' && `$${session.cost.total_cost_usd.toFixed(2)}`,
  status?.tests && `tests ${clean(status.tests)}`,
  status?.task && clean(status.task),
].filter(Boolean)

console.log(parts.join(' | ') || 'my-console')
