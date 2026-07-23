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
import type { CodingAgentSessionData } from "../services/coding-agent-session.types";

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
   * The row is an aggregate, not a copy, so it cannot be read back into state
   * (the counters are there, but the step ordering and the "first seen" identity
   * rules are not reconstructable from it). On a cache miss the executor must
   * rebuild from the event log, or a partial batch would overwrite a complete
   * session with only the events in that batch.
   */
  override options: FoldProjectionOptions = { refoldOnStoreMiss: true };

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
 * The row that lands in `coding_agent_sessions` (migration 00051). Field names
 * mirror the ClickHouse columns 1:1 so the repository's record literal is a
 * straight mapping.
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
}

/**
 * Project the fold state into the row. Every heavy thing stays out: the row
 * carries counters, bounded sets, and the IDS that reach the spans, the logs and
 * the response body — never their contents.
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
  };
}
