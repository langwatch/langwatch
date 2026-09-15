import { z } from "zod";

// Declarative agent definitions registered in index.ts; normalization engine
// folds them into shared vocabulary; nothing outside agents/ uses vendor literals.

/** The agents we can name. `unknown` is not a failure — it is an honest answer. */
export const codingAgentSchema = z.enum([
  "claude_code",
  "claude_cowork",
  "opencode",
  "codex",
  "gemini_cli",
  "copilot",
  "unknown",
]);

export type CodingAgent = z.infer<typeof codingAgentSchema>;

/**
 * The canonical event kinds. Every agent's event name maps onto one of these, or
 * onto nothing (which is fine — an event we have no use for costs one lookup).
 */
export type CodingAgentEvent =
  | "user_prompt"
  | "assistant_response"
  | "api_request"
  | "api_response"
  | "api_error"
  | "api_refusal"
  | "retries_exhausted"
  | "rate_limit"
  | "tool_result"
  | "tool_decision"
  | "compaction"
  | "permission_mode_changed"
  | "skill_activated"
  | "mcp_server_connection"
  | "hook_execution_complete"
  | "at_mention"
  | "internal_error"
  | "session_created"
  /**
   * The LangWatch companion event: the session's repository, branch and
   * worktree identity, which no agent exports on its own telemetry.
   */
  | "session_context"
  | "session_idle"
  | "session_error"
  | "subtask_invoked"
  | "commit"
  /**
   * Time to first token, reported as its own event. Codex is the only agent
   * that spells TTFT this way (`codex.turn_ttft` with a `duration_ms`);
   * Claude Code carries it as an attribute on its llm_request span instead.
   */
  | "turn_ttft";

/** The canonical metric kinds, same idea as the event kinds. */
export type CodingAgentMetric =
  | "tool_call"
  | "lines_of_code"
  | "commit"
  | "pull_request"
  | "edit_decision"
  | "active_time"
  | "token_usage"
  | "cost_usage";

/**
 * Token buckets. Every agent spells these differently, and the distinction
 * that actually costs money (a cache READ is cheap, a cache WRITE costs more
 * than fresh input) is spelled differently by every one of them.
 */
export type TokenType = "input" | "output" | "cache_read" | "cache_creation" | "reasoning";

/**
 * The identity signal for one record, pre-lowercased by the engine so every
 * definition matches on the same normalized strings.
 */
export interface CodingAgentSignal {
  /** A span name, metric name, or event name — whichever we have. */
  name: string;
  /** Instrumentation scope name. */
  scope: string;
  /** Resource-level service.name. */
  service: string;
}

/**
 * Does any of the three signals say this needle? The shared match primitive:
 * a namespaced record name (`<needle>.`), or a scope / service that mentions
 * the needle anywhere.
 */
export function signalSays(signal: CodingAgentSignal, needle: string): boolean {
  return (
    signal.name.startsWith(`${needle}.`) ||
    signal.scope.includes(needle) ||
    signal.service.includes(needle)
  );
}

/**
 * One agent, declaratively. Pure data and pure predicates — a definition
 * never reads state, never writes, and is exercised only through the engine.
 *
 * Registration is ordered (see `CODING_AGENT_REGISTRY`): the first definition
 * whose `matches` returns true names the record.
 */
export interface CodingAgentDefinition {
  id: Exclude<CodingAgent, "unknown">;

  /** Identity predicate over the pre-lowercased signal. */
  matches(signal: CodingAgentSignal): boolean;

  /**
   * Name namespaces this agent prefixes onto its event/metric names, stripped
   * before vocabulary matching. Longest-first where one contains another.
   */
  namePrefixes: readonly string[];

  /**
   * Vendor-specific event-name aliases (post-strip, dot-flattened) beyond the
   * standard vocabulary the engine owns.
   */
  eventAliases?: Readonly<Record<string, CodingAgentEvent>>;

  /** Vendor-specific metric aliases beyond the standard vocabulary. */
  metricAliases?: Readonly<Record<string, CodingAgentMetric>>;

  /**
   * If the agent encodes the tool name in its SPAN NAME rather than an
   * attribute, this resolves it; return null when the span is not a tool span.
   */
  toolNameFromSpanName?(spanName: string): string | null;

  /**
   * Span names this agent's session facts fold from, joined into the span
   * dispatcher's gate. Names here need not carry the agent's namespace
   * (codex's turn span is a bare `session_task.turn`), so the gate demands
   * agent DETECTION on top of membership for them — a foreign span that
   * happens to reuse the name is declined, where Claude's self-namespaced
   * names are admitted on the name alone.
   */
  sessionSpanNames?: readonly string[];

  /**
   * The session key off one of this agent's spans, when the SHARED candidate
   * order reads the wrong attribute for it. Codex is the reason this exists:
   * its turn span carries the per-turn id under `gen_ai.conversation.id` and
   * the SESSION's id under `thread.id`, so the shared order would split every
   * turn into its own session. Return null to fall back to the shared
   * resolution; never return a value that is not this agent's session id.
   */
  sessionKeyFromSpan?(params: { name: string; attrs: Record<string, unknown> }): string | null;

  /**
   * True when the agent's tool runs are reported only on its LOG events
   * (there is no tool span to fold from), so the session fold counts them
   * from `tool_result`. Implied by `logsOnly`. Codex is the non-logsOnly
   * case: its spans carry the turn and token story, its events the tools.
   */
  foldsToolRunsFromEvents?: boolean;

  /** Dispatch wrappers that re-enter the tool registry; exclude to avoid double-counting. */
  wrapperToolNames?: readonly string[];

  /** Logs without session id stamp are ambient process telemetry, not session activity. */
  logsRequireSessionKey?: boolean;

  /** Events-only telemetry: session fold gets model calls and tool runs from LOG events. */
  logsOnly?: boolean;
}
