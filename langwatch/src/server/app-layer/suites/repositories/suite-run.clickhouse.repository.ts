import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { SuiteRunStateData } from "~/server/event-sourcing/pipelines/suite-run-processing/projections/suiteRunState.foldProjection";
import { expandSetIdFilter } from "~/server/scenarios/internal-set-id";
import type { SuiteRunReadRepository } from "./suite-run.repository";

export class SuiteRunClickHouseRepository implements SuiteRunReadRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  private async getClient(tenantId: string): Promise<ClickHouseClient> {
    return this.resolveClient(tenantId);
  }

  async getSuiteRunState(params: {
    projectId: string;
    batchRunId: string;
  }): Promise<SuiteRunStateData | null> {
    const client = await this.getClient(params.projectId);
    const result = await client.query({
      query: `
        SELECT
          SuiteRunId, BatchRunId, ScenarioSetId, SuiteId,
          Status, Total, StartedCount, CompletedCount, FailedCount,
          Progress, PassRateBps, PassedCount, GradedCount,
          toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
          toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt,
          toUnixTimestamp64Milli(StartedAt) AS StartedAt,
          toUnixTimestamp64Milli(FinishedAt) AS FinishedAt
        FROM suite_runs
        WHERE TenantId = {projectId:String}
          AND BatchRunId = {batchRunId:String}
        ORDER BY UpdatedAt DESC
        LIMIT 1
      `,
      query_params: { projectId: params.projectId, batchRunId: params.batchRunId },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    const row = rows[0];
    if (!row) return null;

    return this.mapRowToState(row);
  }

  async getBatchHistory(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
  }): Promise<SuiteRunStateData[]> {
    const limit = Math.min(params.limit ?? 50, 100);
    const client = await this.getClient(params.projectId);
    const result = await client.query({
      query: `
        SELECT
          SuiteRunId, BatchRunId, ScenarioSetId, SuiteId,
          Status, Total, StartedCount, CompletedCount, FailedCount,
          Progress, PassRateBps, PassedCount, GradedCount,
          toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
          toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt,
          toUnixTimestamp64Milli(StartedAt) AS StartedAt,
          toUnixTimestamp64Milli(FinishedAt) AS FinishedAt
        FROM suite_runs
        WHERE TenantId = {projectId:String}
          AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
        ORDER BY CreatedAt DESC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        projectId: params.projectId,
        scenarioSetIds: expandSetIdFilter(params.scenarioSetId),
        limit,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    return rows.map((row) => this.mapRowToState(row));
  }

  private mapRowToState(row: Record<string, unknown>): SuiteRunStateData {
    return {
      SuiteRunId: String(row.SuiteRunId),
      BatchRunId: String(row.BatchRunId),
      ScenarioSetId: String(row.ScenarioSetId),
      SuiteId: String(row.SuiteId),
      Status: String(row.Status),
      Total: Number(row.Total),
      StartedCount: Number(row.StartedCount),
      CompletedCount: Number(row.CompletedCount),
      FailedCount: Number(row.FailedCount),
      Progress: Number(row.Progress),
      PassRateBps: row.PassRateBps != null ? Number(row.PassRateBps) : null,
      PassedCount: Number(row.PassedCount ?? 0),
      GradedCount: Number(row.GradedCount ?? 0),
      CreatedAt: Number(row.CreatedAt),
      UpdatedAt: Number(row.UpdatedAt),
      StartedAt: row.StartedAt != null ? Number(row.StartedAt) : null,
      FinishedAt: row.FinishedAt != null ? Number(row.FinishedAt) : null,
    };
  }
}
