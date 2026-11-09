# How to build a console like ruflo-console for any Claude Code project

Studied: `ruflo-console` 0.49.13 (the 0.44.3 cache copy has the same shape), `ruflo-mods`, the `ruflo-plugin-creator` mod template, a project's classic `.claude/helpers/` wiring, and Claude Code 2.1.319's plugin-authoring reference. Everything below is a description of the mechanism plus original sketches in `sketches/`. No ruflo source is copied.

## 1. What a "console" is here

ruflo-console is not one program. It is four layers that share one read model:

| Layer | What it is | Needs |
|---|---|---|
| **Mod** (the main thing) | A Claude Code plugin whose hooks are *functions* running inside Claude Code. It draws a **pane** beside the transcript, a **band** above the prompt, registers a **slash command**, and optionally gives Claude **tools** to drive it. | Claude Code with function hooks on |
| **Classic helpers** | Ordinary `settings.json` command hooks and a `statusLine` command (node scripts). Work on every Claude Code, with or without the mod. | Node, a few lines of settings |
| **Standalone TUI** | The same views in a terminal of its own, no Claude Code. Read-only. | Node |
| **Data files** | The project writes small status files; the console reads them. | The project |

The split that makes it work: **the project provides data, the plugin provides everything that draws, decides and asks.** The plugin never needs to know the project's internals, only the file shapes it reads.

## 2. What the project provides vs what the plugin provides

**Project provides**
- State files in a folder the console owns, for example `.my-console/status.json` (a snapshot) and `.my-console/events.jsonl` (an append-only log). Anything that can write JSON can feed it: a build script, a daemon, the classic hooks below.
- Optionally a table of fixed commands (the *actions*) the console may run.
- Settings: enable the plugin, and the classic wiring if you want the fallback.

**Plugin provides**
- Manifest, hooks module, read model, renderers, action gate, optional model tools, optional TUI.

ruflo's own convention is the same: each mod writes a small `status.json` (shape-checked, size-capped, `version: 1`) that the console lists; the console is a reader of other things' files.

## 3. The mechanism, piece by piece

### 3.1 Plugin layout (function-hook mod)

```
my-console/
  .claude-plugin/plugin.json     manifest: name, version, userConfig
  hooks/hooks.json               {"modules": ["./register.tsx"]}  one path
  hooks/register.tsx             export const register: Register = (on, options) => {...}
  hooks/*.ts                     plain modules the register file imports
  types/index.d.ts               (only if you keep values in $.state)
  README.md                      required by the plugin directory
```

Findings that are easy to get wrong:
- **No `commands/` folder.** A mod's slash command exists because `session.start` calls `$.command.register({name, description})` and a `command.run` hook answers it with `{ text }`. The ruflo console registers both `/ruflo` and `/ruflo-console` as one command.
- **The hooks module runs in its own environment: no DOM, no Node, no `require`, no `import()`.** Everything outside reaches it through the `$` object (`$.fs`, `$.process`, `$.clock`, `$.env`, `$.store`, `$.ui`, `$.tool`, `$.command`, `$.http`, `$.session`, `$.settings`). Files must be `.ts/.tsx/.js/...` and are ES modules.
- **`$` calls must be literal** (`$.env.get('NAME')`, not a computed name); `claude plugin validate` refuses computed ones and the mod then does not load. This is why ruflo-console funnels every `$` call into one `bindHost` function: the engine reads the calls off one place and the rest of the code is plain functions a test can fake.
- **Options** come from `userConfig` in the manifest (`string` with `options` = a picker, `number`, `boolean`). Users change them in the config menu or under `pluginConfigs` in settings; a change reloads the module.
- **Hot reload re-runs `register` and `session.start`.** Timers and module variables are dropped. Keep anything that must survive in `$.store` (across sessions) or `$.state` (the session's, needs a type contract).
- The mod only loads where **function hooks are on**: Claude Code ≥ 2.1.287 on by default; before that `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. Without them the plugin's command/skill/agent files still load, the hooks module does not. So build a classic fallback (3.6).

Sketch: `sketches/mod/` (validates with `claude plugin validate`).

### 3.2 The hook shape

Every hook is `($, e, next)`. `e` is the frozen event input. `next(e)` runs the plugins beneath and then the engine, resolving to the event's result. Return without `next` and you answered for yourself; `next({...e, x})` rewrites what the rest sees.

Events the console uses, and why:

| Event | Use |
|---|---|
| `session.start` | Bind the host, register the command and tools, start timers, first read, schedule the auto-open. |
| `command.run {command}` | The slash command: parse args into an intent, return `{text}`. |
| `ui.render {component:'Pane', requestId}` | Draw the pane. Pure: read state, return a tree. |
| `ui.render {component:'AbovePrompt'}` | Draw the band. Give way (`next(e)`) when `e.props.hasSurvey`. |
| `ui.press / ui.input / ui.scroll {component:'Pane'}` | Observe which element was pressed, or take over the wheel. |
| `tool.call` | *Observe* (count tool calls) or *serve your own tool names*. |
| `tool.check` | Observe permission verdicts (the console lists denied calls in an approvals queue); return the verdict untouched. |
| `turn.start / turn.complete` | Reset per-turn limits; record spend and timing. |
| `prompt.compose / prompt.submit` | Optionally add a context section or react to the prompt. |
| `session.end`, `ui.close` | Persist state, stop timers. |

Rules the validator enforces: a hook that can refuse something is written `on(...).catch(($, e, next) => next.called ? next(e) : {deny: 'why'})`. Answer **only your own tool names** in `tool.call`; a wider matcher would hijack the model's tools.

### 3.3 The pane

- Opened with `$.ui.open({id, title, focus})`, drawn by a `ui.render` hook matching `{component:'Pane', requestId:id}`. One pane per id.
- Placement is the engine's call. An *unasked* pane (auto-open) only seats where it can dock (about 144 columns and wider); otherwise `open` answers `{isPlaced:false, reason}` and the console tells the user in the band to type the command.
- **Auto-open from a timer, never from a render hook, and without `focus`**, so the prompt keeps the keys. `/cmd open` opens it with focus.
- **Every pane key also needs a slash subcommand**, because a key reaches the pane only while it holds focus. ruflo-console makes every key an intent in its `/ruflo` parser so the whole thing works unfocused (and so Claude can use it).
- Elements come from the surface's table: `const {Box, Text, Button, Input, Raster} = $.ui.resolve(e)`; `e.surface` is `terminal | desktop | vscode | mobile`. Below a narrow threshold draw text only (no controls that wrap). Use one `Raster` for any chart, never a `Box` per cell.
- Redraw with `$.ui.invalidate('ui.render')` after state changes. Frame cap and a "pane hidden = nothing animates" rule keep it cheap (ruflo: `fps` option 0..12, default 8; refresh 2..60 s, default 3).

### 3.4 The band above the prompt

A `ui.render {component:'AbovePrompt'}` hook returning one row. Design rules from ruflo's: parts ordered **most urgent first** so truncation drops the least useful; a part with nothing to say is omitted, not shown as zero; a click on a part opens the pane on that view; show "quiet" when idle. If the band is turned off, fall back to a segment on the status line.

### 3.5 Status line

Two routes:
1. **Classic `statusLine` command** in `settings.json`: Claude Code pipes session JSON (`model`, `workspace.current_dir`, `cost`, `context`) to stdin and shows stdout. Runs constantly: no network, no CLI on the hot path, a short file cache (ruflo's uses ~10 s) for anything slow, always exit 0, strip control characters from anything read from disk. Sketch: `sketches/classic/statusline.mjs`.
2. **Mod route**: `$.ui.status(text)` from any hook (`undefined` clears), or a segment contributed to another mod's status line.

The project-side wiring pattern is: `sh -c 'D="${CLAUDE_PROJECT_DIR:-.}"; [ -f "$D/.claude/helpers/x" ] || D="${HOME}"; exec node "$D/.claude/helpers/x"'` so a project-local helper wins and a home-level one is the fallback.

### 3.6 Classic hooks as the fallback and the data source

`settings.json` `hooks` run on `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SessionEnd`, `PreCompact`, `SubagentStart/Stop`, `Notification`, `Stop`. A project typically points them all at **one dispatcher** (`hook-handler.<ext> <command>`) so settings stay small and the logic lives in one file. Conventions:
- Event JSON arrives on **stdin**; read it with a short timeout (an unclosed stdin must not hang the session).
- Exit **0** passes, exit **2** blocks and feeds stderr to Claude. Everything else fails open: a broken helper must never stop the work.
- Stdout from `UserPromptSubmit`/`SessionStart` joins the model's context: print nothing unless it earns its tokens.
- **No double-firing:** when the mod is loaded it sets an env var on the Claude process (`$.env.set`, ruflo uses `RUFLO_MODS_OWNS=route,post-edit`) which every hook started afterwards inherits; the classic dispatcher exits 0 for commands the mod already owns. Sketch: `sketches/classic/hook-handler.mjs`, `settings.fragment.json`.
- This is also where the console's **data gets written**: the classic hooks append events to `events.jsonl`, masked.

### 3.7 The read model

Write it as plain functions over a tiny `ReaderFs {read, stat}` so the mod and the TUI share it (`sketches/mod/hooks/read-model.ts`). The rules ruflo-console follows, all worth copying:
- **Bounded:** refuse files over a size cap (2 MB here; a busy project's state file can reach tens of MB), cache by mtime so unchanged files are not re-read, back off on missing files.
- **Untrusted:** another process wrote it. Clamp numbers (no `Infinity`, no negative counts, times inside `Date`'s range), look up record keys as *own* keys only, and strip control/bidi characters from every string before drawing. One torn JSONL line costs one row.
- **Honest:** a fact nobody measured is `null` and is drawn `n/a (why)`. Never zero.
- **A fixed read list.** Key material is never named, so it can never be read. ruflo-console explicitly lists key files as never-read.
- **No model sees it** unless the user asks Claude through an explicit action.

### 3.8 Actions: how the console changes anything

One table of **fixed argv** (never a shell string, never a command read from a project file). A *read* runs at once. Anything else:
1. raises exactly one **pending card** with an `Effect:` line,
2. waits for an explicit yes bound to **that card's number** (a card replaced meanwhile runs nothing),
3. expires (30 s in ruflo),
4. runs with a timeout,
5. then **verifies** that it took (exit 0 is not proof), by re-reading the files.

Install-class, spend and delete actions sit behind higher control levels. Sketch: `sketches/mod/hooks/actions.ts`.

### 3.9 Letting Claude drive it (model tools)

`$.tool.register({name, description, inputSchema, isDeferred})` declares a tool, listed as `mcp__<plugin>__<name>` (ruflo: `console_state`, `console_open`, `console_set`, `console_run`). You serve it with a `tool.call` hook whose matcher is exactly that name. A tool nothing serves fails saying so. Design choices that make this safe, all from ruflo's ADR-444 line of work:
- **The level is the user's setting**: `off | read | write | manage | full`, and `off` declares no tools. A separate `ask | auto` decides whether a non-read action waits for the person. An env override (`MY_CONSOLE_CONTROL=read:ask`) may only *lower* the saved level, so a project's settings cannot raise Claude's power.
- **Same surface, no private path.** Claude reads the same text a person sees (`console_state`) and goes through the same gate (`console_run`).
  Text.js’s `text mcp` is the same idea in a different host; see section 8.
- **Screen text is data.** Say so in the tool description and the result (federation peers, files and the web can write what's on screen).
- **Per-turn call cap** (40 in ruflo; reset on `turn.start`), a visible "take back control" button, and a control log.
- **Secret screen** on any text Claude passes in: refuse and *don't echo what matched*.
- A spawned `drive.sh`-style harness runs the console through its own tools from a throwaway config dir with a hard budget cap, for CI.
Sketch: `sketches/mod/hooks/model-tools.ts`.

### 3.10 The standalone TUI

Same views, own terminal, no Claude Code. ruflo ships it as `ruflo tui` (five pages plus an AI page), bundled with esbuild to one file. Properties to keep: it is built over the same `Host` interface with a Node-backed adapter; **read-only by construction** (reads confined to the project and config dirs after symlink resolution; the only program that may run is the project's own CLI, by argv, no shell); `--plain` prints one frame and exits 0 for scripts and CI; no terminal and no `--plain` is a usage error (exit 2); always restore the terminal on exit. Sketch: `sketches/tui/console-tui.mjs`.

For another renderer that can show the same read model outside Claude Code — including in DevTools via `console.log` and to agents over MCP — see section 8.

### 3.11 Settings keys that matter

User or project `settings.json`:
- `enabledPlugins`: `{"my-console@my-marketplace": true}`
- `extraKnownMarketplaces`: where to find it (or `claude plugin marketplace add <owner/repo|folder>`)
- `pluginConfigs["my-console@my-marketplace"].options`: the `userConfig` values
- `statusLine`: the classic command
- `hooks`: the classic dispatcher
- `env`: e.g. `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` on builds before it was default

Install flow for others: marketplace repo with `.claude-plugin/marketplace.json` (`plugins: [{name, source: "./plugins/my-console", description}]`) then `/plugin install my-console --marketplace owner/repo`, or `claude plugin install`. For local dogfooding use `claude --plugin-dir <folder>` (hot-reloaded) or a directory marketplace.

## 4. Build order (what to do, in order)

1. **Decide the data contract.** Two files: `status.json` (snapshot, small, versioned) and `events.jsonl` (append-only, masked). Write one producer, even a shell script.
2. **Classic first.** Statusline script + a dispatcher that appends events. This already gives value on every Claude Code and is the fallback.
3. **Read model** as plain functions with the bounds in 3.7. Unit test it with a fake `ReaderFs`.
4. **Manifest + `register.tsx`**: `session.start` (bind host, register command, timers), `command.run`, then the `Pane` render, then the `AbovePrompt` band.
5. **Action table + gate** (3.8). Start with reads only.
6. **Model tools** (3.9), default `off`. Add `read`, then `write`.
7. **TUI** over the same read model.
8. **Validate, test, ship:** `claude plugin validate <dir>`, `tsc -p <dir>` with the engine-written types, `claude plugin test <dir>` (`claude-code/testing` gives `$.ui.mount` to render the pane on all four surfaces), `claude --debug` while developing, then `/reload-plugins`. Add a README (the directory refuses a plugin without one) and an icon.

## 5. Traps (each one is a real constraint, not a style point)

- Computed `$` names or feature-detecting a noun: validation refuses, the whole mod doesn't load. Wrap optional nouns in an `async` call whose rejection the caller catches.
- Calling things that wait on the turn (`submitPrompt`, `$.tool.call`) from inside a `command.run` hook: run them from a clock tick instead.
- Drawing from a render hook with side effects (opening panes, timers): do it from a timer.
- A click can arrive after its drawing was replaced (a resize). The press handler must tolerate "no handler found" quietly.
- Values kept in module variables vanish on reload; the next code version meets the old stored values, so tag stored shapes (`shape: 'calls-1'`) and let the engine decline stale ones.
- Anything that can be *refused* (policy, an administrator): every host member may reject. Catch at the edge so a refusal is a missing fact, not a crash.
- Don't let a status/band feature touch the network by default. ruflo's one self-initiated call is a daily read of its own published `plugin.json`, with an `ask | auto | off` setting; federation lookups are off unless enabled.
- Mods are unsigned and can run host commands. ruflo-mods has an optional trust gate (`observe` default, `refuse-risky` with an allow-list set only in user/managed settings, never project settings). If you ship a mod that spawns processes, expect that scrutiny.
- Persisted history should be masked before it's written (credentials, home-directory user names, control characters) and be switchable off.

## 6. What ruflo-console adds on top (don't copy unless you need it)

About 100 view/data modules: swarm topology, claims flow with TTL rings, federation map, plugin health matrix, MetaHarness radar, memory/cost gauges, agent timeline, an events/timeline store, a session "Room" that lists sessions on the machine with a Needs-you queue, ADR management for the host project, a command palette of ~460 confirm-gated entries (catalog JSON shipped with the plugin), mission/loop controllers, three looks (bbs, plain, orbital), and a boot animation. All of it is the same four ideas: **files in, bounded reader, pure draw, gated action.**

## 7. Files in this folder

See `STATUS.md`. Every sketch here is original, marked SKETCH, and uses only generic names (`.my-console/`, `my-console`).

## 8. Related technique: Text.js

[Text.js](https://textjs.org/) is a console framework for full-stack React 19 apps that render inside `console.log`. It is not a Claude Code plugin and it does not replace the four layers above. It is another way to draw the same kind of console, and it is worth knowing about when you pick a renderer for the standalone TUI or for an agent-readable view.

### What it does

A commit that changes the tree goes through a custom React reconciler, then Yoga lays out boxes on whole cells. A cell buffer repaints only damaged rows. A dirty gate drops unchanged frames so they never reach the console. Surviving frames are run-length encoded (they measure a 100×32 dashboard, 3,200 cells, as about 149 `%c` spans) and emitted as one `console.log` call, no faster than every 66 ms. Frames are appended rather than `clear()` plus `log()`: clearing first leaves the panel blank until DevTools paints again (about 70% blank vs about 1% when appending).

The same App Router app also runs:

- in a real terminal (`text run`) as truecolor ANSI, with route handlers in-process
- over MCP (`text mcp`), where an agent navigates routes, presses keys, and reads each frame as plain text
- optionally on the server (`export const runtime = "server"`), so the browser loads a ~21 kB gzip frame player instead of the app

It also has keyboard, paste and IME input, an App Router with back/forward and deep links, testing via `lastFrame()`, and deploy adapters (`static`, `bun`, `vercel`, `cloudflare`).

### How it lines up with this console

The idea that matters here is the same one in 3.9 and 3.10: **one read model, several hosts, no private path for the agent.** `text mcp` is a packaged form of `console_state`: the agent sees the frame a person would see. `text run` is another standalone TUI host, in the same role as `sketches/tui/`.

What Text.js does *not* cover, and what you should still build as in sections 3–5:

- Claude Code function hooks, the pane, the band, the slash command
- the `$` host (no DOM, no Node, no computed `$.…` names)
- the pending-card action gate and the control-level tools
- the project data contract (`status.json` / `events.jsonl`) and the bounded untrusted reader

The function-hook module cannot host Text.js. The hooks environment has no React, no Yoga, no `console.log` render loop, and no dynamic imports. Putting Text.js inside `register.tsx` would fail validation and would not load.

Where it *can* fit:

- **Standalone / browser view.** A Text.js app that reads the same `status.json` and `events.jsonl` (through the same bounded reader) and draws them in DevTools or with `text run`. This is an alternative to the Node TUI sketch, not a replacement for the mod.
- **Agent frames.** `text mcp` can expose that view to coding agents the same way `console_state` exposes pane text to Claude. Keep the action gate on this side: the MCP surface should read frames and send the same fixed-argv intents, not grow a second command path.
- **Cost model.** Section 3.3 already says to use one `Raster` for a chart, never a `Box` per cell. Text.js’s dirty cell buffer and unchanged-frame gate are that rule taken all the way to paint.

Do not copy ruflo-console’s ~100 views into a Text.js app any more than you would copy them into a new mod. If you use Text.js, feed it the small status files and draw the thin instance console (sessions, needs-you, gated send) — the same four ideas: files in, bounded reader, pure draw, gated action.
