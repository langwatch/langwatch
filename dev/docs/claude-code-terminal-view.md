# Claude Code "Terminal" view (prototype)

A Traces V2 drawer view that renders a coding-agent trace the way it looked
inside the Claude Code CLI: ANSI-coloured tool output, red/green code diffs,
prompt chrome, and a scrubber to travel through the session while the token and
cost totals tick up.

This doc covers what was built and how to wire it into the drawer. The
components are self-contained; nothing is wired in yet.

## Why

Claude Code traces carry `service.name=claude-code`, a `terminal.type`
(`xterm-256color`), `os.type`, and tool output (Bash `git`, test runners, build
tools) full of raw ANSI escape codes (`\x1b[32m…`). Today that renders as noise.
`terminal.type=xterm-256color` tells us it's true 256-colour ANSI, so we can
parse it into real colours (a readability win) and, for the recreation, show the
session as a terminal.

## Files

ANSI engine (pure, no new npm dependency — see "ANSI library" below):

- `langwatch/src/features/traces-v2/utils/ansi/ansi.ts` — SGR parser:
  `parseAnsi(str) → AnsiLine[]`, plus `stripAnsi`, `hasAnsi`, `xterm256ToHex`.
  Handles 16-colour, xterm-256, truecolor, bold/dim/italic/underline/inverse/
  strikethrough + resets; strips cursor/erase/OSC sequences and stray control
  bytes; collapses carriage-return overwrites. Never throws.
- `langwatch/src/features/traces-v2/utils/terminalOrigin.ts` —
  `isTerminalOrigin({ serviceName, origin, terminalType })` gating helper.

Presentational components (`langwatch/src/features/traces-v2/components/TraceDrawer/terminalView/`):

- `palette.ts` — maps ANSI colours onto **Chakra semantic/colour tokens**
  (`red.fg`, `green.solid`, …) so everything is theme-aware; only 256/truecolor
  codes fall back to their literal hex (no token equivalent exists).
- `AnsiText.tsx` — renders a raw string as selectable, theme-aware coloured
  monospace. Escape codes never reach the DOM, so selection copies clean text.
- `TerminalOutput.tsx` — one block of tool output on a terminal "screen", with a
  hover copy button and click-to-copy (copies the de-ANSI'd text). Mount only
  when the trace is terminal origin; it doesn't gate itself.
- `diff.ts` + `TerminalDiff.tsx` — line diff (`computeLineDiff`) rendered
  Claude-Code-style: removed lines red, added lines green, context dimmed, with
  line numbers and a `+N -M` stat.
- `terminalSession.ts` — `TerminalStep` type, `buildTimeline` (cumulative
  tokens/cost/elapsed per step), `toolPrimaryArg`, `isDiffTool`,
  `extractDiffFromToolInput`.
- `TerminalView.tsx` — the full recreation: window frame, `>` user prompts,
  assistant prose, `⏺ Tool(arg)` calls with `⎿` results, diffs for Edit/Write,
  and the timeline scrubber + token/cost HUD.
- `index.ts` — barrel.

Tests (all run under `pnpm test:unit`):
`ansi.unit.test.ts` (33), `terminalOrigin.unit.test.ts`, `diff.unit.test.ts`,
`terminalSession.unit.test.ts`, `TerminalOutput.unit.test.tsx`,
`TerminalView.unit.test.tsx`. The `.tsx` render tests are pure jsdom with plain
props (no boundary mocking), matching the existing traces-v2 `*.unit.test.tsx`
precedent (e.g. `TraceTable/__tests__/IOPreview.unit.test.tsx`).

## ANSI library

There is **no ANSI library in the repo** (`anser`, `ansi-to-html`, `fansi`, …
are all absent). Rather than add a dependency, the SGR parser is hand-rolled
(~230 lines, thoroughly tested). Recommendation: keep it hand-rolled — the
scope we need (SGR + strip-the-rest) is small and the parser has no runtime
deps. If we later need full terminal emulation (cursor addressing, scroll
regions, alt-screen) revisit `xterm.js`, but that's out of scope for read-only
trace rendering.

## How it integrates

The conversation view already builds turns from the trace's I/O payloads. Add a
"Terminal" mode to the coding-agent drawer alongside the existing
thread/bubbles/markdown modes, gated so it only appears for terminal-origin
traces.

1. **Gate the tab.** Show the Terminal mode only when
   `isTerminalOrigin({ serviceName, origin, terminalType })` is true —
   `serviceName`/`origin` are on `TraceListItem`; `terminalType` comes from the
   `terminal.type` span attribute (surface it in the drawer's trace context).

2. **Build `TerminalStep[]`.** Reuse the existing shapes — do not reinvent:
   - Turn content: for each turn's message payload, run
     `coerceToChatMessages(...)` then `groupMessagesIntoTurns(...)` (both from
     `../transcript`) to get `ConversationTurn[]` — the same path
     `ConversationTurnsList` uses. Each `ConversationTurn` is one step's `turn`.
   - Per-step metrics for the timeline come straight off the conversation's
     `TraceListItem`s (`timestamp`, `totalTokens`/`inputTokens`,
     `totalCost`, `models[0]`). Map one trace/turn → one `TerminalStep`.

   ```tsx
   const steps: TerminalStep[] = turns.map((t) => ({
     turn: /* ConversationTurn from groupMessagesIntoTurns(t) */,
     timestamp: t.timestamp,
     tokens: t.totalTokens,
     costUsd: t.totalCost,
     model: t.models[0],
   }));
   <TerminalView steps={steps} meta={{ terminalType, osType, cwd, model }} />
   ```

3. **Or render output inline.** `TerminalOutput` can also drop into the existing
   transcript tool cards to colour Bash/test output in place — mount it in place
   of the raw `<pre>` result body when `hasAnsi(resultText)` and the trace is
   terminal origin.

## Data it needs

- Trace/turn payloads (already loaded by the conversation view).
- `service.name`, `langwatch.origin`, and the `terminal.type` span attribute for
  gating + the window title.
- Per-turn `timestamp`, tokens, cost, model for the timeline HUD (all on
  `TraceListItem`).

For diffs, `TerminalView` synthesises the before/after from the Edit tool's
`old_string`/`new_string` (or Write's `content`) in the tool-call input — no
extra data needed.

## Follow-ups

- **Prefer span-level tool output** if/when the drawer exposes `tool.output`
  events per span — richer and avoids re-deriving output from message payloads.
- **Real diffs for Read+Edit**: today the diff is `old_string`→`new_string`
  only; pairing with the file's Read span would give full-file context lines.
- **Virtualize** the screen for very long sessions (mirror the conversation
  view's `useVirtualizer` threshold).
- **Timeline polish**: continuous time axis (currently step-indexed), per-step
  tick marks with relative-time labels, play/pause auto-advance.
- Consider promoting `utils/ansi/` to a shared location if non-traces surfaces
  (e.g. worker logs) want ANSI rendering too.
