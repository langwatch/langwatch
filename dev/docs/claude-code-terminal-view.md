# Claude Code "Terminal" view

A Traces V2 drawer tab that replays a coding-agent turn the way it looked inside
the Claude Code CLI: ANSI-coloured tool output, red/green code diffs, and a
scrubber to travel through the session while token and cost totals tick up.

## The data model (verified)

Source of truth: <https://code.claude.com/docs/en/monitoring-usage>. Claude Code
emits three signals; we consume all three.

### Spans (`CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` + `OTEL_TRACES_EXPORTER=otlp`)

```
claude_code.interaction        (root — carries user_prompt, interaction.sequence)
├── claude_code.llm_request    (one per model call)
└── claude_code.tool           (one per tool call)
    ├── claude_code.tool.blocked_on_user   (decision, source)
    └── claude_code.tool.execution         (success, error)
```

`llm_request` carries `request_id`, `model`, `input_tokens`, `output_tokens`,
`cache_read_tokens`, `ttft_ms`, `stop_reason`, `response.has_tool_call`, and
`agent_id` / `parent_agent_id` for the sub-agent tree. **It carries no message
content and no cost.** `claude_code.tool` carries `tool_name`, `tool_use_id`,
`file_path`, `full_command`, `result_tokens`, and — when `OTEL_LOG_TOOL_CONTENT=1`
— a `tool.output` span EVENT holding the tool's real input and output bodies.

### Log events — each with its OWN content key

There is **no shared `body` convention**. This bit us: enrichment read `body` for
everything, so on the light path spans came back with no input and no output,
silently (fixed; regression-pinned in `trace-service-claude-enrichment.unit.test.ts`).

| event | content key | gate |
|---|---|---|
| `user_prompt` | `prompt` | `OTEL_LOG_USER_PROMPTS` |
| `assistant_response` | `response` | `OTEL_LOG_ASSISTANT_RESPONSES` (falls back to the above) |
| `api_request_body` / `api_response_body` | `body` | `OTEL_LOG_RAW_API_BODIES` |
| `api_request` | — (`cost_usd`, `request_id`) | always |
| `tool_result` / `tool_decision` | `tool_input`, `tool_parameters` | `OTEL_LOG_TOOL_DETAILS` |

Every event also carries **`prompt.id`** (a UUID linking all events from one user
prompt) and **`event.sequence`** (monotonic per session).

## How the pieces fit

Claude's spans have the structure but no content; the logs have the content but
no span ids. `enrichCodingAgentSpansFromLogs`
(`src/server/app-layer/traces/claude-code-log-enrichment.ts`) joins them at read
time and is called by BOTH read paths — `tracesV2.spansFull` (the drawer) and the
legacy `TraceService` (REST, exports, evals). Joins:

- **output**, **cost** — exact, by `request_id`.
- **input** — positional today (Nth span ↔ Nth `api_request_body` within a
  `query_source`), because the request body carries no `request_id`. See
  follow-ups: `prompt.id` + `event.sequence` can make this exact.

The join runs **before** protections, so joined content goes through the same
PII/redaction pass as any other span content.

## The view

`TerminalTab` (its own drawer tab, next to Conversation — gated on
`isTerminalOrigin`) reads `tracesV2.spansFull` and rebuilds the session with
`buildTerminalStepsFromSpans`.

Why spans and not the trace summary: a Claude Code turn is an agentic **loop** —
model → tool → model → tool → answer. The trace summary only ever holds the
opening prompt and the closing reply, so rendering from it loses every tool call.
Each model call carries the *rolling* history, so the final `llm_request` span's
input already contains the whole turn (prompt, every `tool_use`, every
`tool_result`); appending its own reply completes the transcript. Metrics are
summed across all the calls — the turn cost is the whole loop.

`TerminalView` deliberately has **no window chrome** — no frame, no traffic
lights, no title bar. Claude Code doesn't draw those; it prints into the terminal
you already have, and its whole hierarchy rides on four glyphs at one monospace
size: `❯` prompt, `⏺` call/message, `⎿` result, `✻` thinking. Chrome around it
makes it read as a screenshot of a terminal rather than as the session.

Components (`langwatch/src/features/traces-v2/components/TraceDrawer/terminalView/`):
`TerminalTab` (data boundary) · `TerminalView` (the screen + status line) ·
`buildStepsFromSpans` (spans → steps) · `TerminalOutput` (ANSI tool output,
click-to-copy) · `TerminalDiff` + `diff.ts` · `terminalSession.ts` (timeline,
tool-arg + diff extraction) · `palette.ts` (ANSI → Chakra semantic tokens) ·
`AnsiText`. ANSI parsing is hand-rolled in `utils/ansi/` (no dependency added).

## Follow-ups

- **Exact input join.** Use `prompt.id` + `event.sequence` instead of positional
  pairing; removes the documented "two concurrent sub-agents sharing a
  `query_source` can cross their inputs" caveat.
- **Tool spans + `tool.output` events.** We set `OTEL_LOG_TOOL_CONTENT=1` and read
  neither. They carry the tool's real I/O and are richer than re-deriving it from
  the message history. `tool_result` log events (`duration_ms`, `success`) are
  ingested and read by nothing either.
- **Sub-agent tree.** `agent_id` / `parent_agent_id` are on the spans and lifted
  into no DTO, so sub-agents can't be told apart in the UI.
- **Per-turn spans in the conversation view** — same model as the Terminal tab,
  so a turn row can expand into the loop it actually ran.
- **Virtualize** the screen for very long sessions.
