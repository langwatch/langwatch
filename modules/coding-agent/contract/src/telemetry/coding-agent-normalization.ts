// One vocabulary for all coding agents; folds registry definitions into
// shared detection, prefix-stripping and alias tables; downstream code never
// compares vendor literals.

import type {
  CodingAgent,
  CodingAgentEvent,
  CodingAgentMetric,
  CodingAgentSignal,
  TokenType,
} from "./coding-agent-definition.ts";
import { CODING_AGENT_REGISTRY } from "./index.ts";

/** Detect agent from record name (reliable signal), not scope (varies by vendor). */
export function detectCodingAgent({
  scopeName,
  recordName,
  serviceName,
}: {
  scopeName?: string | null;
  /** A span name, metric name, or event name — whichever we have. */
  recordName?: string | null;
  serviceName?: string | null;
}): CodingAgent {
  const signal: CodingAgentSignal = {
    name: (recordName ?? "").toLowerCase(),
    scope: (scopeName ?? "").toLowerCase(),
    service: (serviceName ?? "").toLowerCase(),
  };

  for (const agent of CODING_AGENT_REGISTRY) {
    if (agent.matches(signal)) return agent.id;
  }
  return "unknown";
}

/** The sole session key every agent agrees on; varies by vendor under four different names. */
export function deriveConversationKey(attrs: Record<string, unknown>): string | null {
  const candidates = ["session.id", "conversation.id", "gen_ai.conversation.id", "thread.id"];
  for (const key of candidates) {
    const value = attrs[key];
    if (typeof value === "string" && value.length > 0) return value;
    // The span-store read-back deserializes purely numeric attribute strings
    // as numbers, so an agent whose session key is all digits must resolve
    // to the same key on both the inline and the claim-check path.
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

/**
 * The conversation key off one SPAN's attributes: the detected agent's own
 * `deriveSessionKeyFromSpan` hook first, the shared candidate order otherwise. Log and metric
 * callers instead keep {@link deriveConversationKey} — no agent's events need the override.
 */
export function deriveSpanConversationKey({
  agent,
  name,
  attrs,
}: {
  agent: CodingAgent;
  name: string;
  attrs: Record<string, unknown>;
}): string | null {
  const definition = CODING_AGENT_REGISTRY.find((candidate) => candidate.id === agent);
  return definition?.deriveSessionKeyFromSpan?.({ name, attrs }) ?? deriveConversationKey(attrs);
}

/**
 * The canonical event, from whatever the agent called it. Some agents namespace their event
 * names (`claude_code.tool_result`, `codex.tool_result`) and some don't (opencode emits a
 * bare `tool_result`), so the prefix is stripped before matching rather than enumerated.
 */
export function normalizeEventName(
  rawEventName: string | null | undefined,
): CodingAgentEvent | null {
  if (!rawEventName) return null;

  // Strip a leading `<agent>.` namespace, if any. opencode sends none.
  const bare = stripAgentPrefix(rawEventName);

  // opencode dots its session events (`session.created`); the canonical form
  // underscores them, so both spellings land on the same fact.
  const canonical = bare.replace(/\./g, "_");

  return EVENT_ALIASES[canonical] ?? null;
}

/**
 * The canonical vocabulary every agent shares: identity mappings for the canonical names
 * themselves, plus spellings not attributable to a single vendor. Vendor-specific aliases
 * live on the agent definitions and are merged in below.
 */
const BASE_EVENT_ALIASES: Readonly<Record<string, CodingAgentEvent>> = {
  user_prompt: "user_prompt",
  assistant_response: "assistant_response",
  api_request: "api_request",
  // Gemini's completion event; carries the reply text (`response_text`) when
  // prompt logging is on. Claude splits the same fact into api_request (the
  // cost anchor) and api_response_body (the raw payload), so its second half
  // lands here too: one canonical "the model answered" fact, two carriers.
  api_response: "api_response",
  api_response_body: "api_response",
  api_error: "api_error",
  api_refusal: "api_refusal",
  refusal: "api_refusal",
  api_retries_exhausted: "retries_exhausted",
  retries_exhausted: "retries_exhausted",
  // Claude's two rate-limit carriers: `rate_limit_event` fires on a limit
  // actually engaging, `rate_limit_info` on status/warning updates. Both are
  // the agent SAYING it was throttled, as opposed to the 429-inferred
  // `rateLimited` counter, so they land on one canonical fact.
  rate_limit: "rate_limit",
  rate_limit_event: "rate_limit",
  rate_limit_info: "rate_limit",
  tool_result: "tool_result",
  tool_decision: "tool_decision",
  compaction: "compaction",
  permission_mode_changed: "permission_mode_changed",
  skill_activated: "skill_activated",
  mcp_server_connection: "mcp_server_connection",
  hook_execution_complete: "hook_execution_complete",
  at_mention: "at_mention",
  internal_error: "internal_error",
  session_created: "session_created",
  // The LangWatch companion event. It arrives fully qualified
  // (`langwatch.session_context`), and `langwatch.` is nobody's agent prefix,
  // so the dot-flattened spelling is what the lookup sees; the bare form maps
  // too, for an emitter that drops the namespace.
  session_context: "session_context",
  langwatch_session_context: "session_context",
  session_idle: "session_idle",
  session_error: "session_error",
  subtask_invoked: "subtask_invoked",
  commit: "commit",
  conversation_finished: "session_idle",
  slash_command: "user_prompt",
};

/**
 * The canonical metric, from whatever the agent called it. The agent prefix is the only
 * difference for the metrics we care about (`claude_code.lines_of_code.count` vs
 * `opencode.lines_of_code.count`), so it's stripped and the remainder matched.
 */
export function normalizeMetricName(
  rawMetricName: string | null | undefined,
): CodingAgentMetric | null {
  if (!rawMetricName) return null;
  return METRIC_ALIASES[stripAgentPrefix(rawMetricName)] ?? null;
}

const BASE_METRIC_ALIASES: Readonly<Record<string, CodingAgentMetric>> = {
  "lines_of_code.count": "lines_of_code",
  "commit.count": "commit",
  "pull_request.count": "pull_request",
  "code_edit_tool.decision": "edit_decision",
  "active_time.total": "active_time",
  "token.usage": "token_usage",
  "cost.usage": "cost_usage",
  "tool.call.count": "tool_call",
};

/**
 * Base table + every registered agent's aliases, collisions rejected.
 * Exported for the unit suite, which proves the collision guard fires.
 */
export function mergeAliasTables<Value>(
  base: Readonly<Record<string, Value>>,
  perAgent: readonly (Readonly<Record<string, Value>> | undefined)[],
): Readonly<Record<string, Value>> {
  const merged: Record<string, Value> = { ...base };
  for (const table of perAgent) {
    if (!table) continue;
    for (const [alias, canonical] of Object.entries(table)) {
      if (alias in merged && merged[alias] !== canonical) {
        // Module-load failure on a genuine conflict: two agents (or an agent
        // and the base vocabulary) disagreeing on one spelling is a wiring
        // bug, not a runtime condition.
        throw new Error(
          `Conflicting coding-agent alias "${alias}": ${String(merged[alias])} vs ${String(canonical)}`,
        );
      }
      merged[alias] = canonical;
    }
  }
  return Object.freeze(merged);
}

const EVENT_ALIASES = mergeAliasTables(
  BASE_EVENT_ALIASES,
  CODING_AGENT_REGISTRY.map((agent) => agent.eventAliases),
);

const METRIC_ALIASES = mergeAliasTables(
  BASE_METRIC_ALIASES,
  CODING_AGENT_REGISTRY.map((agent) => agent.metricAliases),
);

/**
 * Is this metric from a coding agent at all? Checks across every registered agent, not just
 * Claude's own prefix, so opencode and Codex metrics aren't dropped at the gate.
 */
export function isCodingAgentMetricName(metricName: string): boolean {
  return (
    detectCodingAgent({ recordName: metricName }) !== "unknown" &&
    normalizeMetricName(metricName) !== null
  );
}

/** Scalar vocabulary for log contributions; content stays in the canonical row. */
export const CODING_AGENT_CONTRIBUTION_KEYS: readonly string[] = [
  "event.name",
  "session.id",
  // The LangWatch companion event's vocabulary: the agent it declares itself
  // to be, and the repository / branch / worktree the session ran against.
  // Operational identity, not conversation content.
  "coding_agent.name",
  "vcs.repository.host",
  "vcs.repository.owner",
  "vcs.repository.name",
  "vcs.ref.head.name",
  "vcs.worktree.name",
  // The codex harvest names the session on its companion event: codex
  // withholds prompt text from its own telemetry, so the name is derived
  // from the transcript on the device and arrives as this one bounded value.
  "langwatch.session.title",
  // The session's own name, as the harness itself holds it (claude's --name
  // and /rename, codex's thread name), mirrored by the capture seams. The
  // newest name replaces the row's title and outranks the derived titles.
  "langwatch.session.name",
  "user.id",
  "user.email",
  "user.account_uuid",
  "user.account_id",
  "organization.id",
  "app.version",
  "app.entrypoint",
  "terminal.type",
  // Cowork correlation + decision vocabulary (its events are otherwise
  // Claude Code's): the per-prompt id, in-session ordering, request speed
  // tier, and the tool_result-embedded decision fields.
  "prompt.id",
  "event.sequence",
  "speed",
  // The llm_request span's request context ("interaction" for the main
  // thread, "tool" for a sub-agent call), which decides the cache-write
  // lifetime the fold prices the call's writes at.
  "llm_request.context",
  "decision_type",
  "decision_source",
  // Sub-agent lineage, for agents that stamp it (the claude_code
  // subagent-spawn vocabulary): who spawned this session, and whether it
  // FORKED the parent's context instead of starting fresh.
  "parent_session_id",
  "parent_agent_id",
  "is_fork",
  "depth",
  "spawn_mode",
  "mcp_server_scope",
  "gen_ai.request.model",
  // The codex turn span's vocabulary (session_task.turn): the gen_ai token
  // buckets — where `input_tokens` INCLUDES the cache buckets, unlike the
  // disjoint claude spellings above — and codex's own non-cached count, which
  // is the disjoint input the fold actually wants.
  "gen_ai.response.model",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  "gen_ai.usage.cache_read.input_tokens",
  "gen_ai.usage.cache_creation.input_tokens",
  "codex.turn.token_usage.non_cached_input_tokens",
  // Codex's tool_result events spell the MCP server as a bare `mcp_server`.
  "mcp_server",
  "mcp_server.name",
  "mcp_tool.name",
  "plugin.name",
  "skill.name",
  "interaction.sequence",
  "agent_id",
  "agent_type",
  "attempt",
  "cache_creation_tokens",
  "cache_read_tokens",
  "category",
  "command_name",
  "cost_usd",
  "decision",
  "duration_ms",
  "error_type",
  "file_path",
  "input_tokens",
  "language",
  "model",
  "num_blocking",
  "num_cancelled",
  "output_tokens",
  "post_tokens",
  "pre_tokens",
  "precompute_reuse",
  "prompt_length",
  "query_source",
  "response_length",
  "server_fallback_hop",
  "server_name",
  "skill_name",
  "source",
  "status_code",
  "stop_reason",
  "subagent_type",
  "success",
  "to_mode",
  "tool_input_size_bytes",
  "tool_name",
  "tool_result_size_bytes",
  "total_duration_ms",
  "total_retry_duration_ms",
  "total_tokens",
  "trigger",
  "ttft_ms",
  "type",
  "request_id",
];

/**
 * The companion event a LangWatch-installed hook emits, carrying the session's repository,
 * branch and worktree identity. Fully qualified under `langwatch.coding_agent.hook` — it
 * belongs to LangWatch, and imitating a vendor's scope would blur the two apart.
 */
export const SESSION_CONTEXT_EVENT_NAME = "langwatch.session_context";

/**
 * The fact key the generated conversation title rides on: derived for claude (parsed from a
 * response body by the dispatcher), but carried as a wire attribute by codex's session-context
 * record — which is why the key is also in the lifted vocabulary above.
 */
export const SESSION_TITLE_FACT_KEY = "langwatch.session.title";

/** Prompt-derived session name, lower precedence than generated title. */
export const SESSION_TITLE_FALLBACK_FACT_KEY = "langwatch.session.title_fallback";

/** Session's own name from harness (`--name`, `/rename`, thread name); highest precedence. */
export const SESSION_NAME_FACT_KEY = "langwatch.session.name";

/**
 * The literal codex substitutes for prompt text it withholds
 * (`log_user_prompt` off, the default). Wherever prompt text is read, this
 * value means "withheld", not "the user typed this".
 */
export const WITHHELD_PROMPT_TEXT = "[REDACTED]";

/** The most of a prompt that becomes a session's name. */
const MAX_PROMPT_TITLE_CHARS = 120;

/**
 * A session name out of a prompt's text, or null when it can't name one: withheld text, an
 * empty string, or a machine-injected turn (agents wrap notifications as user turns, and a
 * session named `<task-notification>` names nothing). Otherwise the first line, capped.
 */
export function deriveSessionTitleFromPrompt(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === WITHHELD_PROMPT_TEXT) return null;
  if (trimmed.startsWith("<")) return null;
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  if (collapsed === "") return null;
  return collapsed.slice(0, MAX_PROMPT_TITLE_CHARS);
}

/** Declared agent name from companion event (only source), null if unknown. */
export function pickDeclaredCodingAgent(facts: Record<string, unknown>): CodingAgent | null {
  const declared = facts["coding_agent.name"];
  if (typeof declared !== "string" || declared.length === 0) return null;
  const match = CODING_AGENT_REGISTRY.find((agent) => agent.id === declared);
  return match?.id ?? null;
}

/** Extract coding-agent facts from log record; consumer-side gate for session fold. */
export function extractCodingAgentLogFacts({
  scopeName,
  attributes,
}: {
  scopeName: string | null | undefined;
  attributes: Record<string, unknown>;
}): Record<string, string | number | boolean> | null {
  const eventName = attributes["event.name"];
  const recordName = typeof eventName === "string" ? eventName : null;
  if (
    eventName !== SESSION_CONTEXT_EVENT_NAME &&
    detectCodingAgent({ scopeName, recordName }) === "unknown"
  ) {
    return null;
  }

  const facts: Record<string, string | number | boolean> = {};
  for (const key of CODING_AGENT_CONTRIBUTION_KEYS) {
    const value = attributes[key];
    if (
      (typeof value === "string" && value.length > 0) ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      facts[key] = value;
    }
  }
  return facts;
}

/** `claude_code.tool_result` → `tool_result`; `tool_result` → `tool_result`. */
function stripAgentPrefix(name: string): string {
  for (const agent of CODING_AGENT_REGISTRY) {
    for (const prefix of agent.namePrefixes) {
      if (name.startsWith(prefix)) return name.slice(prefix.length);
    }
  }
  return name;
}

/**
 * The token bucket, from any agent's spelling. Deliberately SHARED rather than per-agent:
 * folding overlapping spellings in one place keeps a new agent's `cacheRead` / `cache_read`
 * from silently mispricing a session — which doesn't throw, and is worse than throwing.
 */
export function normalizeTokenType(rawType: string | null | undefined): TokenType | null {
  if (!rawType) return null;
  // Fold camelCase and snake_case together so `cacheRead` and `cache_read` are
  // one thing, then match on the flattened form.
  const flat = rawType.replace(/[_-]/g, "").toLowerCase();

  switch (flat) {
    case "input":
    case "prompt":
    case "noncachedinput":
      return "input";
    case "output":
    case "completion":
      return "output";
    case "cacheread":
    case "cachedinput":
    case "cachereadinput":
    // Gemini's bare `cache` means tokens SERVED from cache, i.e. a read.
    case "cache":
      return "cache_read";
    case "cachecreation":
    case "cachewrite":
    case "cachecreationinput":
      return "cache_creation";
    case "reasoning":
    case "reasoningoutput":
    // Gemini calls reasoning tokens "thought".
    case "thought":
    case "thoughts":
      return "reasoning";
    // Codex reports a `total` bucket alongside the parts. Counting it would
    // double every token in the session, so it is deliberately not a bucket.
    case "total":
      return null;
    // Gemini's `tool` token type counts tokens spent on tool DEFINITIONS. It is
    // already inside the input count, so it is not a bucket of its own.
    case "tool":
      return null;
    default:
      return null;
  }
}

/**
 * The tool that ran: the attribute when the agent carries one, else whatever a registered
 * definition reads off the span name (opencode encodes it there). Reading only the attribute
 * loses every opencode tool; reading only the span name loses everyone else's.
 */
export function deriveToolName({
  spanName,
  attrs,
}: {
  spanName?: string | null;
  attrs: Record<string, unknown>;
}): string | null {
  const fromAttr = pickFirstString(attrs, ["tool_name", "tool.name"]);
  if (fromAttr !== null) return fromAttr;

  const name = spanName ?? "";
  if (name.length === 0) return null;
  for (const agent of CODING_AGENT_REGISTRY) {
    const tool = agent.extractToolNameFromSpanName?.(name) ?? null;
    if (tool !== null) return tool;
  }
  return null;
}

/**
 * `mcp__<server>__<tool>` — the naming convention MCP tools follow. This is how MCP usage
 * actually reaches us: the `mcp_server.name` / `mcp_tool.name` attributes live on METRIC
 * records, not the tool span, so reading them off the span finds nothing on real sessions.
 */
export function parseMcpToolName(
  toolName: string | null | undefined,
): { server: string; tool: string } | null {
  const PREFIX = "mcp__";
  const SEPARATOR = "__";
  if (!toolName?.startsWith(PREFIX)) return null;

  const rest = toolName.slice(PREFIX.length);
  const at = rest.indexOf(SEPARATOR);
  if (at <= 0) return null;

  const server = rest.slice(0, at);
  const tool = rest.slice(at + SEPARATOR.length);
  if (tool.length === 0) return null;
  return { server, tool };
}

function pickFirstString(attrs: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = attrs[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}
