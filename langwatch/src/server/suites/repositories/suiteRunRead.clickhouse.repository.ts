import type { ClickHouseClient } from "@clickhouse/client";
import type { SuiteRunStateRow, SuiteRunItemRow } from "../suite-run.service";
import type { SuiteRunReadRepository } from "./suiteRunRead.repository";

const SUITE_RUNS_TABLE = "suite_runs" as const;
const SUITE_RUN_ITEMS_TABLE = "suite_run_items" as const;

const STATE_COLUMNS = `
  SuiteId, BatchRunId, SetId,
  Total, Progress,
  CompletedCount, FailedCount, ErroredCount, CancelledCount,
  PassRateBps, Status, ScenarioIds, Targets, RepeatCount, IdempotencyKey,
  toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
  toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt,
  toUnixTimestamp64Milli(StartedAt) AS StartedAt,
  toUnixTimestamp64Milli(FinishedAt) AS FinishedAt
`;

function mapStateRow(row: Record<string, unknown>): SuiteRunStateRow {
  let scenarioIds: string[] = [];
  try {
    scenarioIds = JSON.parse(String(row.ScenarioIds || "[]")) as string[];
  } catch { /* empty */ }

  let targets: Array<{ id: string; type: string }> = [];
  try {
    targets = JSON.parse(String(row.Targets || "[]")) as Array<{ id: string; type: string }>;
  } catch { /* empty */ }

  return {
    suiteId: String(row.SuiteId),
    batchRunId: String(row.BatchRunId),
    setId: String(row.SetId),
    total: Number(row.Total),
    progress: Number(row.Progress),
    completedCount: Number(row.CompletedCount),
    failedCount: Number(row.FailedCount),
    erroredCount: Number(row.ErroredCount),
    cancelledCount: Number(row.CancelledCount),
    passRateBps: row.PassRateBps === null ? null : Number(row.PassRateBps),
    status: String(row.Status),
    scenarioIds,
    targets,
    repeatCount: Number(row.RepeatCount),
    idempotencyKey: String(row.IdempotencyKey ?? ""),
    createdAt: Number(row.CreatedAt),
    updatedAt: Number(row.UpdatedAt),
    startedAt: row.StartedAt === null ? null : Number(row.StartedAt),
    finishedAt: row.FinishedAt === null ? null : Number(row.FinishedAt),
  };
}

function mapItemRow(row: Record<string, unknown>): SuiteRunItemRow {
  return {
    scenarioRunId: String(row.ScenarioRunId),
    scenarioId: String(row.ScenarioId),
    targetReferenceId: String(row.TargetReferenceId),
    targetType: String(row.TargetType),
    status: String(row.Status),
    verdict: row.Verdict === null ? null : String(row.Verdict),
    durationMs: row.DurationMs === null ? null : Number(row.DurationMs),
    startedAt: row.StartedAt === null ? null : Number(row.StartedAt),
    finishedAt: row.FinishedAt === null ? null : Number(row.FinishedAt),
    updatedAt: Number(row.UpdatedAt),
  };
}

export class SuiteRunReadRepositoryClickHouse implements SuiteRunReadRepository {
  constructor(private readonly clickhouse: ClickHouseClient) {}

  async getRunState(params: {
    suiteId: string;
    batchRunId: string;
    tenantId: string;
  }): Promise<SuiteRunStateRow | null> {
    const result = await this.clickhouse.query({
      query: `
        SELECT ${STATE_COLUMNS}
        FROM ${SUITE_RUNS_TABLE}
        WHERE TenantId = {tenantId:String}
          AND SuiteId = {suiteId:String}
          AND BatchRunId = {batchRunId:String}
        ORDER BY UpdatedAt DESC
        LIMIT 1
      `,
      query_params: params,
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    const row = rows[0];
    if (!row) return null;

    return mapStateRow(row);
  }

  async getRunHistory(params: {
    suiteId: string;
    tenantId: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ runs: SuiteRunStateRow[]; nextCursor: string | null }> {
    const limit = params.limit ?? 20;

    let cursorFilter = "";
    if (params.cursor) {
      cursorFilter = `AND UpdatedAt < toDateTime64({cursor:UInt64} / 1000, 3)`;
    }

    const result = await this.clickhouse.query({
      query: `
        SELECT ${STATE_COLUMNS}
        FROM ${SUITE_RUNS_TABLE}
        WHERE TenantId = {tenantId:String}
          AND SuiteId = {suiteId:String}
          ${cursorFilter}
        ORDER BY UpdatedAt DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: params.tenantId,
        suiteId: params.suiteId,
        limit: limit + 1,
        ...(params.cursor ? { cursor: params.cursor } : {}),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);

    const runs = items.map(mapStateRow);
    const nextCursor = hasMore && runs.length > 0
      ? String(runs[runs.length - 1]!.updatedAt)
      : null;

    return { runs, nextCursor };
  }

  async getAllRunHistory(params: {
    tenantId: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ runs: SuiteRunStateRow[]; nextCursor: string | null }> {
    const limit = params.limit ?? 20;

    let cursorFilter = "";
    if (params.cursor) {
      cursorFilter = `AND UpdatedAt < toDateTime64({cursor:UInt64} / 1000, 3)`;
    }

    const result = await this.clickhouse.query({
      query: `
        SELECT ${STATE_COLUMNS}
        FROM ${SUITE_RUNS_TABLE}
        WHERE TenantId = {tenantId:String}
          ${cursorFilter}
        ORDER BY UpdatedAt DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: params.tenantId,
        limit: limit + 1,
        ...(params.cursor ? { cursor: params.cursor } : {}),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);

    const runs = items.map(mapStateRow);
    const nextCursor = hasMore && runs.length > 0
      ? String(runs[runs.length - 1]!.updatedAt)
      : null;

    return { runs, nextCursor };
  }

  async getRunItems(params: {
    suiteId: string;
    batchRunId: string;
    tenantId: string;
  }): Promise<SuiteRunItemRow[]> {
    const result = await this.clickhouse.query({
      query: `
        SELECT
          ScenarioRunId, ScenarioId,
          TargetReferenceId, TargetType,
          Status, Verdict, DurationMs,
          toUnixTimestamp64Milli(StartedAt) AS StartedAt,
          toUnixTimestamp64Milli(FinishedAt) AS FinishedAt,
          toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt
        FROM ${SUITE_RUN_ITEMS_TABLE}
        WHERE TenantId = {tenantId:String}
          AND SuiteId = {suiteId:String}
          AND BatchRunId = {batchRunId:String}
        ORDER BY UpdatedAt ASC
      `,
      query_params: params,
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    return rows.map(mapItemRow);
  }

  async getRunByIdempotencyKey(params: {
    tenantId: string;
    idempotencyKey: string;
  }): Promise<SuiteRunStateRow | null> {
    const result = await this.clickhouse.query({
      query: `
        SELECT ${STATE_COLUMNS}
        FROM ${SUITE_RUNS_TABLE}
        WHERE TenantId = {tenantId:String}
          AND IdempotencyKey = {idempotencyKey:String}
        ORDER BY UpdatedAt DESC
        LIMIT 1
      `,
      query_params: params,
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    const row = rows[0];
    if (!row) return null;

    return mapStateRow(row);
  }
}
