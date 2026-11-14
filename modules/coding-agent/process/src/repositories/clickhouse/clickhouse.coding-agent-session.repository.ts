import { performance } from "node:perf_hooks";

import type { Authorization } from "@langwatch/authorization";
import { type ClickHouseQueryClient, indexWindow } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  cond,
  type Condition,
  fn,
  QueryBuilderError,
  type ProofScope,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import type {
  CodingAgentSession,
  CodingAgentSessionBranchRecord,
  CodingAgentSessionContextUsage,
  CodingAgentUsageCount,
} from "@langwatch/coding-agent-contract";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import type { CodingAgentClock } from "../../services/coding-agent-clock.service.ts";
import {
  type CodingAgentReadMetrics,
  type CodingAgentSessionListReadOutcome,
  type CodingAgentSessionRepository as SessionRepository,
  type OtherSessionKind,
  type SessionIdIndexRead,
  SessionIdIndexNotReadyError,
} from "../coding-agent-session.repository.ts";
import { codingAgentSessionsIdIndex } from "./clickhouse.coding-agent-sessions-id-index.table.ts";
import { codingAgentSessions } from "./clickhouse.coding-agent-sessions.table.ts";
import {
  clickHouseMomentOf,
  asNumber,
  asStringArray,
  parseClickHouseDateTimeMs,
  type ClickHouseMoment,
} from "./clickhouse.mapper.ts";

const TABLE_NAME = "coding_agent_sessions" as const;
const SESSION_ID_KEY = ["SessionId"] as const;

const sessions = codingAgentSessions;
const index = codingAgentSessionsIdIndex;

/** The client calls this repository makes: built reads, inserts, and the id index's readiness. */
type SessionsClickHouse = Pick<ClickHouseQueryClient, "read" | "insert" | "targetOf" | "idIndexes">;

/** Where a dedup scan may look: the whole tenant, or a `StartedAt` span from the id index. */
type DedupBound = { kind: "unbounded" } | { kind: "within"; fromMs: number; toMs: number };

/** No bound: the statement as it read before the id index. */
const UNBOUNDED: DedupBound = { kind: "unbounded" };

/** The sessions a read can reach, per the id index: how many, and all their versions' span. */
type SessionSpan = { n: number; fromMs: number; toMs: number };

const sessionSpanRowsSchema = z.array(
  z.object({ n: z.coerce.number(), fromMs: z.coerce.number(), toMs: z.coerce.number() }),
);

/** Which tenants a span read covers: one tenant, or an organization's declared set. */
type SpanTenants = { tenantId: string; tenantIds?: readonly string[] };

/** `target:read` pairs already warned about a not-ready index; the counter has the rest. */
const warnedNotReady = new Set<string>();

/** Every stored column, as `SELECT *` read them: `fromRecord` decodes the row. */
const { $table: _sessionsFacts, ...ALL_SESSION_COLUMNS } = sessions;

/** The tuple an election matches each row against: its key and the newest version. */
const ELECTED_VERSION = fn.tuple(sessions.TenantId, sessions.SessionId, fn.max(sessions.UpdatedAt));
const ROW_VERSION = fn.tuple(sessions.TenantId, sessions.SessionId, sessions.UpdatedAt);

/** `StartedAt` inside a dedup bound; none when the bound is the whole tenant. */
function withinBound(bound: DedupBound): Condition<"coding_agent_sessions">[] {
  return bound.kind === "unbounded"
    ? []
    : [
        cond.and(
          cond.gte(sessions.StartedAt, bound.fromMs),
          cond.lte(sessions.StartedAt, bound.toMs),
        ),
      ];
}

const asString = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : "";
type CodingAgentSessionRow = CodingAgentSession;
type CodingAgentSessionMetricSeriesRow = CodingAgentSession["metricSeries"][number];
type CodingAgentBranchSessionRow = CodingAgentSessionBranchRecord;

/**
 * The columns behind a `CodingAgentBranchSessionRow`: only what the pull-request rollup
 * adds up, groups by and names, plus the scalar tie-break keys — never content. Shared by
 * the branch read and the by-id read so the two can never answer with different shapes.
 */
const BRANCH_SESSION_COLUMNS = {
  SessionId: sessions.SessionId,
  TenantId: sessions.TenantId,
  StartedAt: sessions.StartedAt,
  InputTokens: sessions.InputTokens,
  OutputTokens: sessions.OutputTokens,
  CacheReadTokens: sessions.CacheReadTokens,
  CacheCreationTokens: sessions.CacheCreationTokens,
  CostUsd: sessions.CostUsd,
  Agent: sessions.Agent,
  Models: sessions.Models,
  UserId: sessions.UserId,
  GitBranch: sessions.GitBranch,
  GitBranches: sessions.GitBranches,
  UsageByContext: sessions.UsageByContext,
  Title: sessions.Title,
  LastEventOccurredAt: sessions.LastEventOccurredAt,
  ModelCalls: sessions.ModelCalls,
  ToolCalls: sessions.ToolCalls,
  Prompts: sessions.Prompts,
} as const;

/**
 * How much `findManyRecent` over-reads so its TypeScript dedup cannot shorten the page.
 */
const LIST_READ_DEDUP_OVERFETCH = 2;

const logger = createLogger("langwatch:coding-agent:session-repository");

/**
 * ClickHouse persistence for the coding-agent session row (ADR-056,
 * migration 00051).
 */
interface ClickHouseWriteRecord {
  [key: string]: unknown;
  TenantId: string;
  SessionId: string;
  SessionKeySource: string;
  Version: string;
  StartedAt: ClickHouseMoment;
  CreatedAt: ClickHouseMoment;
  UpdatedAt: ClickHouseMoment;

  Agent: string;
  AgentVersion: string;
  TraceIds: string[];
  FinalRequestId: string;
  UserId: string;
  TerminalType: string;
  Entrypoint: string;
  ParentSessionId: string;
  IsFork: boolean;
  Auxiliary: boolean;
  RepositoryHost: string;
  RepositoryOwner: string;
  RepositoryName: string;
  GitBranch: string;
  GitBranches: string[];
  GitWorktree: string;
  Title: string;
  TitleSource: string;

  ModelCalls: number;
  ToolCalls: number;
  SubAgents: number;
  Prompts: number;
  PromptChars: string;
  ResponseChars: string;
  Steps: [string, number, boolean][];

  ToolCounts: Record<string, number>;
  ToolDurationMs: Record<string, string>;
  FilesTouched: string[];
  Skills: string[];
  SubAgentTypes: string[];
  SlashCommands: string[];
  Models: string[];
  McpServers: string[];
  McpTools: string[];

  InputTokens: string;
  OutputTokens: string;
  CacheReadTokens: string;
  CacheCreationTokens: string;
  CostUsd: number;
  AgentReportedCostUsd: number;
  // Array(Tuple(RepositoryHost, RepositoryOwner, RepositoryName, Branch,
  // InputTokens, OutputTokens, CacheReadTokens, CacheCreationTokens, CostUsd));
  // the UInt64 members ride as strings like every other UInt64 column.
  UsageByContext: [string, string, string, string, string, string, string, string, number][];

  ModelCallMs: string;
  ToolMs: string;
  TtftMsTotal: string;
  TtftSamples: number;
  BlockedOnUserMs: string;
  ActiveTimeUserSec: string;
  ActiveTimeCliSec: string;

  ToolResultBytes: string;
  ToolInputBytes: string;
  Compactions: number;
  CompactionTokensBefore: string;
  CompactionTokensAfter: string;
  CompactionTriggers: Record<string, number>;
  PeakContextTokens: string;
  CacheRebuildCount: number;
  LargestCacheRebuildTokens: string;

  FailedTools: number;
  ErrorTypes: Record<string, number>;
  ApiErrors: number;
  RateLimited: number;
  RateLimitEvents: number;
  RetriesExhausted: number;
  RetryMs: string;
  Attempts: number;
  Refusals: number;
  RefusalCategories: string[];
  InternalErrors: number;

  ToolsDenied: number;
  ToolsAborted: number;
  PermissionMode: string;
  PermissionChanges: number;
  HooksBlocked: number;
  HooksCancelled: number;
  HookMs: string;

  LinesAdded: string;
  LinesRemoved: string;
  Commits: number;
  PullRequests: number;
  EditsAccepted: number;
  EditsRejected: number;
  LanguagesEdited: string[];
  AtMentions: number;

  StopReason: string;
  Truncated: boolean;

  // ── Read-back state (ADR-066, migration 00053) ─────────────────────────
  SubAgentIds: string[];
  // UInt64 arrays / scalars ride as strings, like the other UInt64 columns.
  StepStartedAt: string[];
  PreviousCallContextTokens: string;
  // Array(Tuple(SeriesId, MetricName, Type, Decision, Language, Value)).
  MetricSeries: [string, string, string, string, string, number][];
  LastEventOccurredAt: ClickHouseMoment;

  // ── Durable dedup watermark (ADR-066, migration 00054) ─────────────────
  // The applied-event-id set the executor checks a redelivery against. Not fold
  // state and not analytics — it rides next to the row so dedup survives cache
  // loss.
  AppliedEventIds: string[];

  _retention_days: number;
}

/** UInt64 columns ride as strings — see the interface docblock. */
const big = (n: number): string => String(Math.max(0, Math.round(n)));

function toBranchSessionRow(record: Record<string, unknown>): CodingAgentBranchSessionRow {
  return {
    sessionId: asString(record.SessionId),
    tenantId: asString(record.TenantId),
    startedAtMs: parseClickHouseDateTimeMs(asString(record.StartedAt)),
    lastEventOccurredAtMs: parseClickHouseDateTimeMs(asString(record.LastEventOccurredAt)),
    inputTokens: asNumber(record.InputTokens),
    outputTokens: asNumber(record.OutputTokens),
    cacheReadTokens: asNumber(record.CacheReadTokens),
    cacheCreationTokens: asNumber(record.CacheCreationTokens),
    costUsd: asNumber(record.CostUsd),
    agent: asString(record.Agent),
    models: asStringArray(record.Models),
    userId: asString(record.UserId),
    gitBranch: asString(record.GitBranch),
    gitBranches: asStringArray(record.GitBranches),
    usageByContext: asContextUsageRows(record.UsageByContext),
    title: asString(record.Title),
  };
}

function toRecord({
  row,
  retentionDays,
  appliedEventIds = [],
  versionStampMs,
}: {
  row: CodingAgentSessionRow;
  retentionDays?: number;
  appliedEventIds?: readonly string[];
  versionStampMs: number;
}): ClickHouseWriteRecord {
  const now = clickHouseMomentOf(nowInstant().epochMilliseconds);
  return {
    TenantId: row.tenantId,
    SessionId: row.sessionId,
    SessionKeySource: row.sessionKeySource,
    Version: row.version,
    StartedAt: clickHouseMomentOf(row.startedAtMs),
    // Preserve first-seen creation across re-folds; UpdatedAt is the RMT
    // version and must be strictly greater than the version it supersedes —
    // see nextVersionStamp for why write time alone is not enough.
    CreatedAt: row.createdAt > 0 ? clickHouseMomentOf(row.createdAt) : now,
    UpdatedAt: clickHouseMomentOf(versionStampMs),

    Agent: row.agent,
    AgentVersion: row.agentVersion,
    TraceIds: row.traceIds,
    FinalRequestId: row.finalRequestId,
    UserId: row.userId,
    TerminalType: row.terminalType,
    Entrypoint: row.entrypoint,
    ParentSessionId: row.parentSessionId,
    IsFork: row.isFork,
    Auxiliary: row.auxiliary,
    RepositoryHost: row.repositoryHost,
    RepositoryOwner: row.repositoryOwner,
    RepositoryName: row.repositoryName,
    GitBranch: row.gitBranch,
    GitBranches: row.gitBranches,
    UsageByContext: row.usageByContext.map((usage) => [
      usage.repositoryHost,
      usage.repositoryOwner,
      usage.repositoryName,
      usage.branch,
      big(usage.inputTokens),
      big(usage.outputTokens),
      big(usage.cacheReadTokens),
      big(usage.cacheCreationTokens),
      usage.costUsd,
    ]),
    GitWorktree: row.gitWorktree,
    Title: row.title,
    TitleSource: row.titleSource,

    ModelCalls: row.modelCalls,
    ToolCalls: row.toolCalls,
    SubAgents: row.subAgents,
    Prompts: row.prompts,
    PromptChars: big(row.promptChars),
    ResponseChars: big(row.responseChars),
    Steps: row.steps,

    ToolCounts: row.toolCounts,
    ToolDurationMs: Object.fromEntries(
      Object.entries(row.toolDurationMs).map(([k, v]) => [k, big(v)]),
    ),
    FilesTouched: row.filesTouched,
    Skills: row.skills,
    SubAgentTypes: row.subAgentTypes,
    SlashCommands: row.slashCommands,
    Models: row.models,
    McpServers: row.mcpServers,
    McpTools: row.mcpTools,

    InputTokens: big(row.inputTokens),
    OutputTokens: big(row.outputTokens),
    CacheReadTokens: big(row.cacheReadTokens),
    CacheCreationTokens: big(row.cacheCreationTokens),
    CostUsd: row.costUsd,
    AgentReportedCostUsd: row.agentReportedCostUsd,

    ModelCallMs: big(row.modelCallMs),
    ToolMs: big(row.toolMs),
    TtftMsTotal: big(row.ttftMsTotal),
    TtftSamples: row.ttftSamples,
    BlockedOnUserMs: big(row.blockedOnUserMs),
    ActiveTimeUserSec: big(row.activeTimeUserSec),
    ActiveTimeCliSec: big(row.activeTimeCliSec),

    ToolResultBytes: big(row.toolResultBytes),
    ToolInputBytes: big(row.toolInputBytes),
    Compactions: row.compactions,
    CompactionTokensBefore: big(row.compactionTokensBefore),
    CompactionTokensAfter: big(row.compactionTokensAfter),
    CompactionTriggers: row.compactionTriggers,
    PeakContextTokens: big(row.peakContextTokens),
    CacheRebuildCount: row.cacheRebuildCount,
    LargestCacheRebuildTokens: big(row.largestCacheRebuildTokens),

    FailedTools: row.failedTools,
    ErrorTypes: row.errorTypes,
    ApiErrors: row.apiErrors,
    RateLimited: row.rateLimited,
    RateLimitEvents: row.rateLimitEvents,
    RetriesExhausted: row.retriesExhausted,
    RetryMs: big(row.retryMs),
    Attempts: row.attempts,
    Refusals: row.refusals,
    RefusalCategories: row.refusalCategories,
    InternalErrors: row.internalErrors,

    ToolsDenied: row.toolsDenied,
    ToolsAborted: row.toolsAborted,
    PermissionMode: row.permissionMode,
    PermissionChanges: row.permissionChanges,
    HooksBlocked: row.hooksBlocked,
    HooksCancelled: row.hooksCancelled,
    HookMs: big(row.hookMs),

    LinesAdded: big(row.linesAdded),
    LinesRemoved: big(row.linesRemoved),
    Commits: row.commits,
    PullRequests: row.pullRequests,
    EditsAccepted: row.editsAccepted,
    EditsRejected: row.editsRejected,
    LanguagesEdited: row.languagesEdited,
    AtMentions: row.atMentions,

    StopReason: row.stopReason,
    Truncated: row.truncated,

    SubAgentIds: row.subAgentIds,
    StepStartedAt: row.stepStartedAt.map(big),
    PreviousCallContextTokens: big(row.previousCallContextTokens),
    MetricSeries: row.metricSeries.map((unit) => [
      unit.seriesId,
      unit.metricName,
      unit.type,
      unit.decision,
      unit.language,
      unit.value,
    ]),
    LastEventOccurredAt: clickHouseMomentOf(row.lastEventOccurredAt),

    AppliedEventIds: [...appliedEventIds],

    _retention_days: retentionDays ?? 0,
  };
}

export class CodingAgentSessionClickHouseRepository implements SessionRepository {
  private readonly clickhouse: SessionsClickHouse;
  private readonly defaultTraceRetentionDays: number;
  private readonly metrics: CodingAgentReadMetrics;
  private readonly clock: CodingAgentClock;

  private constructor({
    clickhouse,
    defaultTraceRetentionDays,
    metrics,
    clock,
  }: {
    clickhouse: SessionsClickHouse;
    defaultTraceRetentionDays: number;
    metrics: CodingAgentReadMetrics;
    clock: CodingAgentClock;
  }) {
    this.clickhouse = clickhouse;
    this.defaultTraceRetentionDays = defaultTraceRetentionDays;
    this.metrics = metrics;
    this.clock = clock;
  }

  /**
   * A `StartedAt` bound holding every version of the sessions a read can reach, from the id
   * index: those overlapping `overlapping`, less `excludeSessionIds`. `null` when there are none.
   * Not ready, a read either runs as before the index (counted) or is refused (ADR-071).
   */
  private async spanBound({
    read,
    tenants,
    overlapping,
    excludeSessionIds,
    whenNotReady,
  }: {
    read: SessionIdIndexRead;
    tenants: SpanTenants;
    overlapping?: { fromMs: number; toMs?: number };
    excludeSessionIds?: string[];
    whenNotReady: "unbounded" | "refuse";
  }): Promise<DedupBound | null> {
    const target = await this.clickhouse.targetOf({ tenantId: tenants.tenantId });
    const ready = this.clickhouse
      .idIndexes()
      .isReady({ source: TABLE_NAME, key: SESSION_ID_KEY, target });
    if (!ready) {
      this.reportIndexNotReady({ read, target, tenantId: tenants.tenantId, whenNotReady });
      if (whenNotReady === "refuse") throw new SessionIdIndexNotReadyError({ read });
      return UNBOUNDED;
    }
    const span = await this.sessionSpan({ tenants, overlapping, excludeSessionIds });
    return span.n === 0 ? null : startedAtWithin(span);
  }

  /** Counts every not-ready read, and warns once per read kind and target per process. */
  private reportIndexNotReady({
    read,
    target,
    tenantId,
    whenNotReady,
  }: {
    read: SessionIdIndexRead;
    target: string;
    tenantId: string;
    whenNotReady: "unbounded" | "refuse";
  }): void {
    this.metrics.countSessionIdIndexNotReady({ read, target });
    const key = `${target}:${read}`;
    if (warnedNotReady.has(key)) return;
    warnedNotReady.add(key);
    logger.warn(
      { read, target, tenantId, whenNotReady },
      "coding-agent session id index not ready, the read ran without its bound or was refused",
    );
  }

  /** One read of the id index: the sessions' count and the span of all their versions. */
  private async sessionSpan({
    tenants,
    overlapping,
    excludeSessionIds,
  }: {
    tenants: SpanTenants;
    overlapping?: { fromMs: number; toMs?: number };
    excludeSessionIds?: string[];
  }): Promise<SessionSpan> {
    const { tenantId, tenantIds } = tenants;
    const scope =
      tenantIds === undefined ? tenantScope.single({ tenantId }) : tenantScope.set({ tenantIds });
    let perSession = clickhouseRead({ scope })
      .from(index)
      .select({
        TenantId: index.TenantId,
        SessionId: index.SessionId,
        SessionFromAt: fn.min(index.FromAt),
        SessionToAt: fn.max(index.ToAt),
      })
      .groupBy(index.TenantId, index.SessionId);
    if (excludeSessionIds !== undefined && excludeSessionIds.length > 0) {
      perSession = perSession.where(({ not, oneOf }) =>
        not(oneOf(index.SessionId, excludeSessionIds)),
      );
    }
    if (overlapping !== undefined) {
      perSession = perSession.having(({ gte }) => gte(fn.max(index.ToAt), overlapping.fromMs));
    }
    if (overlapping?.toMs !== undefined) {
      const toMs = overlapping.toMs;
      perSession = perSession.having(({ lte }) => lte(fn.min(index.FromAt), toMs));
    }
    const spans = perSession.as("sessions");
    const statement = clickhouseRead({ scope })
      .from(spans)
      .select({
        n: fn.count(),
        fromMs: fn.toUnixTimestamp64Milli(fn.min(spans.SessionFromAt)),
        toMs: fn.toUnixTimestamp64Milli(fn.max(spans.SessionToAt)),
      })
      .build();
    const { rows } = await this.clickhouse.read({ statement });
    return sessionSpanRowsSchema.parse(rows)[0] ?? { n: 0, fromMs: 0, toMs: 0 };
  }

  static create(deps: {
    clickhouse: SessionsClickHouse;
    defaultTraceRetentionDays: number;
    metrics: CodingAgentReadMetrics;
    clock: CodingAgentClock;
  }): CodingAgentSessionClickHouseRepository {
    return new CodingAgentSessionClickHouseRepository({
      clickhouse: deps.clickhouse,
      defaultTraceRetentionDays: deps.defaultTraceRetentionDays,
      metrics: deps.metrics,
      clock: deps.clock,
    });
  }

  /**
   * Monotonic floor for the RMT version stamp this writer issues.
   */
  private lastVersionStampMs = 0;

  private nextVersionStamp(priorUpdatedAtMs: number): number {
    const stamp = Math.max(this.clock.nowMs(), priorUpdatedAtMs + 1, this.lastVersionStampMs + 1);
    this.lastVersionStampMs = stamp;
    return stamp;
  }

  async upsert(
    row: CodingAgentSessionRow,
    retentionDays?: number,
    appliedEventIds?: readonly string[],
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "CodingAgentSessionClickHouseRepository.upsert",
    );
    try {
      await this.clickhouse.insert({
        tenantId: row.tenantId,
        table: TABLE_NAME,
        rows: [
          toRecord({
            row,
            retentionDays: retentionDays ?? this.defaultTraceRetentionDays,
            appliedEventIds,
            versionStampMs: this.nextVersionStamp(row.updatedAt),
          }),
        ],
        settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
        { error, tenantId: row.tenantId, sessionId: row.sessionId },
        "failed to upsert coding agent session",
      );
      throw error;
    }
  }

  /**
   * Reads the latest raw session record without `FINAL`: late signals can move `StartedAt`.
   * A caller's window bounds the outer scan only, since a newer version may sit outside it;
   * the id index (once ready) bounds every dedup scan to the range all versions span.
   */
  private async findLatestRecord({
    tenantId,
    sessionId,
    window,
  }: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<Record<string, unknown> | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "CodingAgentSessionClickHouseRepository.findBySessionId",
    );
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
      .from(sessions)
      .with("latest", (sub) =>
        sub
          .from(sessions)
          .select({ Elected: ELECTED_VERSION })
          .where(({ and, eq, idBound }) =>
            and(eq(sessions.SessionId, sessionId), idBound(sessions.SessionId, sessionId)),
          )
          .groupBy(sessions.TenantId, sessions.SessionId),
      )
      .select(ALL_SESSION_COLUMNS)
      .where(({ and, eq, gte, idBound, lte, oneOf }) =>
        and(
          eq(sessions.SessionId, sessionId),
          // A caller's window bounds the outer scan only: a newer version may sit outside it.
          window === undefined
            ? idBound(sessions.SessionId, sessionId)
            : and(gte(sessions.StartedAt, window.fromMs), lte(sessions.StartedAt, window.toMs)),
          oneOf(ROW_VERSION, { cte: "latest" }),
        ),
      )
      // The newest version first; ties keep the one that folded the most (ADR-071).
      .orderBy(sessions.LastEventOccurredAt, "DESC")
      .orderBy(fn.plus(fn.plus(sessions.ModelCalls, sessions.ToolCalls), sessions.Prompts), "DESC")
      .orderBy(fn.length(sessions.MetricSeries), "DESC")
      .orderBy(fn.length(sessions.AppliedEventIds), "DESC")
      .orderBy(sessions.StartedAt, "ASC")
      .limit(1)
      .build();
    const { rows } = await this.clickhouse.read({ statement, idBound: { fallback: "unbounded" } });
    return rows[0] ?? null;
  }

  /** One session by its key, or null. */
  async findBySessionId(params: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<CodingAgentSessionRow | null> {
    const record = await this.findLatestRecord(params);
    return record ? fromRecord(record) : null;
  }

  /**
   * The session plus its applied-event-id watermark (ADR-066, migration 00054).
   * One ClickHouse read — the same query as `findBySessionId` — with the
   * watermark carried alongside the mapped row rather than inside it.
   */
  async findBySessionIdWithApplied(params: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{
    row: CodingAgentSessionRow;
    appliedEventIds: string[];
  } | null> {
    const record = await this.findLatestRecord(params);
    if (!record) return null;
    return {
      row: fromRecord(record),
      appliedEventIds: asStringArray(record.AppliedEventIds),
    };
  }

  /**
   * The id index names the other sessions' span, so "none" needs no source read; then two
   * `LIMIT 1` probes inside it. A row-level match can only mistake a helper for main, which
   * reads as "not first": the safe side. Refused, never unbounded, while the index is not ready.
   */
  async findOtherSessionKind({
    tenantId,
    excludeSessionIds,
  }: {
    tenantId: string;
    excludeSessionIds: string[];
  }): Promise<OtherSessionKind> {
    EventUtils.validateTenantId(
      { tenantId },
      "CodingAgentSessionClickHouseRepository.findOtherSessionKind",
    );
    const within = await this.spanBound({
      read: "other_session_kind",
      tenants: { tenantId },
      excludeSessionIds,
      whenNotReady: "refuse",
    });
    if (within === null) return "none";
    const probe = async ({ mainOnly }: { mainOnly: boolean }): Promise<boolean> => {
      const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
        .from(sessions)
        .select({ SessionId: sessions.SessionId })
        .where(({ and, eq, not, oneOf }) =>
          and(
            ...withinBound(within),
            ...(excludeSessionIds.length > 0
              ? [not(oneOf(sessions.SessionId, excludeSessionIds))]
              : []),
            ...(mainOnly ? [eq(sessions.Auxiliary, false)] : []),
          ),
        )
        .limit(1)
        .build();
      const { rows } = await this.clickhouse.read({ statement });
      return rows.length > 0;
    };
    if (await probe({ mainOnly: true })) return "main";
    return (await probe({ mainOnly: false })) ? "helpers_only" : "none";
  }

  /**
   * Read newest sessions after deduplication: the outer range prunes returned rows, and the
   * dedup scope is bounded to the span every version of the window's sessions lies in (ADR-071).
   */
  async findManyRecent({
    tenantId,
    userId,
    fromMs,
    toMs,
    limit,
  }: {
    tenantId: string;
    userId?: string;
    fromMs: number;
    toMs: number;
    limit: number;
  }): Promise<CodingAgentSessionRow[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "CodingAgentSessionClickHouseRepository.findManyRecent",
    );

    const startedAt = performance.now();
    const observe = (outcome: CodingAgentSessionListReadOutcome) =>
      this.metrics.observeSessionListRead({
        table: TABLE_NAME,
        outcome,
        durationMs: performance.now() - startedAt,
      });

    let rows: Record<string, unknown>[];
    try {
      const dedup = await this.spanBound({
        read: "recent_list",
        tenants: { tenantId },
        overlapping: { fromMs, toMs },
        whenNotReady: "unbounded",
      });
      if (dedup === null) {
        observe("no_sessions");
        return [];
      }
      const statement = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
        .from(sessions)
        .with("latest", (sub) => {
          const election = sub
            .from(sessions)
            .select({ Elected: ELECTED_VERSION })
            .groupBy(sessions.TenantId, sessions.SessionId)
            .having(({ eq }) => eq(fn.max(fn.toUInt8(sessions.Auxiliary)), 0));
          const bound = withinBound(dedup);
          return bound.length === 0 ? election : election.where(({ and }) => and(...bound));
        })
        .select(ALL_SESSION_COLUMNS)
        .where(({ and, eq, gte, lte, oneOf }) =>
          and(
            ...(userId === undefined ? [] : [eq(sessions.UserId, userId)]),
            gte(sessions.StartedAt, fromMs),
            lte(sessions.StartedAt, toMs),
            oneOf(ROW_VERSION, { cte: "latest" }),
          ),
        )
        .orderBy(sessions.StartedAt, "DESC")
        // Over-fetched because the collapse happens in TypeScript, below. Two versions of one
        // session can tie on `max(UpdatedAt)` and both satisfy the election, so a page cut to
        // `limit` here would spend slots on rows that are about to merge.
        .limit(limit * LIST_READ_DEDUP_OVERFETCH)
        .build();
      ({ rows } = await this.clickhouse.read({ statement }));
    } catch (error) {
      observe("error");
      throw error;
    }
    // `empty` means the dedup scan ran and returned nothing. `no_sessions` means the index
    // found no session, so the scan never ran. Timings include the span read and the row
    // deserialization, but not the mapping to domain rows.
    observe(rows.length > 0 ? "hit" : "empty");

    // Marked sessions left with the dedup group above; this repeats the rule on the settled row.
    return dedupToLatestPerSession(rows)
      .map(fromRecord)
      .filter((row) => !row.auxiliary)
      .toSorted((a, b) => b.startedAtMs - a.startedAtMs)
      .slice(0, limit);
  }

  /**
   * `findManyRecent` through a proof's fence: the fence picks the tenants, a shared
   * grant's window cuts `StartedAt`, and the dedup group is bound to the same set.
   */
  async findManyRecentFenced({
    authorization,
    fromMs,
    toMs,
    limit,
  }: {
    authorization: Authorization;
    fromMs: number;
    toMs: number;
    limit: number;
  }): Promise<CodingAgentSessionRow[]> {
    const startedAt = performance.now();
    const observe = (outcome: CodingAgentSessionListReadOutcome) =>
      this.metrics.observeSessionListRead({
        table: TABLE_NAME,
        outcome,
        durationMs: performance.now() - startedAt,
      });

    let rows: Record<string, unknown>[];
    try {
      const reach = fencedReachOf(authorization);
      if (reach.kind === "noTenants") {
        observe("no_sessions");
        return [];
      }
      const { scope } = reach;
      const dedup = await this.spanBound({
        read: "recent_list_fenced",
        tenants: { tenantId: scope.tenantId, tenantIds: scope.tenantIds },
        overlapping: { fromMs, toMs },
        whenNotReady: "unbounded",
      });
      if (dedup === null) {
        observe("no_sessions");
        return [];
      }
      // The election reads under the windowed fence too, as the builder's own election does.
      const statement = clickhouseRead({ scope })
        .from(sessions)
        .withinWindows()
        .with("latest", (sub) => {
          const election = sub
            .from(sessions)
            .withinWindows()
            .select({ Elected: ELECTED_VERSION })
            .groupBy(sessions.TenantId, sessions.SessionId)
            .having(({ eq }) => eq(fn.max(fn.toUInt8(sessions.Auxiliary)), 0));
          const bound = withinBound(dedup);
          return bound.length === 0 ? election : election.where(({ and }) => and(...bound));
        })
        .select(ALL_SESSION_COLUMNS)
        .where(({ and, gte, lte, oneOf }) =>
          and(
            gte(sessions.StartedAt, fromMs),
            lte(sessions.StartedAt, toMs),
            oneOf(ROW_VERSION, { cte: "latest" }),
          ),
        )
        .orderBy(sessions.StartedAt, "DESC")
        // Over-fetched for the same tie `findManyRecent` collapses below.
        .limit(limit * LIST_READ_DEDUP_OVERFETCH)
        .build();
      ({ rows } = await this.clickhouse.read({ statement }));
    } catch (error) {
      observe("error");
      throw error;
    }
    observe(rows.length > 0 ? "hit" : "empty");

    return dedupToLatestPerSession(rows)
      .map(fromRecord)
      .filter((row) => !row.auxiliary)
      .toSorted((a, b) => b.startedAtMs - a.startedAtMs)
      .slice(0, limit);
  }

  /**
   * Reads pull-request usage across one organization's project tenants.
   */
  async findByRepositoryBranch({
    tenantIds,
    repositoryHost,
    repositoryOwner,
    repositoryName,
    branches,
    startedAtFromMs,
  }: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    startedAtFromMs: number;
  }): Promise<CodingAgentBranchSessionRow[]> {
    if (tenantIds.length === 0 || branches.length === 0) return [];
    for (const tenantId of tenantIds) {
      EventUtils.validateTenantId(
        { tenantId },
        "CodingAgentSessionClickHouseRepository.findByRepositoryBranch",
      );
    }

    return this.listBranchSessions({
      tenantIds,
      repositoryHost,
      repositoryOwner,
      repositoryName,
      branches,
      startedAtFromMs,
    });
  }

  /** The rollup's one statement over an organization's project tenants. */
  private async listBranchSessions({
    tenantIds,
    repositoryHost,
    repositoryOwner,
    repositoryName,
    branches,
    startedAtFromMs,
  }: {
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    startedAtFromMs: number;
  }): Promise<CodingAgentBranchSessionRow[]> {
    const scope = tenantScope.set({ tenantIds });
    const dedup = await this.spanBound({
      read: "branch_list",
      tenants: { tenantId: scope.tenantId, tenantIds },
      overlapping: { fromMs: startedAtFromMs },
      whenNotReady: "unbounded",
    });
    if (dedup === null) return [];
    const statement = clickhouseRead({ scope })
      .from(sessions)
      .with("latest", (sub) => {
        const election = sub
          .from(sessions)
          .select({ Elected: ELECTED_VERSION })
          .groupBy(sessions.TenantId, sessions.SessionId);
        const bound = withinBound(dedup);
        return bound.length === 0 ? election : election.where(({ and }) => and(...bound));
      })
      .select(BRANCH_SESSION_COLUMNS)
      // Case-folded on both sides. A session stores the remote's casing verbatim, while the
      // pull-request mapping stores its host and repository lowercased. None of the three is in
      // the sort key, so folding costs no pruning. Branch names are case sensitive: not folded.
      .where(({ and, eq, gte, oneOf, or }) =>
        and(
          eq(fn.lower(sessions.RepositoryHost), repositoryHost.toLowerCase()),
          eq(fn.lower(sessions.RepositoryOwner), repositoryOwner.toLowerCase()),
          eq(fn.lower(sessions.RepositoryName), repositoryName.toLowerCase()),
          or(oneOf(sessions.GitBranch, branches), fn.hasAny(sessions.GitBranches, branches)),
          gte(sessions.StartedAt, startedAtFromMs),
          oneOf(ROW_VERSION, { cte: "latest" }),
        ),
      )
      .orderBy(sessions.StartedAt, "ASC")
      .build();
    const { rows } = await this.clickhouse.read({ statement });
    return latestPerTenantSession(rows);
  }

  /**
   * The same row shape as `findByRepositoryBranch`, anchored on session ids: the second leg
   * of fact-stamp discovery, fetching the session rows for sessions whose stamped events
   * named a repository their own row has since moved away from.
   */
  async findBySessionIds({
    tenantIds,
    sessionIds,
    startedAtFromMs,
  }: {
    tenantIds: string[];
    sessionIds: string[];
    startedAtFromMs: number;
  }): Promise<CodingAgentBranchSessionRow[]> {
    if (tenantIds.length === 0 || sessionIds.length === 0) return [];
    for (const tenantId of tenantIds) {
      EventUtils.validateTenantId(
        { tenantId },
        "CodingAgentSessionClickHouseRepository.findBySessionIds",
      );
    }

    // The caller's time bounds the outer scan; the id index bounds the dedup (ADR-071).
    const statement = clickhouseRead({ scope: tenantScope.set({ tenantIds }) })
      .from(sessions)
      .with("latest", (sub) =>
        sub
          .from(sessions)
          .select({ Elected: ELECTED_VERSION })
          .where(({ and, idBound, oneOf }) =>
            and(oneOf(sessions.SessionId, sessionIds), idBound(sessions.SessionId, sessionIds)),
          )
          .groupBy(sessions.TenantId, sessions.SessionId),
      )
      .select(BRANCH_SESSION_COLUMNS)
      .where(({ and, gte, oneOf }) =>
        and(
          oneOf(sessions.SessionId, sessionIds),
          gte(sessions.StartedAt, startedAtFromMs),
          oneOf(ROW_VERSION, { cte: "latest" }),
        ),
      )
      .orderBy(sessions.StartedAt, "ASC")
      .build();
    const { rows } = await this.clickhouse.read({ statement, idBound: { fallback: "unbounded" } });
    return latestPerTenantSession(rows);
  }

  async upsertBatch(
    entries: {
      row: CodingAgentSessionRow;
      retentionDays?: number;
      appliedEventIds?: readonly string[];
    }[],
  ): Promise<void> {
    const [first] = entries;
    if (!first) return;

    const tenantId = first.row.tenantId;
    EventUtils.validateTenantId({ tenantId }, "CodingAgentSessionClickHouseRepository.upsertBatch");
    // A batch is written for ONE tenant, so a row from another would land in
    // this tenant's ClickHouse. Refuse rather than cross the line.
    for (const { row } of entries) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError({
          operation: "CodingAgentSessionClickHouseRepository.upsertBatch",
          message: "coding agent session batch spans multiple tenants",
          tenantId,
        });
      }
    }

    try {
      await this.clickhouse.insert({
        tenantId,
        table: TABLE_NAME,
        rows: entries.map(({ row, retentionDays, appliedEventIds }) =>
          toRecord({
            row,
            retentionDays: retentionDays ?? this.defaultTraceRetentionDays,
            appliedEventIds,
            versionStampMs: this.nextVersionStamp(row.updatedAt),
          }),
        ),
        settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
        { error, tenantId, count: entries.length },
        "failed to upsert coding agent session batch",
      );
      throw error;
    }
  }

  /** By session id, so a session folded twice counts once; the first is lifetime. */
  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<CodingAgentUsageCount> {
    const perProject = await Promise.all(
      [...new Set(projectIds)].map(async (tenantId) => {
        const lifetime = await this.spanBound({
          read: "usage_count",
          tenants: { tenantId },
          whenNotReady: "unbounded",
        });
        if (lifetime === null) return { sessions: 0, first: [] };
        const scope = tenantScope.single({ tenantId });
        const bounded = withinBound(lifetime);
        const windowed = [
          ...bounded,
          ...(since === undefined ? [] : [cond.gte(sessions.StartedAt, since)]),
        ];
        const counting = clickhouseRead({ scope })
          .from(sessions)
          .select({ Sessions: fn.uniqExact(sessions.SessionId) });
        const earliestOf = clickhouseRead({ scope })
          .from(sessions)
          .select({
            Versions: fn.count(),
            FirstMs: fn.toUnixTimestamp64Milli(fn.min(sessions.StartedAt)),
          });
        const [counted, earliest] = await Promise.all([
          this.clickhouse.read({
            statement: (windowed.length === 0
              ? counting
              : counting.where(({ and }) => and(...windowed))
            ).build(),
          }),
          this.clickhouse.read({
            statement: (bounded.length === 0
              ? earliestOf
              : earliestOf.where(({ and }) => and(...bounded))
            ).build(),
          }),
        ]);
        const [count] = usageCountRowsSchema.parse(counted.rows);
        const [first] = usageFirstRowsSchema.parse(earliest.rows);
        return {
          sessions: count?.Sessions ?? 0,
          first: (first?.Versions ?? 0) === 0 ? [] : [first?.FirstMs ?? 0],
        };
      }),
    );
    const firsts = perProject.flatMap((project) => project.first);
    return {
      sessions: perProject.reduce((sum, project) => sum + project.sessions, 0),
      ...(firsts.length === 0 ? {} : { firstSessionAt: Math.min(...firsts) }),
    };
  }
}

/** What a proof's fence reaches: its scope, or no tenant at all, which reads no rows. */
type FencedReach = { kind: "fenced"; scope: ProofScope } | { kind: "noTenants" };

function fencedReachOf(authorization: Authorization): FencedReach {
  try {
    return { kind: "fenced", scope: tenantScope.fromProof({ authorization, reads: "traces" }) };
  } catch (error) {
    if (error instanceof QueryBuilderError && error.violation.kind === "empty-tenant-set") {
      return { kind: "noTenants" };
    }
    throw error;
  }
}

/**
 * Deduped per tenant, not across the whole result: one provider session id in two of an
 * organization's projects is two sessions, and collapsing them would drop the other's cost.
 */
function latestPerTenantSession(rows: Record<string, unknown>[]): CodingAgentBranchSessionRow[] {
  return dedupToLatestPerSession(rows).map(toBranchSessionRow);
}

/** `StartedAt` inside an index span, widened a day each side as an `{{idBound}}` read widens. */
function startedAtWithin(span: SessionSpan): DedupBound {
  const window = indexWindow(span);
  return { kind: "within", fromMs: window.fromMs, toMs: window.toMs };
}

const usageCountRowsSchema = z.array(z.object({ Sessions: z.coerce.number() }));
const usageFirstRowsSchema = z.array(
  z.object({ Versions: z.coerce.number(), FirstMs: z.coerce.number() }),
);

const asNumberArray = (value: unknown): number[] =>
  Array.isArray(value) ? value.map(asNumber) : [];

const metricSeriesTupleSchema = z.tuple([
  z.unknown(),
  z.unknown(),
  z.unknown(),
  z.unknown(),
  z.unknown(),
  z.unknown(),
]);

/** Parse the `MetricSeries` Array(Tuple(...)), read as an array of arrays. */
const asMetricSeriesRows = (value: unknown): CodingAgentSessionMetricSeriesRow[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((unit) => {
    const parsed = metricSeriesTupleSchema.safeParse(unit);
    if (!parsed.success) {
      return [];
    }

    const tuple = parsed.data;
    return [
      {
        seriesId: asString(tuple[0]),
        metricName: asString(tuple[1]),
        type: asString(tuple[2]),
        decision: asString(tuple[3]),
        language: asString(tuple[4]),
        value: asNumber(tuple[5]),
      },
    ];
  });
};

const numberMapSchema = z.record(z.string(), z.unknown());

/** Parse the `UsageByContext` Array(Tuple(...)), read as an array of arrays. */
const asContextUsageRows = (value: unknown): CodingAgentSessionContextUsage[] =>
  Array.isArray(value)
    ? value.map((entry) => {
        const tuple: unknown[] = Array.isArray(entry) ? entry : [];
        return {
          repositoryHost: asString(tuple[0]),
          repositoryOwner: asString(tuple[1]),
          repositoryName: asString(tuple[2]),
          branch: asString(tuple[3]),
          inputTokens: asNumber(tuple[4]),
          outputTokens: asNumber(tuple[5]),
          cacheReadTokens: asNumber(tuple[6]),
          cacheCreationTokens: asNumber(tuple[7]),
          costUsd: asNumber(tuple[8]),
        };
      })
    : [];

const asNumberMap = (value: unknown): Record<string, number> => {
  const parsed = numberMapSchema.safeParse(value);
  if (!parsed.success) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parsed.data).map(([key, entry]) => [key, asNumber(entry)]),
  );
};

/**
 * Collapse versions the IN-tuple could not separate: two versions sharing a
 * `max(UpdatedAt)` both satisfy the dedup subquery and render twice
 * (ADR-071 consequence 1).
 */
function dedupToLatestPerSession(records: Record<string, unknown>[]): Record<string, unknown>[] {
  const bySession = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    // Keyed with the tenant: a fenced page spans projects, and one session id
    // in two of them is two sessions.
    const key = `${asString(record.TenantId)}\u0000${asString(record.SessionId)}`;
    const incumbent = bySession.get(key);
    bySession.set(key, incumbent === undefined ? record : preferredOf(incumbent, record));
  }
  return [...bySession.values()];
}

// A column absent from the record ranks as "no progress" rather than NaN,
// which would make every comparison against it false and the winner depend on
// argument order.
function progressMsOf(value: unknown): number {
  const ms = parseClickHouseDateTimeMs(asString(value));
  return Number.isFinite(ms) ? ms : 0;
}

function progressOf(record: Record<string, unknown>) {
  return {
    watermark: progressMsOf(record.LastEventOccurredAt),
    signals: asNumber(record.ModelCalls) + asNumber(record.ToolCalls) + asNumber(record.Prompts),
    units: Array.isArray(record.MetricSeries) ? record.MetricSeries.length : 0,
    applied: Array.isArray(record.AppliedEventIds) ? record.AppliedEventIds.length : 0,
    startedAt: progressMsOf(record.StartedAt),
  };
}

/**
 * `findLatestRecord`'s ranking, key for key, applied in TypeScript.
 */
function preferredOf(
  incumbent: Record<string, unknown>,
  challenger: Record<string, unknown>,
): Record<string, unknown> {
  const held = progressOf(incumbent);
  const next = progressOf(challenger);

  if (held.watermark !== next.watermark) {
    return next.watermark > held.watermark ? challenger : incumbent;
  }
  if (held.signals !== next.signals) {
    return next.signals > held.signals ? challenger : incumbent;
  }
  if (held.units !== next.units) {
    return next.units > held.units ? challenger : incumbent;
  }
  if (held.applied !== next.applied) {
    return next.applied > held.applied ? challenger : incumbent;
  }
  return next.startedAt < held.startedAt ? challenger : incumbent;
}

/**
 * Decode one `JSONEachRow` record.
 */
function fromRecord(record: Record<string, unknown>): CodingAgentSessionRow {
  const steps = Array.isArray(record.Steps) ? record.Steps : [];
  return {
    tenantId: asString(record.TenantId),
    sessionId: asString(record.SessionId),
    sessionKeySource: asString(record.SessionKeySource),
    version: asString(record.Version),
    startedAtMs: parseClickHouseDateTimeMs(asString(record.StartedAt)),

    agent: asString(record.Agent),
    agentVersion: asString(record.AgentVersion),
    traceIds: asStringArray(record.TraceIds),
    finalRequestId: asString(record.FinalRequestId),
    userId: asString(record.UserId),
    terminalType: asString(record.TerminalType),
    entrypoint: asString(record.Entrypoint),
    parentSessionId: asString(record.ParentSessionId),
    isFork: Boolean(record.IsFork),
    auxiliary: Boolean(record.Auxiliary),
    repositoryHost: asString(record.RepositoryHost),
    repositoryOwner: asString(record.RepositoryOwner),
    repositoryName: asString(record.RepositoryName),
    gitBranch: asString(record.GitBranch),
    usageByContext: asContextUsageRows(record.UsageByContext),
    gitBranches: asStringArray(record.GitBranches),
    gitWorktree: asString(record.GitWorktree),
    title: asString(record.Title),
    titleSource: asString(record.TitleSource),

    modelCalls: asNumber(record.ModelCalls),
    toolCalls: asNumber(record.ToolCalls),
    subAgents: asNumber(record.SubAgents),
    prompts: asNumber(record.Prompts),
    promptChars: asNumber(record.PromptChars),
    responseChars: asNumber(record.ResponseChars),
    steps: steps.map((s) => {
      const tuple = s as [string, unknown, unknown];
      return [String(tuple[0]), asNumber(tuple[1]), Boolean(tuple[2])] as [string, number, boolean];
    }),

    toolCounts: asNumberMap(record.ToolCounts),
    toolDurationMs: asNumberMap(record.ToolDurationMs),
    filesTouched: asStringArray(record.FilesTouched),
    skills: asStringArray(record.Skills),
    subAgentTypes: asStringArray(record.SubAgentTypes),
    slashCommands: asStringArray(record.SlashCommands),
    models: asStringArray(record.Models),
    mcpServers: asStringArray(record.McpServers),
    mcpTools: asStringArray(record.McpTools),

    inputTokens: asNumber(record.InputTokens),
    outputTokens: asNumber(record.OutputTokens),
    cacheReadTokens: asNumber(record.CacheReadTokens),
    cacheCreationTokens: asNumber(record.CacheCreationTokens),
    costUsd: asNumber(record.CostUsd),
    agentReportedCostUsd: asNumber(record.AgentReportedCostUsd),

    modelCallMs: asNumber(record.ModelCallMs),
    toolMs: asNumber(record.ToolMs),
    ttftMsTotal: asNumber(record.TtftMsTotal),
    ttftSamples: asNumber(record.TtftSamples),
    blockedOnUserMs: asNumber(record.BlockedOnUserMs),
    activeTimeUserSec: asNumber(record.ActiveTimeUserSec),
    activeTimeCliSec: asNumber(record.ActiveTimeCliSec),

    toolResultBytes: asNumber(record.ToolResultBytes),
    toolInputBytes: asNumber(record.ToolInputBytes),
    compactions: asNumber(record.Compactions),
    compactionTokensBefore: asNumber(record.CompactionTokensBefore),
    compactionTokensAfter: asNumber(record.CompactionTokensAfter),
    compactionTriggers: asNumberMap(record.CompactionTriggers),
    peakContextTokens: asNumber(record.PeakContextTokens),
    cacheRebuildCount: asNumber(record.CacheRebuildCount),
    largestCacheRebuildTokens: asNumber(record.LargestCacheRebuildTokens),

    failedTools: asNumber(record.FailedTools),
    errorTypes: asNumberMap(record.ErrorTypes),
    apiErrors: asNumber(record.ApiErrors),
    rateLimited: asNumber(record.RateLimited),
    rateLimitEvents: asNumber(record.RateLimitEvents),
    retriesExhausted: asNumber(record.RetriesExhausted),
    retryMs: asNumber(record.RetryMs),
    attempts: asNumber(record.Attempts),
    refusals: asNumber(record.Refusals),
    refusalCategories: asStringArray(record.RefusalCategories),
    internalErrors: asNumber(record.InternalErrors),

    toolsDenied: asNumber(record.ToolsDenied),
    toolsAborted: asNumber(record.ToolsAborted),
    permissionMode: asString(record.PermissionMode),
    permissionChanges: asNumber(record.PermissionChanges),
    hooksBlocked: asNumber(record.HooksBlocked),
    hooksCancelled: asNumber(record.HooksCancelled),
    hookMs: asNumber(record.HookMs),

    linesAdded: asNumber(record.LinesAdded),
    linesRemoved: asNumber(record.LinesRemoved),
    commits: asNumber(record.Commits),
    pullRequests: asNumber(record.PullRequests),
    editsAccepted: asNumber(record.EditsAccepted),
    editsRejected: asNumber(record.EditsRejected),
    languagesEdited: asStringArray(record.LanguagesEdited),
    atMentions: asNumber(record.AtMentions),

    stopReason: asString(record.StopReason),
    truncated: Boolean(record.Truncated),

    subAgentIds: asStringArray(record.SubAgentIds),
    stepStartedAt: asNumberArray(record.StepStartedAt),
    previousCallContextTokens: asNumber(record.PreviousCallContextTokens),
    metricSeries: asMetricSeriesRows(record.MetricSeries),
    createdAt: parseClickHouseDateTimeMs(asString(record.CreatedAt)),
    updatedAt: parseClickHouseDateTimeMs(asString(record.UpdatedAt)),
    lastEventOccurredAt: parseClickHouseDateTimeMs(asString(record.LastEventOccurredAt)),
  };
}
