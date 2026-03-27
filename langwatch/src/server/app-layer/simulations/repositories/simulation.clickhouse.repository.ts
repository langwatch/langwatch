import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type {
  BatchHistoryItem,
  ExternalSetSummary,
  ScenarioRunData,
  ScenarioSetData,
} from "~/server/scenarios/scenario-event.types";
import { resolveRunStatus } from "~/server/scenarios/stall-detection";
import {
  mapClickHouseRowToScenarioRunData,
  mapStatus,
  type ClickHouseSimulationRunRow,
} from "~/server/simulations/simulation-run.mappers";
import { INTERNAL_SET_PREFIX, expandSetIdFilter } from "~/server/scenarios/internal-set-id";
import type { SimulationRepository } from "./simulation.repository";

const TABLE_NAME = "simulation_runs" as const;

/**
 * Builds a HAVING clause fragment that filters batches by their max(CreatedAt)
 * falling within [startDate, endDate]. Returns both the SQL clause and the
 * parameterized values so they stay co-located. Filters atomically by the
 * batch's latest timestamp so entire batches are included or excluded together.
 */
function buildDateHavingFilter({
  startDate,
  endDate,
}: {
  startDate?: number;
  endDate?: number;
}): { clause: string | null; params: Record<string, string> } {
  const parts: string[] = [];
  const params: Record<string, string> = {};
  if (startDate !== undefined) {
    parts.push(
      "toUnixTimestamp64Milli(max(CreatedAt)) >= toUInt64({startDateMs:String})",
    );
    params.startDateMs = String(startDate);
  }
  if (endDate !== undefined) {
    parts.push(
      "toUnixTimestamp64Milli(max(CreatedAt)) <= toUInt64({endDateMs:String})",
    );
    params.endDateMs = String(endDate);
  }
  return { clause: parts.length > 0 ? parts.join(" AND ") : null, params };
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
  toString(toUnixTimestamp64Milli(CreatedAt)) AS CreatedAt,
  toString(toUnixTimestamp64Milli(UpdatedAt)) AS UpdatedAt,
  toString(toUnixTimestamp64Milli(FinishedAt)) AS FinishedAt,
  toString(toUnixTimestamp64Milli(ArchivedAt)) AS ArchivedAt` as const;

/**
 * Columns for list/grid views — truncated messages and no heavy JSON blobs.
 * Keeps first 6 messages (3 turns) for grid card previews.
 * Omits Messages.Rest (tool call JSON) and Messages.TraceId.
 */
const LIST_COLUMNS = `
  ScenarioRunId, ScenarioId, BatchRunId, ScenarioSetId,
  Status, Name, Description, Metadata,
  arraySlice(\`Messages.Id\`, 1, 6) AS \`Messages.Id\`,
  arraySlice(\`Messages.Role\`, 1, 6) AS \`Messages.Role\`,
  arraySlice(\`Messages.Content\`, 1, 6) AS \`Messages.Content\`,
  CAST([] AS Array(String)) AS \`Messages.TraceId\`,
  CAST([] AS Array(String)) AS \`Messages.Rest\`,
  TraceIds,
  Verdict, Reasoning, MetCriteria, UnmetCriteria, Error,
  toString(DurationMs) AS DurationMs,
  TotalCost, RoleCosts, RoleLatencies,
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

/** Minimal columns for inner subquery in aggregation-only queries (count, max, group by) */
const DEDUP_COLUMNS = `
  TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, ScenarioId,
  Status, UpdatedAt, CreatedAt, FinishedAt, ArchivedAt` as const;

/** Inner subquery columns for preview queries (getBatchHistory items) */
const DEDUP_PREVIEW_COLUMNS = `
  TenantId, ScenarioSetId, BatchRunId, ScenarioRunId,
  Status, Name, Description,
  \`Messages.Role\`, \`Messages.Content\`,
  DurationMs, UpdatedAt, CreatedAt, FinishedAt, ArchivedAt` as const;

/** Inner subquery columns for list-view queries (getRunsForBatchIds) */
const DEDUP_LIST_COLUMNS = `
  TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, ScenarioId,
  Status, Name, Description, Metadata,
  \`Messages.Id\`, \`Messages.Role\`, \`Messages.Content\`,
  TraceIds, Verdict, Reasoning, MetCriteria, UnmetCriteria, Error,
  DurationMs, TotalCost, RoleCosts, RoleLatencies,
  UpdatedAt, CreatedAt, FinishedAt, ArchivedAt` as const;

/** Inner subquery columns for full-detail queries */
const DEDUP_RUN_COLUMNS = `
  TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, ScenarioId,
  Status, Name, Description, Metadata,
  \`Messages.Id\`, \`Messages.Role\`, \`Messages.Content\`,
  \`Messages.TraceId\`, \`Messages.Rest\`,
  TraceIds, Verdict, Reasoning, MetCriteria, UnmetCriteria, Error,
  DurationMs, TotalCost, RoleCosts, RoleLatencies,
  UpdatedAt, CreatedAt, FinishedAt, ArchivedAt` as const;

interface CursorPayload {
  ts: string;
  batchRunId: string;
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
  }: {
    projectId: string;
  }): Promise<ScenarioSetData[]> {
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
         FROM (
           SELECT ${DEDUP_COLUMNS}
           FROM ${TABLE_NAME}
           WHERE TenantId = {tenantId:String}
           ORDER BY ScenarioRunId, UpdatedAt DESC
           LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
         )
       )
       WHERE ArchivedAt IS NULL
       GROUP BY NormalizedSetId
       ORDER BY LastRunAt DESC`,
      { tenantId: projectId },
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
    const rows = await this.queryRows<ClickHouseSimulationRunRow>(
      `SELECT ${RUN_COLUMNS}
       FROM (
         SELECT ${DEDUP_RUN_COLUMNS}
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String} AND ScenarioRunId = {scenarioRunId:String}
         ORDER BY UpdatedAt DESC
         LIMIT 1
       )
       WHERE ArchivedAt IS NULL
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
  }: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    batches: BatchHistoryItem[];
    nextCursor?: string;
    hasMore: boolean;
    lastUpdatedAt: number;
    totalCount: number;
  }> {
    const validatedLimit = Math.min(Math.max(1, limit), 100);
    const decoded = cursor ? this.decodeCursor(cursor) : null;

    const cursorClause = decoded
      ? `HAVING (toString(toUnixTimestamp64Milli(max(CreatedAt))) < {cursorTs:String})
         OR (toString(toUnixTimestamp64Milli(max(CreatedAt))) = {cursorTs:String} AND BatchRunId > {cursorBatchRunId:String})`
      : "HAVING 1 = 1";

    // Step 0: fetch total distinct batch count (runs in parallel with step 1)
    const totalCountPromise = this.queryRows<{ TotalBatchCount: string }>(
      `SELECT toString(count(DISTINCT BatchRunId)) AS TotalBatchCount
       FROM (
         SELECT ${DEDUP_COLUMNS}
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE ArchivedAt IS NULL`,
      { tenantId: projectId, scenarioSetIds: expandSetIdFilter(scenarioSetId) },
    );

    // Step 1: fetch batch-level aggregates
    const batchRowsPromise = this.queryRows<{
      BatchRunId: string;
      TotalCount: string;
      PassCount: string;
      FailCount: string;
      RunningCount: string;
      LastUpdatedAt: string;
      LastRunAt: string;
      FirstCompletedAt: string;
      AllCompletedAt: string;
    }>(
      `SELECT
        BatchRunId,
        toString(count())                                               AS TotalCount,
        toString(countIf(Status = 'SUCCESS'))                          AS PassCount,
        toString(countIf(Status IN ('FAILED','FAILURE','ERROR','CANCELLED'))) AS FailCount,
        toString(countIf(Status IN ('IN_PROGRESS','PENDING')))         AS RunningCount,
        toString(toUnixTimestamp64Milli(max(UpdatedAt)))               AS LastUpdatedAt,
        toString(toUnixTimestamp64Milli(max(CreatedAt)))               AS LastRunAt,
        toString(toUnixTimestamp64Milli(
          minIf(UpdatedAt, Status IN ('SUCCESS','FAILED','FAILURE','ERROR','CANCELLED'))
        )) AS FirstCompletedAt,
        toString(toUnixTimestamp64Milli(
          maxIf(UpdatedAt, Status NOT IN ('STALLED','IN_PROGRESS','PENDING'))
        )) AS AllCompletedAt
       FROM (
         SELECT ${DEDUP_COLUMNS}
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE ArchivedAt IS NULL
       GROUP BY BatchRunId
       ${cursorClause}
       ORDER BY LastRunAt DESC, BatchRunId ASC
       LIMIT {fetchLimit:UInt32}`,
      {
        tenantId: projectId,
        scenarioSetIds: expandSetIdFilter(scenarioSetId),
        ...(decoded ? { cursorTs: decoded.ts, cursorBatchRunId: decoded.batchRunId } : {}),
        fetchLimit: String(validatedLimit + 1),
      },
    );

    const [totalCountRows, batchRows] = await Promise.all([totalCountPromise, batchRowsPromise]);
    const totalCount = parseInt(totalCountRows[0]?.TotalBatchCount ?? "0", 10);

    const hasMore = batchRows.length > validatedLimit;
    const pageRows = hasMore ? batchRows.slice(0, validatedLimit) : batchRows;

    if (pageRows.length === 0) {
      return { batches: [], nextCursor: undefined, hasMore: false, lastUpdatedAt: 0, totalCount };
    }

    const lastRow = pageRows[pageRows.length - 1]!;
    const nextCursor = hasMore
      ? this.encodeCursor(lastRow.LastRunAt, lastRow.BatchRunId)
      : undefined;

    const batchRunIds = pageRows.map((r) => r.BatchRunId);

    // Step 2: fetch slim item rows (preview columns only)
    const itemRows = await this.queryRows<{
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
    }>(
      `SELECT ${PREVIEW_COLUMNS}
       FROM (
         SELECT ${DEDUP_PREVIEW_COLUMNS}
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
           AND BatchRunId IN ({batchRunIds:Array(String)})
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE ArchivedAt IS NULL
       ORDER BY CreatedAt ASC`,
      { tenantId: projectId, scenarioSetIds: expandSetIdFilter(scenarioSetId), batchRunIds },
    );

    // Group items by batchRunId
    const itemsByBatch = new Map<string, typeof itemRows>();
    for (const row of itemRows) {
      const list = itemsByBatch.get(row.BatchRunId) ?? [];
      list.push(row);
      itemsByBatch.set(row.BatchRunId, list);
    }

    const now = Date.now();
    let globalLastUpdatedAt = 0;

    const batches: BatchHistoryItem[] = pageRows.map((b) => {
      const lastUpdatedAt = Number(b.LastUpdatedAt);
      if (lastUpdatedAt > globalLastUpdatedAt) globalLastUpdatedAt = lastUpdatedAt;

      const items = (itemsByBatch.get(b.BatchRunId) ?? []).map((r) => {
        const baseStatus = mapStatus(r.Status);
        const durationMs = r.DurationMs != null ? parseInt(r.DurationMs, 10) : 0;
        const perRunUpdatedAt = Number(r.UpdatedAt);
        const hasFinished = r.FinishedAt != null && Number(r.FinishedAt) > 0;
        const resolvedStatus = resolveRunStatus({
          finishedStatus: hasFinished ? baseStatus : undefined,
          lastEventTimestamp: perRunUpdatedAt,
          now,
        });
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
        runningCount: Math.max(0, runningCount),
        stalledCount,
        lastRunAt: Number(b.LastRunAt),
        lastUpdatedAt,
        firstCompletedAt: firstCompletedAt > 0 ? firstCompletedAt : null,
        allCompletedAt: allCompletedAt > 0 ? allCompletedAt : null,
        items,
      };
    });

    return { batches, nextCursor, hasMore, lastUpdatedAt: globalLastUpdatedAt, totalCount };
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

    const rows = await this.queryRows<ClickHouseSimulationRunRow>(
      `SELECT ${RUN_COLUMNS}
       FROM (
         SELECT ${DEDUP_RUN_COLUMNS}
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
           AND BatchRunId = {batchRunId:String}
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE ArchivedAt IS NULL
       ORDER BY CreatedAt ASC`,
      { tenantId: projectId, scenarioSetIds: expandSetIdFilter(scenarioSetId), batchRunId },
    );

    const now = Date.now();
    const runs = rows.map((row) => mapClickHouseRowToScenarioRunData(row, now));
    const lastUpdatedAt = runs.reduce(
      (max, r) => Math.max(max, r.timestamp),
      0,
    );
    return { changed: true, lastUpdatedAt, runs };
  }

  async getBatchRunCountForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<number> {
    const rows = await this.queryRows<{ BatchRunCount: string }>(
      `SELECT toString(count(DISTINCT BatchRunId)) AS BatchRunCount
       FROM (
         SELECT ${DEDUP_COLUMNS}
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE ArchivedAt IS NULL`,
      { tenantId: projectId, scenarioSetIds: expandSetIdFilter(scenarioSetId) },
    );
    return parseInt(rows[0]?.BatchRunCount ?? "0", 10);
  }

  async getScenarioRunDataByScenarioId({
    projectId,
    scenarioId,
  }: {
    projectId: string;
    scenarioId: string;
  }): Promise<ScenarioRunData[] | null> {
    const rows = await this.queryRows<ClickHouseSimulationRunRow>(
      `SELECT ${RUN_COLUMNS}
       FROM (
         SELECT ${DEDUP_RUN_COLUMNS}
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioId = {scenarioId:String}
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE ArchivedAt IS NULL
       ORDER BY CreatedAt DESC
       LIMIT 1000`,
      { tenantId: projectId, scenarioId },
    );

    if (rows.length === 0) return null;

    const now = Date.now();
    return rows.map((row) => mapClickHouseRowToScenarioRunData(row, now));
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
       FROM (
         SELECT ${DEDUP_RUN_COLUMNS}
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE ArchivedAt IS NULL
       ORDER BY BatchRunId ASC, CreatedAt ASC
       LIMIT 10000`,
      { tenantId: projectId, scenarioSetIds: expandSetIdFilter(scenarioSetId) },
    );

    const now = Date.now();
    return rows.map((row) => mapClickHouseRowToScenarioRunData(row, now));
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
  }): Promise<{ runs: ScenarioRunData[]; nextCursor?: string; hasMore: boolean }> {
    const validatedLimit = Math.min(Math.max(1, limit), 100);
    const decoded = cursor ? this.decodeCursor(cursor) : null;

    const cursorPredicate = decoded
      ? `(
          (toString(toUnixTimestamp64Milli(max(CreatedAt))) < {cursorTs:String})
          OR (toString(toUnixTimestamp64Milli(max(CreatedAt))) = {cursorTs:String} AND BatchRunId > {cursorBatchRunId:String})
        )`
      : "1 = 1";

    const dateFilter = buildDateHavingFilter({ startDate, endDate });
    const combinedHaving = `HAVING ${[cursorPredicate, dateFilter.clause].filter(Boolean).join(" AND ")}`;

    const batchRows = await this.queryRows<{
      BatchRunId: string;
      MaxCreatedAt: string;
    }>(
      `SELECT
        BatchRunId,
        toString(toUnixTimestamp64Milli(max(CreatedAt))) AS MaxCreatedAt
       FROM (
         SELECT ${DEDUP_COLUMNS}
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE ArchivedAt IS NULL
       GROUP BY BatchRunId
       ${combinedHaving}
       ORDER BY MaxCreatedAt DESC, BatchRunId ASC
       LIMIT {fetchLimit:UInt32}`,
      {
        tenantId: projectId,
        scenarioSetIds: expandSetIdFilter(scenarioSetId),
        ...(decoded ? { cursorTs: decoded.ts, cursorBatchRunId: decoded.batchRunId } : {}),
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

    const nextCursor = lastRow && hasMore
      ? this.encodeCursor(lastRow.MaxCreatedAt, lastRow.BatchRunId)
      : undefined;

    const batchRunIds = pageRows.map((r) => r.BatchRunId);
    const runs = await this.getRunsForBatchIds({ projectId, batchRunIds, scenarioSetId });

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

    const dateFilter = buildDateHavingFilter({ startDate, endDate });
    const combinedHaving = `HAVING ${[cursorPredicate, dateFilter.clause].filter(Boolean).join(" AND ")}`;

    const batchRows = await this.queryRows<{
      BatchRunId: string;
      MaxCreatedAt: string;
      ScenarioSetId: string;
    }>(
      `SELECT
        BatchRunId,
        toString(toUnixTimestamp64Milli(max(CreatedAt))) AS MaxCreatedAt,
        any(ScenarioSetId) AS ScenarioSetId
       FROM (
         SELECT ${DEDUP_COLUMNS}
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE ArchivedAt IS NULL
       GROUP BY BatchRunId
       ${combinedHaving}
       ORDER BY MaxCreatedAt DESC, BatchRunId ASC
       LIMIT {fetchLimit:UInt32}`,
      {
        tenantId: projectId,
        ...(decoded ? { cursorTs: decoded.ts, cursorBatchRunId: decoded.batchRunId } : {}),
        ...dateFilter.params,
        fetchLimit: String(validatedLimit + 1),
      },
    );

    const hasMore = batchRows.length > validatedLimit;
    const pageRows = hasMore ? batchRows.slice(0, validatedLimit) : batchRows;

    if (pageRows.length === 0) {
      return { changed: true, lastUpdatedAt: 0, runs: [], scenarioSetIds: {}, nextCursor: undefined, hasMore: false };
    }

    const lastRow = pageRows[pageRows.length - 1]!;
    const nextCursor = hasMore
      ? this.encodeCursor(lastRow.MaxCreatedAt, lastRow.BatchRunId)
      : undefined;

    const scenarioSetIds: Record<string, string> = {};
    for (const row of pageRows) {
      scenarioSetIds[row.BatchRunId] = row.ScenarioSetId;
    }

    const batchRunIds = pageRows.map((r) => r.BatchRunId);
    const runs = await this.getRunsForBatchIds({ projectId, batchRunIds });
    const lastUpdatedAt = runs.reduce(
      (max, r) => Math.max(max, r.timestamp),
      0,
    );

    return { changed: true, lastUpdatedAt, runs, scenarioSetIds, nextCursor, hasMore };
  }

  async getExternalSetSummaries({
    projectId,
    startDate,
    endDate,
  }: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<ExternalSetSummary[]> {
    const dateFilter = buildDateHavingFilter({ startDate, endDate });
    const havingClause = dateFilter.clause ? `HAVING ${dateFilter.clause}` : "";

    const rows = await this.queryRows<{
      ScenarioSetId: string;
      TotalCount: string;
      PassCount: string;
      FailCount: string;
      LastRunAt: string;
    }>(
      `SELECT
        NormalizedSetId AS ScenarioSetId,
        toString(argMax(RunCount, MaxCreatedAtMs)) AS TotalCount,
        toString(argMax(PassCount, MaxCreatedAtMs)) AS PassCount,
        toString(argMax(FailCount, MaxCreatedAtMs)) AS FailCount,
        toString(max(MaxCreatedAtMs)) AS LastRunAt
       FROM (
         SELECT
           NormalizedSetId,
           BatchRunId,
           count() AS RunCount,
           countIf(Status = 'SUCCESS') AS PassCount,
           countIf(Status IN ('FAILED','FAILURE','ERROR')) AS FailCount,
           toUnixTimestamp64Milli(max(CreatedAt)) AS MaxCreatedAtMs
         FROM (
           SELECT
             -- 'default' must match DEFAULT_SET_ID from internal-set-id.ts
           IF(ScenarioSetId = '', 'default', ScenarioSetId) AS NormalizedSetId,
             BatchRunId,
             Status,
             CreatedAt,
             ArchivedAt
           FROM (
             SELECT ${DEDUP_COLUMNS}
             FROM ${TABLE_NAME}
             WHERE TenantId = {tenantId:String}
               AND NOT startsWith(ScenarioSetId, '__internal__')
             ORDER BY ScenarioRunId, UpdatedAt DESC
             LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
           )
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

  async getAllRunIdsForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<string[]> {
    const client = await this.getClient(projectId);
    const result = await client.query({
      query: `SELECT DISTINCT ScenarioRunId FROM ${TABLE_NAME} WHERE TenantId = {tenantId:String} AND ArchivedAt IS NULL LIMIT 10000`,
      query_params: { tenantId: projectId },
      format: "JSONEachRow",
    });
    const rows = await result.json<{ ScenarioRunId: string }>();
    return rows.map((r) => r.ScenarioRunId);
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

    const rows = await this.queryRows<{ ScenarioSetId: string }>(
      `SELECT DISTINCT ScenarioSetId
       FROM (
         SELECT ScenarioSetId, ArchivedAt
         FROM ${TABLE_NAME}
         WHERE TenantId IN ({projectIds:Array(String)})
           AND NOT startsWith(ScenarioSetId, '${INTERNAL_SET_PREFIX}')
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE ArchivedAt IS NULL`,
      { tenantId: firstProjectId, projectIds },
    );

    return new Set(rows.map((r) => r.ScenarioSetId));
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
      if (typeof parsed.ts !== "string" || typeof parsed.batchRunId !== "string") {
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
      ? "AND ScenarioSetId IN ({scenarioSetIds:Array(String)})"
      : "";

    const rows = await this.queryRows<ClickHouseSimulationRunRow>(
      `SELECT ${LIST_COLUMNS}
       FROM (
         SELECT ${DEDUP_LIST_COLUMNS}
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND BatchRunId IN ({batchRunIds:Array(String)})
           ${setFilter}
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE ArchivedAt IS NULL
       ORDER BY CreatedAt ASC
       LIMIT 5000`,
      { tenantId: projectId, batchRunIds, ...(scenarioSetId ? { scenarioSetIds: expandSetIdFilter(scenarioSetId) } : {}) },
    );

    const now = Date.now();
    return rows.map((row) => mapClickHouseRowToScenarioRunData(row, now));
  }
}
