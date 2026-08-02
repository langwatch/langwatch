/**
 * Agent Definition Types
 *
 * The coding-agent pipeline knows each agent through one pure, declarative
 * definition (see the sibling files) registered in `./index.ts` — the same
 * registration shape the trace canonicalisation extractors use. The engine in
 * `../services/coding-agent-normalization.ts` folds the registry into the
 * shared vocabulary; nothing outside `agents/` compares vendor literals.
 */

/** The agents we can name. `unknown` is not a failure — it is an honest answer. */
export type CodingAgent =
  | "claude_code"
  | "claude_cowork"
  | "opencode"
  | "codex"
  | "gemini_cli"
  | "copilot"
  | "unknown";

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
  | "session_idle"
  | "session_error"
  | "subtask_invoked"
  | "commit";

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
export type TokenType =
  | "input"
  | "output"
  | "cache_read"
  | "cache_creation"
  | "reasoning";

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
   * True when the agent's telemetry is events-only (no spans): the session
   * fold then folds model calls and tool runs from its LOG events.
   *
   * This is the double-count gate, and it is ENFORCED on both sides —
   * `applyLogToCodingAgentSession` folds those facts only for a logs-only
   * agent, and `applySpanToCodingAgentSession` skips them only for one. It
   * cannot be a rule about what an agent is allowed to emit: an agent with
   * this flag may still export the equivalent spans (Cowork does, behind its
   * beta trace-export flag), and the pipeline accepts them for their identity.
   */
  logsOnly?: boolean;
}
