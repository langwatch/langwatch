import type { FoldProjectionOptions, FoldProjectionStore } from "@langwatch/eventing";
import { AbstractFoldProjection, type FoldEventHandlers } from "@langwatch/eventing";
import type { CodingAgentCostEstimatorPort } from "../ports/coding-agent-cost-estimator.port";
import type { TraceCanonicalisationService } from "@langwatch/trace-contract";
import {
  type LogFactsContributedEvent,
  logFactsContributedEventSchema,
  type MetricFactsContributedEvent,
  metricFactsContributedEventSchema,
  type SpanFactsContributedEvent,
  spanFactsContributedEventSchema,
} from "@langwatch/coding-agent-contract";
import {
  type CodingAgentSessionData,
  type MetricSeriesFact,
  type SessionTitleSource,
  CodingAgentSessionStateProjection,
  sessionTitleSourceSchema,
} from "./coding-agent-session-state.projection";
import { CodingAgentSessionSpanProjection } from "./coding-agent-session-span.projection";
import { CodingAgentSessionLogProjection } from "./coding-agent-session-log.projection";
import { CodingAgentSessionMetricProjection } from "./coding-agent-session-metric.projection";

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
 *
 * State continuity (ADR-066): the store reads its own last committed row back
 * (`get` → `findBySessionIdWithApplied` → `CodingAgentSessionStateMapper.fromRow`).
 * The typed read-back columns (migrations 00053/00054) close the round-trip gap
 * the projected row otherwise left, so the delivery path does not re-fold from
 * the event log. Read-back applies only to rows stamped with the current
 * projection version — a row written before those columns existed is reported
 * as a miss and refolded once, then rewritten at the current version (see
 * `options` below).
 */
const codingAgentSessionEvents = [
  spanFactsContributedEventSchema,
  logFactsContributedEventSchema,
  metricFactsContributedEventSchema,
] as const;

/**
 * Schema-snapshot version. Bump when replay must rebuild persisted state.
 * This version moves reported cost to `AgentReportedCostUsd` and recomputes
 * `CostUsd` from stored span contributions (migration 00085). Older schema
 * transitions live with migrations 00053, 00054, 00074, 00075, and 00077.
 */
export const CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST = "2026-08-23";

/**
 * The stamp rows carried while migrations 00053 and 00054 shipped.
 *
 * Neither migration bumped the projection version, so this stamp spans BOTH
 * sides of the read-back columns: rows written before 00053 deployed carry it
 * with those columns absent, and rows written after carry it with them fully
 * populated. The version alone therefore cannot decide whether a row is
 * decodable — see `EventingCodingAgentSessionStoreAdapter.getWithApplied` for the second half
 * of the discriminator.
 *
 * Still accepted after the 2026-07-28, 2026-08-02 and 2026-08-10 bumps,
 * deliberately: these rows predate
 * the logs-only fold entirely, so no agent folded a turn from both a log and a
 * span into them. They are stale in shape, never double-counted, and the
 * discriminator already covers the shape. (The same trade holds for the 00074
 * context-economics columns: a pre-stamp row decodes them as zeros, which is
 * honest for sessions that old, and a replay can backfill them if they ever
 * matter. And for the 00077 branch set: a pre-stamp row decodes it empty, and
 * the read side falls back to the single branch such a row does carry.)
 *
 * Rejecting them would buy nothing anyway. They also predate Cowork detection,
 * so their contributions were stored labelled `claude_code` and a refold
 * replays exactly that (see the version docblock above) — the label and the
 * logs-only counts it gates are only corrected by re-ingestion, never by
 * refolding. Accepting the stamp trades no correctness for one avoided refold
 * wave over every session that predates migrations 00053/00054.
 */
export const CODING_AGENT_SESSION_PROJECTION_VERSION_PRE_STAMP = "2026-07-21";

/**
 * How far a session's StartedAt (the table's partition column) may drift from
 * the business time a read is anchored on — a folded event's occurredAt, or a
 * trace-session mapping's timestamp. Sessions run for hours and a late signal
 * can move StartedAt backwards, so the window is ±7 days rather than pinned to
 * the exact ms. Declared once here, on the fold; direct callers derive their
 * window from this too, never from their own arithmetic.
 */
export const CODING_AGENT_SESSION_READ_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How many same-session events one load/apply/store cycle may coalesce.
 *
 * Lower than the platform default (500) because this fold persists the
 * applied-event-id watermark INTO its ClickHouse row (migration 00054): on a
 * fresh delivery the stored set is exactly the batch's ids, so the coalesce
 * ceiling IS the per-row watermark size. `coding_agent_sessions` is a
 * ReplacingMergeTree that only collapses rows sharing the full sort key, and a
 * late earlier-starting span shifts StartedAt, so superseded row versions — each
 * carrying their own watermark — survive until TTL. 128 ids is a few KB per
 * version instead of ~15-20 KB, and still drains a backed-up hot session in
 * 128-event bites: the amplification collapse comes from coalescing at all, not
 * from the size of the ceiling.
 *
 * Must stay below MAX_APPLIED_EVENT_IDS (the Redis cache trims the set at that
 * cap; a batch at or above it would break redelivery dedup — the projection
 * router rejects such a config at registration).
 */
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
   * off because accumulators commute and steps order by their own time. The
   * window prunes StartedAt partitions, with an unbounded retry on a miss.
   * See `EventingCodingAgentSessionStoreAdapter.getWithApplied` for the legacy checkpoint.
   */
  override options: FoldProjectionOptions = {
    refoldOnStoreMiss: true,
    refoldOnOutOfOrder: false,
    readWindow: { widthMs: CODING_AGENT_SESSION_READ_WINDOW_MS },
    coalesceMaxBatch: CODING_AGENT_SESSION_COALESCE_MAX_BATCH,
  };

  private constructor(deps: {
    store: FoldProjectionStore<CodingAgentSessionState>;
    traceCanonicalisation: TraceCanonicalisationService;
    modelProviders: CodingAgentCostEstimatorPort;
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
    traceCanonicalisation: TraceCanonicalisationService;
    modelProviders: CodingAgentCostEstimatorPort;
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

/**
 * Project the fold state into the row. Every heavy thing stays out: the row
 * carries counters, bounded sets, and the IDS that reach the spans, the logs and
 * the response body — never their contents. The read-back columns (ADR-066)
 * carry the fold's working-state bookkeeping so `store.get()` round-trips.
 */
export class CodingAgentSessionRowMapper {
  private constructor() {}

  static toRow({
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
      parentSessionId: state.parentSessionId ?? "",
      isFork: state.isFork,
      ...gitContextColumns(state),

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
      agentReportedCostUsd: state.agentReportedCostUsd,

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
      compactionTriggers: state.compactionTriggers,
      peakContextTokens: state.peakContextTokens,
      cacheRebuildCount: state.cacheRebuildCount,
      largestCacheRebuildTokens: state.largestCacheRebuildTokens,

      failedTools: state.failedTools,
      errorTypes: state.errorTypes,
      apiErrors: state.apiErrors,
      rateLimited: state.rateLimited,
      rateLimitEvents: state.rateLimitEvents,
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
      metricSeries: Object.entries(state.metricSeries).map(([seriesId, fact]) => ({
        seriesId,
        metricName: fact.metricName,
        type: fact.type ?? "",
        decision: fact.decision ?? "",
        language: fact.language ?? "",
        value: fact.value,
      })),
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      lastEventOccurredAt: state.LastEventOccurredAt,
    };
  }
}

/**
 * The git identity and title columns (migrations 00075 and 00077). The empty
 * string is the honest unset for the six scalars: an agent with no companion
 * emitter reports none of them, and `nullIfEmpty` maps them straight back on
 * read. `gitBranches` is an empty array for the same reason.
 */
function gitContextColumns(state: CodingAgentSessionState): {
  repositoryHost: string;
  repositoryOwner: string;
  repositoryName: string;
  gitBranch: string;
  gitBranches: string[];
  gitWorktree: string;
  title: string;
  titleSource: string;
} {
  return {
    repositoryHost: state.repositoryHost ?? "",
    repositoryOwner: state.repositoryOwner ?? "",
    repositoryName: state.repositoryName ?? "",
    gitBranch: state.gitBranch ?? "",
    gitBranches: state.gitBranches,
    gitWorktree: state.gitWorktree ?? "",
    title: state.title ?? "",
    titleSource: state.titleSource ?? "",
  };
}

/**
 * The title-source column decodes into its union; anything else — the empty
 * default on a pre-00083 row included — reads as unset, which the fold ranks
 * as a generated title (see `withTitle`).
 */
const titleSourceFromRow = (value: string): SessionTitleSource | null =>
  sessionTitleSourceSchema.safeParse(value).data ?? null;

/** An empty string in a row column reads back as "unset" (null) in state. */
const nullIfEmpty = (value: string): string | null => (value === "" ? null : value);

/**
 * Decode the fold's working state from its persisted row — the `fromRow`
 * inverse of {@link CodingAgentSessionRowMapper.toRow} (ADR-066).
 *
 * This is a deserialize, NOT a rebuild. A rebuild replays the aggregate's
 * history from `event_log`; this only maps the columns of the last committed
 * projection back into the state shape, so `store.get()` can return the state
 * that Redis (or, on a miss, ClickHouse) already holds. It derives nothing.
 *
 * The row mirrors the state field-for-field; the only conversions are the
 * nullable identity fields (stored as "" ) mapping back to null, `steps`
 * zipping with the parallel `stepStartedAt`, and `metricSeries` re-keying by
 * series id.
 *
 * This decoder is TOTAL: handed a row whose read-back columns are absent it
 * still answers, mapping the ClickHouse column defaults to state defaults (no
 * sub-agent ids, every step starting at 0, no previous context size, no metric
 * units). Those defaults are indistinguishable from real values, so deciding
 * WHETHER a row may be decoded is the store's job, not this function's:
 * `getWithApplied` refuses any row stamped with an older projection version and
 * reports a store miss, and the fold's `refoldOnStoreMiss` rebuilds that session
 * from `event_log` once. A caller that bypasses the version gate gets the
 * defaults above.
 */
export class CodingAgentSessionStateMapper {
  private constructor() {}

  static fromRow(row: CodingAgentSessionRow): CodingAgentSessionState {
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
      parentSessionId: nullIfEmpty(row.parentSessionId),
      isFork: row.isFork,
      repositoryHost: nullIfEmpty(row.repositoryHost),
      repositoryOwner: nullIfEmpty(row.repositoryOwner),
      repositoryName: nullIfEmpty(row.repositoryName),
      gitBranch: nullIfEmpty(row.gitBranch),
      gitBranches: row.gitBranches,
      gitWorktree: nullIfEmpty(row.gitWorktree),
      title: nullIfEmpty(row.title),
      titleSource: titleSourceFromRow(row.titleSource),

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
      agentReportedCostUsd: row.agentReportedCostUsd,

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
      compactionTriggers: row.compactionTriggers,
      peakContextTokens: row.peakContextTokens,
      cacheRebuildCount: row.cacheRebuildCount,
      largestCacheRebuildTokens: row.largestCacheRebuildTokens,
      previousCallContextTokens: row.previousCallContextTokens,

      failedTools: row.failedTools,
      errorTypes: row.errorTypes,
      apiErrors: row.apiErrors,
      rateLimited: row.rateLimited,
      rateLimitEvents: row.rateLimitEvents,
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
}
