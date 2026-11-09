/**
 * SKETCH. The engine behind one small interface. Every `$` call is spelled out here and nowhere else, so
 * the rest is plain functions a test or the standalone TUI can drive. The engine reads literal `$.noun.method`
 * calls from the source: do not compute them, and do not feature-detect a noun.
 */
import type { EngineInterface } from 'claude-code'

import type { ReaderFs } from './read-model'

export type Host = {
  fs: ReaderFs
  every: (ms: number, fn: () => void) => { cancel?: () => void } | unknown
  run: (argv: readonly string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  redraw: () => void
  toast: (text: string) => void
  openPane: (id: string, title: string, focus: boolean) => Promise<{ isPlaced: boolean; reason?: string }>
  closePane: (id: string) => Promise<void>
}

export function bindHost($: EngineInterface, cwd: string): Host {
  // Any member may be refused (policy, an administrator). A refused draw is not a crashed hook.
  const quietly = (fn: () => unknown) => {
    try {
      void Promise.resolve(fn()).catch(() => undefined)
    } catch {
      // nothing to do about a draw nobody may make
    }
  }

  return {
    fs: {
      read: async path => $.fs.read(path),
      stat: async path => $.fs.stat(path),
    },
    every: (ms, fn) => $.clock.every(ms, fn),
    run: async (argv, timeoutMs) => {
      const done = await $.process.run([...argv], { cwd, timeoutMs })
      return { exitCode: done.exitCode ?? 1, stdout: done.stdout, stderr: done.stderr }
    },
    redraw: () => quietly(() => $.ui.invalidate('ui.render')),
    toast: text => quietly(() => $.ui.toast(text)),
    openPane: async (id, title, focus) => {
      const result = await $.ui.open({ id, title, focus })
      return { isPlaced: result?.isPlaced ?? true, ...(result?.reason !== undefined && { reason: result.reason }) }
    },
    closePane: async id => {
      await $.ui.close({ id })
    },
  }
}
