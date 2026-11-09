/**
 * SKETCH. The read model: project files in, plain facts out. No `$`, no Node, so the mod and the
 * standalone TUI share it. A fact nobody measured is null and is drawn as n/a, never as zero.
 */
export const STATE_DIR = '.my-console'
const READ_MAX = 2_000_000 // past this a file is a "too large" fact, not a stalled hook
const EVENTS_SHOWN = 8

export type ReaderFs = {
  read: (path: string) => Promise<string>
  stat: (path: string) => Promise<{ size?: number; mtimeMs?: number } | undefined>
}

export type ConsoleEvent = { atMs: number; kind: string; text: string }

export type Snapshot = {
  readAtMs: number
  /** The project's own status, whatever it chooses to publish; null when it publishes none. */
  status: { build: string | null; tests: string | null; task: string | null } | null
  statusWhy: string
  events: ConsoleEvent[]
}

type Cached = { mtimeMs: number | undefined; text: string }
export type ReadCache = Map<string, Cached>

/** Strips what could move the cursor or reorder text: another process wrote this. */
export const clean = (value: unknown, max = 160): string =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .slice(0, max)

async function readBounded(fs: ReaderFs, path: string, cache: ReadCache): Promise<string | { why: string }> {
  try {
    const info = await fs.stat(path)
    if (info === undefined) return { why: 'missing' }
    if ((info.size ?? 0) > READ_MAX) return { why: 'too large' }
    const held = cache.get(path)
    if (held !== undefined && held.mtimeMs !== undefined && held.mtimeMs === info.mtimeMs) return held.text
    const text = await fs.read(path)
    cache.set(path, { mtimeMs: info.mtimeMs, text })
    return text
  } catch {
    return { why: 'refused or missing' } // a refusal is a missing fact, never a crash
  }
}

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? clean(value, 80) : null)

export async function readSnapshot(fs: ReaderFs, root: string, cache: ReadCache, nowMs: number): Promise<Snapshot> {
  // A fixed list of paths. Key material is simply never named here.
  const statusRaw = await readBounded(fs, `${root}/${STATE_DIR}/status.json`, cache)
  const eventsRaw = await readBounded(fs, `${root}/${STATE_DIR}/events.jsonl`, cache)

  let status: Snapshot['status'] = null
  let statusWhy = typeof statusRaw === 'string' ? '' : statusRaw.why
  if (typeof statusRaw === 'string') {
    try {
      const parsed = JSON.parse(statusRaw) as Record<string, unknown>
      status = { build: textOrNull(parsed.build), tests: textOrNull(parsed.tests), task: textOrNull(parsed.task) }
    } catch {
      statusWhy = 'unreadable'
    }
  }

  const events: ConsoleEvent[] = []
  if (typeof eventsRaw === 'string') {
    for (const line of eventsRaw.trim().split('\n').slice(-EVENTS_SHOWN)) {
      try {
        const row = JSON.parse(line) as Record<string, unknown>
        if (typeof row.atMs === 'number' && Number.isFinite(row.atMs)) {
          events.push({ atMs: row.atMs, kind: clean(row.kind, 20), text: clean(row.text) })
        }
      } catch {
        // one torn line (a writer mid-append) costs one row
      }
    }
  }
  return { readAtMs: nowMs, status, statusWhy, events }
}

const fact = (value: string | null | undefined, why = 'not reported'): string => value ?? `n/a (${why})`

/** The one text layer: the pane's narrow mode, the TUI and the model's console_state all draw this. */
export function summaryLines(snapshot: Snapshot | null): string[] {
  if (snapshot === null) return ['reading...']
  const why = snapshot.statusWhy || 'not reported'
  return [
    `build  ${fact(snapshot.status?.build, why)}`,
    `tests  ${fact(snapshot.status?.tests, why)}`,
    `task   ${fact(snapshot.status?.task, why)}`,
    '',
    ...(snapshot.events.length === 0 ? ['no events yet'] : snapshot.events.map(row => `${row.kind.padEnd(8)} ${row.text}`)),
  ]
}

/** The band: most urgent first, so a narrow terminal cuts the least useful part. Nothing to say is left out. */
export function bandText(snapshot: Snapshot | null, waiting: string | null): string {
  const parts = [
    waiting === null ? null : `waiting for a yes: ${waiting}`,
    snapshot?.status?.task ? `task ${snapshot.status.task}` : null,
    snapshot?.status?.tests ? `tests ${snapshot.status.tests}` : null,
  ].filter(part => part !== null)
  return parts.length === 0 ? 'quiet' : parts.join(' | ')
}
