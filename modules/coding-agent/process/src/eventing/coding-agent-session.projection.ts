import {
  type LogFactsContributedEvent,
  logFactsContributedEventSchema,
  type CodingAgentSessionContextUsage,
  extractStampedContext,
  type MetricFactsContributedEvent,
  metricFactsContributedEventSchema,
  type SpanFactsContributedEvent,
  spanFactsContributedEventSchema,
} from "@langwatch/coding-agent-contract";
import {
  type FoldProjectionOptions,
  type FoldProjectionStore,
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "@langwatch/eventing";
import type { TraceApi } from "@langwatch/trace-contract";

import type { CodingAgentCostEstimator } from "../app/coding-agent.members.ts";
import { CodingAgentSessionLogProjection } from "./coding-agent-session-log.projection.ts";
import { CodingAgentSessionMetricProjection } from "./coding-agent-session-metric.projection.ts";
import { CodingAgentSessionSpanProjection } from "./coding-agent-session-span.projection.ts";
import {
  type CodingAgentSessionData,
  CodingAgentSessionStateProjection,
} from "./coding-agent-session-state.projection.ts";

/** Session fold; spans multiple traces via provider session key or trace id fallback. */
const codingAgentSessionEvents = [
  spanFactsContributedEventSchema,
  logFactsContributedEventSchema,
  metricFactsContributedEventSchema,
] as const;

/**
 * Schema-snapshot version; bump when replay must rebuild persisted state.
 * This version moves reported cost to `AgentReportedCostUsd`, recomputed from
 * stored span contributions (migration 00085; earlier: 00053/54/74/75/77).
 */
export const CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST = "2026-08-23";

/** Stamp rows from migrations 00053/00054; version alone cannot decide decodability. */
export const CODING_AGENT_SESSION_PROJECTION_VERSION_PRE_STAMP = "2026-07-21";

/** StartedAt drift window (±7 days); declared once for all callers to share. */
export const CODING_AGENT_SESSION_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Coalesce max batch; limited to ~few KB per version to avoid watermark bloat. */
export const CODING_AGENT_SESSION_COALESCE_MAX_BATCH = 128;

/**
 * The fold's state: the derived session plus the bookkeeping the abstract fold
 * needs. Deliberately flat — the session data is already bounded, so the whole
 * state is O(1) in the length of the session.
 */
export interface CodingAgentSessionState extends CodingAgentSessionData {
  /** How the aggregate key was established (`provider` / `trace_fallback`). */
  sessionKeySource: string;
  /**
   * Every trace that contributed, bounded, first-seen order. A sub-agent
   * `claude -p` spawn starts its own trace inside the same session, so this
   * is a set by design, not a single id.
   */
  traceIds: string[];
  /** Earliest span start seen. 0 is the "no spans yet" sentinel. */
  startedAtMs: number;
  createdAt: number;
  updatedAt: number;
  LastEventOccurredAt: number;
}

export class CodingAgentSessionFoldProjection
  extends AbstractFoldProjection<
    CodingAgentSessionState,
    typeof codingAgentSessionEvents,
    "createdAt",
    "updatedAt",
    "LastEventOccurredAt"
  >
  implements FoldEventHandlers<typeof codingAgentSessionEvents, CodingAgentSessionState>
{
  private readonly stateProjection: CodingAgentSessionStateProjection;
  private readonly spanProjection: CodingAgentSessionSpanProjection;
  private readonly logProjection: CodingAgentSessionLogProjection;
  private readonly metricProjection: CodingAgentSessionMetricProjection;
  readonly name = "codingAgentSession";
  readonly version = CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<CodingAgentSessionState>;

  protected readonly events = codingAgentSessionEvents;

  /**
   * Read back committed state per ADR-066. A schema-gated miss refolds once;
   * steady-state delivery never reads `event_log`. Out-of-order refolds stay
   * off since accumulators commute, and the window retries unbounded on a miss.
   */
  override options: FoldProjectionOptions = {
    refoldOnStoreMiss: true,
    refoldOnOutOfOrder: false,
    readWindow: { widthMs: CODING_AGENT_SESSION_READ_WINDOW_MS },
    coalesceMaxBatch: CODING_AGENT_SESSION_COALESCE_MAX_BATCH,
  };

  private constructor(deps: {
    store: FoldProjectionStore<CodingAgentSessionState>;
    traceCanonicalisation: Pick<TraceApi, "classifyClaudeCall">;
    modelProviders: CodingAgentCostEstimator;
  }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = deps.store;
    this.stateProjection = CodingAgentSessionStateProjection.create();
    this.spanProjection = CodingAgentSessionSpanProjection.create({
      stateProjection: this.stateProjection,
      traceCanonicalisation: deps.traceCanonicalisation,
      modelProviders: deps.modelProviders,
    });
    this.logProjection = CodingAgentSessionLogProjection.create({
      stateProjection: this.stateProjection,
    });
    this.metricProjection = CodingAgentSessionMetricProjection.create({
      stateProjection: this.stateProjection,
    });
  }

  static create(deps: {
    store: FoldProjectionStore<CodingAgentSessionState>;
    traceCanonicalisation: Pick<TraceApi, "classifyClaudeCall">;
    modelProviders: CodingAgentCostEstimator;
  }): CodingAgentSessionFoldProjection {
    return new CodingAgentSessionFoldProjection(deps);
  }

  protected initState(): CodingAgentSessionState {
    return {
      ...this.stateProjection.createInitCodingAgentSession(),
      sessionKeySource: "",
      traceIds: [],
      startedAtMs: 0,
      createdAt: 0,
      updatedAt: 0,
      LastEventOccurredAt: 0,
    };
  }

  /** Identity every contribution carries, applied identically by both handlers. */
  private withContributionIdentity(
    state: CodingAgentSessionState,
    data: {
      sessionId: string;
      sessionKeySource: string;
      agent: string;
      traceId: string | null;
      occurredAt: number;
    },
  ): CodingAgentSessionState {
    return {
      ...state,
      sessionId: state.sessionId ?? data.sessionId,
      sessionKeySource: state.sessionKeySource || data.sessionKeySource,
      agent: state.agent ?? data.agent,
      traceIds:
        data.traceId !== null
          ? this.stateProjection.addToBoundedSet(state.traceIds, data.traceId)
          : state.traceIds,
      // The session starts when its earliest signal does. Spans refine this
      // below with their own start time, which can predate arrival order.
      startedAtMs:
        state.startedAtMs === 0 ? data.occurredAt : Math.min(state.startedAtMs, data.occurredAt),
    };
  }

  handleCodingAgentSessionSpanFactsContributed(
    event: SpanFactsContributedEvent,
    state: CodingAgentSessionState,
  ): CodingAgentSessionState {
    const data = event.data;
    const next = this.spanProjection.applySpanToCodingAgentSession({
      state,
      span: {
        name: data.name,
        startTimeUnixMs: data.startTimeUnixMs,
        endTimeUnixMs: data.endTimeUnixMs,
        statusCode: data.statusCode,
        attrs: data.facts,
      },
      // The contribution's own label, not the folded (first-writer-wins)
      // state's — same reasoning as the log handler below.
      agent: data.agent,
      // The stamp the contribute service put on the event, so the call's
      // tokens are charged to the context declared before it.
      context: extractStampedContext(data),
    });

    const withIdentity = this.withContributionIdentity(
      { ...state, ...next },
      { ...data, occurredAt: data.startTimeUnixMs },
    );
    return withIdentity;
  }

  handleCodingAgentSessionLogFactsContributed(
    event: LogFactsContributedEvent,
    state: CodingAgentSessionState,
  ): CodingAgentSessionState {
    const data = event.data;
    const next = this.logProjection.applyLogToCodingAgentSession({
      state,
      attributes: data.facts,
      // The contribution's own label, not the folded (first-writer-wins)
      // state's — the logs-only gate must reflect what THIS record is.
      agent: data.agent,
      occurredAtMs: data.timeUnixMs,
      context: extractStampedContext(data),
    });

    return this.withContributionIdentity(
      { ...state, ...next },
      { ...data, occurredAt: data.timeUnixMs },
    );
  }

  handleCodingAgentSessionMetricFactsContributed(
    event: MetricFactsContributedEvent,
    state: CodingAgentSessionState,
  ): CodingAgentSessionState {
    const data = event.data;
    const next = this.metricProjection.applyMetricToCodingAgentSession({
      state,
      metric: {
        seriesId: data.seriesId,
        metricName: data.metricName,
        attributes: data.attributes,
        value: data.value,
      },
    });
    // Metrics carry no trace context at all — the session is the only key.
    return this.withContributionIdentity(
      { ...state, ...next },
      { ...data, traceId: null, occurredAt: data.asOfUnixMs },
    );
  }
}

/**
 * One converged metric unit in the row's `MetricSeries` column (migration
 * 00053). Mirrors `MetricSeriesFact`, with nullable attributes flattened to
 * empty strings for the ClickHouse tuple and mapped back to null on read.
 */
export interface CodingAgentSessionMetricSeriesRow {
  seriesId: string;
  metricName: string;
  type: string;
  decision: string;
  language: string;
  value: number;
}

/**
 * The row that lands in `coding_agent_sessions` (migration 00051, extended by
 * 00053). Field names mirror the ClickHouse columns 1:1 so the repository's
 * record literal is a straight mapping.
 */
export interface CodingAgentSessionRow {
  tenantId: string;
  sessionId: string;
  sessionKeySource: string;
  version: string;
  startedAtMs: number;

  agent: string;
  agentVersion: string;
  /** Every trace that contributed — bounded, first-seen order. */
  traceIds: string[];
  finalRequestId: string;
  userId: string;
  terminalType: string;
  entrypoint: string;
  parentSessionId: string;
  isFork: boolean;
  /** Git identity from the companion event, and the generated title (00075). */
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  gitBranch: string;
  /** Every branch the session reported, bounded and first-seen (00077). */
  gitBranches: string[];
  gitWorktree: string;
  title: string;
  /**
   * Which source set `Title` (00083): "prompt", "generated", "name", or ""
   * on a row from before the column. Read back so a later fold knows whether
   * a regenerated title may replace it — a name may not be clobbered.
   */
  titleSource: string;

  modelCalls: number;
  toolCalls: number;
  subAgents: number;
  prompts: number;
  promptChars: number;
  responseChars: number;
  /** `(name, count, failed)`, in the order they happened. */
  steps: [string, number, boolean][];

  toolCounts: Record<string, number>;
  toolDurationMs: Record<string, number>;
  filesTouched: string[];
  skills: string[];
  subAgentTypes: string[];
  slashCommands: string[];
  models: string[];
  mcpServers: string[];
  mcpTools: string[];

  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  agentReportedCostUsd: number;
  /**
   * What the session spent under each declared working context (migration 00099), first seen first.
   * The counters above are the amount; this says where it went. Empty on a row folded before the
   * column, whose whole usage then reads as spent before any declaration.
   */
  usageByContext: CodingAgentSessionContextUsage[];

  modelCallMs: number;
  toolMs: number;
  ttftMsTotal: number;
  ttftSamples: number;
  blockedOnUserMs: number;
  activeTimeUserSec: number;
  activeTimeCliSec: number;

  toolResultBytes: number;
  toolInputBytes: number;
  compactions: number;
  compactionTokensBefore: number;
  compactionTokensAfter: number;
  compactionTriggers: Record<string, number>;
  peakContextTokens: number;
  cacheRebuildCount: number;
  largestCacheRebuildTokens: number;

  failedTools: number;
  errorTypes: Record<string, number>;
  apiErrors: number;
  rateLimited: number;
  rateLimitEvents: number;
  retriesExhausted: number;
  retryMs: number;
  attempts: number;
  refusals: number;
  refusalCategories: string[];
  internalErrors: number;

  toolsDenied: number;
  toolsAborted: number;
  permissionMode: string;
  permissionChanges: number;
  hooksBlocked: number;
  hooksCancelled: number;
  hookMs: number;

  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
  editsAccepted: number;
  editsRejected: number;
  languagesEdited: string[];
  atMentions: number;

  stopReason: string;
  truncated: boolean;

  // ── Read-back state (ADR-066, migration 00053) ─────────────────────────
  // Not analytics columns — these round-trip the fold's working state so
  // store.get() can read it back (decode the row) without replaying event_log.
  /** The dedup set behind `subAgents`; the row keeps count + types, plus this. */
  subAgentIds: string[];
  /** Per-step start times, index-aligned with `steps` (dropped by the 3-tuple). */
  stepStartedAt: number[];
  /** Previous model call's context size, to detect the next cache rebuild. */
  previousCallContextTokens: number;
  /** The converged metric units the metric-fed fields are recomputed from. */
  metricSeries: CodingAgentSessionMetricSeriesRow[];
  /** Fold bookkeeping timestamps (createdAt/updatedAt map to CreatedAt/UpdatedAt). */
  createdAt: number;
  updatedAt: number;
  lastEventOccurredAt: number;
}
