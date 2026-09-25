import {
  CODING_AGENT_MAP_COALESCE_MAX_BATCH,
  contributionFactsSchema,
  type ContributionFacts,
  type LogFactsContributedEvent,
  logFactsContributedEventSchema,
} from "@langwatch/coding-agent-contract";
import {
  type AppendStore,
  AbstractMapProjection,
  type MapEventHandlers,
} from "@langwatch/eventing";
import { z } from "zod";

const contributionEventDataSchema = z.object({
  facts: contributionFactsSchema,
});

/** Per-call facts table; log-driven only to prevent double-counting against spans. */
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
const events = [logFactsContributedEventSchema] as const;

export class CodingAgentSessionEventsMapProjection
  extends AbstractMapProjection<CodingAgentSessionEventRecord, typeof events>
  implements MapEventHandlers<typeof events, CodingAgentSessionEventRecord>
{
  readonly name = "codingAgentSessionEvents";
  readonly store: AppendStore<CodingAgentSessionEventRecord>;
  protected readonly events = events;

  private constructor(deps: { store: AppendStore<CodingAgentSessionEventRecord> }) {
    super();
    this.store = deps.store;
    this.options = {
      coalesceMaxBatch: CODING_AGENT_MAP_COALESCE_MAX_BATCH,
      enqueue: {
        filter: CodingAgentSessionEventsMapProjection.accepts,
      },
    };
  }

  static create(deps: {
    store: AppendStore<CodingAgentSessionEventRecord>;
  }): CodingAgentSessionEventsMapProjection {
    return new CodingAgentSessionEventsMapProjection(deps);
  }

  static readonly accepts = (event: { data?: unknown }): boolean =>
    CodingAgentSessionEventsMapProjection.resolveEventKind(
      CodingAgentSessionEventsMapProjection.rawEventName(event),
    ) !== null;

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
      repositoryHost: event.data.repositoryHost ?? "",
      repositoryOwner: event.data.repositoryOwner ?? "",
      repositoryName: event.data.repositoryName ?? "",
      branch: event.data.branch ?? "",
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
