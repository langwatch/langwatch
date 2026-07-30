/**
 * One vocabulary for every coding agent.
 *
 * Claude Code, Cowork, opencode, Codex, Gemini CLI and Copilot all describe
 * the same handful of things — a model call, a tool run, a prompt, a denial,
 * a token — and every one of them spells those things differently. This
 * module is where that ends: raw wire strings in, one canonical fact out.
 * Nothing downstream of here should ever compare against a vendor's literal.
 *
 * WHO each agent is lives in `../agents/` — one pure definition per agent,
 * registered in an ordered registry (the trace-canonicalisation extractor
 * shape). This engine folds the registry into the shared detection,
 * prefix-stripping and alias tables; the per-vendor evidence lives with each
 * definition. Adding an agent touches `agents/` only.
 *
 * The rules here are not guesses. They come from reading each agent's source
 * and from 30 days of live telemetry, and each surprising one carries the
 * evidence that forced it.
 */

import { createLogger } from "@langwatch/observability";
import { scalarsFromCanonicalAttributes } from "../../metric-processing/canonical/attributes";
import { CODING_AGENT_REGISTRY } from "../agents";
import type {
  CodingAgent,
  CodingAgentEvent,
  CodingAgentMetric,
  CodingAgentSignal,
  TokenType,
} from "../agents/_types";

const logger = createLogger("langwatch:coding-agent:normalization");

/**
 * Which agent produced this record.
 *
 * Deliberately NOT keyed on instrumentation scope alone. Claude Code uses
 * `com.anthropic.claude_code.events` and opencode uses `com.opencode`, but
 * Codex uses whatever `service_name` it was configured with — there is no
 * stable scope string to match on. The NAME of the span/metric/event is the
 * reliable signal, so that is what definitions key on, with the scope and
 * service as supporting hints. Registry order resolves the one genuine
 * overlap (Cowork before Claude Code — see `agents/index.ts`).
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

/**
 * The conversation this record belongs to.
 *
 * The single most load-bearing function here, because it is the ONLY key every
 * agent agrees on — and they agree on it under four different names:
 *
 *   - Claude Code / Cowork: `session.id` on logs and metrics,
 *     `gen_ai.conversation.id` on SPANS. Verified identical: the same UUID
 *     appears under both keys for the same trace, so a span and a log of one
 *     session do join.
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
 * The canonical event, from whatever the agent called it.
 *
 * Some agents namespace their event names (`claude_code.tool_result`,
 * `codex.tool_result`) and some do not (opencode emits a bare `tool_result`),
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

/**
 * The canonical vocabulary every agent shares: identity mappings for the
 * canonical names themselves, plus spellings not attributable to a single
 * vendor. Vendor-specific aliases live on the agent definitions and are
 * merged in below.
 */
const BASE_EVENT_ALIASES: Readonly<Record<string, CodingAgentEvent>> = {
  user_prompt: "user_prompt",
  assistant_response: "assistant_response",
  api_request: "api_request",
  // Gemini's completion event; carries the reply text (`response_text`) when
  // prompt logging is on. Claude splits the same fact into api_request (cost
  // anchor) + api_response_body (raw payload), neither of which lands here.
  api_response: "api_response",
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
  conversation_finished: "session_idle",
  slash_command: "user_prompt",
};

/**
 * The canonical metric, from whatever the agent called it.
 *
 * The agent prefix is the only difference for the metrics we care about
 * (`claude_code.lines_of_code.count` vs `opencode.lines_of_code.count`), so it
 * is stripped and the remainder matched — the same trick the event names use.
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
  perAgent: ReadonlyArray<Readonly<Record<string, Value>> | undefined>,
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

/**
 * The scalar coding-agent vocabulary a log contribution carries so the
 * session fold can run entirely on contribution events. Content never rides
 * here: prompts and replies stay in the canonical row; these are lengths,
 * ids, names and counters. Raw key names are preserved on purpose — the
 * fold's derivation reads the same keys off every signal's contribution, so
 * the paths cannot drift. Exported because the span dispatcher lifts the
 * same vocabulary off span attributes.
 */
export const CODING_AGENT_CONTRIBUTION_KEYS: readonly string[] = [
  "event.name",
  "session.id",
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
  "decision_type",
  "decision_source",
  "mcp_server_scope",
  "gen_ai.request.model",
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
  "prompt_length",
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
  "ttft_ms",
  "type",
  "request_id",
];

/**
 * The coding-agent facts off one log record, for its trace contribution —
 * or null when the record is not a coding agent's, which doubles as the
 * consumer-side gate (a contribution without the lift never reaches the
 * session fold).
 *
 * **Deliberately blind to `service.name`**, unlike `detectCodingAgent`. This
 * runs on every ingested log record, and the service name lives only inside
 * `resourceAttributesFlatJson` — there is no extracted column for it — so
 * consulting it here would put a JSON parse on the whole log firehose to
 * answer a question that is almost always "no". That is the cost ADR-098
 * exists to refuse, so the gate stays on the cheap signals (scope, event name)
 * and the caller supplies `service.name` afterwards, to LABEL a record this
 * has already admitted.
 *
 * The residual gap is narrow and known: an agent identified by service name
 * ALONE, emitting bare event names under a scope this does not recognise,
 * would be declined here. Cowork is not that case — it reuses Claude Code's
 * runtime, so its records carry the anthropic scope and `claude_code.*` event
 * names and pass on those. An agent that genuinely needs naming by service
 * alone needs a `ServiceName` column extracted on the canonical log record
 * first; do not close it by parsing resource attributes in this path.
 */
export function liftCodingAgentLogFacts({
  scopeName,
  attributes,
}: {
  scopeName: string | null | undefined;
  attributes: Record<string, unknown>;
}): Record<string, string | number | boolean> | null {
  const eventName = attributes["event.name"];
  if (
    detectCodingAgent({
      scopeName,
      recordName: typeof eventName === "string" ? eventName : null,
    }) === "unknown"
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
 * The token bucket, from any agent's spelling.
 *
 * Deliberately SHARED rather than per-agent: the spellings overlap and
 * folding them in one place is what keeps a new agent's `cacheRead` /
 * `cache_read` / `cached_input` from silently mispricing a session — which
 * does not throw, and is worse than throwing.
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
 * The tool that ran: the attribute when the agent carries one, else whatever
 * a registered definition can read off the span name (opencode encodes the
 * tool there). Reading only the attribute loses every opencode tool; reading
 * only the span name loses everyone else's.
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

  const name = spanName ?? "";
  if (name.length === 0) return null;
  for (const agent of CODING_AGENT_REGISTRY) {
    const tool = agent.toolNameFromSpanName?.(name) ?? null;
    if (tool !== null) return tool;
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

/**
 * Which canonical row a parse failure belongs to, for the log line.
 *
 * The id, never the blob: the row is still there to read, and it is the only
 * pointer a reader needs.
 */
interface CanonicalAttributesRef {
  kind: "record" | "point";
  id: string;
}

/**
 * Parse a canonical row's attributes blob, or skip the row.
 *
 * The blob is written by our own canonical preparation, so a parse failure
 * should be unreachable — but a dispatcher must never poison the queue over
 * one row, so this reports null and the caller drops it.
 *
 * **Only the error's NAME reaches the log line.** V8 builds
 * `SyntaxError.message` by quoting roughly ten characters of the input it
 * choked on, so serialising the error would copy a slice of the customer's
 * attributes into our logs. The ref is the better pointer anyway.
 *
 * `decode` is where the two canonical shapes differ — flat object vs the
 * typed KeyValue array — and is the only thing a caller varies.
 */
function parseCanonicalAttributes<T>({
  json,
  ref,
  decode,
}: {
  json: string;
  ref: CanonicalAttributesRef;
  decode: (parsed: unknown) => T | null;
}): T | null {
  if (!json) return null;
  try {
    return decode(JSON.parse(json));
  } catch (error) {
    logger.warn(
      {
        errorName: error instanceof Error ? error.name : typeof error,
        refKind: ref.kind,
        refId: ref.id,
      },
      "unparseable canonical attributes; skipping",
    );
    return null;
  }
}

/**
 * The flat-object canonical shape (`attributesFlatJson`,
 * `resourceAttributesFlatJson`): a plain map of scalars.
 *
 * An array parses as an object in JavaScript but is never a valid attribute
 * map, so it is rejected rather than indexed into.
 */
export function parseFlatCanonicalAttributes({
  json,
  ref,
}: {
  json: string;
  ref: CanonicalAttributesRef;
}): Record<string, unknown> | null {
  return parseCanonicalAttributes({
    json,
    ref,
    decode: (parsed) =>
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null,
  });
}

/**
 * The KeyValue canonical shape (`pointAttributesJson`,
 * `resourceAttributesJson`): the `[{key, value: {type, value}}]` array
 * `buildPoint` writes, flattened back to scalars.
 */
export function parseKeyValueCanonicalAttributes({
  json,
  ref,
}: {
  json: string;
  ref: CanonicalAttributesRef;
}): Record<string, string | number | boolean> | null {
  return parseCanonicalAttributes({
    json,
    ref,
    decode: scalarsFromCanonicalAttributes,
  });
}

/**
 * A present, non-empty string, or null.
 *
 * Every resource read wants this: an attribute that is absent, wrongly typed,
 * or an empty string all mean "no signal", and passing `""` on as if it were
 * one invites a downstream match against the empty prefix.
 */
export function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
