import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import {
  DEFAULT_SET_ID,
  expandSetIdFilter,
  INTERNAL_SET_PREFIX,
} from "~/server/scenarios/internal-set-id";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type {
  BatchHistoryItem,
  ExternalSetSummary,
  ScenarioRunData,
  ScenarioSetData,
} from "~/server/scenarios/scenario-event.types";
import {
  type ClickHouseSimulationRunRow,
  mapClickHouseRowToScenarioRunData,
  mapStatus,
} from "~/server/simulations/simulation-run.mappers";
import {
  queryWindowed,
  type WindowFragment,
} from "../../clients/clickhouse/windowed-read";
import type {
  ExportableRun,
  SimulationRepository,
} from "./simulation.repository";

const TABLE_NAME = "simulation_runs" as const;

export const RUN_ID_CAP = 10000;

/**
 * Sort key for the export sweep, as a single SQL expression.
 *
 * ORDER BY, the cursor predicate and the value returned as the cursor must all
 * be *the same* expression. Sorting on StartedAt while seeding the cursor from
 * a CreatedAt fallback makes the next page filter on a column it did not sort
 * by, which silently drops or repeats runs at the boundary — and ClickHouse
 * sorts NULLs first under ASC, so any NULL StartedAt rows land on page one and
 * become unreachable for the rest of the sweep while the count still includes
 * them. Coalescing here means there is one definition and no fallback in TS.
 */
const EXPORT_SORT_KEY =
  "toUnixTimestamp64Milli(ifNull(t.StartedAt, t.CreatedAt))";

/**
 * Returns an IN-tuple dedup predicate for simulation_runs.
 *
 * simulation_runs uses ReplacingMergeTree(UpdatedAt) with dedup key
 * (TenantId, ScenarioSetId, BatchRunId, ScenarioRunId). This predicate
 * resolves dedup using only lightweight key columns in the inner GROUP BY,
 * avoiding the per-row dedup anti-pattern which materializes ALL columns
 * per granule (~8K rows).
 *
 * @param whereFilters - The same WHERE filters from the outer query,
 *   duplicated here for partition pruning in the inner subquery.
 *
 * @see dev/docs/best_practices/clickhouse-queries.md — "Safe Pattern: IN-Tuple Dedup"
 */
function simulationRunDedupPredicate(whereFilters: string): string {
  return `AND (TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, UpdatedAt) IN (
    SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
    FROM ${TABLE_NAME}
    WHERE ${whereFilters}
    GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
  )`;
}

/**
 * Dedup predicate for a query that reads simulation_runs through the `t` alias.
 *
 * The outer columns MUST be table-qualified. RUN_COLUMNS aliases the timestamp
 * columns to strings (`toString(toUnixTimestamp64Milli(UpdatedAt)) AS UpdatedAt`)
 * and ClickHouse resolves WHERE against SELECT aliases, so an unqualified
 * `UpdatedAt` here compares a String against the subquery's DateTime64 and the
 * IN-tuple matches nothing. That failure is silent — the query succeeds and
 * returns zero rows — so it surfaces as a mysteriously empty result rather than
 * an error. Qualifying with `t.` binds to the column instead of the alias.
 */
function qualifiedDedupPredicate(whereFilters: string): string {
  return `AND (t.TenantId, t.ScenarioSetId, t.BatchRunId, t.ScenarioRunId, t.UpdatedAt) IN (
    SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
    FROM ${TABLE_NAME}
    WHERE ${whereFilters}
    GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
  )`;
}

/**
 * Strips the `t.` qualifier for reuse inside the dedup subquery, which selects
 * from the bare table and has no such alias in scope.
 */
function unqualify(clause: string): string {
  return clause.replace(/\bt\./g, "");
}

/**
 * Builds date filter clauses from startDate/endDate:
 *
 * - `havingClause`: Filters on max(CreatedAt) for exact batch-level filtering
 *   (post-aggregation). Used in HAVING.
 * - `whereClause`: Filters on StartedAt for partition pruning (pre-scan).
 *   simulation_runs is partitioned by toYearWeek(StartedAt). Without this,
 *   ClickHouse scans ALL partitions including cold storage.
 *
 * Both clauses use the same startDate/endDate range but on different columns.
 * The WHERE on StartedAt enables partition pruning (~12x faster), the HAVING
 * on max(CreatedAt) ensures exact filtering for edge cases where they differ.
 */
function buildDateFilter({
  startDate,
  endDate,
}: {
  startDate?: number;
  endDate?: number;
}): {
  havingClause: string | null;
  whereClause: string;
  params: Record<string, string>;
} {
  const havingParts: string[] = [];
  const whereParts: string[] = [];
  const params: Record<string, string> = {};
  if (startDate !== undefined) {
    havingParts.push(
      "toUnixTimestamp64Milli(max(CreatedAt)) >= toUInt64({startDateMs:String})",
    );
    whereParts.push(
      "StartedAt >= fromUnixTimestamp64Milli(toUInt64({startDateMs:String}))",
    );
    params.startDateMs = String(startDate);
  }
  if (endDate !== undefined) {
    havingParts.push(
      "toUnixTimestamp64Milli(max(CreatedAt)) <= toUInt64({endDateMs:String})",
    );
    whereParts.push(
      "StartedAt <= fromUnixTimestamp64Milli(toUInt64({endDateMs:String}))",
    );
    params.endDateMs = String(endDate);
  }
  return {
    havingClause: havingParts.length > 0 ? havingParts.join(" AND ") : null,
    whereClause: whereParts.length > 0 ? `AND ${whereParts.join(" AND ")}` : "",
    params,
  };
}

/**
 * Extracts a StartedAt partition-pruning window from a page of batch aggregates,
 * as a [min, max] range hint for {@link queryWindowed}.
 *
 * getBatchHistoryForScenarioSet fetches the batch page (step 1) and then reads
 * the heavy Messages preview columns for those batches (step 2). simulation_runs
 * is partitioned by toYearWeek(StartedAt), so without a StartedAt predicate the
 * step-2 read opens every weekly partition (including cold storage) to serve a
 * single page. Step 1 already aggregated min/max StartedAt for exactly these
 * batches over the same (deduped, latest-version) rows step 2 returns, so every
 * page run's latest StartedAt lies inside [min, max]. Bounding step 2 to that
 * window prunes the heavy read to the page's few weeks without dropping rows.
 *
 * The window must be applied on the OUTER query only, not inside the
 * max(UpdatedAt) dedup subquery: StartedAt is not strictly immutable across a
 * run's ReplacingMergeTree versions (a snapshot arriving before the run-started
 * event seeds a provisional StartedAt that the started event later overwrites),
 * so filtering versions by StartedAt before picking the latest could resolve the
 * wrong version. Filtering the already-deduped outer rows is always correct.
 *
 * Returns `null` when no valid bound exists (an empty page, or rows whose
 * StartedAt is still provisional/zero). {@link queryWindowed} meters a null hint
 * as an `unwindowed` read: the step-2 read then runs unbounded — the same
 * behaviour as before — but the widening is now counted rather than silent
 * (ADR-067).
 */
export function startedAtBoundsForPage(
  rows: { MinStartedAt: string; MaxStartedAt: string }[],
): { minMs: number; maxMs: number } | null {
  let minMs = Number.POSITIVE_INFINITY;
  let maxMs = 0;
  for (const row of rows) {
    const lo = Number(row.MinStartedAt);
    const hi = Number(row.MaxStartedAt);
    if (Number.isFinite(lo) && lo > 0) minMs = Math.min(minMs, lo);
    if (Number.isFinite(hi) && hi > 0) maxMs = Math.max(maxMs, hi);
  }
  if (!Number.isFinite(minMs) || maxMs <= 0 || minMs > maxMs) {
    return null;
  }
  return { minMs, maxMs };
}

/**
 * Renders the StartedAt predicate the step-2 read has always emitted, from a
 * {@link queryWindowed} fragment (or the empty clause for an unbounded `null`
 * fragment). Deliberately hand-written as `toUInt64({...:String})` rather than
 * `window.sqlFor` so the migration onto queryWindowed changes only *what is
 * metered* — the emitted SQL and params stay byte-identical. A windowed
 * fragment's `[fromMs, toMs]` reproduces the page's exact integer `[min, max]`
 * (a midpoint hint ± a half-range window), so `String(fromMs)`/`String(toMs)`
 * equal the bounds' own decimal strings.
 */
export function buildStartedAtWindowClause(window: WindowFragment | null): {
  whereClause: string;
  params: Record<string, string>;
} {
  if (!window) {
    return { whereClause: "", params: {} };
  }
  return {
    whereClause:
      "AND StartedAt >= fromUnixTimestamp64Milli(toUInt64({minStartedAtMs:String})) " +
      "AND StartedAt <= fromUnixTimestamp64Milli(toUInt64({maxStartedAtMs:String}))",
    params: {
      minStartedAtMs: String(window.fromMs),
      maxStartedAtMs: String(window.toMs),
    },
  };
}

const RUN_COLUMNS = `
  ScenarioRunId, ScenarioId, BatchRunId, ScenarioSetId,
  Status, Name, Description, Metadata,
  \`Messages.Id\`, \`Messages.Role\`, \`Messages.Content\`,
  \`Messages.TraceId\`, \`Messages.Rest\`,
  TraceIds,
  Verdict, Reasoning, MetCriteria, UnmetCriteria, Error,
  toString(DurationMs) AS DurationMs,
  TotalCost, RoleCosts, RoleLatencies,
  toString(toUnixTimestamp64Milli(StartedAt)) AS StartedAt,
  toString(toUnixTimestamp64Milli(CreatedAt)) AS CreatedAt,
  toString(toUnixTimestamp64Milli(UpdatedAt)) AS UpdatedAt,
  toString(toUnixTimestamp64Milli(FinishedAt)) AS FinishedAt,
  toString(toUnixTimestamp64Milli(ArchivedAt)) AS ArchivedAt` as const;

/**
 * Columns for list/grid views — truncated messages and no heavy JSON blobs.
 * Keeps first 6 messages (3 turns) for grid card previews.
 * Omits Messages.Rest (tool call JSON), Messages.TraceId, TraceIds,
 * Reasoning and Error (detail-drawer-only payloads; Reasoning is the judge's
 * multi-paragraph rationale and Error can carry stack traces). MetCriteria /
 * UnmetCriteria stay: the list renders "Passed (met/total)" from their counts.
 */
const LIST_COLUMNS = `
  ScenarioRunId, ScenarioId, BatchRunId, ScenarioSetId,
  Status, Name, Description, Metadata,
  arraySlice(\`Messages.Id\`, 1, 6) AS \`Messages.Id\`,
  arraySlice(\`Messages.Role\`, 1, 6) AS \`Messages.Role\`,
  arraySlice(\`Messages.Content\`, 1, 6) AS \`Messages.Content\`,
  CAST([] AS Array(String)) AS \`Messages.TraceId\`,
  CAST([] AS Array(String)) AS \`Messages.Rest\`,
  CAST([] AS Array(String)) AS TraceIds,
  Verdict,
  CAST(NULL AS Nullable(String)) AS Reasoning,
  MetCriteria, UnmetCriteria,
  CAST(NULL AS Nullable(String)) AS Error,
  toString(DurationMs) AS DurationMs,
  TotalCost, RoleCosts, RoleLatencies,
  toString(toUnixTimestamp64Milli(StartedAt)) AS StartedAt,
  toString(toUnixTimestamp64Milli(CreatedAt)) AS CreatedAt,
  toString(toUnixTimestamp64Milli(UpdatedAt)) AS UpdatedAt,
  toString(toUnixTimestamp64Milli(FinishedAt)) AS FinishedAt,
  toString(toUnixTimestamp64Milli(ArchivedAt)) AS ArchivedAt` as const;

/** Columns for a slim batch-history preview — no full message arrays. */
const PREVIEW_COLUMNS = `
  ScenarioRunId, BatchRunId, Name, Description, Status,
  toString(DurationMs) AS DurationMs,
  toString(toUnixTimestamp64Milli(UpdatedAt)) AS UpdatedAt,
  toString(toUnixTimestamp64Milli(FinishedAt)) AS FinishedAt,
  arraySlice(\`Messages.Role\`, 1, 4) AS MessagePreviewRoles,
  arraySlice(\`Messages.Content\`, 1, 4) AS MessagePreviewContents` as const;

interface CursorPayload {
  ts: string;
  batchRunId: string;
}

/** Slim per-run row shape for the batch-history preview (step-2 heavy read). */
interface PreviewItemRow {
  ScenarioRunId: string;
  BatchRunId: string;
  Name: string | null;
  Description: string | null;
  Status: string;
  DurationMs: string | null;
  UpdatedAt: string;
  FinishedAt: string | null;
  MessagePreviewRoles: string[];
  MessagePreviewContents: string[];
}

export class SimulationClickHouseRepository implements SimulationRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  /** Guards against empty/missing tenantId before delegating to the injected resolver. */
  private async getClient(tenantId: string): Promise<ClickHouseClient> {
    if (!tenantId) {
      throw new Error("tenantId is required for ClickHouse client resolution");
    }
    return this.resolveClient(tenantId);
  }

  private async queryRows<T>(
    query: string,
    params: { tenantId: string } & Record<string, string | string[]>,
  ): Promise<T[]> {
    const client = await this.getClient(params.tenantId);
    const result = await client.query({
      query,
      query_params: params,
      format: "JSONEachRow",
    });
    return result.json<T>();
  }

  async getScenarioSetsData({
    projectId,
    startDate,
    endDate,
  }: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<ScenarioSetData[]> {
    const dateFilter = buildDateFilter({ startDate, endDate });

    const rows = await this.queryRows<{
      ScenarioSetId: string;
      ScenarioCount: string;
      LastRunAt: string;
    }>(
      `SELECT
        NormalizedSetId AS ScenarioSetId,
        toString(count(*)) AS ScenarioCount,
        toString(toUnixTimestamp64Milli(max(UpdatedAt))) AS LastRunAt
       FROM (
         SELECT
           -- 'default' must match DEFAULT_SET_ID from internal-set-id.ts
           IF(ScenarioSetId = '', 'default', ScenarioSetId) AS NormalizedSetId,
           UpdatedAt,
           ArchivedAt
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           ${dateFilter.whereClause}
           ${simulationRunDedupPredicate(`TenantId = {tenantId:String} ${dateFilter.whereClause}`)}
       )
       WHERE ArchivedAt IS NULL
       GROUP BY NormalizedSetId
       ORDER BY LastRunAt DESC`,
      { tenantId: projectId, ...dateFilter.params },
    );

    return rows.map((row) => ({
      scenarioSetId: row.ScenarioSetId,
      scenarioCount: parseInt(row.ScenarioCount, 10),
      lastRunAt: Number(row.LastRunAt),
    }));
  }

  async getScenarioRunData({
    projectId,
    scenarioRunId,
  }: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<ScenarioRunData | null> {
    // Uses a scalar subquery to find the latest UpdatedAt, avoiding the old
    // pattern that read all heavy columns (Messages, RoleCosts, etc.) across
    // entire granules (~8K rows) for dedup, causing OOM on parts with large
    // payloads.
    const rows = await this.queryRows<
      ClickHouseSimulationRunRow & { ExportSortKey: string }
    >(
      `SELECT ${RUN_COLUMNS},
        toString(${EXPORT_SORT_KEY}) AS ExportSortKey
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         AND t.ScenarioRunId = {scenarioRunId:String}
         AND t.ArchivedAt IS NULL
         AND t.UpdatedAt = (
           SELECT max(s.UpdatedAt)
           FROM ${TABLE_NAME} AS s
           WHERE s.TenantId = {tenantId:String}
             AND s.ScenarioRunId = {scenarioRunId:String}
         )
       LIMIT 1`,
      { tenantId: projectId, scenarioRunId },
    );

    const row = rows[0];
    if (!row) return null;
    return mapClickHouseRowToScenarioRunData(row);
  }

  async getBatchHistoryForScenarioSet({
    projectId,
    scenarioSetId,
    limit = 8,
    cursor,
    startDate,
    endDate,
  }: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<{
    batches: BatchHistoryItem[];
    nextCursor?: string;
    hasMore: boolean;
    lastUpdatedAt: number;
    totalCount: number;
  }> {
    const validatedLimit = Math.min(Math.max(1, limit), 100);
    const decoded = cursor ? this.decodeCursor(cursor) : null;

    const cursorPredicate = decoded
      ? `((toString(toUnixTimestamp64Milli(max(CreatedAt))) < {cursorTs:String})
         OR (toString(toUnixTimestamp64Milli(max(CreatedAt))) = {cursorTs:String} AND BatchRunId > {cursorBatchRunId:String}))`
      : "1 = 1";

    const dateFilter = buildDateFilter({ startDate, endDate });

    const combinedHaving = `HAVING ${[cursorPredicate, dateFilter.havingClause].filter(Boolean).join(" AND ")}`;

    // Step 0: fetch total distinct batch count (runs in parallel with step 1)
    const totalCountPromise = this.queryRows<{ TotalBatchCount: string }>(
      `SELECT toString(count(DISTINCT BatchRunId)) AS TotalBatchCount
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ${dateFilter.whereClause}
         AND ArchivedAt IS NULL
         ${simulationRunDedupPredicate(`TenantId = {tenantId:String} AND ScenarioSetId IN ({scenarioSetIds:Array(String)}) ${dateFilter.whereClause}`)}`,
      {
        tenantId: projectId,
        scenarioSetIds: expandSetIdFilter(scenarioSetId),
        ...dateFilter.params,
      },
    );

    // Step 1: fetch batch-level aggregates
    const batchRowsPromise = this.queryRows<{
      BatchRunId: string;
      TotalCount: string;
      PassCount: string;
      FailCount: string;
      CancelledCount: string;
      RunningCount: string;
      LastUpdatedAt: string;
      LastRunAt: string;
      FirstCompletedAt: string;
      AllCompletedAt: string;
      MinStartedAt: string;
      MaxStartedAt: string;
    }>(
      `SELECT
        BatchRunId,
        toString(count())                                               AS TotalCount,
        toString(countIf(Status = 'SUCCESS'))                          AS PassCount,
        -- Cancelled is neither pass nor fail (#6834) — it gets its own count
        -- below instead of inflating FailCount. 'FAILURE' stays for rows
        -- written before the fold started emitting the FAILED enum member.
        toString(countIf(Status IN ('FAILED','FAILURE','ERROR')))      AS FailCount,
        toString(countIf(Status = 'CANCELLED'))                        AS CancelledCount,
        toString(countIf(Status IN ('IN_PROGRESS','PENDING')))         AS RunningCount,
        toString(toUnixTimestamp64Milli(max(UpdatedAt)))               AS LastUpdatedAt,
        toString(toUnixTimestamp64Milli(max(CreatedAt)))               AS LastRunAt,
        toString(toUnixTimestamp64Milli(
          minIf(UpdatedAt, Status IN ('SUCCESS','FAILED','FAILURE','ERROR','CANCELLED'))
        )) AS FirstCompletedAt,
        -- QUEUED belongs with the other not-yet-completed states: a batch
        -- still holding a queued run has not all completed, and counting one
        -- stamped a completion time on a batch that was still waiting to
        -- start (#6834).
        toString(toUnixTimestamp64Milli(
          maxIf(UpdatedAt, Status NOT IN ('STALLED','IN_PROGRESS','PENDING','QUEUED'))
        )) AS AllCompletedAt,
        toString(toUnixTimestamp64Milli(min(StartedAt)))                AS MinStartedAt,
        toString(toUnixTimestamp64Milli(max(StartedAt)))                AS MaxStartedAt
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ${dateFilter.whereClause}
         AND ArchivedAt IS NULL
         ${simulationRunDedupPredicate(`TenantId = {tenantId:String} AND ScenarioSetId IN ({scenarioSetIds:Array(String)}) ${dateFilter.whereClause}`)}
       GROUP BY BatchRunId
       ${combinedHaving}
       ORDER BY LastRunAt DESC, BatchRunId ASC
       LIMIT {fetchLimit:UInt32}`,
      {
        tenantId: projectId,
        scenarioSetIds: expandSetIdFilter(scenarioSetId),
        ...(decoded
          ? { cursorTs: decoded.ts, cursorBatchRunId: decoded.batchRunId }
          : {}),
        ...dateFilter.params,
        fetchLimit: String(validatedLimit + 1),
      },
    );

    const [totalCountRows, batchRows] = await Promise.all([
      totalCountPromise,
      batchRowsPromise,
    ]);
    const totalCount = parseInt(totalCountRows[0]?.TotalBatchCount ?? "0", 10);

    const hasMore = batchRows.length > validatedLimit;
    const pageRows = hasMore ? batchRows.slice(0, validatedLimit) : batchRows;

    if (pageRows.length === 0) {
      return {
        batches: [],
        nextCursor: undefined,
        hasMore: false,
        lastUpdatedAt: 0,
        totalCount,
      };
    }

    const lastRow = pageRows[pageRows.length - 1]!;
    const nextCursor = hasMore
      ? this.encodeCursor(lastRow.LastRunAt, lastRow.BatchRunId)
      : undefined;

    const batchRunIds = pageRows.map((r) => r.BatchRunId);

    // Bound the heavy step-2 read to the StartedAt window of the batches on this
    // page (aggregated in step 1) so it prunes partitions instead of scanning
    // every weekly partition including cold storage — routed through
    // queryWindowed so the outcome lands on clickhouse_windowed_read_total{table}
    // exactly once per call (ADR-067):
    //
    //   - Page has a StartedAt range: the read runs windowed and is metered
    //     `hit` — the cheap, pruned path.
    //   - Page has no usable StartedAt (empty / provisional): the hint is null,
    //     so the read runs unbounded and is metered `unwindowed`. This is the
    //     widening the old empty-clause helper did *silently*; it is now counted.
    //
    // The page carries a [min, max] RANGE, not a point, so it maps as a midpoint
    // hint with a half-range window — the emitted fragment covers exactly
    // [min, max]. fallback "none": step 1 already bounded these batches to
    // [min, max], so a run's latest StartedAt always lies inside the window; an
    // empty windowed read is a genuine empty page and is never widened (widening
    // here would issue a second unbounded scan the old code never did, changing
    // the SQL that runs — precisely what byte-identical adoption forbids).
    const startedAtBounds = startedAtBoundsForPage(pageRows);

    // Step 2: fetch slim item rows (preview columns only)
    const itemRows = await queryWindowed<PreviewItemRow[]>({
      table: TABLE_NAME,
      hintMs: startedAtBounds
        ? (startedAtBounds.minMs + startedAtBounds.maxMs) / 2
        : null,
      windowMs: startedAtBounds
        ? (startedAtBounds.maxMs - startedAtBounds.minMs) / 2
        : undefined,
      fallback: "none",
      isEmpty: (rows) => rows.length === 0,
      run: (window) => {
        const startedAtWindow = buildStartedAtWindowClause(window);
        return this.queryRows<PreviewItemRow>(
          `SELECT ${PREVIEW_COLUMNS}
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         AND BatchRunId IN ({batchRunIds:Array(String)})
         AND ArchivedAt IS NULL
         ${startedAtWindow.whereClause}
         ${simulationRunDedupPredicate("TenantId = {tenantId:String} AND ScenarioSetId IN ({scenarioSetIds:Array(String)}) AND BatchRunId IN ({batchRunIds:Array(String)})")}
       ORDER BY CreatedAt ASC`,
          {
            tenantId: projectId,
            scenarioSetIds: expandSetIdFilter(scenarioSetId),
            batchRunIds,
            ...startedAtWindow.params,
          },
        );
      },
    });

    // Group items by batchRunId
    const itemsByBatch = new Map<string, typeof itemRows>();
    for (const row of itemRows) {
      const list = itemsByBatch.get(row.BatchRunId) ?? [];
      list.push(row);
      itemsByBatch.set(row.BatchRunId, list);
    }

    let globalLastUpdatedAt = 0;

    const batches: BatchHistoryItem[] = pageRows.map((b) => {
      const lastUpdatedAt = Number(b.LastUpdatedAt);
      if (lastUpdatedAt > globalLastUpdatedAt)
        globalLastUpdatedAt = lastUpdatedAt;

      const items = (itemsByBatch.get(b.BatchRunId) ?? []).map((r) => {
        const baseStatus = mapStatus(r.Status);
        const durationMs =
          r.DurationMs != null ? parseInt(r.DurationMs, 10) : 0;
        const hasFinished = r.FinishedAt != null && Number(r.FinishedAt) > 0;
        // Stored status is the only truth: unfinished runs collapse to
        // IN_PROGRESS; stalled runs arrive as stored ERROR via the
        // process-manager stall watchdog.
        const resolvedStatus = hasFinished
          ? baseStatus
          : ScenarioRunStatus.IN_PROGRESS;
        return {
          scenarioRunId: r.ScenarioRunId,
          name: r.Name,
          description: r.Description,
          status: resolvedStatus,
          durationInMs: durationMs,
          messagePreview: (r.MessagePreviewRoles ?? []).map((role, i) => ({
            role,
            content: r.MessagePreviewContents?.[i] ?? "",
          })),
        };
      });

      const stalledCount = items.filter((i) => i.status === "STALLED").length;
      const runningCount = Number(b.RunningCount) - stalledCount;

      const firstCompletedAt = Number(b.FirstCompletedAt);
      const allCompletedAt = Number(b.AllCompletedAt);

      return {
        batchRunId: b.BatchRunId,
        totalCount: Number(b.TotalCount),
        passCount: Number(b.PassCount),
        failCount: Number(b.FailCount),
        cancelledCount: Number(b.CancelledCount),
        runningCount: Math.max(0, runningCount),
        stalledCount,
        lastRunAt: Number(b.LastRunAt),
        lastUpdatedAt,
        firstCompletedAt: firstCompletedAt > 0 ? firstCompletedAt : null,
        allCompletedAt: allCompletedAt > 0 ? allCompletedAt : null,
        items,
      };
    });

    return {
      batches,
      nextCursor,
      hasMore,
      lastUpdatedAt: globalLastUpdatedAt,
      totalCount,
    };
  }

  async getRunDataForBatchRun({
    projectId,
    scenarioSetId,
    batchRunId,
    sinceTimestamp,
  }: {
    projectId: string;
    scenarioSetId: string;
    batchRunId: string;
    sinceTimestamp?: number;
  }): Promise<
    | { changed: false; lastUpdatedAt: number }
    | { changed: true; lastUpdatedAt: number; runs: ScenarioRunData[] }
  > {
    if (sinceTimestamp !== undefined) {
      const tsRows = await this.queryRows<{ LastUpdatedAt: string }>(
        `SELECT toString(toUnixTimestamp64Milli(max(UpdatedAt))) AS LastUpdatedAt
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND BatchRunId = {batchRunId:String}
           AND ArchivedAt IS NULL`,
        { tenantId: projectId, batchRunId },
      );
      const lastUpdatedAt = Number(tsRows[0]?.LastUpdatedAt ?? "0");
      if (lastUpdatedAt <= sinceTimestamp) {
        return { changed: false, lastUpdatedAt };
      }
    }

    const rows = await this.queryRows<
      ClickHouseSimulationRunRow & { ExportSortKey: string }
    >(
      `SELECT ${RUN_COLUMNS},
        toString(${EXPORT_SORT_KEY}) AS ExportSortKey
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         AND t.ScenarioSetId IN ({scenarioSetIds:Array(String)})
         AND t.BatchRunId = {batchRunId:String}
         AND t.ArchivedAt IS NULL
         AND (t.TenantId, t.ScenarioSetId, t.BatchRunId, t.ScenarioRunId, t.UpdatedAt) IN (
           SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
           FROM ${TABLE_NAME}
           WHERE TenantId = {tenantId:String}
             AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
             AND BatchRunId = {batchRunId:String}
           GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
         )
       ORDER BY CreatedAt ASC`,
      {
        tenantId: projectId,
        scenarioSetIds: expandSetIdFilter(scenarioSetId),
        batchRunId,
      },
    );

    const runs = rows.map((row) => mapClickHouseRowToScenarioRunData(row));
    const lastUpdatedAt = runs.reduce(
      (max, r) => Math.max(max, r.timestamp),
      0,
    );
    return { changed: true, lastUpdatedAt, runs };
  }

  async getBatchRunCountForScenarioSet({
    projectId,
    scenarioSetId,
    startDate,
    endDate,
  }: {
    projectId: string;
    scenarioSetId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number> {
    const dateFilter = buildDateFilter({ startDate, endDate });

    const rows = await this.queryRows<{ BatchRunCount: string }>(
      `SELECT toString(count(DISTINCT BatchRunId)) AS BatchRunCount
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ${dateFilter.whereClause}
         AND ArchivedAt IS NULL
         ${simulationRunDedupPredicate(`TenantId = {tenantId:String} AND ScenarioSetId IN ({scenarioSetIds:Array(String)}) ${dateFilter.whereClause}`)}`,
      {
        tenantId: projectId,
        scenarioSetIds: expandSetIdFilter(scenarioSetId),
        ...dateFilter.params,
      },
    );
    return parseInt(rows[0]?.BatchRunCount ?? "0", 10);
  }

  async getAllRunDataForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<ScenarioRunData[]> {
    const rows = await this.queryRows<
      ClickHouseSimulationRunRow & { ExportSortKey: string }
    >(
      `SELECT ${RUN_COLUMNS},
        toString(${EXPORT_SORT_KEY}) AS ExportSortKey
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         AND t.ScenarioSetId IN ({scenarioSetIds:Array(String)})
         AND t.ArchivedAt IS NULL
         AND (t.TenantId, t.ScenarioSetId, t.BatchRunId, t.ScenarioRunId, t.UpdatedAt) IN (
           SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
           FROM ${TABLE_NAME}
           WHERE TenantId = {tenantId:String}
             AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
           GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
         )
       ORDER BY BatchRunId ASC, CreatedAt ASC
       LIMIT 10000`,
      { tenantId: projectId, scenarioSetIds: expandSetIdFilter(scenarioSetId) },
    );

    return rows.map((row) => mapClickHouseRowToScenarioRunData(row));
  }

  async getRunDataForScenarioSet({
    projectId,
    scenarioSetId,
    limit = 20,
    cursor,
    startDate,
    endDate,
  }: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<{
    runs: ScenarioRunData[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const validatedLimit = Math.min(Math.max(1, limit), 100);
    const decoded = cursor ? this.decodeCursor(cursor) : null;

    const cursorPredicate = decoded
      ? `(
          (toString(toUnixTimestamp64Milli(max(CreatedAt))) < {cursorTs:String})
          OR (toString(toUnixTimestamp64Milli(max(CreatedAt))) = {cursorTs:String} AND BatchRunId > {cursorBatchRunId:String})
        )`
      : "1 = 1";

    const dateFilter = buildDateFilter({ startDate, endDate });

    const combinedHaving = `HAVING ${[cursorPredicate, dateFilter.havingClause].filter(Boolean).join(" AND ")}`;

    const batchRows = await this.queryRows<{
      BatchRunId: string;
      MaxCreatedAt: string;
    }>(
      `SELECT
        BatchRunId,
        toString(toUnixTimestamp64Milli(max(CreatedAt))) AS MaxCreatedAt
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ${dateFilter.whereClause}
         AND ArchivedAt IS NULL
         ${simulationRunDedupPredicate(`TenantId = {tenantId:String} AND ScenarioSetId IN ({scenarioSetIds:Array(String)}) ${dateFilter.whereClause}`)}
       GROUP BY BatchRunId
       ${combinedHaving}
       ORDER BY MaxCreatedAt DESC, BatchRunId ASC
       LIMIT {fetchLimit:UInt32}`,
      {
        tenantId: projectId,
        scenarioSetIds: expandSetIdFilter(scenarioSetId),
        ...(decoded
          ? { cursorTs: decoded.ts, cursorBatchRunId: decoded.batchRunId }
          : {}),
        ...dateFilter.params,
        fetchLimit: String(validatedLimit + 1),
      },
    );

    const hasMore = batchRows.length > validatedLimit;
    const pageRows = hasMore ? batchRows.slice(0, validatedLimit) : batchRows;

    if (pageRows.length === 0) {
      return { runs: [], nextCursor: undefined, hasMore: false };
    }

    const lastRow = pageRows[pageRows.length - 1];

    const nextCursor =
      lastRow && hasMore
        ? this.encodeCursor(lastRow.MaxCreatedAt, lastRow.BatchRunId)
        : undefined;

    const batchRunIds = pageRows.map((r) => r.BatchRunId);
    const runs = await this.getRunsForBatchIds({
      projectId,
      batchRunIds,
      scenarioSetId,
    });

    return { runs, nextCursor, hasMore };
  }

  async getRunDataForAllSuites({
    projectId,
    limit = 20,
    cursor,
    startDate,
    endDate,
    sinceTimestamp,
  }: {
    projectId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
    sinceTimestamp?: number;
  }): Promise<
    | { changed: false; lastUpdatedAt: number }
    | {
        changed: true;
        lastUpdatedAt: number;
        runs: ScenarioRunData[];
        scenarioSetIds: Record<string, string>;
        nextCursor?: string;
        hasMore: boolean;
      }
  > {
    // Cheap timestamp check: skip heavy query if nothing changed
    if (sinceTimestamp !== undefined) {
      const tsRows = await this.queryRows<{ LastUpdatedAt: string }>(
        `SELECT toString(toUnixTimestamp64Milli(max(UpdatedAt))) AS LastUpdatedAt
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ArchivedAt IS NULL`,
        { tenantId: projectId },
      );
      const lastUpdatedAt = Number(tsRows[0]?.LastUpdatedAt ?? "0");
      if (lastUpdatedAt <= sinceTimestamp) {
        return { changed: false, lastUpdatedAt };
      }
    }

    const validatedLimit = Math.min(Math.max(1, limit), 100);
    const decoded = cursor ? this.decodeCursor(cursor) : null;

    const cursorPredicate = decoded
      ? `(
          (toString(toUnixTimestamp64Milli(max(CreatedAt))) < {cursorTs:String})
          OR (toString(toUnixTimestamp64Milli(max(CreatedAt))) = {cursorTs:String} AND BatchRunId > {cursorBatchRunId:String})
        )`
      : "1 = 1";

    const dateFilter = buildDateFilter({ startDate, endDate });

    const combinedHaving = `HAVING ${[cursorPredicate, dateFilter.havingClause].filter(Boolean).join(" AND ")}`;

    // NOTE: The aggregate is aliased as NormalizedSetId (not ScenarioSetId) on
    // purpose — aliasing as ScenarioSetId would shadow the underlying column
    // referenced in the dedup IN-tuple below, causing ClickHouse to reject the
    // query with "Aggregate function ... is found in WHERE in query".
    const batchRows = await this.queryRows<{
      BatchRunId: string;
      MaxCreatedAt: string;
      NormalizedSetId: string;
    }>(
      `SELECT
        BatchRunId,
        toString(toUnixTimestamp64Milli(max(CreatedAt))) AS MaxCreatedAt,
        any(IF(ScenarioSetId = '', 'default', ScenarioSetId)) AS NormalizedSetId -- Must match DEFAULT_SET_ID from internal-set-id.ts
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         ${dateFilter.whereClause}
         AND ArchivedAt IS NULL
         ${simulationRunDedupPredicate(`TenantId = {tenantId:String} ${dateFilter.whereClause}`)}
       GROUP BY BatchRunId
       ${combinedHaving}
       ORDER BY MaxCreatedAt DESC, BatchRunId ASC
       LIMIT {fetchLimit:UInt32}`,
      {
        tenantId: projectId,
        ...(decoded
          ? { cursorTs: decoded.ts, cursorBatchRunId: decoded.batchRunId }
          : {}),
        ...dateFilter.params,
        fetchLimit: String(validatedLimit + 1),
      },
    );

    const hasMore = batchRows.length > validatedLimit;
    const pageRows = hasMore ? batchRows.slice(0, validatedLimit) : batchRows;

    if (pageRows.length === 0) {
      return {
        changed: true,
        lastUpdatedAt: 0,
        runs: [],
        scenarioSetIds: {},
        nextCursor: undefined,
        hasMore: false,
      };
    }

    const lastRow = pageRows[pageRows.length - 1]!;
    const nextCursor = hasMore
      ? this.encodeCursor(lastRow.MaxCreatedAt, lastRow.BatchRunId)
      : undefined;

    const scenarioSetIds: Record<string, string> = {};
    for (const row of pageRows) {
      scenarioSetIds[row.BatchRunId] = row.NormalizedSetId;
    }

    const batchRunIds = pageRows.map((r) => r.BatchRunId);
    const runs = await this.getRunsForBatchIds({ projectId, batchRunIds });
    const lastUpdatedAt = runs.reduce(
      (max, r) => Math.max(max, r.timestamp),
      0,
    );

    return {
      changed: true,
      lastUpdatedAt,
      runs,
      scenarioSetIds,
      nextCursor,
      hasMore,
    };
  }

  async findLastUpdatedAt({
    projectId,
    scenarioSetId,
    startDate,
    endDate,
  }: {
    projectId: string;
    scenarioSetId?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number> {
    // Freshness probes poll frequently, so an unbounded StartedAt window
    // (scanning every partition, including cold storage) is never acceptable
    // here — floor the window at 30 days when the caller omits it.
    const dateFilter = buildDateFilter({
      startDate: startDate ?? Date.now() - 30 * 24 * 60 * 60 * 1000,
      endDate,
    });
    const setFilter = scenarioSetId
      ? "AND ScenarioSetId IN ({scenarioSetIds:Array(String)})"
      : "";

    // max(UpdatedAt) over all versions equals the latest version's UpdatedAt
    // (ReplacingMergeTree version column), so no dedup subquery is needed.
    // Reads only light columns; the StartedAt window prunes partitions.
    const rows = await this.queryRows<{ LastUpdatedAt: string | null }>(
      `SELECT toString(toUnixTimestamp64Milli(max(UpdatedAt))) AS LastUpdatedAt
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         ${setFilter}
         ${dateFilter.whereClause}`,
      {
        tenantId: projectId,
        ...(scenarioSetId
          ? { scenarioSetIds: expandSetIdFilter(scenarioSetId) }
          : {}),
        ...dateFilter.params,
      },
    );

    return Number(rows[0]?.LastUpdatedAt ?? "0");
  }

  async getExternalSetSummaries(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<ExternalSetSummary[]> {
    return this.getSetSummaries({ ...params, filter: "external" });
  }

  async getInternalSuiteSummaries(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<ExternalSetSummary[]> {
    return this.getSetSummaries({ ...params, filter: "internal-suites" });
  }

  /**
   * ⚠️  KEEP IN SYNC: The content panel computes pass rate on the frontend
   * with its own formula (passed / settled, excluding in-progress/queued).
   * If you change the aggregation here, also update:
   *   - run-history-transforms.ts → computeGroupSummary() (content panel)
   */
  private async getSetSummaries({
    projectId,
    startDate,
    endDate,
    filter,
  }: {
    projectId: string;
    startDate?: number;
    endDate?: number;
    filter: "external" | "internal-suites";
  }): Promise<ExternalSetSummary[]> {
    const dateFilter = buildDateFilter({ startDate, endDate });

    const havingClause = dateFilter.havingClause
      ? `HAVING ${dateFilter.havingClause}`
      : "";

    const wherePredicate =
      filter === "external"
        ? "AND NOT startsWith(ScenarioSetId, '__internal__')"
        : "AND startsWith(ScenarioSetId, '__internal__') AND endsWith(ScenarioSetId, '__suite')";

    // External sets normalize empty ScenarioSetId to 'default'
    const selectId =
      filter === "external"
        ? "IF(ScenarioSetId = '', 'default', ScenarioSetId) AS NormalizedSetId"
        : "ScenarioSetId AS NormalizedSetId";

    const rows = await this.queryRows<{
      ScenarioSetId: string;
      TotalCount: string;
      PassCount: string;
      FailCount: string;
      LastRunAt: string;
    }>(
      `SELECT
        NormalizedSetId AS ScenarioSetId,
        toString(argMax(SettledCount, MinStartedAtMs)) AS TotalCount,
        toString(argMax(PassCount, MinStartedAtMs)) AS PassCount,
        toString(argMax(FailCount, MinStartedAtMs)) AS FailCount,
        toString(max(MinStartedAtMs)) AS LastRunAt
       FROM (
         SELECT
           NormalizedSetId,
           BatchRunId,
           -- Settled = terminal states that say something about the agent.
           -- Cancelled is excluded from both sides (#6834): a user
           -- cancellation is neither a pass nor a fail, and counting it
           -- either way distorts the sidebar pass rate. Keep in sync with
           -- computeGroupSummary in run-history-transforms.ts.
           countIf(Status NOT IN ('IN_PROGRESS', 'PENDING', 'QUEUED', 'RUNNING', 'CANCELLED')) AS SettledCount,
           countIf(Status = 'SUCCESS') AS PassCount,
           countIf(Status IN ('FAILED','FAILURE','ERROR','STALLED')) AS FailCount,
           -- Use min(StartedAt) to match frontend's minTimestamp (batch creation time)
           toUnixTimestamp64Milli(min(if(StartedAt IS NOT NULL, StartedAt, CreatedAt))) AS MinStartedAtMs
         FROM (
           SELECT ${selectId}, BatchRunId, Status, CreatedAt, StartedAt, ArchivedAt
           FROM ${TABLE_NAME}
           WHERE TenantId = {tenantId:String}
             ${wherePredicate}
             ${dateFilter.whereClause}
             ${simulationRunDedupPredicate(`TenantId = {tenantId:String} ${wherePredicate} ${dateFilter.whereClause}`)}
         )
         WHERE ArchivedAt IS NULL
         GROUP BY NormalizedSetId, BatchRunId
         ${havingClause}
       )
       GROUP BY NormalizedSetId
       ORDER BY LastRunAt DESC`,
      { tenantId: projectId, ...dateFilter.params },
    );

    return rows.map((row) => ({
      scenarioSetId: row.ScenarioSetId,
      passedCount: Number(row.PassCount),
      failedCount: Number(row.FailCount),
      totalCount: Number(row.TotalCount),
      lastRunTimestamp: Number(row.LastRunAt),
    }));
  }

  async findAllRunIdsForSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<{ runIds: string[]; reachedCap: boolean }> {
    const client = await this.getClient(projectId);
    // The default set is stored as '' but addressed as 'default' (and
    // vice-versa). Expand to both storage forms so archiving the default
    // set matches its rows — the same normalization every other set-scoped
    // query uses via expandSetIdFilter.
    const scenarioSetIds = expandSetIdFilter(scenarioSetId);
    // Dedup to the latest version per run before applying ArchivedAt IS NULL.
    // simulation_runs is ReplacingMergeTree(UpdatedAt); without dedup, an
    // older non-archived row can satisfy the filter even after the run was
    // archived, re-dispatching deletions for already-archived runs.
    const result = await client.query({
      query: `SELECT DISTINCT ScenarioRunId
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
                AND ArchivedAt IS NULL
                ${simulationRunDedupPredicate(
                  "TenantId = {tenantId:String} AND ScenarioSetId IN ({scenarioSetIds:Array(String)})",
                )}
              LIMIT ${RUN_ID_CAP}`,
      query_params: { tenantId: projectId, scenarioSetIds },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ ScenarioRunId: string }>();
    const runIds = rows.map((r) => r.ScenarioRunId);
    return { runIds, reachedCap: runIds.length === RUN_ID_CAP };
  }

  async getDistinctExternalSetIds({
    projectIds,
  }: {
    projectIds: string[];
  }): Promise<Set<string>> {
    const [firstProjectId] = projectIds;
    if (!firstProjectId) {
      return new Set();
    }

    // simulation_runs is a ReplacingMergeTree, so each run is read at its
    // latest version. Rather than the IN-tuple dedup pattern — which scans the
    // table twice (once to build the latest-version key set, once for the
    // outer filter) and materialises a key set sized to every run — fold each
    // run to its latest version in a single GROUP BY pass and keep the sets
    // whose latest run is not archived. Light columns only; the distinct
    // external set ids are identical.
    //
    // We fold over `argMax(ArchivedAt IS NULL, UpdatedAt)` rather than
    // `argMax(ArchivedAt, UpdatedAt)`: ArchivedAt is Nullable, and argMax
    // skips rows whose first argument is NULL, so a freshly un-archived run
    // (latest ArchivedAt = NULL) would otherwise be ignored and the run would
    // look archived. The `IS NULL` expression is non-nullable, so the fold
    // reads the true latest version.
    const rows = await this.queryRows<{ ScenarioSetId: string }>(
      `SELECT DISTINCT IF(ScenarioSetId = '', '${DEFAULT_SET_ID}', ScenarioSetId) AS ScenarioSetId
       FROM (
         SELECT
           ScenarioSetId,
           argMax(ArchivedAt IS NULL, UpdatedAt) AS latestIsActive
         FROM ${TABLE_NAME}
         WHERE TenantId IN ({projectIds:Array(String)})
           AND NOT startsWith(ScenarioSetId, '${INTERNAL_SET_PREFIX}')
         GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE latestIsActive`,
      { tenantId: firstProjectId, projectIds },
    );

    return new Set(
      rows.map((r) =>
        r.ScenarioSetId === "" ? DEFAULT_SET_ID : r.ScenarioSetId,
      ),
    );
  }

  // ---- Export sweep ----

  async countRunsForExport({
    projectId,
    scenarioSetId,
    scenarioId,
    startDate,
    endDate,
  }: {
    projectId: string;
    scenarioSetId?: string;
    scenarioId?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number> {
    const { stableClause, dateClause, params } = this.buildExportFilters({
      scenarioSetId,
      scenarioId,
      startDate,
      endDate,
    });

    const rows = await this.queryRows<{ Total: string }>(
      `SELECT toString(count()) AS Total
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         ${stableClause}
         ${dateClause}
         AND t.ArchivedAt IS NULL
         ${qualifiedDedupPredicate(`TenantId = {tenantId:String} ${unqualify(stableClause)}`)}`,
      { tenantId: projectId, ...params },
    );

    return Number(rows[0]?.Total ?? "0");
  }

  /**
   * Forward-only page of runs for a CSV export sweep.
   *
   * Distinct from getRunDataForAllSuites, which caps at 100 and is shaped for
   * the UI's freshness protocol (it can answer `changed: false` and skip the
   * read entirely). An export needs a plain chronological sweep it can drive to
   * exhaustion, so it gets its own read rather than bending that one.
   *
   * Keyset (not OFFSET) pagination on (StartedAt, ScenarioRunId): OFFSET makes
   * ClickHouse re-scan and re-sort every preceding row for each page, so a large
   * export degrades quadratically. The tuple is unique because ScenarioRunId
   * breaks ties within a millisecond.
   *
   * Reads RUN_COLUMNS, never LIST_COLUMNS — the latter nulls out Reasoning and
   * Error and truncates the conversation to 6 messages for grid cards, which
   * would silently ship an export with empty judge reasoning.
   */
  async findRunsForExport({
    projectId,
    scenarioSetId,
    scenarioId,
    startDate,
    endDate,
    limit,
    cursor,
  }: {
    projectId: string;
    scenarioSetId?: string;
    scenarioId?: string;
    startDate?: number;
    endDate?: number;
    limit: number;
    cursor?: string;
  }): Promise<{
    runs: ExportableRun[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const validatedLimit = Math.min(Math.max(1, limit), 500);
    const decoded = cursor ? this.decodeExportCursor(cursor) : null;

    const { stableClause, dateClause, params } = this.buildExportFilters({
      scenarioSetId,
      scenarioId,
      startDate,
      endDate,
    });

    const cursorPredicate = decoded
      ? `AND (
          (${EXPORT_SORT_KEY} > toUInt64({cursorTs:String}))
          OR (${EXPORT_SORT_KEY} = toUInt64({cursorTs:String}) AND t.ScenarioRunId > {cursorRunId:String})
        )`
      : "";

    const rows = await this.queryRows<
      ClickHouseSimulationRunRow & { ExportSortKey: string }
    >(
      `SELECT ${RUN_COLUMNS},
        toString(${EXPORT_SORT_KEY}) AS ExportSortKey
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         ${stableClause}
         ${dateClause}
         ${cursorPredicate}
         AND t.ArchivedAt IS NULL
         ${qualifiedDedupPredicate(`TenantId = {tenantId:String} ${unqualify(stableClause)}`)}
       ORDER BY ${EXPORT_SORT_KEY} ASC, t.ScenarioRunId ASC
       LIMIT {fetchLimit:UInt32}`,
      {
        tenantId: projectId,
        ...params,
        ...(decoded
          ? { cursorTs: decoded.ts, cursorRunId: decoded.scenarioRunId }
          : {}),
        fetchLimit: String(validatedLimit + 1),
      },
    );

    const hasMore = rows.length > validatedLimit;
    const pageRows = hasMore ? rows.slice(0, validatedLimit) : rows;

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? this.encodeExportCursor(lastRow.ExportSortKey, lastRow.ScenarioRunId)
        : undefined;

    return {
      runs: pageRows.map((row) => ({
        ...mapClickHouseRowToScenarioRunData(row),
        scenarioSetId:
          row.ScenarioSetId === "" ? DEFAULT_SET_ID : row.ScenarioSetId,
        traceIds: row.TraceIds ?? [],
      })),
      nextCursor,
      hasMore,
    };
  }

  /**
   * Shared WHERE fragments for the export sweep and its count, so the two can
   * never drift and report a total the sweep does not produce.
   *
   * Returned in two halves because only one of them may go inside the dedup
   * subquery:
   *
   *   stable — ScenarioSetId and ScenarioId. A run cannot move between sets or
   *     scenarios, and ScenarioSetId is part of the dedup key already, so
   *     narrowing on these picks the same version either way. Keeping them in
   *     the subquery is what stops it grouping the whole tenant.
   *
   *   date — StartedAt, which IS mutable across versions: the projection opens
   *     a run with StartedAt null (persisted as CreatedAt) and only sets the
   *     real value when the started event lands. Inside the subquery it would
   *     make max(UpdatedAt) the newest version *within the range* rather than
   *     the newest version, so a run whose corrected timestamp moved out of the
   *     window would export its stale earlier snapshot — old status, missing
   *     messages — instead of being excluded. It belongs only in the outer
   *     query, applied to whichever version actually won.
   *
   * The cost is that the subquery no longer prunes partitions by date. That is
   * the trade: an export that is cheaper but occasionally wrong around a range
   * boundary is not worth having.
   *
   * Note the pass/fail filter is deliberately absent: outcome categories
   * (success/failure/stalled/…) are derived from the mapped status by
   * categorizeRunStatus, so filtering happens after mapping, keeping the
   * export consistent with what the run history shows.
   */
  private buildExportFilters({
    scenarioSetId,
    scenarioId,
    startDate,
    endDate,
  }: {
    scenarioSetId?: string;
    scenarioId?: string;
    startDate?: number;
    endDate?: number;
  }): {
    stableClause: string;
    dateClause: string;
    params: Record<string, string | string[]>;
  } {
    const stableParts: string[] = [];
    const params: Record<string, string | string[]> = {};

    if (scenarioSetId) {
      stableParts.push("t.ScenarioSetId IN ({exportSetIds:Array(String)})");
      params.exportSetIds = expandSetIdFilter(scenarioSetId);
    }

    if (scenarioId) {
      stableParts.push("t.ScenarioId = {exportScenarioId:String}");
      params.exportScenarioId = scenarioId;
    }

    const dateFilter = buildDateFilter({ startDate, endDate });
    let dateClause = "";
    if (dateFilter.whereClause) {
      // buildDateFilter emits unqualified column names; the export queries read
      // through the `t` alias, so qualify them here.
      dateClause = dateFilter.whereClause.replace(/StartedAt/g, "t.StartedAt");
      Object.assign(params, dateFilter.params);
    }

    return {
      stableClause:
        stableParts.length > 0 ? `AND ${stableParts.join(" AND ")}` : "",
      dateClause,
      params,
    };
  }

  // ---- Cursor helpers ----

  /**
   * Export cursors key on (StartedAt, ScenarioRunId); the batch cursors below
   * key on (max(CreatedAt), BatchRunId). Separate encoders rather than one
   * shared pair so neither payload carries a field named for the other's key.
   */
  private encodeExportCursor(ts: string, scenarioRunId: string): string {
    return Buffer.from(JSON.stringify({ ts, scenarioRunId })).toString(
      "base64",
    );
  }

  private decodeExportCursor(
    cursor: string,
  ): { ts: string; scenarioRunId: string } | null {
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, "base64").toString("utf-8"),
      ) as Record<string, unknown>;
      if (
        typeof parsed.ts !== "string" ||
        typeof parsed.scenarioRunId !== "string"
      ) {
        return null;
      }
      return { ts: parsed.ts, scenarioRunId: parsed.scenarioRunId };
    } catch {
      return null;
    }
  }

  private encodeCursor(ts: string, batchRunId: string): string {
    const payload: CursorPayload = { ts, batchRunId };
    return Buffer.from(JSON.stringify(payload)).toString("base64");
  }

  private decodeCursor(cursor: string): CursorPayload | null {
    try {
      const json = Buffer.from(cursor, "base64").toString("utf-8");
      const parsed = JSON.parse(json) as Record<string, unknown>;
      if (
        typeof parsed.ts !== "string" ||
        typeof parsed.batchRunId !== "string"
      ) {
        return null;
      }
      return { ts: parsed.ts, batchRunId: parsed.batchRunId };
    } catch {
      return null;
    }
  }

  // ---- Batch helper ----

  private async getRunsForBatchIds({
    projectId,
    batchRunIds,
    scenarioSetId,
  }: {
    projectId: string;
    batchRunIds: string[];
    scenarioSetId?: string;
  }): Promise<ScenarioRunData[]> {
    if (batchRunIds.length === 0) return [];

    const setFilter = scenarioSetId
      ? "AND t.ScenarioSetId IN ({scenarioSetIds:Array(String)})"
      : "";
    const innerSetFilter = scenarioSetId
      ? "AND ScenarioSetId IN ({scenarioSetIds:Array(String)})"
      : "";

    const rows = await this.queryRows<ClickHouseSimulationRunRow>(
      `SELECT ${LIST_COLUMNS}
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         AND t.BatchRunId IN ({batchRunIds:Array(String)})
         ${setFilter}
         AND t.ArchivedAt IS NULL
         AND (t.TenantId, t.ScenarioSetId, t.BatchRunId, t.ScenarioRunId, t.UpdatedAt) IN (
           SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
           FROM ${TABLE_NAME}
           WHERE TenantId = {tenantId:String}
             AND BatchRunId IN ({batchRunIds:Array(String)})
             ${innerSetFilter}
           GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
         )
       ORDER BY CreatedAt ASC
       LIMIT 5000`,
      {
        tenantId: projectId,
        batchRunIds,
        ...(scenarioSetId
          ? { scenarioSetIds: expandSetIdFilter(scenarioSetId) }
          : {}),
      },
    );

    return rows.map((row) => mapClickHouseRowToScenarioRunData(row));
  }
}
