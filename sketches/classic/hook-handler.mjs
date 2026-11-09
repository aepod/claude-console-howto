#!/usr/bin/env node
// SKETCH. One dispatcher for settings.json command hooks. Claude Code sends the event as JSON on stdin.
// Exit 0 passes, exit 2 blocks and feeds stderr back. Everything else fails open: a broken helper must not stop work.
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const command = process.argv[2] ?? ''

// The mod does this one in process while it runs, so this copy stands down.
const owned = (process.env.MY_CONSOLE_OWNS ?? '').split(',').map(word => word.trim())
if (owned.includes(command)) process.exit(0)

const readStdin = () =>
  new Promise(resolve => {
    if (process.stdin.isTTY) return resolve({})
    let raw = ''
    const done = () => {
      try {
        resolve(raw.trim() ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    }
    setTimeout(done, 500).unref() // an unclosed stdin must not hang the session
    process.stdin.on('data', chunk => (raw += chunk)).on('end', done).on('error', done)
  })

// Masks before anything reaches the disk. Extend these for your project's secret shapes.
const mask = text =>
  String(text ?? '')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '[private key]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16})\b/g, '[token]')
    .replace(/(password|secret|token|api[_-]?key)(\s*[=:]\s*)\S+/gi, '$1$2[masked]')
    .replace(/\/(home|Users)\/[^/\s]+/g, '~')
    .slice(0, 200)

function record(event, kind, text) {
  try {
    const dir = join(event.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), '.my-console')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ atMs: Date.now(), kind, text: mask(text) })}\n`)
  } catch {
    // an observer never fails the hook
  }
}

const event = await readStdin()

switch (command) {
  case 'session-start':
    record(event, 'session', 'started')
    break
  case 'session-end':
    record(event, 'session', 'ended')
    break
  case 'prompt':
    // stdout here joins the model's context, so keep it empty unless it earns its tokens.
    record(event, 'prompt', `${String(event.prompt ?? '').length} chars`) // the size, not the words
    break
  case 'post-edit':
    record(event, 'edit', event.tool_input?.file_path)
    break
  case 'pre-bash': {
    const line = String(event.tool_input?.command ?? '')
    if (/\brm\s+-[a-z]*r[a-z]*f?\s+\/(\s|$)/.test(line)) {
      console.error('my-console: refused a recursive delete of the filesystem root.')
      process.exit(2)
    }
    record(event, 'bash', line)
    break
  }
  default:
    break // an unknown command from a newer settings file is not an error
}
process.exit(0)
