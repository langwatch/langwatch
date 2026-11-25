import {
  AI_UNITS_SESSION_FACT,
  CODING_AGENT_MAP_COALESCE_MAX_BATCH,
  contributionFactsSchema,
  type ContributionFacts,
  isSpanFedModelCall,
  type LogFactsContributedEvent,
  logFactsContributedEventSchema,
  type SpanFactsContributedEvent,
  spanFactsContributedEventSchema,
} from "@langwatch/coding-agent-contract";
import {
  type AppendStore,
  AbstractMapProjection,
  type MapEventHandlers,
} from "@langwatch/eventing";
import { z } from "zod";

import {
  genAiModelCallFacts,
  modelCallCostInput,
  spanModelCallRecordId,
} from "../rules/coding-agent-model-call-facts.rules.ts";
import type { CodingAgentCostEstimator } from "../services/model-catalog-cost-estimator.service.ts";

const contributionEventDataSchema = z.object({
  facts: contributionFactsSchema,
});
const spanIdentitySchema = z.object({ agent: z.string(), name: z.string() });

/**
 * Per-call facts table. Each call is written from one signal only: log events, except for an
 * agent whose calls ride spans alone (`isSpanFedModelCall`), whose model-call spans write it.
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
  /** The call's AI units (Copilot), a count beside the dollar figure; 0 for every log row. */
  aiUnits: number;
  /**
   * The working context active when the event happened, stamped from the
   * session's last `session_context` declaration. '' on pre-declaration rows;
   * this is what lets one session's cost split across every pull request it drove.
   */
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  branch: string;
}

/** Wire event names that become rows; single declaration powers both row and gate. */
export const EVENT_KIND_BY_RAW_NAME: Record<string, string> = {
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

/** Enqueue-time gate (ADR-069 invariant 4); gates on resolveEventKind, mirrors map(). */
const events = [logFactsContributedEventSchema, spanFactsContributedEventSchema] as const;

export class CodingAgentSessionEventsMapProjection
  extends AbstractMapProjection<CodingAgentSessionEventRecord, typeof events>
  implements MapEventHandlers<typeof events, CodingAgentSessionEventRecord>
{
  readonly name = "codingAgentSessionEvents";
  readonly targetTable = "coding_agent_session_events";
  readonly store: AppendStore<CodingAgentSessionEventRecord>;
  protected readonly events = events;
  private readonly modelProviders: CodingAgentCostEstimator;

  private constructor(deps: {
    store: AppendStore<CodingAgentSessionEventRecord>;
    modelProviders: CodingAgentCostEstimator;
  }) {
    super();
    this.store = deps.store;
    this.modelProviders = deps.modelProviders;
    this.options = {
      coalesceMaxBatch: CODING_AGENT_MAP_COALESCE_MAX_BATCH,
      enqueue: {
        filter: CodingAgentSessionEventsMapProjection.accepts,
      },
    };
  }

  static create(deps: {
    store: AppendStore<CodingAgentSessionEventRecord>;
    modelProviders: CodingAgentCostEstimator;
  }): CodingAgentSessionEventsMapProjection {
    return new CodingAgentSessionEventsMapProjection(deps);
  }

  static readonly accepts = (event: { data?: unknown }): boolean =>
    CodingAgentSessionEventsMapProjection.resolveEventKind(
      CodingAgentSessionEventsMapProjection.rawEventName(event),
    ) !== null || CodingAgentSessionEventsMapProjection.isSpanFedCall(event);

  /**
   * A model-call span of an agent whose calls ride spans alone, as a `model_call` row priced the
   * way the session fold prices it. Every other span maps to nothing: its agent logs its calls.
   */
  mapCodingAgentSessionSpanFactsContributed(
    event: SpanFactsContributedEvent,
  ): CodingAgentSessionEventRecord | null {
    if (!CodingAgentSessionEventsMapProjection.isSpanFedCall(event)) return null;
    const span = event.data;
    const facts = genAiModelCallFacts(span.facts);
    return {
      ...CodingAgentSessionEventsMapProjection.blankRow(),
      tenantId: span.tenantId,
      sessionId: span.sessionId,
      timeUnixMs: span.startTimeUnixMs,
      recordId: spanModelCallRecordId({ traceId: span.traceId, spanId: span.spanId }),
      eventKind: "model_call",
      agent: span.agent,
      sessionKeySource: span.sessionKeySource,
      traceId: span.traceId,
      spanId: span.spanId,
      model: facts.model ?? "",
      inputTokens: Math.round(facts.input_tokens),
      outputTokens: Math.round(facts.output_tokens),
      cacheReadTokens: Math.round(facts.cache_read_tokens),
      cacheCreationTokens: Math.round(facts.cache_creation_tokens),
      costUsd: this.modelProviders.estimateCost(modelCallCostInput(facts)),
      durationMs: Math.max(0, Math.round(span.endTimeUnixMs - span.startTimeUnixMs)),
      aiUnits: CodingAgentSessionEventsMapProjection.num(span.facts[AI_UNITS_SESSION_FACT]),
      repositoryHost: span.repositoryHost ?? "",
      repositoryOwner: span.repositoryOwner ?? "",
      repositoryName: span.repositoryName ?? "",
      branch: span.branch ?? "",
    };
  }

  mapCodingAgentSessionLogFactsContributed(
    event: LogFactsContributedEvent,
  ): CodingAgentSessionEventRecord | null {
    const facts = event.data.facts;
    const eventKind = CodingAgentSessionEventsMapProjection.resolveEventKind(
      CodingAgentSessionEventsMapProjection.rawEventName(event),
    );
    if (eventKind === null) return null;

    const querySource = CodingAgentSessionEventsMapProjection.str(facts.query_source);

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
      promptId: CodingAgentSessionEventsMapProjection.str(facts["prompt.id"]),
      querySource,
      agentType: CodingAgentSessionEventsMapProjection.resolveAgentType(facts, querySource),
      eventSequence: CodingAgentSessionEventsMapProjection.int(facts["event.sequence"], -1),
      requestId: CodingAgentSessionEventsMapProjection.str(facts.request_id),
      model:
        CodingAgentSessionEventsMapProjection.str(facts.model) ||
        CodingAgentSessionEventsMapProjection.str(facts["gen_ai.request.model"]),
      inputTokens: CodingAgentSessionEventsMapProjection.nat(facts.input_tokens),
      outputTokens: CodingAgentSessionEventsMapProjection.nat(facts.output_tokens),
      cacheReadTokens: CodingAgentSessionEventsMapProjection.nat(facts.cache_read_tokens),
      cacheCreationTokens: CodingAgentSessionEventsMapProjection.nat(facts.cache_creation_tokens),
      costUsd: CodingAgentSessionEventsMapProjection.num(facts.cost_usd),
      durationMs: CodingAgentSessionEventsMapProjection.nat(facts.duration_ms),
      ttftMs: CodingAgentSessionEventsMapProjection.nat(facts.ttft_ms),
      attempt: CodingAgentSessionEventsMapProjection.nat(facts.attempt),
      speed: CodingAgentSessionEventsMapProjection.str(facts.speed),
      stopReason: CodingAgentSessionEventsMapProjection.str(facts.stop_reason),
      preTokens: CodingAgentSessionEventsMapProjection.nat(facts.pre_tokens),
      postTokens: CodingAgentSessionEventsMapProjection.nat(facts.post_tokens),
      compactionTrigger:
        eventKind === "compaction" ? CodingAgentSessionEventsMapProjection.str(facts.trigger) : "",
      precomputeReuse: CodingAgentSessionEventsMapProjection.str(facts.precompute_reuse),
      statusCode: CodingAgentSessionEventsMapProjection.str(facts.status_code),
      errorType: CodingAgentSessionEventsMapProjection.str(facts.error_type),
      // `event` or `info`: which of Claude's two rate-limit carriers reported
      // this row, not the dimension that was limited.
      rateLimitCarrier:
        eventKind === "rate_limit"
          ? CodingAgentSessionEventsMapProjection.bare(
              CodingAgentSessionEventsMapProjection.str(facts["event.name"]),
            ).replace("rate_limit_", "")
          : "",
      retryDurationMs: CodingAgentSessionEventsMapProjection.nat(facts.total_retry_duration_ms),
      toolName: CodingAgentSessionEventsMapProjection.str(facts.tool_name),
      success: CodingAgentSessionEventsMapProjection.str(facts.success),
      decision: CodingAgentSessionEventsMapProjection.str(facts.decision),
      decisionSource: CodingAgentSessionEventsMapProjection.str(facts.decision_source),
      toolInputBytes: CodingAgentSessionEventsMapProjection.nat(facts.tool_input_size_bytes),
      toolResultBytes: CodingAgentSessionEventsMapProjection.nat(facts.tool_result_size_bytes),
      promptChars: CodingAgentSessionEventsMapProjection.nat(facts.prompt_length),
      totalTokens: CodingAgentSessionEventsMapProjection.nat(facts.total_tokens),
      aiUnits: 0,
      repositoryHost: event.data.repositoryHost ?? "",
      repositoryOwner: event.data.repositoryOwner ?? "",
      repositoryName: event.data.repositoryName ?? "",
      branch: event.data.branch ?? "",
    };
  }

  /** Read totally off any event shape, since the enqueue gate runs on the hot path. */
  private static isSpanFedCall(event: { data?: unknown }): boolean {
    const parsed = spanIdentitySchema.safeParse(event.data);
    return parsed.success && isSpanFedModelCall(parsed.data);
  }

  /** The columns only a log event fills, empty on a span-fed row. */
  private static blankRow(): Omit<
    CodingAgentSessionEventRecord,
    "tenantId" | "sessionId" | "timeUnixMs" | "recordId" | "eventKind" | "agent"
  > {
    return {
      sessionKeySource: "",
      traceId: "",
      spanId: "",
      promptId: "",
      querySource: "",
      agentType: "",
      eventSequence: -1,
      requestId: "",
      model: "",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      costUsd: 0,
      durationMs: 0,
      ttftMs: 0,
      attempt: 0,
      speed: "",
      stopReason: "",
      preTokens: 0,
      postTokens: 0,
      compactionTrigger: "",
      precomputeReuse: "",
      statusCode: "",
      errorType: "",
      rateLimitCarrier: "",
      retryDurationMs: 0,
      toolName: "",
      success: "",
      decision: "",
      decisionSource: "",
      toolInputBytes: 0,
      toolResultBytes: 0,
      promptChars: 0,
      totalTokens: 0,
      aiUnits: 0,
      repositoryHost: "",
      repositoryOwner: "",
      repositoryName: "",
      branch: "",
    };
  }

  private static resolveEventKind(rawName: string): string | null {
    if (rawName === "") return null;
    return EVENT_KIND_BY_RAW_NAME[CodingAgentSessionEventsMapProjection.bare(rawName)] ?? null;
  }

  /**
   * The raw wire event name off a contribution, read totally. Shared by
   * `map()` and the enqueue filter so both read the same field the same way.
   * Structural, not schema-parsed, since the hot-path filter has no retry.
   */
  private static rawEventName(event: { data?: unknown }): string {
    const parsed = contributionEventDataSchema.safeParse(event.data);
    return parsed.success
      ? CodingAgentSessionEventsMapProjection.str(parsed.data.facts["event.name"])
      : "";
  }

  /** `claude_code.api_refusal` and `api_refusal` are the same wire word. */
  private static bare(rawName: string): string {
    const dot = rawName.lastIndexOf(".");
    return dot === -1 ? rawName : rawName.slice(dot + 1);
  }

  /**
   * The sub-agent type for the row: an explicit agent_type/subagent_type fact
   * (sub-agent lifecycle events carry one), else parsed off an `agent:*` query
   * source (`agent:builtin:general-purpose` is a sub-agent's own model call).
   */
  private static resolveAgentType(facts: ContributionFacts, querySource: string): string {
    const explicit =
      CodingAgentSessionEventsMapProjection.str(facts.agent_type) ||
      CodingAgentSessionEventsMapProjection.str(facts.subagent_type);
    if (explicit !== "") return explicit;
    if (querySource.startsWith("agent:")) {
      const lastColon = querySource.lastIndexOf(":");
      return querySource.slice(lastColon + 1);
    }
    return "";
  }

  private static str(value: string | number | boolean | undefined): string {
    if (value === undefined) return "";
    return String(value);
  }

  private static num(value: string | number | boolean | undefined): number {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  private static nat(value: string | number | boolean | undefined): number {
    const parsed = CodingAgentSessionEventsMapProjection.num(value);
    return parsed > 0 ? Math.round(parsed) : 0;
  }

  private static int(value: string | number | boolean | undefined, absent: number): number {
    if (value === undefined) return absent;
    const parsed = CodingAgentSessionEventsMapProjection.num(value);
    return Number.isInteger(parsed) ? parsed : absent;
  }
}
