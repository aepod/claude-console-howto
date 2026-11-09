/**
 * SKETCH. The entry point: slash command, pane, band, event observers, model tools.
 * Hot reload runs register and session.start again, and drops timers and these variables.
 */
import type { Register } from 'claude-code'

import { ACTIONS, answer, ask, newGate } from './actions'
import { bindHost, type Host } from './host'
import { callTool, levelOf, PREFIX, TOOL_SPECS, type ToolDeps } from './model-tools'
import { bandText, clean, readSnapshot, summaryLines, type ReadCache, type Snapshot } from './read-model'

const PANE = 'my-console'
const NARROW = 48

export const register: Register = (on, options) => {
  const gate = newGate()
  const cache: ReadCache = new Map()
  const callsThisTurn = { count: 0 }
  let host: Host | null = null
  let root = '.'
  let snapshot: Snapshot | null = null
  let toolsSeen = 0

  const refreshSeconds = Math.min(60, Math.max(2, Number(options.refreshSeconds) || 3))
  const level = levelOf(options.modelControl)

  const refresh = async (bound: Host) => {
    snapshot = await readSnapshot(bound.fs, root, cache, Date.now())
    bound.redraw()
  }
  const runOf = (bound: Host) => bound.run
  const toolDeps = (bound: Host): ToolDeps => ({ level, snapshot: () => snapshot, gate, run: runOf(bound), now: () => Date.now(), callsThisTurn })
  const press = (id: string) => () => {
    const bound = host
    if (bound === null) return
    void ask(gate, id, 'person', bound.run, Date.now()).then(() => bound.redraw())
  }
  const answerCard = (card: number, isYes: boolean) => () => {
    const bound = host
    if (bound === null) return
    void answer(gate, card, isYes, bound.run, Date.now()).then(() => refresh(bound))
  }

  on('session.start', async ($, e, next) => {
    const bound = bindHost($, e.cwd)
    host = bound
    root = e.cwd

    // Tells classic hooks started after this that the mod owns these commands, so nothing fires twice.
    await $.env.set('MY_CONSOLE_OWNS', 'post-edit').catch(() => undefined)

    // There is no commands/ folder: a mod's command exists because it registered one.
    await $.command.register({ name: 'my-console', description: 'The project cockpit: /my-console help', argumentHint: '[open|close|run <id>|yes <card>|no <card>|status]' }).catch(() => undefined)

    // Declared only when the person turned control on.
    if (level !== 'off') {
      for (const spec of TOOL_SPECS) {
        await $.tool.register({ ...spec, inputSchema: { ...spec.inputSchema } }).catch(() => undefined)
      }
    }

    bound.every(refreshSeconds * 1000, () => void refresh(bound))
    await refresh(bound)

    // From a timer, never from a render hook; without focus, so the prompt keeps the keys.
    if (options.panel !== 'command' && snapshot !== null) {
      $.clock.after(50, () => void bound.openPane(PANE, 'My console', false).catch(() => undefined))
    }

    return next(e)
  })

  // Every pane key needs a subcommand too: a key reaches a pane only while it holds focus.
  on('command.run', { command: 'my-console' }, async ($, e) => {
    const bound = host
    if (bound === null) return { text: 'my-console has not started in this session.' }
    const [head = 'open', arg = ''] = e.args.trim().split(/\s+/).filter(Boolean)

    switch (head) {
      case 'open': {
        const placed = await bound.openPane(PANE, 'My console', true)
        return { text: placed.isPlaced ? 'Opened.' : `Not placed: ${placed.reason ?? 'unknown'}` }
      }
      case 'close':
        await bound.closePane(PANE)
        return { text: 'Closed.' }
      case 'status':
        return { text: summaryLines(snapshot).join('\n') }
      case 'run':
        return { text: await ask(gate, arg, 'person', bound.run, Date.now()) }
      case 'yes':
      case 'no':
        return { text: await answer(gate, Number(arg), head === 'yes', bound.run, Date.now()) }
      default:
        return { text: `Actions: ${ACTIONS.map(action => action.id).join(', ')}` }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = Math.floor(Number(e.props.bodyColumns) || 80)
    const pending = gate.pending

    return (
      <Box flexDirection="column">
        {summaryLines(snapshot).map(line => (
          <Text>{line || ' '}</Text>
        ))}
        <Text dimColor>tool calls seen: {toolsSeen}</Text>
        {pending !== null && (
          <Box>
            <Text>Run {pending.action.label}? {pending.action.effect ?? ''} </Text>
            <Button key="yes" label="Yes" onPress={answerCard(pending.card, true)} />
            <Button key="no" label="No" onPress={answerCard(pending.card, false)} />
          </Box>
        )}
        {/* Below NARROW the pane is text only: the same facts, no controls that would wrap. */}
        {columns >= NARROW && ACTIONS.map(action => <Button key={action.id} label={action.label} onPress={press(action.id)} />)}
        {gate.lastResult !== null && <Text dimColor>{clean(gate.lastResult, 400)}</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    if (e.props.hasSurvey) return next(e) // always give way to what the engine needs to ask
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>my-console: {bandText(snapshot, gate.pending?.action.label ?? null)}</Text>
      </Box>
    )
  })

  // Observe, never decide: call next first and return its answer untouched.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    toolsSeen += 1
    return result
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'my-console: its observer failed' }))

  // Answers only its own names; a wider matcher here would hijack every tool call.
  for (const spec of TOOL_SPECS) {
    on('tool.call', { tool: `${PREFIX}${spec.name}` }, async (_$, e) => {
      const bound = host
      if (bound === null) return { deny: 'my-console is not running in this session' }
      return { result: await callTool(spec.name, e as unknown as { id?: unknown }, toolDeps(bound)) }
    }).catch(() => ({ deny: 'my-console: the tool failed' }))
  }

  on('turn.start', ($, e, next) => {
    callsThisTurn.count = 0
    return next(e)
  })

  on('session.end', ($, e, next) => {
    host = null
    return next(e)
  })
}
