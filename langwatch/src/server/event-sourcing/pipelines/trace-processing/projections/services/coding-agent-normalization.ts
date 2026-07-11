/**
 * One vocabulary for every coding agent.
 *
 * Claude Code, opencode, Codex, Gemini CLI and Copilot all describe the same
 * handful of things — a model call, a tool run, a prompt, a denial, a token —
 * and every one of them spells those things differently. This module is where
 * that ends: raw wire strings in, one canonical fact out. Nothing downstream of
 * here should ever compare against a vendor's literal.
 *
 * The rules below are not guesses. They come from reading each agent's source
 * and from 30 days of live telemetry, and each surprising one carries the
 * evidence that forced it.
 */

/** The agents we can name. `unknown` is not a failure — it is an honest answer. */
export type CodingAgent =
  | "claude_code"
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
  | "api_error"
  | "api_refusal"
  | "retries_exhausted"
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

/**
 * Token buckets. Three agents, three vocabularies for the same five things —
 * and the distinction that actually costs money (a cache READ is cheap, a cache
 * WRITE costs more than fresh input) is spelled differently by every one of them.
 */
export type TokenType =
  | "input"
  | "output"
  | "cache_read"
  | "cache_creation"
  | "reasoning";

/**
 * Which agent produced this record.
 *
 * Deliberately NOT keyed on instrumentation scope. Claude Code uses
 * `com.anthropic.claude_code.events` and opencode uses `com.opencode`, but Codex
 * uses whatever `service_name` it was configured with — there is no stable scope
 * string to match on. The NAME of the span/metric/event is the reliable signal,
 * so that is what we key on, with the scope as a fallback hint.
 */
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
  const name = (recordName ?? "").toLowerCase();
  const scope = (scopeName ?? "").toLowerCase();
  const service = (serviceName ?? "").toLowerCase();

  const says = (needle: string) =>
    name.startsWith(`${needle}.`) ||
    scope.includes(needle) ||
    service.includes(needle);

  if (says("claude_code") || scope.includes("anthropic")) return "claude_code";
  if (says("opencode")) return "opencode";
  if (says("codex")) return "codex";
  if (says("gemini_cli") || says("gemini")) return "gemini_cli";
  if (says("copilot")) return "copilot";
  return "unknown";
}

/**
 * The conversation this record belongs to.
 *
 * The single most load-bearing function here, because it is the ONLY key every
 * agent agrees on — and they agree on it under four different names:
 *
 *   - Claude Code: `session.id` on logs and metrics, `gen_ai.conversation.id` on
 *     SPANS. Verified identical: the same UUID appears under both keys for the
 *     same trace, so a span and a log of one session do join.
 *   - opencode:    `session.id` everywhere.
 *   - Codex:       `conversation.id` == `thread.id` == `session.id` (its MCP span
 *     sets two of them to the same thread id).
 *
 * Order matters only in that all of these are the same value when more than one
 * is present, so the first hit wins and no agent is disadvantaged.
 */
export function resolveConversationKey(
  attrs: Record<string, unknown>,
): string | null {
  const candidates = [
    "session.id",
    "conversation.id",
    "gen_ai.conversation.id",
    "thread.id",
  ];
  for (const key of candidates) {
    const value = attrs[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * The canonical event, from whatever the agent called it.
 *
 * Two agents namespace their event names (`claude_code.tool_result`,
 * `codex.tool_result`) and one does not (opencode emits a bare `tool_result`),
 * so the prefix is stripped before matching rather than enumerated per agent.
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

const EVENT_ALIASES: Readonly<Record<string, CodingAgentEvent>> = {
  user_prompt: "user_prompt",
  assistant_response: "assistant_response",
  api_request: "api_request",
  api_error: "api_error",
  api_refusal: "api_refusal",
  refusal: "api_refusal",
  api_retries_exhausted: "retries_exhausted",
  retries_exhausted: "retries_exhausted",
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
  session_idle: "session_idle",
  session_error: "session_error",
  subtask_invoked: "subtask_invoked",
  commit: "commit",
  // Codex names its shell outcome differently but means "the tool ran".
  sandbox_outcome: "tool_result",
  // Gemini logs a COMPLETED tool call (it carries success + duration_ms), which
  // is our tool_result, not a separate "the tool was requested" fact.
  tool_call: "tool_result",
  chat_compression: "compaction",
  conversation_finished: "session_idle",
  slash_command: "user_prompt",
  // Copilot emits these as SPAN EVENTS rather than log records — see the note on
  // the Copilot shape below. Mapped so they fold the same way if they ever
  // arrive as logs.
  session_compaction_complete: "compaction",
  skill_invoked: "skill_activated",
};

/**
 * The canonical metric, from whatever the agent called it.
 *
 * The agent prefix is the only difference for the metrics we care about
 * (`claude_code.lines_of_code.count` vs `opencode.lines_of_code.count`), so it is
 * stripped and the remainder matched — the same trick the event names use.
 *
 * Two deliberate omissions:
 *   - opencode's `lines_of_code.total` is a cumulative GAUGE that sits alongside
 *     the `.count` delta counter. Adding both would double every line.
 *   - Codex has no lines-of-code and no cost metric at all; its cost must be
 *     priced from tokens. There is nothing here to map.
 */
export function normalizeMetricName(
  rawMetricName: string | null | undefined,
): CodingAgentMetric | null {
  if (!rawMetricName) return null;
  return METRIC_ALIASES[stripAgentPrefix(rawMetricName)] ?? null;
}

export type CodingAgentMetric =
  | "tool_call"
  | "lines_of_code"
  | "commit"
  | "pull_request"
  | "edit_decision"
  | "active_time"
  | "token_usage"
  | "cost_usage";

const METRIC_ALIASES: Readonly<Record<string, CodingAgentMetric>> = {
  "lines_of_code.count": "lines_of_code",
  "commit.count": "commit",
  "pull_request.count": "pull_request",
  "code_edit_tool.decision": "edit_decision",
  "active_time.total": "active_time",
  "token.usage": "token_usage",
  "cost.usage": "cost_usage",
  // Codex spells its token metric differently, and reports it per turn.
  "turn.token_usage": "token_usage",
  // Gemini: `gemini_cli.lines.changed` with type=added|removed.
  "lines.changed": "lines_of_code",
  "tool.call.count": "tool_call",
};

/**
 * Is this metric from a coding agent at all?
 *
 * Was `startsWith("claude_code.")` — which would have dropped every opencode and
 * Codex metric at the gate, after all the trouble of normalizing them.
 */
export function isCodingAgentMetricName(metricName: string): boolean {
  return (
    detectCodingAgent({ recordName: metricName }) !== "unknown" &&
    normalizeMetricName(metricName) !== null
  );
}

/** `claude_code.tool_result` → `tool_result`; `tool_result` → `tool_result`. */
function stripAgentPrefix(name: string): string {
  const AGENT_PREFIXES = [
    "claude_code.",
    "opencode.",
    "codex.",
    "gemini_cli.",
    // Copilot namespaces under the ORG, not the product.
    "github.copilot.",
    "copilot.",
  ];
  for (const prefix of AGENT_PREFIXES) {
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return name;
}

/**
 * The token bucket, from any agent's spelling.
 *
 * The cache distinction is the one that matters and the one they all spell
 * differently: `cacheRead` (Claude Code, opencode) vs `cached_input` (Codex),
 * `cacheCreation` vs `cache_creation`. Getting this wrong does not throw — it
 * silently misprices the session, which is worse.
 */
export function normalizeTokenType(
  rawType: string | null | undefined,
): TokenType | null {
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
 * The tool that ran.
 *
 * opencode puts the tool name IN the span name (`opencode.tool.bash`) while
 * Claude Code and Codex keep the span name constant and carry the tool in an
 * attribute. Reading only the attribute loses every opencode tool; reading only
 * the span name loses everyone else's.
 */
export function resolveToolName({
  spanName,
  attrs,
}: {
  spanName?: string | null;
  attrs: Record<string, unknown>;
}): string | null {
  const fromAttr = firstString(attrs, ["tool_name", "tool.name"]);
  if (fromAttr !== null) return fromAttr;

  // `opencode.tool.bash` → `bash`. Only the opencode shape encodes it this way.
  const name = spanName ?? "";
  const OPENCODE_TOOL_SPAN = "opencode.tool.";
  if (name.startsWith(OPENCODE_TOOL_SPAN)) {
    const tool = name.slice(OPENCODE_TOOL_SPAN.length);
    return tool.length > 0 ? tool : null;
  }
  return null;
}

/**
 * `mcp__<server>__<tool>` — the naming convention MCP tools follow.
 *
 * This is how MCP usage actually reaches us. The `mcp_server.name` /
 * `mcp_tool.name` attributes exist, but on METRIC records (which carry no trace
 * id), not on the tool span — so reading them off the span found nothing on real
 * sessions, and a session that had plainly called an MCP server reported none.
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

function firstString(
  attrs: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = attrs[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}
