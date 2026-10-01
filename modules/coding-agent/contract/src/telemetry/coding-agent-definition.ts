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
 * One agent, declaratively. Pure data and pure predicates — never reads or
 * writes state, exercised only through the engine. Registration is ordered
 * (`CODING_AGENT_REGISTRY`): the first definition whose `matches` returns true wins.
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
  extractToolNameFromSpanName?(spanName: string): string | null;

  /**
   * Span names this agent's session facts fold from. Names need not carry the
   * agent's namespace (codex's turn span is bare `session_task.turn`), so the
   * gate demands agent DETECTION too — Claude's self-namespaced names alone suffice.
   */
  sessionSpanNames?: readonly string[];

  /**
   * The session key off this agent's spans, for when the SHARED candidate
   * order reads the wrong attribute. Codex needs it: its turn span carries
   * the per-turn id under `gen_ai.conversation.id`, the session's under `thread.id`.
   */
  deriveSessionKeyFromSpan?(params: {
    name: string;
    attrs: Record<string, unknown>;
  }): string | null;

  /**
   * True when tool runs are reported only on LOG events (no tool span to fold
   * from), so the session fold counts them from `tool_result`. Codex is the
   * non-logsOnly case: its spans carry turn/token, its events the tools.
   */
  foldsToolRunsFromEvents?: boolean;

  /** Dispatch wrappers that re-enter the tool registry; exclude to avoid double-counting. */
  wrapperToolNames?: readonly string[];

  /** Logs without session id stamp are ambient process telemetry, not session activity. */
  logsRequireSessionKey?: boolean;

  /** Events-only telemetry: session fold gets model calls and tool runs from LOG events. */
  logsOnly?: boolean;
}
