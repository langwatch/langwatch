import { performance } from "node:perf_hooks";

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
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

import type {
  CodingAgentClock,
  CodingAgentReadMetrics,
  CodingAgentSessionListReadOutcome,
} from "../../app/coding-agent.members.ts";
import type { CodingAgentSessionRepository as SessionRepository } from "../coding-agent-session.repository.ts";
import {
  clickHouseMomentOf,
  asNumber,
  asStringArray,
  parseClickHouseDateTimeMs,
  routingTenantOf,
  CROSS_TENANT_ROLLUP,
  type ClickHouseMoment,
} from "./clickhouse.mapper.ts";

const TABLE_NAME = "coding_agent_sessions" as const;

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
const BRANCH_SESSION_COLUMNS = `
  SessionId,
  TenantId,
  StartedAt,
  InputTokens,
  OutputTokens,
  CacheReadTokens,
  CacheCreationTokens,
  CostUsd,
  Agent,
  Models,
  UserId,
  GitBranch,
  GitBranches,
  UsageByContext,
  Title,
  LastEventOccurredAt,
  ModelCalls,
  ToolCalls,
  Prompts
`;

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
  private readonly clickhouse: ClickHouseQueryClient;
  private readonly defaultTraceRetentionDays: number;
  private readonly metrics: CodingAgentReadMetrics;
  private readonly clock: CodingAgentClock;

  private constructor({
    clickhouse,
    defaultTraceRetentionDays,
    metrics,
    clock,
  }: {
    clickhouse: ClickHouseQueryClient;
    defaultTraceRetentionDays: number;
    metrics: CodingAgentReadMetrics;
    clock: CodingAgentClock;
  }) {
    this.clickhouse = clickhouse;
    this.defaultTraceRetentionDays = defaultTraceRetentionDays;
    this.metrics = metrics;
    this.clock = clock;
  }

  static create(deps: {
    clickhouse: ClickHouseQueryClient;
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
   * Reads the latest raw session record without `FINAL`: late signals can move `StartedAt`,
   * leaving superseded ReplacingMergeTree rows until TTL.
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
    const partitionFilter =
      window !== undefined
        ? "AND StartedAt BETWEEN fromUnixTimestamp64Milli({from:Int64}) AND fromUnixTimestamp64Milli({to:Int64})"
        : "";

    const { rows } = await this.clickhouse.query<Record<string, unknown>>({
      tenantId,
      table: TABLE_NAME,
      kind: "read",
      sql: `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND SessionId = {sessionId:String}
          ${partitionFilter}
          AND (TenantId, SessionId, UpdatedAt) IN (
            SELECT TenantId, SessionId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND SessionId = {sessionId:String}
            GROUP BY TenantId, SessionId
          )
        ORDER BY
          LastEventOccurredAt DESC,
          ModelCalls + ToolCalls + Prompts DESC,
          length(MetricSeries) DESC,
          length(AppliedEventIds) DESC,
          StartedAt ASC
        LIMIT 1
      `,
      params: {
        tenantId,
        sessionId,
        ...(window !== undefined ? { from: window.fromMs, to: window.toMs } : {}),
      },
    });

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
   * Read newest sessions after tenant-wide deduplication: the inner scan reads
   * only key columns across the tenant, while the outer range prunes returned
   * rows (ADR-071 records the cost).
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
    const userFilter = userId !== undefined ? "AND UserId = {userId:String}" : "";

    const startedAt = performance.now();
    const observe = (outcome: CodingAgentSessionListReadOutcome) =>
      this.metrics.observeSessionListRead({
        table: TABLE_NAME,
        outcome,
        durationMs: performance.now() - startedAt,
      });

    let rows: Record<string, unknown>[];
    try {
      ({ rows } = await this.clickhouse.query<Record<string, unknown>>({
        tenantId,
        table: TABLE_NAME,
        kind: "read",
        sql: `
          SELECT *
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            ${userFilter}
            AND StartedAt BETWEEN fromUnixTimestamp64Milli({from:Int64}) AND fromUnixTimestamp64Milli({to:Int64})
            AND (TenantId, SessionId, UpdatedAt) IN (
              SELECT TenantId, SessionId, max(UpdatedAt)
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
              GROUP BY TenantId, SessionId
            )
          ORDER BY StartedAt DESC
          LIMIT {limit:UInt32}
        `,
        params: {
          tenantId,
          from: fromMs,
          to: toMs,
          // Over-fetched because the collapse happens in TypeScript, below. Two versions of one
          // session can tie on `max(UpdatedAt)` and both satisfy the IN-tuple — the tie
          // `preferredOf` exists to resolve — so a page cut to `limit` HERE spends slots on rows
          // that are about to merge, and the caller silently receives fewer sessions than it asked
          // for.
          limit: limit * LIST_READ_DEDUP_OVERFETCH,
          ...(userId !== undefined ? { userId } : {}),
        },
      }));
    } catch (error) {
      observe("error");
      throw error;
    }
    // Timed around the read and its row deserialization, but NOT the mapping to
    // domain rows. The `empty` outcome is the one ADR-071 sequencing step 3
    // reads, and it carries no rows to deserialize, so it isolates the dedup
    // scan's own floor from anything that scales with page size.
    observe(rows.length > 0 ? "hit" : "empty");

    return dedupToLatestPerSession(rows)
      .map(fromRecord)
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
    const { rows } = await this.clickhouse.query<Record<string, unknown>>({
      tenantId: routingTenantOf(tenantIds),
      table: TABLE_NAME,
      kind: "read",
      unscoped: CROSS_TENANT_ROLLUP,
      sql: `
        SELECT ${BRANCH_SESSION_COLUMNS}
        FROM ${TABLE_NAME}
        WHERE TenantId IN {tenantIds:Array(String)}
          AND lower(RepositoryHost) = {repositoryHost:String}
          AND lower(RepositoryOwner) = {repositoryOwner:String}
          AND lower(RepositoryName) = {repositoryName:String}
          AND (
            GitBranch IN {branches:Array(String)}
            OR hasAny(GitBranches, {branches:Array(String)})
          )
          AND StartedAt >= fromUnixTimestamp64Milli({from:Int64})
          AND (TenantId, SessionId, UpdatedAt) IN (
            SELECT TenantId, SessionId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId IN {tenantIds:Array(String)}
            GROUP BY TenantId, SessionId
          )
        ORDER BY StartedAt ASC
      `,
      params: {
        tenantIds,
        // Case-folded on both sides. A session stores the remote's casing verbatim, while the
        // pull-request mapping stores its host and repository lowercased, so an exact match here
        // would silently drop every remote whose host, owner or name is not already lower case.
        // All three come from the same remote URL, and none of them is in the sort key, so folding
        // costs no pruning; `TenantId` and `StartedAt` still do all of it.
        repositoryHost: repositoryHost.toLowerCase(),
        repositoryOwner: repositoryOwner.toLowerCase(),
        repositoryName: repositoryName.toLowerCase(),
        // NOT folded: git branch names are case sensitive, and `feat/X` is a
        // different branch from `feat/x`.
        branches,
        from: startedAtFromMs,
      },
    });

    // Deduped per tenant, not across the whole result: the shared helper keys
    // on SessionId alone, which is right for a single-tenant read but would
    // collapse two organizations' projects that happen to share a provider
    // session id into one row here, silently dropping the other's cost.
    const byTenant = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const tenantId = asString(row.TenantId);
      const list = byTenant.get(tenantId) ?? [];
      list.push(row);
      byTenant.set(tenantId, list);
    }
    return [...byTenant.values()].flatMap((tenantRows) =>
      dedupToLatestPerSession(tenantRows).map(toBranchSessionRow),
    );
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

    const { rows } = await this.clickhouse.query<Record<string, unknown>>({
      tenantId: routingTenantOf(tenantIds),
      table: TABLE_NAME,
      kind: "read",
      unscoped: CROSS_TENANT_ROLLUP,
      sql: `
          SELECT ${BRANCH_SESSION_COLUMNS}
          FROM ${TABLE_NAME}
          WHERE TenantId IN {tenantIds:Array(String)}
            AND SessionId IN {sessionIds:Array(String)}
            AND StartedAt >= fromUnixTimestamp64Milli({from:Int64})
            AND (TenantId, SessionId, UpdatedAt) IN (
              SELECT TenantId, SessionId, max(UpdatedAt)
              FROM ${TABLE_NAME}
              WHERE TenantId IN {tenantIds:Array(String)}
              GROUP BY TenantId, SessionId
            )
          ORDER BY StartedAt ASC
        `,
      params: {
        tenantIds,
        sessionIds,
        from: startedAtFromMs,
      },
    });

    const byTenant = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const tenantId = asString(row.TenantId);
      const list = byTenant.get(tenantId) ?? [];
      list.push(row);
      byTenant.set(tenantId, list);
    }
    return [...byTenant.values()].flatMap((tenantRows) =>
      dedupToLatestPerSession(tenantRows).map(toBranchSessionRow),
    );
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
        throw new SecurityError(
          "CodingAgentSessionClickHouseRepository.upsertBatch",
          "coding agent session batch spans multiple tenants",
          tenantId,
        );
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
    const window =
      since === undefined ? "" : "AND StartedAt >= fromUnixTimestamp64Milli({since:Int64})";
    const perProject = await Promise.all(
      [...new Set(projectIds)].map(async (tenantId) => {
        const read = async (sql: string) =>
          usageRowsSchema.parse(
            (
              await this.clickhouse.query<unknown>({
                tenantId,
                table: TABLE_NAME,
                kind: "read",
                sql,
                params: since === undefined ? { tenantId } : { tenantId, since },
              })
            ).rows,
          )[0];
        const [counted, earliest] = await Promise.all([
          read(`
            SELECT toString(uniqExact(SessionId)) AS Total, '0' AS FirstMs
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              ${window}`),
          read(`
            SELECT toString(count()) AS Total,
                   toString(toUnixTimestamp64Milli(min(StartedAt))) AS FirstMs
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}`),
        ]);
        return {
          sessions: Number.parseInt(counted?.Total ?? "0", 10),
          first:
            Number.parseInt(earliest?.Total ?? "0", 10) === 0
              ? []
              : [Number(earliest?.FirstMs ?? "0")],
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

const usageRowsSchema = z.array(z.object({ Total: z.string(), FirstMs: z.string() }));

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
    const sessionId = asString(record.SessionId);
    const incumbent = bySession.get(sessionId);
    bySession.set(sessionId, incumbent === undefined ? record : preferredOf(incumbent, record));
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
