import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import {
  DEFAULT_SET_ID,
  expandSetIdFilter,
  INTERNAL_SET_PREFIX,
} from "~/server/scenarios/internal-set-id";
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
import type { SimulationRepository } from "./simulation.repository";
import {
  SIMULATION_FAILED_STATUSES,
  SIMULATION_RUNS_TABLE,
  SIMULATION_TERMINAL_STATUSES,
  simulationRunDedupPredicate,
  statusList,
} from "./simulationRuns.sql";

const TABLE_NAME = SIMULATION_RUNS_TABLE;

export const RUN_ID_CAP = 10000;

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
 * StartedAt is NOT immutable across a run's ReplacingMergeTree versions — a
 * snapshot arriving before the run-started event seeds a provisional StartedAt
 * that the started event overwrites — so in general a StartedAt range inside a
 * max(UpdatedAt) dedup subquery is the movable-column defect the rulebook
 * forbids: the true latest version drifts out of the filtered scope and the
 * group resolves to a stale in-window one. This particular window is the
 * exception, and only because of where it comes from: step 1 aggregated
 * [min, max] over the *deduped, latest-version* rows of exactly these batches,
 * so every page run's latest StartedAt lies inside it by construction. The
 * filter can therefore never exclude a latest version, which makes it safe in
 * both scopes — and repeating it in the dedup scope is what lets that scan
 * prune partitions too, rather than reading every week of the tenant's light
 * key columns. Do not generalise this to a caller-supplied window.
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
 * Maps each batch on the page to the number of runs it set out to queue
 * (`BatchTotal`, ADR-072), so a caller holding only the runs that landed can
 * still tell a five-run batch from a six-run batch that lost one.
 *
 * A batch queued before the denominator existed reports 0, and is left out
 * entirely rather than published as a zero total — the absence is what tells
 * the reader to count the runs instead. Callers must apply that fallback; see
 * `computeGroupSummary` in run-history-transforms.ts for the read side.
 */
export function expectedCountsForPage(
  rows: { BatchRunId: string; ExpectedCount: string }[],
): Record<string, number> {
  const expectedCounts: Record<string, number> = {};
  for (const row of rows) {
    const expected = Number(row.ExpectedCount);
    if (Number.isFinite(expected) && expected > 0) {
      expectedCounts[row.BatchRunId] = expected;
    }
  }
  return expectedCounts;
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
 *
 * `alias` qualifies the column for outer scopes that alias the table: both
 * {@link RUN_COLUMNS} and {@link LIST_COLUMNS} project
 * `toString(...) AS StartedAt`, a `String` alias that shadows the raw
 * `DateTime64` column and would otherwise make the comparison a type error.
 * The dedup subquery selects no such alias, so it takes the unqualified form.
 */
export function buildStartedAtWindowClause({
  window,
  alias,
}: {
  window: Pick<WindowFragment, "fromMs" | "toMs"> | null;
  alias?: string;
}): {
  whereClause: string;
  params: Record<string, string>;
} {
  if (!window) {
    return { whereClause: "", params: {} };
  }
  const column = alias ? `${alias}.StartedAt` : "StartedAt";
  return {
    whereClause:
      `AND ${column} >= fromUnixTimestamp64Milli(toUInt64({minStartedAtMs:String})) ` +
      `AND ${column} <= fromUnixTimestamp64Milli(toUInt64({maxStartedAtMs:String}))`,
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
           ${simulationRunDedupPredicate({ tenantIdParam: "tenantId", partitionFilters: dateFilter.whereClause })}
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
    const rows = await this.queryRows<ClickHouseSimulationRunRow>(
      `SELECT ${RUN_COLUMNS}
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
         ${simulationRunDedupPredicate({ tenantIdParam: "tenantId", partitionFilters: dateFilter.whereClause })}`,
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
      ExpectedCount: string;
      PassCount: string;
      FailCount: string;
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
        toString(max(BatchTotal))                                       AS ExpectedCount,
        toString(countIf(Status = 'SUCCESS'))                          AS PassCount,
        toString(countIf(Status IN (${statusList(SIMULATION_FAILED_STATUSES)},'CANCELLED'))) AS FailCount,
        toString(countIf(Status IN ('IN_PROGRESS','PENDING')))         AS RunningCount,
        toString(toUnixTimestamp64Milli(max(UpdatedAt)))               AS LastUpdatedAt,
        toString(toUnixTimestamp64Milli(max(CreatedAt)))               AS LastRunAt,
        toString(toUnixTimestamp64Milli(
          minIf(UpdatedAt, Status IN (${statusList(SIMULATION_TERMINAL_STATUSES)}))
        )) AS FirstCompletedAt,
        toString(toUnixTimestamp64Milli(
          maxIf(UpdatedAt, Status IN (${statusList(SIMULATION_TERMINAL_STATUSES)}))
        )) AS AllCompletedAt,
        toString(toUnixTimestamp64Milli(min(StartedAt)))                AS MinStartedAt,
        toString(toUnixTimestamp64Milli(max(StartedAt)))                AS MaxStartedAt
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ${dateFilter.whereClause}
         AND ArchivedAt IS NULL
         ${simulationRunDedupPredicate({ tenantIdParam: "tenantId", partitionFilters: dateFilter.whereClause })}
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
        const startedAtWindow = buildStartedAtWindowClause({ window });
        return this.queryRows<PreviewItemRow>(
          `SELECT ${PREVIEW_COLUMNS}
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         AND BatchRunId IN ({batchRunIds:Array(String)})
         AND ArchivedAt IS NULL
         ${startedAtWindow.whereClause}
         ${simulationRunDedupPredicate({ tenantIdParam: "tenantId", partitionFilters: startedAtWindow.whereClause })}
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
        const durationMs =
          r.DurationMs != null ? parseInt(r.DurationMs, 10) : 0;
        return {
          scenarioRunId: r.ScenarioRunId,
          name: r.Name,
          description: r.Description,
          status: mapStatus(r.Status),
          durationInMs: durationMs,
          messagePreview: (r.MessagePreviewRoles ?? []).map((role, i) => ({
            role,
            content: r.MessagePreviewContents?.[i] ?? "",
          })),
        };
      });

      // STALLED is a stored status since ADR-073 step 2, so a stalled run is
      // already outside RunningCount's IN_PROGRESS/PENDING set. Subtracting it
      // again — which is what the read-time derivation required — would take
      // the same run off the count twice.
      const stalledCount = items.filter((i) => i.status === "STALLED").length;
      const runningCount = Number(b.RunningCount);

      const firstCompletedAt = Number(b.FirstCompletedAt);
      const allCompletedAt = Number(b.AllCompletedAt);

      // Named apart from the outer `totalCount` (the distinct-batch count for
      // pagination), which this callback would otherwise shadow.
      const batchRunCount = Number(b.TotalCount);
      // 0 means the batch predates the denominator; count the rows instead.
      const expectedCount = Math.max(
        Number(b.ExpectedCount) || 0,
        batchRunCount,
      );

      return {
        batchRunId: b.BatchRunId,
        totalCount: batchRunCount,
        expectedCount,
        passCount: Number(b.PassCount),
        failCount: Number(b.FailCount),
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
    let watermark: number | null = null;
    if (sinceTimestamp !== undefined) {
      watermark = await this.findBatchWatermark({ projectId, batchRunId });
      if (watermark <= sinceTimestamp) {
        return { changed: false, lastUpdatedAt: watermark };
      }
    }

    const rows = await this.queryRows<ClickHouseSimulationRunRow>(
      `SELECT ${RUN_COLUMNS}
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         AND t.ScenarioSetId IN ({scenarioSetIds:Array(String)})
         AND t.BatchRunId = {batchRunId:String}
         AND t.ArchivedAt IS NULL
         ${simulationRunDedupPredicate({ tenantIdParam: "tenantId", alias: "t" })}
       ORDER BY CreatedAt ASC`,
      {
        tenantId: projectId,
        scenarioSetIds: expandSetIdFilter(scenarioSetId),
        batchRunId,
      },
    );

    const runs = rows.map((row) => mapClickHouseRowToScenarioRunData(row));
    // The watermark, when we have one, is what the caller must poll with next:
    // it accounts for runs that left the list (archived), whose UpdatedAt is by
    // definition absent from `runs`. Reporting only the max over the surviving
    // runs would leave the caller polling with a value below the watermark, so
    // every subsequent poll would re-report `changed: true` forever.
    const lastUpdatedAt = Math.max(
      watermark ?? 0,
      runs.reduce((max, r) => Math.max(max, r.timestamp), 0),
    );
    return { changed: true, lastUpdatedAt, runs };
  }

  /**
   * Latest-version UpdatedAt across every version ever written for `batchRunId`,
   * archived ones included.
   *
   * `simulation_runs` is `ReplacingMergeTree(UpdatedAt)` and the version column
   * only increases, so the maximum over all versions already equals the maximum
   * over latest versions — no dedup subquery, no heavy columns (the same
   * reasoning {@link findLastUpdatedAt} documents).
   *
   * The one thing that must stay out is `ArchivedAt IS NULL`, which this probe
   * used to carry. Applied to the raw `ReplacingMergeTree` it excludes the
   * archived latest version, and `max(UpdatedAt)` falls back to the run's own
   * superseded non-archived version — a value at or below the caller's
   * `sinceTimestamp`, so the caller is told nothing changed and the archive
   * never reaches the UI. Archival is precisely the kind of change a poll has
   * to see, so the watermark spans archived runs and the `ArchivedAt IS NULL`
   * narrowing belongs only to the read that follows it.
   *
   * `BatchRunId` is a plain equality filter here rather than a post-dedup
   * `argMax`: this is a watermark, not a listing, and the run whose newest
   * version lost its batch id drops out of the read below for the same reason.
   */
  private async findBatchWatermark({
    projectId,
    batchRunId,
  }: {
    projectId: string;
    batchRunId: string;
  }): Promise<number> {
    const rows = await this.queryRows<{ LastUpdatedAt: string }>(
      `SELECT toString(toUnixTimestamp64Milli(max(UpdatedAt))) AS LastUpdatedAt
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND BatchRunId = {batchRunId:String}`,
      { tenantId: projectId, batchRunId },
    );
    return Number(rows[0]?.LastUpdatedAt ?? "0");
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
         ${simulationRunDedupPredicate({ tenantIdParam: "tenantId", partitionFilters: dateFilter.whereClause })}`,
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
    const rows = await this.queryRows<ClickHouseSimulationRunRow>(
      `SELECT ${RUN_COLUMNS}
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         AND t.ScenarioSetId IN ({scenarioSetIds:Array(String)})
         AND t.ArchivedAt IS NULL
         ${simulationRunDedupPredicate({ tenantIdParam: "tenantId", alias: "t" })}
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
    expectedCounts: Record<string, number>;
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
      ExpectedCount: string;
      MinStartedAt: string;
      MaxStartedAt: string;
    }>(
      `SELECT
        BatchRunId,
        toString(toUnixTimestamp64Milli(max(CreatedAt))) AS MaxCreatedAt,
        toString(max(BatchTotal))                        AS ExpectedCount,
        toString(toUnixTimestamp64Milli(min(StartedAt))) AS MinStartedAt,
        toString(toUnixTimestamp64Milli(max(StartedAt))) AS MaxStartedAt
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ${dateFilter.whereClause}
         AND ArchivedAt IS NULL
         ${simulationRunDedupPredicate({ tenantIdParam: "tenantId", partitionFilters: dateFilter.whereClause })}
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
      return {
        runs: [],
        expectedCounts: {},
        nextCursor: undefined,
        hasMore: false,
      };
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
      startedAtBounds: startedAtBoundsForPage(pageRows),
    });

    return {
      runs,
      expectedCounts: expectedCountsForPage(pageRows),
      nextCursor,
      hasMore,
    };
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
        expectedCounts: Record<string, number>;
        nextCursor?: string;
        hasMore: boolean;
      }
  > {
    // Cheap timestamp check: skip the heavy query if nothing changed.
    let watermark: number | null = null;
    if (sinceTimestamp !== undefined) {
      watermark = await this.findTenantWatermark({ projectId });
      if (watermark <= sinceTimestamp) {
        return { changed: false, lastUpdatedAt: watermark };
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
      ExpectedCount: string;
      MinStartedAt: string;
      MaxStartedAt: string;
    }>(
      `SELECT
        BatchRunId,
        toString(toUnixTimestamp64Milli(max(CreatedAt))) AS MaxCreatedAt,
        any(IF(ScenarioSetId = '', 'default', ScenarioSetId)) AS NormalizedSetId, -- Must match DEFAULT_SET_ID from internal-set-id.ts
        toString(max(BatchTotal))                        AS ExpectedCount,
        toString(toUnixTimestamp64Milli(min(StartedAt))) AS MinStartedAt,
        toString(toUnixTimestamp64Milli(max(StartedAt))) AS MaxStartedAt
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}
         ${dateFilter.whereClause}
         AND ArchivedAt IS NULL
         ${simulationRunDedupPredicate({ tenantIdParam: "tenantId", partitionFilters: dateFilter.whereClause })}
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
        // The watermark, not 0: an empty page after an archive is exactly the
        // case where the poll must still advance, or the caller keeps asking
        // with a timestamp the watermark already passed and is told `changed`
        // on every poll forever.
        lastUpdatedAt: watermark ?? 0,
        runs: [],
        scenarioSetIds: {},
        expectedCounts: {},
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
    const runs = await this.getRunsForBatchIds({
      projectId,
      batchRunIds,
      startedAtBounds: startedAtBoundsForPage(pageRows),
    });
    // See getRunDataForBatchRun: the watermark covers runs that left the page
    // (archived), whose UpdatedAt no longer appears in `runs`, so polling with
    // the page maximum alone would report `changed: true` on every poll.
    const lastUpdatedAt = Math.max(
      watermark ?? 0,
      runs.reduce((max, r) => Math.max(max, r.timestamp), 0),
    );

    return {
      changed: true,
      lastUpdatedAt,
      runs,
      scenarioSetIds,
      expectedCounts: expectedCountsForPage(pageRows),
      nextCursor,
      hasMore,
    };
  }

  /**
   * Latest-version UpdatedAt across every run in the tenant, archived included.
   *
   * `simulation_runs` is `ReplacingMergeTree(UpdatedAt)` and the version column
   * only increases, so the maximum over all versions already is the maximum
   * over latest versions — no dedup subquery, no heavy columns. The one thing
   * that must stay out is an `ArchivedAt IS NULL` filter; see
   * {@link findBatchWatermark} for why it silently lowers the watermark.
   */
  private async findTenantWatermark({
    projectId,
  }: {
    projectId: string;
  }): Promise<number> {
    const rows = await this.queryRows<{ LastUpdatedAt: string }>(
      `SELECT toString(toUnixTimestamp64Milli(max(UpdatedAt))) AS LastUpdatedAt
       FROM ${TABLE_NAME}
       WHERE TenantId = {tenantId:String}`,
      { tenantId: projectId },
    );
    return Number(rows[0]?.LastUpdatedAt ?? "0");
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
           -- Settled = all terminal states (excludes in-progress/queued)
           countIf(Status NOT IN ('IN_PROGRESS', 'PENDING', 'QUEUED', 'RUNNING')) AS SettledCount,
           countIf(Status = 'SUCCESS') AS PassCount,
           countIf(Status IN ('FAILED','FAILURE','ERROR','STALLED','CANCELLED')) AS FailCount,
           -- Use min(StartedAt) to match frontend's minTimestamp (batch creation time)
           toUnixTimestamp64Milli(min(if(StartedAt IS NOT NULL, StartedAt, CreatedAt))) AS MinStartedAtMs
         FROM (
           SELECT ${selectId}, BatchRunId, Status, CreatedAt, StartedAt, ArchivedAt
           FROM ${TABLE_NAME}
           WHERE TenantId = {tenantId:String}
             ${wherePredicate}
             ${dateFilter.whereClause}
             ${simulationRunDedupPredicate({ tenantIdParam: "tenantId", partitionFilters: dateFilter.whereClause })}
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
                ${simulationRunDedupPredicate({ tenantIdParam: "tenantId" })}
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
    //
    // The fold groups on the engine key `(TenantId, ScenarioRunId)`, and both
    // ScenarioSetId and the internal-prefix test are resolved from the latest
    // version (argMax / an outer predicate) rather than from whichever version
    // the row happened to be read from. ScenarioSetId is fold-written and starts
    // as '', so grouping by it — or filtering on it before the fold — would both
    // split a run's versions into separate groups and let a pre-started version
    // report the run under the default set.
    const rows = await this.queryRows<{ ScenarioSetId: string }>(
      `SELECT DISTINCT IF(LatestSetId = '', '${DEFAULT_SET_ID}', LatestSetId) AS ScenarioSetId
       FROM (
         SELECT
           argMax(ScenarioSetId, UpdatedAt) AS LatestSetId,
           argMax(ArchivedAt IS NULL, UpdatedAt) AS LatestIsActive
         FROM ${TABLE_NAME}
         WHERE TenantId IN ({projectIds:Array(String)})
         GROUP BY TenantId, ScenarioRunId
       )
       WHERE LatestIsActive
         AND NOT startsWith(LatestSetId, '${INTERNAL_SET_PREFIX}')`,
      { tenantId: firstProjectId, projectIds },
    );

    return new Set(
      rows.map((r) =>
        r.ScenarioSetId === "" ? DEFAULT_SET_ID : r.ScenarioSetId,
      ),
    );
  }

  // ---- Cursor helpers ----

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

  /**
   * Reads the page's runs at their latest version, with `Messages.Content` and
   * the rest of {@link LIST_COLUMNS}.
   *
   * `startedAtBounds` is the [min, max] StartedAt of the batches on the page,
   * aggregated by the caller's own batch query over the same deduped,
   * latest-version rows this read returns — the same hint
   * {@link startedAtBoundsForPage} builds for the batch-history preview, and
   * safe for the same reason: every page run's latest StartedAt lies inside the
   * bounds by construction, so bounding cannot drop a row. Without it this
   * read — the heaviest on the table, since it materialises message content —
   * opened every weekly partition including cold storage to serve one page.
   * Both callers have the bounds, so both pass them; `null` means the page had
   * no usable StartedAt and the read runs unbounded, as it always did.
   */
  private async getRunsForBatchIds({
    projectId,
    batchRunIds,
    scenarioSetId,
    startedAtBounds,
  }: {
    projectId: string;
    batchRunIds: string[];
    scenarioSetId?: string;
    startedAtBounds?: { minMs: number; maxMs: number } | null;
  }): Promise<ScenarioRunData[]> {
    if (batchRunIds.length === 0) return [];

    const setFilter = scenarioSetId
      ? "AND t.ScenarioSetId IN ({scenarioSetIds:Array(String)})"
      : "";
    const window = startedAtBounds
      ? { fromMs: startedAtBounds.minMs, toMs: startedAtBounds.maxMs }
      : null;
    // Same bounds, same params, rendered twice: qualified for the aliased outer
    // scope, bare for the dedup subquery (which has no alias to qualify).
    const outerStartedAtWindow = buildStartedAtWindowClause({
      window,
      alias: "t",
    });
    const innerStartedAtWindow = buildStartedAtWindowClause({ window });

    const rows = await this.queryRows<ClickHouseSimulationRunRow>(
      `SELECT ${LIST_COLUMNS}
       FROM ${TABLE_NAME} AS t
       WHERE t.TenantId = {tenantId:String}
         AND t.BatchRunId IN ({batchRunIds:Array(String)})
         ${setFilter}
         AND t.ArchivedAt IS NULL
         ${outerStartedAtWindow.whereClause}
         ${simulationRunDedupPredicate({ tenantIdParam: "tenantId", partitionFilters: innerStartedAtWindow.whereClause, alias: "t" })}
       ORDER BY CreatedAt ASC
       LIMIT 5000`,
      {
        tenantId: projectId,
        batchRunIds,
        ...(scenarioSetId
          ? { scenarioSetIds: expandSetIdFilter(scenarioSetId) }
          : {}),
        ...outerStartedAtWindow.params,
      },
    );

    return rows.map((row) => mapClickHouseRowToScenarioRunData(row));
  }
}
