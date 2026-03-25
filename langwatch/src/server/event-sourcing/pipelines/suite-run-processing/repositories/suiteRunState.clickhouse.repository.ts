import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { DEFAULT_CLICKHOUSE_SETTINGS } from "~/server/clickhouse/queryDefaults";
import type { WithDateWrites } from "~/server/clickhouse/types";
import {
  ErrorCategory,
  SecurityError,
  StoreError,
  ValidationError,
} from "~/server/event-sourcing/services/errorHandling";
import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../";
import { createTenantId, EventUtils } from "../../../";
import { createLogger } from "../../../../../utils/logger";
import type {
  SuiteRunState,
  SuiteRunStateData,
} from "../projections/suiteRunState.foldProjection";
import type { SuiteRunStateRepository } from "./suiteRunState.repository";

const TABLE_NAME = "suite_runs" as const;

const logger = createLogger(
  "langwatch:suite-run-processing:run-state-repository",
);

interface ClickHouseSuiteRunRecord {
  ProjectionId: string;
  TenantId: string;
  SuiteRunId: string;
  BatchRunId: string;
  ScenarioSetId: string;
  SuiteId: string;
  Version: string;
  Status: string;
  Total: number;
  StartedCount: number;
  CompletedCount: number;
  FailedCount: number;
  Progress: number;
  PassRateBps: number | null;
  PassedCount: number;
  GradedCount: number;
  CreatedAt: number;
  UpdatedAt: number;
  StartedAt: number | null;
  FinishedAt: number | null;
}

type ClickHouseSuiteRunWriteRecord = WithDateWrites<
  ClickHouseSuiteRunRecord,
  "CreatedAt" | "UpdatedAt" | "StartedAt" | "FinishedAt"
>;

export class SuiteRunStateRepositoryClickHouse<
  ProjectionType extends Projection = Projection,
> implements SuiteRunStateRepository<ProjectionType>
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  private mapClickHouseRecordToProjectionData(
    record: ClickHouseSuiteRunRecord,
  ): SuiteRunStateData {
    return {
      SuiteRunId: record.SuiteRunId,
      BatchRunId: record.BatchRunId,
      ScenarioSetId: record.ScenarioSetId,
      SuiteId: record.SuiteId,
      Status: record.Status,
      Total: record.Total,
      StartedCount: record.StartedCount,
      CompletedCount: record.CompletedCount,
      FailedCount: record.FailedCount,
      Progress: record.Progress,
      PassRateBps: record.PassRateBps,
      PassedCount: record.PassedCount ?? 0,
      GradedCount: record.GradedCount ?? 0,
      CreatedAt: Number(record.CreatedAt),
      UpdatedAt: Number(record.UpdatedAt),
      StartedAt: record.StartedAt === null ? null : Number(record.StartedAt),
      FinishedAt: record.FinishedAt === null ? null : Number(record.FinishedAt),
    };
  }

  private mapProjectionDataToClickHouseRecord(
    data: SuiteRunStateData,
    tenantId: string,
    projectionId: string,
    projectionVersion: string,
  ): ClickHouseSuiteRunWriteRecord {
    return {
      ProjectionId: projectionId,
      TenantId: tenantId,
      SuiteRunId: data.SuiteRunId || projectionId,
      BatchRunId: data.BatchRunId,
      ScenarioSetId: data.ScenarioSetId,
      SuiteId: data.SuiteId,
      Version: projectionVersion,
      Status: data.Status,
      Total: data.Total,
      StartedCount: data.StartedCount,
      CompletedCount: data.CompletedCount,
      FailedCount: data.FailedCount,
      Progress: data.Progress,
      PassRateBps: data.PassRateBps,
      PassedCount: data.PassedCount,
      GradedCount: data.GradedCount,
      CreatedAt: new Date(data.CreatedAt),
      UpdatedAt: new Date(data.UpdatedAt),
      StartedAt: new Date(data.StartedAt ?? data.CreatedAt),
      FinishedAt: data.FinishedAt != null ? new Date(data.FinishedAt) : null,
    };
  }

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null> {
    EventUtils.validateTenantId(
      context,
      "SuiteRunStateRepositoryClickHouse.getProjection",
    );

    const batchRunId = String(aggregateId);

    try {
      const client = await this.resolveClient(context.tenantId);
      const result = await client.query({
        query: `
          SELECT
            ProjectionId, TenantId, SuiteRunId, BatchRunId, ScenarioSetId, SuiteId,
            Version, Status, Total, StartedCount, CompletedCount, FailedCount, Progress,
            PassRateBps, PassedCount, GradedCount,
            toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(FinishedAt) AS FinishedAt
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND BatchRunId = {batchRunId:String}
          ORDER BY UpdatedAt DESC
          LIMIT 1
        `,
        query_params: { tenantId: context.tenantId, batchRunId },
        format: "JSONEachRow",
        clickhouse_settings: DEFAULT_CLICKHOUSE_SETTINGS,
      });

      const rows = await result.json<ClickHouseSuiteRunRecord>();
      const row = rows[0];
      if (!row) return null;

      const projection: SuiteRunState = {
        id: row.ProjectionId,
        aggregateId: batchRunId,
        tenantId: createTenantId(context.tenantId),
        version: row.Version,
        data: this.mapClickHouseRecordToProjectionData(row),
      };

      return projection as ProjectionType;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error({ batchRunId, tenantId: context.tenantId, error: errorMessage },
        "Failed to get projection from ClickHouse");
      throw new StoreError(
        "getProjection",
        "SuiteRunStateRepositoryClickHouse",
        `Failed to get projection for batch run ${batchRunId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        { batchRunId },
        error,
      );
    }
  }

  async storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    EventUtils.validateTenantId(
      context,
      "SuiteRunStateRepositoryClickHouse.storeProjection",
    );

    if (!EventUtils.isValidProjection(projection)) {
      throw new ValidationError(
        "Invalid projection: projection must have id, aggregateId, tenantId, version, and data",
        "projection",
        projection,
      );
    }

    if (projection.tenantId !== context.tenantId) {
      throw new SecurityError(
        "storeProjection",
        `Projection has tenantId '${projection.tenantId}' that does not match context tenantId '${context.tenantId}'`,
        projection.tenantId,
        { contextTenantId: context.tenantId },
      );
    }

    try {
      const client = await this.resolveClient(context.tenantId);
      const projectionRecord = this.mapProjectionDataToClickHouseRecord(
        projection.data as SuiteRunStateData,
        String(context.tenantId),
        projection.id,
        projection.version,
      );

      await client.insert({
        table: TABLE_NAME,
        values: [projectionRecord],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });

    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error({
        tenantId: context.tenantId,
        batchRunId: String(projection.aggregateId),
        projectionId: projection.id,
        error: errorMessage,
      }, "Failed to store projection in ClickHouse");
      throw new StoreError(
        "storeProjection",
        "SuiteRunStateRepositoryClickHouse",
        `Failed to store projection ${projection.id} for batch run ${projection.aggregateId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        { projectionId: projection.id, batchRunId: String(projection.aggregateId) },
        error,
      );
    }
  }
}
