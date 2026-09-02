import { performance } from "node:perf_hooks";
import type {
  CodingAgentSession,
  CodingAgentSessionBranchRecord,
} from "@langwatch/coding-agent-contract";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type {
  CodingAgentClickHouseClient,
  CodingAgentClickHousePort,
} from "../../ports/coding-agent-clickhouse.port";
import type { CodingAgentClockPort } from "../../ports/coding-agent-clock.port";
import {
  type CodingAgentReadMetricsPort,
  type CodingAgentSessionListReadOutcome,
} from "../../adapters/coding-agent-read-metrics.adapter";
import type { CodingAgentSessionRepository as SessionRepository } from "../coding-agent-session.repository";
import {
  groupTenantsByClient,
  asNumber,
  asStringArray,
  parseClickHouseDateTimeMs,
} from "../coding-agent-clickhouse/clickhouse.repository";

const TABLE_NAME = "coding_agent_sessions" as const;
type CodingAgentSessionRow = CodingAgentSession;
type CodingAgentSessionMetricSeriesRow = CodingAgentSession["metricSeries"][number];
type CodingAgentBranchSessionRow = CodingAgentSessionBranchRecord;

/**
 * How much `findManyRecent` over-reads so its TypeScript dedup cannot shorten
 * the page.
 *
 * Duplicates only arise from an `UpdatedAt` tie between two versions of one
 * session, so they are the exception rather than the rule and a doubling is
 * ample headroom; anything the collapse still trims comes off the tail, which
 * `slice` was going to drop anyway. Set this to 1 and a tie silently costs the
 * caller a whole session.
 */
const LIST_READ_DEDUP_OVERFETCH = 2;

const logger = createLogger("langwatch:coding-agent:session-repository");

/**
 * ClickHouse persistence for the coding-agent session row (ADR-056,
 * migration 00051).
 *
 * The UInt64 columns are serialised as STRINGS in the JSONEachRow body: JSON
 * numbers cannot safely round-trip past 2^53, and a long session's token counts
 * and byte totals are exactly the columns that get large. UInt32 / Float64 / Bool
 * fit in JSON numbers and pass through as-is.
 */
interface ClickHouseWriteRecord {
  TenantId: string;
  SessionId: string;
  SessionKeySource: string;
  Version: string;
  StartedAt: Date;
  CreatedAt: Date;
  UpdatedAt: Date;

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
  LastEventOccurredAt: Date;

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
    sessionId: String(record.SessionId ?? ""),
    tenantId: String(record.TenantId ?? ""),
    startedAtMs: parseClickHouseDateTimeMs(String(record.StartedAt ?? "")),
    lastEventOccurredAtMs: parseClickHouseDateTimeMs(String(record.LastEventOccurredAt ?? "")),
    inputTokens: asNumber(record.InputTokens),
    outputTokens: asNumber(record.OutputTokens),
    cacheReadTokens: asNumber(record.CacheReadTokens),
    cacheCreationTokens: asNumber(record.CacheCreationTokens),
    costUsd: asNumber(record.CostUsd),
    agent: String(record.Agent ?? ""),
    models: asStringArray(record.Models),
    userId: String(record.UserId ?? ""),
    gitBranch: String(record.GitBranch ?? ""),
    gitBranches: asStringArray(record.GitBranches),
    title: String(record.Title ?? ""),
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
  const now = new Date();
  return {
    TenantId: row.tenantId,
    SessionId: row.sessionId,
    SessionKeySource: row.sessionKeySource,
    Version: row.version,
    StartedAt: new Date(row.startedAtMs),
    // Preserve first-seen creation across re-folds; UpdatedAt is the RMT
    // version and must be strictly greater than the version it supersedes —
    // see nextVersionStamp for why write time alone is not enough.
    CreatedAt: row.createdAt > 0 ? new Date(row.createdAt) : now,
    UpdatedAt: new Date(versionStampMs),

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
    LastEventOccurredAt: new Date(row.lastEventOccurredAt),

    AppliedEventIds: [...appliedEventIds],

    _retention_days: retentionDays ?? 0,
  };
}

export class CodingAgentSessionClickHouseRepository implements SessionRepository {
  private constructor(
    private readonly clickHouse: CodingAgentClickHousePort,
    private readonly defaultTraceRetentionDays: number,
    private readonly metrics: CodingAgentReadMetricsPort,
    private readonly clock: CodingAgentClockPort,
  ) {}

  static create(deps: {
    clickHouse: CodingAgentClickHousePort;
    defaultTraceRetentionDays: number;
    metrics: CodingAgentReadMetricsPort;
    clock: CodingAgentClockPort;
  }): CodingAgentSessionClickHouseRepository {
    return new CodingAgentSessionClickHouseRepository(
      deps.clickHouse,
      deps.defaultTraceRetentionDays,
      deps.metrics,
      deps.clock,
    );
  }

  /**
   * Monotonic floor for the RMT version stamp this writer issues. The
   * IN-tuple read pattern requires that no two versions of one session tie on
   * UpdatedAt (dev/docs/best_practices/clickhouse-queries.md: "nextUpdatedAt =
   * max(now, prevUpdatedAt + 1) … no ties possible"): a tie makes BOTH rows
   * match max(UpdatedAt), and a windowed read can then resurrect the stale
   * in-window version while the true latest sits outside the window. The
   * stamp combines the superseded version's timestamp threaded through the
   * row (the read-back path) with this writer's own last stamp (covers
   * writers that did not read back); per-aggregate group serialization covers
   * the cross-process window.
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
    const client = await this.clickHouse.resolve(row.tenantId);
    try {
      await client.insert({
        table: TABLE_NAME,
        values: [
          toRecord({
            row,
            retentionDays: retentionDays ?? this.defaultTraceRetentionDays,
            appliedEventIds,
            versionStampMs: this.nextVersionStamp(row.updatedAt),
          }),
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
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
   * Reads the latest raw session record without `FINAL`: late signals can move
   * `StartedAt`, leaving superseded ReplacingMergeTree rows until TTL. The
   * unwindowed max-UpdatedAt subquery finds the real version; applying the
   * caller's window there could return an older row instead of a recoverable
   * outer miss. The remaining order is a deterministic tie-break over fold
   * progress (event, span/log, metric and delivery watermarks).
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
    const client = await this.clickHouse.resolve(tenantId);

    const partitionFilter =
      window !== undefined
        ? "AND StartedAt BETWEEN fromUnixTimestamp64Milli({from:Int64}) AND fromUnixTimestamp64Milli({to:Int64})"
        : "";

    const result = await client.query({
      query: `
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
      query_params: {
        tenantId,
        sessionId,
        ...(window !== undefined ? { from: window.fromMs, to: window.toMs } : {}),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    return rows[0] ?? null;
  }

  /** One session by its key, or null. */
  async tryFindBySessionId(params: {
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
  async tryFindBySessionIdWithApplied(params: {
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
   * Read newest sessions after tenant-wide deduplication. `StartedAt` and
   * `UserId` filter only the outer scope because either may change between
   * versions; applying them inside `max(UpdatedAt)` can surface a superseded
   * row. The inner scan therefore reads only key columns across the tenant,
   * while the outer range still prunes returned rows. ADR-071 records the cost
   * and the immutable-anchor change that would make inner pruning safe. The
   * injected read-metrics port measures whether the compact scan stays viable.
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
    const client = await this.clickHouse.resolve(tenantId);

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
      const result = await client.query({
        query: `
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
        query_params: {
          tenantId,
          from: fromMs,
          to: toMs,
          // Over-fetched because the collapse happens in TypeScript, below.
          // Two versions of one session can tie on `max(UpdatedAt)` and both
          // satisfy the IN-tuple — the tie `preferredOf` exists to resolve —
          // so a page cut to `limit` HERE spends slots on rows that are about
          // to merge, and the caller silently receives fewer sessions than it
          // asked for. Through `getUsageTotals` that is not a short page but
          // an omitted session's cost and tokens: the mirror of the double
          // count the tiebreak prevents.
          limit: limit * LIST_READ_DEDUP_OVERFETCH,
          ...(userId !== undefined ? { userId } : {}),
        },
        format: "JSONEachRow",
      });

      rows = await result.json<Record<string, unknown>>();
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
      .sort((a, b) => b.startedAtMs - a.startedAtMs)
      .slice(0, limit);
  }

  /**
   * Reads pull-request usage across one organization's project tenants.
   *
   * `TenantId IN (...)` preserves the table's tenant-first read shape. The
   * required `startedAtFromMs` bounds the partition scan; there is no upper
   * bound because an open pull request continues accruing usage.
   *
   * Dedup remains unwindowed because `StartedAt` can move between versions.
   * Branch matching uses both the final scalar and bounded history, while the
   * select carries only rollup fields and scalar tie-break keys; absent array
   * tie-break fields rank as no progress in `preferredOf`.
   */
  async listByRepositoryBranch({
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
        "CodingAgentSessionClickHouseRepository.listByRepositoryBranch",
      );
    }

    const groups = await groupTenantsByClient({
      tenantIds,
      clickHouse: this.clickHouse,
    });
    const rows: CodingAgentBranchSessionRow[] = [];
    for (const group of groups) {
      rows.push(
        ...(await this.listBranchSessionsForClient({
          ...group,
          repositoryHost,
          repositoryOwner,
          repositoryName,
          branches,
          startedAtFromMs,
        })),
      );
    }
    return rows;
  }

  /** One endpoint's share of a repository's branch sessions. */
  private async listBranchSessionsForClient({
    client,
    tenantIds,
    repositoryHost,
    repositoryOwner,
    repositoryName,
    branches,
    startedAtFromMs,
  }: {
    client: CodingAgentClickHouseClient;
    tenantIds: string[];
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    branches: string[];
    startedAtFromMs: number;
  }): Promise<CodingAgentBranchSessionRow[]> {
    const result = await client.query({
      query: `
        SELECT
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
          Title,
          LastEventOccurredAt,
          ModelCalls,
          ToolCalls,
          Prompts
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
      query_params: {
        tenantIds,
        // Case-folded on both sides. A session stores the remote's casing
        // verbatim, while the pull-request mapping stores its host and
        // repository lowercased, so an exact match here would silently drop
        // every remote whose host, owner or name is not already lower case.
        // All three come from the same remote URL, and none of them is in the
        // sort key, so folding costs no pruning; `TenantId` and `StartedAt`
        // still do all of it.
        repositoryHost: repositoryHost.toLowerCase(),
        repositoryOwner: repositoryOwner.toLowerCase(),
        repositoryName: repositoryName.toLowerCase(),
        // NOT folded: git branch names are case sensitive, and `feat/X` is a
        // different branch from `feat/x`.
        branches,
        from: startedAtFromMs,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    // Deduped per tenant, not across the whole result: the shared helper keys
    // on SessionId alone, which is right for a single-tenant read but would
    // collapse two organizations' projects that happen to share a provider
    // session id into one row here, silently dropping the other's cost.
    const byTenant = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
      const tenantId = String(row.TenantId ?? "");
      const list = byTenant.get(tenantId) ?? [];
      list.push(row);
      byTenant.set(tenantId, list);
    }
    return [...byTenant.values()].flatMap((tenantRows) =>
      dedupToLatestPerSession(tenantRows).map(toBranchSessionRow),
    );
  }

  async upsertBatch(
    entries: Array<{
      row: CodingAgentSessionRow;
      retentionDays?: number;
      appliedEventIds?: readonly string[];
    }>,
  ): Promise<void> {
    const [first] = entries;
    if (!first) return;

    const tenantId = first.row.tenantId;
    EventUtils.validateTenantId({ tenantId }, "CodingAgentSessionClickHouseRepository.upsertBatch");
    // A batch insert resolves ONE client, so a row from another tenant would be
    // written into this tenant's ClickHouse. Refuse rather than cross the line.
    for (const { row } of entries) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "CodingAgentSessionClickHouseRepository.upsertBatch",
          "coding agent session batch spans multiple tenants",
          tenantId,
        );
      }
    }

    const client = await this.clickHouse.resolve(tenantId);
    try {
      await client.insert({
        table: TABLE_NAME,
        values: entries.map(({ row, retentionDays, appliedEventIds }) =>
          toRecord({
            row,
            retentionDays: retentionDays ?? this.defaultTraceRetentionDays,
            appliedEventIds,
            versionStampMs: this.nextVersionStamp(row.updatedAt),
          }),
        ),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
        { error, tenantId, count: entries.length },
        "failed to upsert coding agent session batch",
      );
      throw error;
    }
  }
}

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
        seriesId: String(tuple[0] ?? ""),
        metricName: String(tuple[1] ?? ""),
        type: String(tuple[2] ?? ""),
        decision: String(tuple[3] ?? ""),
        language: String(tuple[4] ?? ""),
        value: asNumber(tuple[5]),
      },
    ];
  });
};

const numberMapSchema = z.record(z.string(), z.unknown());

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
 * Collapse versions the IN-tuple could not separate.
 *
 * The dedup subquery matches `(TenantId, SessionId, max(UpdatedAt))`, so two
 * versions of one session sharing that `max(UpdatedAt)` BOTH satisfy it and the
 * session renders TWICE. Such versions differ in `StartedAt` — that is why they
 * are both still there — so they differ in the RMT sort key and no merge ever
 * collapses them (ADR-071 consequence 1). `getUsageTotals` reduces over this
 * array, so a duplicate does not merely look wrong: it counts that session's
 * cost, tokens and active time twice.
 *
 * `findLatestRecord` closes the identical tie with `ORDER BY … LIMIT 1`. A list
 * read cannot — its own `ORDER BY` is the caller's sort — so the same ranking is
 * applied per session here. Like the point read's, this is DEFENCE IN DEPTH:
 * `nextVersionStamp` makes the tie unreachable while per-aggregate serialization
 * holds, and this covers the residual where two writers resumed from the same
 * committed version outside that window.
 *
 * Insertion order is not relied on — the caller re-sorts — so this only has to
 * pick the right version, not preserve a position.
 */
function dedupToLatestPerSession(records: Record<string, unknown>[]): Record<string, unknown>[] {
  const bySession = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    const sessionId = String(record.SessionId ?? "");
    const incumbent = bySession.get(sessionId);
    bySession.set(sessionId, incumbent === undefined ? record : preferredOf(incumbent, record));
  }
  return [...bySession.values()];
}

/**
 * `findLatestRecord`'s ranking, key for key, applied in TypeScript.
 *
 * See that query's docblock for why each key is here and, in particular, why
 * `StartedAt ASC` closes the ordering without being a progress signal. Ties on
 * every key return the incumbent, so the result does not depend on read order.
 */
function preferredOf(
  incumbent: Record<string, unknown>,
  challenger: Record<string, unknown>,
): Record<string, unknown> {
  // A column absent from the record ranks as "no progress" rather than NaN,
  // which would make every comparison against it false and the winner depend on
  // argument order.
  const msOf = (value: unknown) => {
    const ms = parseClickHouseDateTimeMs(String(value ?? ""));
    return Number.isFinite(ms) ? ms : 0;
  };
  const progressOf = (record: Record<string, unknown>) => ({
    watermark: msOf(record.LastEventOccurredAt),
    signals: asNumber(record.ModelCalls) + asNumber(record.ToolCalls) + asNumber(record.Prompts),
    units: Array.isArray(record.MetricSeries) ? record.MetricSeries.length : 0,
    applied: Array.isArray(record.AppliedEventIds) ? record.AppliedEventIds.length : 0,
    startedAt: msOf(record.StartedAt),
  });
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
 *
 * Every DateTime64(3) goes through `parseClickHouseDateTimeMs`: ClickHouse emits
 * them without a zone suffix ("2026-07-24 12:00:00.123") and V8 reads a bare
 * datetime as LOCAL time, so `new Date(str)` skews each one by the host's UTC
 * offset. `LastEventOccurredAt` makes that load-bearing rather than cosmetic —
 * `EventingCodingAgentSessionStoreAdapter` reads it as the "was this row written after
 * migration 00053" discriminator, and a pre-00053 row's `1970-01-01
 * 00:00:00.000` decodes POSITIVE anywhere west of UTC, which would let the
 * store decode exactly the rows its gate exists to reject.
 */
function fromRecord(record: Record<string, unknown>): CodingAgentSessionRow {
  const steps = Array.isArray(record.Steps) ? record.Steps : [];
  return {
    tenantId: String(record.TenantId ?? ""),
    sessionId: String(record.SessionId ?? ""),
    sessionKeySource: String(record.SessionKeySource ?? ""),
    version: String(record.Version ?? ""),
    startedAtMs: parseClickHouseDateTimeMs(String(record.StartedAt ?? "")),

    agent: String(record.Agent ?? ""),
    agentVersion: String(record.AgentVersion ?? ""),
    traceIds: asStringArray(record.TraceIds),
    finalRequestId: String(record.FinalRequestId ?? ""),
    userId: String(record.UserId ?? ""),
    terminalType: String(record.TerminalType ?? ""),
    entrypoint: String(record.Entrypoint ?? ""),
    parentSessionId: String(record.ParentSessionId ?? ""),
    isFork: Boolean(record.IsFork),
    repositoryHost: String(record.RepositoryHost ?? ""),
    repositoryOwner: String(record.RepositoryOwner ?? ""),
    repositoryName: String(record.RepositoryName ?? ""),
    gitBranch: String(record.GitBranch ?? ""),
    gitBranches: asStringArray(record.GitBranches),
    gitWorktree: String(record.GitWorktree ?? ""),
    title: String(record.Title ?? ""),
    titleSource: String(record.TitleSource ?? ""),

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
    permissionMode: String(record.PermissionMode ?? ""),
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

    stopReason: String(record.StopReason ?? ""),
    truncated: Boolean(record.Truncated),

    subAgentIds: asStringArray(record.SubAgentIds),
    stepStartedAt: asNumberArray(record.StepStartedAt),
    previousCallContextTokens: asNumber(record.PreviousCallContextTokens),
    metricSeries: asMetricSeriesRows(record.MetricSeries),
    createdAt: parseClickHouseDateTimeMs(String(record.CreatedAt ?? "")),
    updatedAt: parseClickHouseDateTimeMs(String(record.UpdatedAt ?? "")),
    lastEventOccurredAt: parseClickHouseDateTimeMs(String(record.LastEventOccurredAt ?? "")),
  };
}
