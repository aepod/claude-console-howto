# Status (2026-11-07)

Done. Write-up of how ruflo-console works plus original, sanitized sketches for building one for any Claude Code project.

## Files
- `HOW-TO.md`: the guide (architecture, hooks, pane, band, status line, actions gate, model tools, TUI, settings, build order, traps, related technique: Text.js)
- `sketches/mod/`: function-hook plugin sketch. `claude plugin validate` passes (only an icon/author warning)
  - `.claude-plugin/plugin.json`, `hooks/hooks.json`, `README.md`
  - `hooks/register.tsx` (command, pane, band, observers, tool serving)
  - `hooks/read-model.ts` (bounded, sanitized reader; shared with the TUI)
  - `hooks/actions.ts` (fixed-argv table, pending card, TTL, verify)
  - `hooks/host.ts` (single place for `$` calls)
  - `hooks/model-tools.ts` (levels, per-turn cap, secret screen)
- `sketches/classic/`: `statusline.mjs`, `hook-handler.mjs`, `settings.fragment.json` (smoke-tested: status line prints, secret masked in events, `rm -rf /` blocked with exit 2)
- `sketches/tui/console-tui.mjs`: standalone read-only TUI (`--plain` smoke-tested with `node --experimental-strip-types`)

## Sanitization
No keys, tokens, auth files or personal file contents were read into or copied to this folder. No verbatim ruflo source: behavior described, code written fresh. Nothing committed; no CLAUDE.md or repo files touched; no `.bashrc`/`.env` touched. Nothing was added to the weftos repo.

## Caveats
- Studied versions: ruflo-console 0.49.13 (marketplace clone and newest cache) and 0.44.3 (the one enabled in user scope); Claude Code 2.1.319. The function-hooks API is early access and moves between releases.
- The mod sketch passes `validate` but was not loaded into a live session or run through `claude plugin test`. The TUI sketch imports the TS read model, which needs a Node that strips types (24.x here is fine).
- Read-only: I did not run `ruflo init`, did not change any plugin or settings.

## Updates
- 2026-11-08: added HOW-TO.md section 8 on [Text.js](https://textjs.org/) as a related console rendering technique (DevTools `console.log`, `text run`, `text mcp`). It does not replace the four-layer Claude Code design.
