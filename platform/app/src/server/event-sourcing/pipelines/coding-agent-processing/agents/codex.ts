import { type CodingAgentDefinition, signalSays } from "./_types";

/**
 * Codex. Uses whatever `service_name` it was configured with — there is no
 * stable scope string — so the record NAME (`codex.*`) is the signal for
 * events and metrics, and the scope/service (`codex_exec` on 0.147) backs the
 * bare-named turn span below.
 *
 * Codex splits its `[otel]` exporters by signal: `trace_exporter` posts spans
 * to /v1/traces, `exporter` posts EVENTS as log records to /v1/logs (both off
 * by default; the CLI's config block enables both). What each carries, from
 * codex-rs 0.147 and live capture:
 *
 *   - `session_task.turn` span: the turn's token totals (`gen_ai.usage.*`,
 *     where input INCLUDES the cache buckets), the model, and the session key
 *     (`gen_ai.conversation.id`). This is the model-call carrier.
 *   - `handle_responses` span: repeats the token counts and stamps a tokio
 *     `thread.id` (sometimes literally "10") that would poison the session
 *     key resolution — never gate it in.
 *   - Events: every record carries `conversation.id`, `app.version`,
 *     `terminal.type`, `user.account_id`. `codex.tool_result` is the tool-run
 *     carrier (tool_name / duration_ms / success); there is no tool span, so
 *     tool runs fold from events. `codex.sandbox_outcome` fires IN ADDITION
 *     to `tool_result` for a sandboxed shell command, so aliasing it onto
 *     tool_result would count that command twice — it maps to nothing.
 *   - Code mode wraps the real tools: the model calls `exec` with a SCRIPT,
 *     and each `tools.exec_command(...)` inside re-enters the registry as
 *     its own dispatch with a minted `exec-<uuid>` call id — both layers log
 *     a `tool_result`, so the `exec` wrapper is declared plumbing below and
 *     the inner per-command events are what count.
 *   - `codex.turn_ttft` carries the turn's time to first token.
 *   - The `codex_otel.log_only` scope emits records OUTSIDE any session (an
 *     `api_request` for an auth refresh, with no `conversation.id`); keying
 *     those on their trace would mint empty one-record sessions, so codex
 *     requires the provider session key on its log contributions.
 *
 * Has no lines-of-code and no cost metric at all; its cost must be priced
 * from tokens, so there is nothing more to map here.
 */
export const codexAgent: CodingAgentDefinition = {
  id: "codex",
  matches: (signal) => signalSays(signal, "codex"),
  namePrefixes: ["codex."],

  sessionSpanNames: ["session_task.turn"],
  foldsToolRunsFromEvents: true,
  wrapperToolNames: ["exec"],
  logsRequireSessionKey: true,

  // The turn span carries TWO ids, live-verified on 0.147: `thread.id` is
  // the session (equal to the `conversation.id` every codex log event
  // carries), while `gen_ai.conversation.id` is the id of the TURN — the
  // shared candidate order would read the latter and split each turn into
  // its own session. Guarded to UUID-shaped values because codex's OTHER
  // spans stamp the tokio worker id ("10") under the same key; those spans
  // are not gated in, but the guard keeps this hook safe if one ever is.
  sessionKeyFromSpan: ({ name, attrs }) => {
    if (name !== "session_task.turn") return null;
    const threadId = attrs["thread.id"];
    return typeof threadId === "string" && threadId.includes("-") ? threadId : null;
  },

  eventAliases: {
    // Codex reports TTFT as its own event rather than a span attribute.
    turn_ttft: "turn_ttft",
  },

  metricAliases: {
    // Codex spells its token metric differently, and reports it per turn.
    "turn.token_usage": "token_usage",
  },
};
