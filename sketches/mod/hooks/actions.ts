/**
 * SKETCH. The only way the console changes anything. An action is a fixed argv from the table below,
 * never a shell string and never a command read from a project file. A read runs at once; anything else
 * raises one pending card that a person answers, which expires, and whose effect is then checked.
 */
export type Action = {
  id: string
  label: string
  argv: readonly string[]
  isRead: boolean
  /** Shown on the confirm row: what will change. */
  effect?: string
  /** Did it take? Asked after the command exits, because exit 0 is not proof. */
  verify?: () => Promise<boolean>
}

export type Run = (argv: readonly string[], timeoutMs: number) => Promise<{ exitCode: number; stdout: string; stderr: string }>

export type Pending = { card: number; action: Action; askedAtMs: number; by: 'person' | 'claude' }
export type Gate = { pending: Pending | null; nextCard: number; lastResult: string | null }

export const PENDING_TTL_MS = 30_000
const RUN_TIMEOUT_MS = 60_000

// Replace with your project's verbs. Write the argv from what the tool actually accepts.
export const ACTIONS: readonly Action[] = [
  { id: 'git-status', label: 'git status', argv: ['git', 'status', '--short'], isRead: true },
  { id: 'test', label: 'run the test suite', argv: ['npm', 'test'], isRead: false, effect: 'runs the tests; may write caches' },
]

export const newGate = (): Gate => ({ pending: null, nextCard: 1, lastResult: null })

async function execute(gate: Gate, action: Action, run: Run): Promise<void> {
  try {
    const done = await run(action.argv, RUN_TIMEOUT_MS)
    const took = done.exitCode === 0 && (action.verify === undefined || (await action.verify()))
    gate.lastResult = `${took ? 'done' : 'failed'}: ${action.label}\n${done.stdout || done.stderr}`.slice(0, 2_000)
  } catch (error) {
    gate.lastResult = `failed: ${action.label}: ${error instanceof Error ? error.message : 'refused'}`
  }
}

/** A person pressed a row, or Claude asked. Only a read runs now. */
export async function ask(gate: Gate, id: string, by: Pending['by'], run: Run, nowMs: number): Promise<string> {
  const action = ACTIONS.find(one => one.id === id)
  if (action === undefined) return `no action "${id}"`
  if (action.isRead) {
    await execute(gate, action, run)
    return gate.lastResult ?? ''
  }
  if (gate.pending !== null && nowMs - gate.pending.askedAtMs < PENDING_TTL_MS) return 'another action is waiting for an answer'
  gate.pending = { card: gate.nextCard++, action, askedAtMs: nowMs, by }
  return `waiting for a yes on card ${gate.pending.card}: ${action.label}`
}

/** Bound to the card the person saw: a card replaced meanwhile runs nothing. */
export async function answer(gate: Gate, card: number, isYes: boolean, run: Run, nowMs: number): Promise<string> {
  const pending = gate.pending
  if (pending === null || pending.card !== card) return 'that card is gone; nothing ran'
  gate.pending = null
  if (!isYes) return `declined: ${pending.action.label}`
  if (nowMs - pending.askedAtMs >= PENDING_TTL_MS) return 'that card expired; nothing ran'
  await execute(gate, pending.action, run)
  return gate.lastResult ?? ''
}
