import {
  AbstractMapProjection,
  type MapEventHandlers,
} from "../../../projections/abstractMapProjection";
import type { AppendStore } from "../../../projections/mapProjection.types";
import { CODING_AGENT_MAP_COALESCE_MAX_BATCH } from "../schemas/constants";
import type { ContributionFacts } from "../schemas/contributions";
import {
  type LogFactsContributedEvent,
  logFactsContributedEventSchema,
} from "../schemas/events";

/**
 * One row per coding-agent session EVENT, the per-call fact table
 * (`coding_agent_session_events`). Where `coding_agent_sessions` converges a
 * session into one row of totals, this keeps the sequence: every model call
 * with its own context and cost, every compaction with its before/after
 * tokens, every rate limit, tool run and prompt, ordered by time within the
 * session. One scan answers the questions totals erase: cost between two
 * compactions, tool mix around a rate limit, context growth call by call.
 *
 * Log-driven only, deliberately: the `api_request` log event is the one
 * carrier with tokens + cost + duration + request id together, so consuming
 * only logs makes double-counting against `llm_request` spans impossible by
 * construction. Span-only agents (codex today) contribute no `model_call`
 * rows until they grow a log carrier: documented degradation, not a bug.
 *
 * Scalar columns only; no free-form attribute map. The wire rides user
 * identity on nearly every event and content lives in the canonical rows, so
 * `recordId` reaches `log_records` for anything not typed here.
 */
export interface CodingAgentSessionEventRecord {
  tenantId: string;
  sessionId: string;
  timeUnixMs: number;
  recordId: string;
  eventKind: string;
  agent: string;
  sessionKeySource: string;
  traceId: string;
  spanId: string;
  promptId: string;
  querySource: string;
  agentType: string;
  eventSequence: number;
  requestId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  durationMs: number;
  ttftMs: number;
  attempt: number;
  speed: string;
  stopReason: string;
  preTokens: number;
  postTokens: number;
  compactionTrigger: string;
  precomputeReuse: string;
  statusCode: string;
  errorType: string;
  rateLimitCarrier: string;
  retryDurationMs: number;
  toolName: string;
  success: string;
  decision: string;
  decisionSource: string;
  toolInputBytes: number;
  toolResultBytes: number;
  promptChars: number;
  totalTokens: number;
}

/**
 * Raw wire event names that become rows, mapped to the row's EventKind.
 * Everything else (hooks, plugin loads, MCP connections, request/response
 * bodies) maps to null and contributes no row. The session fold still
 * counted it where relevant, and the body events' content stays in
 * `log_records`.
 *
 * Wire names arrive bare (`api_request`) from Claude Code and namespaced
 * (`claude_code.api_refusal`) from agents that prefix; both spellings map.
 */
const EVENT_KIND_BY_RAW_NAME: Record<string, string> = {
  api_request: "model_call",
  compaction: "compaction",
  chat_compression: "compaction",
  session_compaction_complete: "compaction",
  rate_limit_event: "rate_limit",
  rate_limit_info: "rate_limit",
  api_error: "api_error",
  retries_exhausted: "retries_exhausted",
  api_retries_exhausted: "retries_exhausted",
  tool_result: "tool_result",
  tool_decision: "tool_decision",
  user_prompt: "user_prompt",
  subagent_completed: "subagent_completed",
};

const events = [logFactsContributedEventSchema] as const;

export class CodingAgentSessionEventsMapProjection
  extends AbstractMapProjection<CodingAgentSessionEventRecord, typeof events>
  implements MapEventHandlers<typeof events, CodingAgentSessionEventRecord>
{
  readonly name = "codingAgentSessionEvents";
  readonly store: AppendStore<CodingAgentSessionEventRecord>;
  protected readonly events = events;

  constructor(deps: { store: AppendStore<CodingAgentSessionEventRecord> }) {
    super();
    this.store = deps.store;
    this.options = {
      coalesceMaxBatch: CODING_AGENT_MAP_COALESCE_MAX_BATCH,
    };
  }

  mapCodingAgentSessionLogFactsContributed(
    event: LogFactsContributedEvent,
  ): CodingAgentSessionEventRecord | null {
    const facts = event.data.facts;
    const eventKind = resolveEventKind(str(facts["event.name"]));
    if (eventKind === null) return null;

    const querySource = str(facts.query_source);

    return {
      tenantId: event.data.tenantId,
      sessionId: event.data.sessionId,
      timeUnixMs: event.data.timeUnixMs,
      recordId: event.data.recordId,
      eventKind,
      agent: event.data.agent,
      sessionKeySource: event.data.sessionKeySource,
      traceId: event.data.traceId ?? "",
      spanId: event.data.spanId ?? "",
      promptId: str(facts["prompt.id"]),
      querySource,
      agentType: resolveAgentType(facts, querySource),
      eventSequence: int(facts["event.sequence"], -1),
      requestId: str(facts.request_id),
      model: str(facts.model) || str(facts["gen_ai.request.model"]),
      inputTokens: nat(facts.input_tokens),
      outputTokens: nat(facts.output_tokens),
      cacheReadTokens: nat(facts.cache_read_tokens),
      cacheCreationTokens: nat(facts.cache_creation_tokens),
      costUsd: num(facts.cost_usd),
      durationMs: nat(facts.duration_ms),
      ttftMs: nat(facts.ttft_ms),
      attempt: nat(facts.attempt),
      speed: str(facts.speed),
      stopReason: str(facts.stop_reason),
      preTokens: nat(facts.pre_tokens),
      postTokens: nat(facts.post_tokens),
      compactionTrigger: eventKind === "compaction" ? str(facts.trigger) : "",
      precomputeReuse: str(facts.precompute_reuse),
      statusCode: str(facts.status_code),
      errorType: str(facts.error_type),
      // `event` or `info`: which of Claude's two rate-limit carriers reported
      // this row, not the dimension that was limited.
      rateLimitCarrier:
        eventKind === "rate_limit"
          ? bare(str(facts["event.name"])).replace("rate_limit_", "")
          : "",
      retryDurationMs: nat(facts.total_retry_duration_ms),
      toolName: str(facts.tool_name),
      success: str(facts.success),
      decision: str(facts.decision),
      decisionSource: str(facts.decision_source),
      toolInputBytes: nat(facts.tool_input_size_bytes),
      toolResultBytes: nat(facts.tool_result_size_bytes),
      promptChars: nat(facts.prompt_length),
      totalTokens: nat(facts.total_tokens),
    };
  }
}

function resolveEventKind(rawName: string): string | null {
  if (rawName === "") return null;
  return EVENT_KIND_BY_RAW_NAME[bare(rawName)] ?? null;
}

/** `claude_code.api_refusal` and `api_refusal` are the same wire word. */
function bare(rawName: string): string {
  const dot = rawName.lastIndexOf(".");
  return dot === -1 ? rawName : rawName.slice(dot + 1);
}

/**
 * The sub-agent type for the row: an explicit agent_type/subagent_type fact
 * (sub-agent lifecycle events carry one), else parsed off an `agent:*` query
 * source (`agent:builtin:general-purpose` is a sub-agent's own model call).
 */
function resolveAgentType(
  facts: ContributionFacts,
  querySource: string,
): string {
  const explicit = str(facts.agent_type) || str(facts.subagent_type);
  if (explicit !== "") return explicit;
  if (querySource.startsWith("agent:")) {
    const lastColon = querySource.lastIndexOf(":");
    return querySource.slice(lastColon + 1);
  }
  return "";
}

function str(value: string | number | boolean | undefined): string {
  if (value === undefined) return "";
  return String(value);
}

function num(value: string | number | boolean | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function nat(value: string | number | boolean | undefined): number {
  const parsed = num(value);
  return parsed > 0 ? Math.round(parsed) : 0;
}

function int(
  value: string | number | boolean | undefined,
  absent: number,
): number {
  if (value === undefined) return absent;
  const parsed = num(value);
  return Number.isInteger(parsed) ? parsed : absent;
}
