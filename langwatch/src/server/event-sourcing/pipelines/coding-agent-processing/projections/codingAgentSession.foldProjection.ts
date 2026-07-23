import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "~/server/event-sourcing/projections/abstractFoldProjection";
import type {
  FoldProjectionOptions,
  FoldProjectionStore,
} from "~/server/event-sourcing/projections/foldProjection.types";
import {
  type LogFactsContributedEvent,
  logFactsContributedEventSchema,
  type MetricFactsContributedEvent,
  metricFactsContributedEventSchema,
  type SpanFactsContributedEvent,
  spanFactsContributedEventSchema,
} from "../schemas/events";
import {
  addToBoundedSet,
  applyLogToCodingAgentSession,
  applyMetricToCodingAgentSession,
  applySpanToCodingAgentSession,
  createInitCodingAgentSession,
} from "../services/coding-agent-session.derivation";
import type {
  CodingAgentSessionData,
  MetricSeriesFact,
} from "../services/coding-agent-session.types";

/**
 * The coding-agent session fold (ADR-056).
 *
 * One row per SESSION — the aggregate id is the provider session key (or the
 * fallback trace id), so a session that spans several traces folds into ONE
 * row and a metric-only session can exist at all. The dispatchers on the
 * source pipelines gate and lift, so every event that arrives here is a
 * coding-agent contribution; the fold only applies.
 *
 * Metric-fed fields (lines of code, commits, PRs, edit decisions, active
 * time) overlay through `metric_facts_contributed` with replace-not-increment
 * semantics per ADR-056 §5. The converged per-series totals themselves live
 * in `session_metric_series`.
 */
const codingAgentSessionEvents = [
  spanFactsContributedEventSchema,
  logFactsContributedEventSchema,
  metricFactsContributedEventSchema,
] as const;

/** Schema-snapshot version (calendar date). Bump when the derivation changes. */
export const CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST = "2026-07-21";

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
  implements
    FoldEventHandlers<typeof codingAgentSessionEvents, CodingAgentSessionState>
{
  readonly name = "codingAgentSession";
  readonly version = CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST;
  readonly store: FoldProjectionStore<CodingAgentSessionState>;

  protected readonly events = codingAgentSessionEvents;

  /**
   * The store reads its own last committed state back (ADR-066): the row now
   * round-trips the full working state, so `get()` returns it and nothing on
   * the delivery path reads `event_log`.
   *
   * `refoldOnStoreMiss` is gone — there is no null-returning miss to refold.
   * `refoldOnOutOfOrder` is off because the derivation is order-insensitive:
   * accumulators commute (sums, counters, min/max, bounded first-seen sets),
   * steps are inserted by their own `startedAtMs`, and the metric overlay
   * replaces per series. A late event folds onto the loaded state in place; no
   * history replay derives anything. (See the 2026-07-23 outage: unbounded
   * refolds starved ClickHouse merges into a platform-wide `TOO_MANY_PARTS`.)
   */
  override options: FoldProjectionOptions = { refoldOnOutOfOrder: false };

  constructor(deps: { store: FoldProjectionStore<CodingAgentSessionState> }) {
    super({
      createdAtKey: "createdAt",
      updatedAtKey: "updatedAt",
      LastEventOccurredAtKey: "LastEventOccurredAt",
    });
    this.store = deps.store;
  }

  protected initState(): CodingAgentSessionState {
    return {
      ...createInitCodingAgentSession(),
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
          ? addToBoundedSet(state.traceIds, data.traceId)
          : state.traceIds,
      // The session starts when its earliest signal does. Spans refine this
      // below with their own start time, which can predate arrival order.
      startedAtMs:
        state.startedAtMs === 0
          ? data.occurredAt
          : Math.min(state.startedAtMs, data.occurredAt),
    };
  }

  handleCodingAgentSessionSpanFactsContributed(
    event: SpanFactsContributedEvent,
    state: CodingAgentSessionState,
  ): CodingAgentSessionState {
    const data = event.data;
    const next = applySpanToCodingAgentSession({
      state,
      span: {
        name: data.name,
        startTimeUnixMs: data.startTimeUnixMs,
        endTimeUnixMs: data.endTimeUnixMs,
        statusCode: data.statusCode,
        attrs: data.facts,
      },
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
    const next = applyLogToCodingAgentSession({
      state,
      attributes: data.facts,
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
    const next = applyMetricToCodingAgentSession({
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
 * One converged metric unit, as it rides in the row's `MetricSeries` column
 * (migration 00053). Mirrors {@link MetricSeriesFact} but with the nullable
 * attribute fields flattened to empty strings for the ClickHouse tuple; they
 * map back to null on read-back.
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
  peakContextTokens: number;
  cacheRebuildCount: number;
  largestCacheRebuildTokens: number;

  failedTools: number;
  errorTypes: Record<string, number>;
  apiErrors: number;
  rateLimited: number;
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
  // store.get() can reconstruct it without replaying event_log.
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

/**
 * Project the fold state into the row. Every heavy thing stays out: the row
 * carries counters, bounded sets, and the IDS that reach the spans, the logs and
 * the response body — never their contents. The read-back columns (ADR-066)
 * carry the fold's working-state bookkeeping so `store.get()` round-trips.
 */
export function projectCodingAgentSessionToRow({
  state,
  tenantId,
  sessionId,
  version,
}: {
  state: CodingAgentSessionState;
  tenantId: string;
  /** The aggregate id — authoritative even when no signal spelled it out. */
  sessionId: string;
  version: string;
}): CodingAgentSessionRow {
  return {
    tenantId,
    sessionId,
    sessionKeySource: state.sessionKeySource,
    version,
    startedAtMs: state.startedAtMs,

    agent: state.agent ?? "",
    agentVersion: state.agentVersion ?? "",
    traceIds: state.traceIds,
    finalRequestId: state.finalRequestId ?? "",
    userId: state.userId ?? "",
    terminalType: state.terminalType ?? "",
    entrypoint: state.entrypoint ?? "",

    modelCalls: state.modelCalls,
    toolCalls: state.toolCalls,
    subAgents: state.subAgents,
    prompts: state.prompts,
    promptChars: state.promptChars,
    responseChars: state.responseChars,
    steps: state.steps.map((s) => [s.name, s.count, s.failed]),

    toolCounts: state.toolCounts,
    toolDurationMs: state.toolDurationMs,
    filesTouched: state.filesTouched,
    skills: state.skills,
    subAgentTypes: state.subAgentTypes,
    slashCommands: state.slashCommands,
    models: state.models,
    mcpServers: state.mcpServers,
    mcpTools: state.mcpTools,

    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    cacheReadTokens: state.cacheReadTokens,
    cacheCreationTokens: state.cacheCreationTokens,
    costUsd: state.costUsd,

    modelCallMs: state.modelCallMs,
    toolMs: state.toolMs,
    ttftMsTotal: state.ttftMsTotal,
    ttftSamples: state.ttftSamples,
    blockedOnUserMs: state.blockedOnUserMs,
    activeTimeUserSec: state.activeTimeUserSec,
    activeTimeCliSec: state.activeTimeCliSec,

    toolResultBytes: state.toolResultBytes,
    toolInputBytes: state.toolInputBytes,
    compactions: state.compactions,
    compactionTokensBefore: state.compactionTokensBefore,
    compactionTokensAfter: state.compactionTokensAfter,
    peakContextTokens: state.peakContextTokens,
    cacheRebuildCount: state.cacheRebuildCount,
    largestCacheRebuildTokens: state.largestCacheRebuildTokens,

    failedTools: state.failedTools,
    errorTypes: state.errorTypes,
    apiErrors: state.apiErrors,
    rateLimited: state.rateLimited,
    retriesExhausted: state.retriesExhausted,
    retryMs: state.retryMs,
    attempts: state.attempts,
    refusals: state.refusals,
    refusalCategories: state.refusalCategories,
    internalErrors: state.internalErrors,

    toolsDenied: state.toolsDenied,
    toolsAborted: state.toolsAborted,
    permissionMode: state.permissionMode ?? "",
    permissionChanges: state.permissionChanges,
    hooksBlocked: state.hooksBlocked,
    hooksCancelled: state.hooksCancelled,
    hookMs: state.hookMs,

    linesAdded: state.linesAdded,
    linesRemoved: state.linesRemoved,
    commits: state.commits,
    pullRequests: state.pullRequests,
    editsAccepted: state.editsAccepted,
    editsRejected: state.editsRejected,
    languagesEdited: state.languagesEdited,
    atMentions: state.atMentions,

    stopReason: state.stopReason ?? "",
    truncated: state.truncated,

    subAgentIds: state.subAgentIds,
    stepStartedAt: state.steps.map((s) => s.startedAtMs),
    previousCallContextTokens: state.previousCallContextTokens,
    metricSeries: Object.entries(state.metricSeries).map(
      ([seriesId, fact]) => ({
        seriesId,
        metricName: fact.metricName,
        type: fact.type ?? "",
        decision: fact.decision ?? "",
        language: fact.language ?? "",
        value: fact.value,
      }),
    ),
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    lastEventOccurredAt: state.LastEventOccurredAt,
  };
}

/** An empty string in a row column reads back as "unset" (null) in state. */
const nullIfEmpty = (value: string): string | null =>
  value === "" ? null : value;

/**
 * Rebuild the fold's working state from its persisted row — the inverse of
 * {@link projectCodingAgentSessionToRow} (ADR-066). This is what makes
 * `store.get()` lossless, so a cache miss reads one row back into state instead
 * of replaying the aggregate's history from `event_log`.
 *
 * The row mirrors the state field-for-field; the only conversions are the
 * nullable identity fields (stored as "" ) mapping back to null, `steps`
 * zipping with the parallel `stepStartedAt`, and `metricSeries` re-keying by
 * series id.
 */
export function rebuildCodingAgentSessionStateFromRow(
  row: CodingAgentSessionRow,
): CodingAgentSessionState {
  const metricSeries: Record<string, MetricSeriesFact> = Object.fromEntries(
    row.metricSeries.map((unit) => [
      unit.seriesId,
      {
        metricName: unit.metricName,
        type: nullIfEmpty(unit.type),
        decision: nullIfEmpty(unit.decision),
        language: nullIfEmpty(unit.language),
        value: unit.value,
      },
    ]),
  );

  return {
    agent: nullIfEmpty(row.agent),
    sessionId: nullIfEmpty(row.sessionId),
    agentVersion: nullIfEmpty(row.agentVersion),
    terminalType: nullIfEmpty(row.terminalType),
    entrypoint: nullIfEmpty(row.entrypoint),
    finalRequestId: nullIfEmpty(row.finalRequestId),
    userId: nullIfEmpty(row.userId),

    modelCalls: row.modelCalls,
    toolCalls: row.toolCalls,
    subAgents: row.subAgents,
    subAgentIds: row.subAgentIds,
    steps: row.steps.map((step, index) => ({
      name: step[0],
      count: step[1],
      failed: step[2],
      startedAtMs: row.stepStartedAt[index] ?? 0,
    })),
    prompts: row.prompts,
    promptChars: row.promptChars,
    responseChars: row.responseChars,

    toolCounts: row.toolCounts,
    toolDurationMs: row.toolDurationMs,
    filesTouched: row.filesTouched,
    skills: row.skills,
    subAgentTypes: row.subAgentTypes,
    slashCommands: row.slashCommands,
    models: row.models,
    mcpServers: row.mcpServers,
    mcpTools: row.mcpTools,

    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheCreationTokens: row.cacheCreationTokens,
    costUsd: row.costUsd,

    modelCallMs: row.modelCallMs,
    toolMs: row.toolMs,
    ttftMsTotal: row.ttftMsTotal,
    ttftSamples: row.ttftSamples,
    blockedOnUserMs: row.blockedOnUserMs,
    activeTimeUserSec: row.activeTimeUserSec,
    activeTimeCliSec: row.activeTimeCliSec,

    toolResultBytes: row.toolResultBytes,
    toolInputBytes: row.toolInputBytes,
    compactions: row.compactions,
    compactionTokensBefore: row.compactionTokensBefore,
    compactionTokensAfter: row.compactionTokensAfter,
    peakContextTokens: row.peakContextTokens,
    cacheRebuildCount: row.cacheRebuildCount,
    largestCacheRebuildTokens: row.largestCacheRebuildTokens,
    previousCallContextTokens: row.previousCallContextTokens,

    failedTools: row.failedTools,
    errorTypes: row.errorTypes,
    apiErrors: row.apiErrors,
    rateLimited: row.rateLimited,
    retriesExhausted: row.retriesExhausted,
    retryMs: row.retryMs,
    attempts: row.attempts,
    refusals: row.refusals,
    refusalCategories: row.refusalCategories,
    internalErrors: row.internalErrors,

    toolsDenied: row.toolsDenied,
    toolsAborted: row.toolsAborted,
    permissionMode: nullIfEmpty(row.permissionMode),
    permissionChanges: row.permissionChanges,
    hooksBlocked: row.hooksBlocked,
    hooksCancelled: row.hooksCancelled,
    hookMs: row.hookMs,

    metricSeries,
    linesAdded: row.linesAdded,
    linesRemoved: row.linesRemoved,
    commits: row.commits,
    pullRequests: row.pullRequests,
    editsAccepted: row.editsAccepted,
    editsRejected: row.editsRejected,
    languagesEdited: row.languagesEdited,
    atMentions: row.atMentions,

    stopReason: nullIfEmpty(row.stopReason),
    truncated: row.truncated,

    sessionKeySource: row.sessionKeySource,
    traceIds: row.traceIds,
    startedAtMs: row.startedAtMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    LastEventOccurredAt: row.lastEventOccurredAt,
  };
}
