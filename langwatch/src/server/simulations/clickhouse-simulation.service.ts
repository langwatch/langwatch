import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "~/utils/logger/server";
import type {
  BatchHistoryItem,
  ScenarioRunData,
  ScenarioSetData,
} from "../scenarios/scenario-event.types";
import { resolveRunStatus } from "../scenarios/stall-detection";
import {
  mapClickHouseRowToScenarioRunData,
  mapStatus,
  type ClickHouseSimulationRunRow,
} from "./simulation-run.mappers";

const logger = createLogger("langwatch:simulations:clickhouse-service");

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
  Status, Name, Description,
  \`Messages.Id\`, \`Messages.Role\`, \`Messages.Content\`,
  \`Messages.TraceId\`, \`Messages.Rest\`,
  TraceIds,
  Verdict, Reasoning, MetCriteria, UnmetCriteria, Error,
  toString(DurationMs) AS DurationMs,
  toString(toUnixTimestamp64Milli(CreatedAt)) AS CreatedAt,
  toString(toUnixTimestamp64Milli(UpdatedAt)) AS UpdatedAt,
  toString(toUnixTimestamp64Milli(FinishedAt)) AS FinishedAt,
  toString(toUnixTimestamp64Milli(DeletedAt)) AS DeletedAt` as const;

/** Columns for a slim batch-history preview — no full message arrays. */
const PREVIEW_COLUMNS = `
  ScenarioRunId, BatchRunId, Name, Description, Status,
  toString(DurationMs) AS DurationMs,
  arraySlice(\`Messages.Role\`, 1, 4) AS MessagePreviewRoles,
  arraySlice(\`Messages.Content\`, 1, 4) AS MessagePreviewContents` as const;

interface CursorPayload {
  ts: string;
  batchRunId: string;
}

/**
 * ClickHouse-backed read service for simulation runs.
 *
 * Queries the `simulation_runs` ReplacingMergeTree table
 * to collapse versions. Returns data in the same ScenarioRunData shape
 * that the ES-backed ScenarioEventService produces, so callers can
 * switch backends transparently.
 */
export class ClickHouseSimulationService {
  constructor(private readonly clickhouse: ClickHouseClient) {}

  static create(
    clickhouse: ClickHouseClient | null,
  ): ClickHouseSimulationService | null {
    if (!clickhouse) return null;
    return new ClickHouseSimulationService(clickhouse);
  }

  private async queryRows<T>(
    query: string,
    params: Record<string, string | string[]>,
  ): Promise<T[]> {
    const result = await this.clickhouse.query({
      query,
      query_params: params,
      format: "JSONEachRow",
    });
    return result.json<T>();
  }

  /**
   * Returns scenario set metadata for a project.
   */
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
        ScenarioSetId,
        toString(count(*)) AS ScenarioCount,
        toString(toUnixTimestamp64Milli(max(UpdatedAt))) AS LastRunAt
       FROM (
         SELECT *
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE DeletedAt IS NULL
       GROUP BY ScenarioSetId
       ORDER BY LastRunAt DESC`,
      { tenantId: projectId },
    );

    return rows.map((row) => ({
      scenarioSetId: row.ScenarioSetId,
      scenarioCount: parseInt(row.ScenarioCount, 10),
      lastRunAt: Number(row.LastRunAt),
    }));
  }

  /**
   * Returns run data for a specific scenario run.
   */
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
         SELECT *
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String} AND ScenarioRunId = {scenarioRunId:String}
         ORDER BY UpdatedAt DESC
         LIMIT 1
       )
       WHERE DeletedAt IS NULL
       LIMIT 1`,
      { tenantId: projectId, scenarioRunId },
    );

    const row = rows[0];
    if (!row) return null;
    return mapClickHouseRowToScenarioRunData(row);
  }

  /**
   * Returns pre-aggregated batch history for the sidebar.
   * No full message arrays — only messagePreview (first 4 messages, role+content).
   */
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
         SELECT *
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId = {scenarioSetId:String}
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE DeletedAt IS NULL`,
      { tenantId: projectId, scenarioSetId },
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
         SELECT *
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId = {scenarioSetId:String}
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE DeletedAt IS NULL
       GROUP BY BatchRunId
       ${cursorClause}
       ORDER BY LastRunAt DESC, BatchRunId ASC
       LIMIT {fetchLimit:UInt32}`,
      {
        tenantId: projectId,
        scenarioSetId,
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
    // Filter by ScenarioSetId to avoid cross-set contamination when a BatchRunId
    // spans multiple scenario sets.
    const itemRows = await this.queryRows<{
      ScenarioRunId: string;
      BatchRunId: string;
      Name: string | null;
      Description: string | null;
      Status: string;
      DurationMs: string | null;
      MessagePreviewRoles: string[];
      MessagePreviewContents: string[];
    }>(
      `SELECT ${PREVIEW_COLUMNS}
       FROM (
         SELECT *
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId = {scenarioSetId:String}
           AND BatchRunId IN ({batchRunIds:Array(String)})
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE DeletedAt IS NULL
       ORDER BY CreatedAt ASC`,
      { tenantId: projectId, scenarioSetId, batchRunIds },
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
        // stall detection uses UpdatedAt — not available in preview rows, approximate with now
        const resolvedStatus = resolveRunStatus({
          finishedStatus: ["SUCCESS","FAILED","FAILURE","ERROR","CANCELLED"].includes(r.Status)
            ? baseStatus
            : undefined,
          lastEventTimestamp: lastUpdatedAt,
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

      // Recompute stalledCount from resolved statuses
      const stalledCount = items.filter((i) => i.status === "STALLED").length;
      const runningCount = Number(b.RunningCount) - stalledCount; // adjust for items that became stalled

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

  /**
   * Returns all run data for a specific batch run.
   * Accepts an optional sinceTimestamp for conditional fetching:
   * returns { changed: false } when nothing has been updated since that timestamp.
   */
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
    // Conditional check: skip full fetch if nothing changed
    if (sinceTimestamp !== undefined) {
      const tsRows = await this.queryRows<{ LastUpdatedAt: string }>(
        `SELECT toString(toUnixTimestamp64Milli(max(UpdatedAt))) AS LastUpdatedAt
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND BatchRunId = {batchRunId:String}
           AND DeletedAt IS NULL`,
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
         SELECT *
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId = {scenarioSetId:String}
           AND BatchRunId = {batchRunId:String}
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE DeletedAt IS NULL
       ORDER BY CreatedAt ASC`,
      { tenantId: projectId, scenarioSetId, batchRunId },
    );

    const now = Date.now();
    const runs = rows.map((row) => mapClickHouseRowToScenarioRunData(row, now));
    const lastUpdatedAt = runs.reduce(
      (max, r) => Math.max(max, r.timestamp),
      0,
    );
    return { changed: true, lastUpdatedAt, runs };
  }

  /**
   * Returns the number of distinct batch runs for a scenario set.
   */
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
         SELECT *
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId = {scenarioSetId:String}
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE DeletedAt IS NULL`,
      { tenantId: projectId, scenarioSetId },
    );
    return parseInt(rows[0]?.BatchRunCount ?? "0", 10);
  }

  /**
   * Returns all run data for a specific scenario (by ScenarioId).
   * Returns null when no rows found (matches ES semantics).
   */
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
         SELECT *
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioId = {scenarioId:String}
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE DeletedAt IS NULL
       ORDER BY CreatedAt DESC`,
      { tenantId: projectId, scenarioId },
    );

    if (rows.length === 0) return null;

    const now = Date.now();
    return rows.map((row) => mapClickHouseRowToScenarioRunData(row, now));
  }

  /**
   * Returns all run data for a scenario set (unpaginated).
   */
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
         SELECT *
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId = {scenarioSetId:String}
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE DeletedAt IS NULL
       ORDER BY BatchRunId ASC, CreatedAt ASC`,
      { tenantId: projectId, scenarioSetId },
    );

    const now = Date.now();
    return rows.map((row) => mapClickHouseRowToScenarioRunData(row, now));
  }

  /**
   * Returns paginated run data for a scenario set, grouped by batch run.
   * Uses keyset cursor pagination on (max(CreatedAt) DESC, BatchRunId ASC).
   */
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
         SELECT *
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId = {scenarioSetId:String}
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE DeletedAt IS NULL
       GROUP BY BatchRunId
       ${combinedHaving}
       ORDER BY MaxCreatedAt DESC, BatchRunId ASC
       LIMIT {fetchLimit:UInt32}`,
      {
        tenantId: projectId,
        scenarioSetId,
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

    const lastRow = pageRows[pageRows.length - 1]!;
    const nextCursor = hasMore
      ? this.encodeCursor(lastRow.MaxCreatedAt, lastRow.BatchRunId)
      : undefined;

    const batchRunIds = pageRows.map((r) => r.BatchRunId);
    const runs = await this.getRunsForBatchIds({ projectId, batchRunIds });

    return { runs, nextCursor, hasMore };
  }

  /**
   * Returns paginated run data across all internal suites.
   * Filters to scenario set IDs matching the `__internal__*__suite` pattern.
   */
  async getRunDataForAllSuites({
    projectId,
    limit = 20,
    cursor,
    startDate,
    endDate,
  }: {
    projectId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<{
    runs: ScenarioRunData[];
    scenarioSetIds: Record<string, string>;
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
         SELECT *
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND ScenarioSetId LIKE '__internal__%__suite'
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE DeletedAt IS NULL
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
      return { runs: [], scenarioSetIds: {}, nextCursor: undefined, hasMore: false };
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

    return { runs, scenarioSetIds, nextCursor, hasMore };
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
  }: {
    projectId: string;
    batchRunIds: string[];
  }): Promise<ScenarioRunData[]> {
    if (batchRunIds.length === 0) return [];

    const rows = await this.queryRows<ClickHouseSimulationRunRow>(
      `SELECT ${RUN_COLUMNS}
       FROM (
         SELECT *
         FROM ${TABLE_NAME}
         WHERE TenantId = {tenantId:String}
           AND BatchRunId IN ({batchRunIds:Array(String)})
         ORDER BY ScenarioRunId, UpdatedAt DESC
         LIMIT 1 BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
       )
       WHERE DeletedAt IS NULL
       ORDER BY CreatedAt ASC`,
      { tenantId: projectId, batchRunIds },
    );

    const now = Date.now();
    return rows.map((row) => mapClickHouseRowToScenarioRunData(row, now));
  }

  /**
   * Soft-deletes all simulation runs for a project by setting DeletedAt.
   */
  async softDeleteAllForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<void> {
    await this.clickhouse.command({
      query: `ALTER TABLE ${TABLE_NAME} UPDATE DeletedAt = now64(3) WHERE TenantId = {tenantId:String} AND DeletedAt IS NULL`,
      query_params: { tenantId: projectId },
    });
    logger.info({ projectId }, "Soft-deleted all simulation runs for project");
  }
}
