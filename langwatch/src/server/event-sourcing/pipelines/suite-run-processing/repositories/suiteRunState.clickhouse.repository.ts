import type { ClickHouseClient } from "@clickhouse/client";
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
import { parseSuiteRunKey } from "../utils/compositeKey";

const TABLE_NAME = "suite_runs" as const;

const logger = createLogger(
  "langwatch:suite-run-processing:run-state-repository",
);

interface ClickHouseSuiteRunRecord {
  ProjectionId: string;
  TenantId: string;
  SuiteId: string;
  BatchRunId: string;
  SetId: string;
  Version: string;
  Total: number;
  Progress: number;
  CompletedCount: number;
  FailedCount: number;
  ErroredCount: number;
  CancelledCount: number;
  PassRateBps: number | null;
  Status: string;
  ScenarioIds: string;
  Targets: string;
  RepeatCount: number;
  IdempotencyKey: string;
  CreatedAt: number;
  UpdatedAt: number;
  StartedAt: number | null;
  FinishedAt: number | null;
  LastProcessedEventId: string;
}

type ClickHouseSuiteRunWriteRecord = WithDateWrites<
  ClickHouseSuiteRunRecord,
  "CreatedAt" | "UpdatedAt" | "StartedAt" | "FinishedAt"
>;

export class SuiteRunStateRepositoryClickHouse<
  ProjectionType extends Projection = Projection,
> implements SuiteRunStateRepository<ProjectionType>
{
  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  private mapClickHouseRecordToProjectionData(
    record: ClickHouseSuiteRunRecord,
  ): SuiteRunStateData {
    return {
      SuiteId: record.SuiteId,
      BatchRunId: record.BatchRunId,
      SetId: record.SetId,
      Total: Number(record.Total),
      Progress: Number(record.Progress),
      CompletedCount: Number(record.CompletedCount),
      FailedCount: Number(record.FailedCount),
      ErroredCount: Number(record.ErroredCount),
      CancelledCount: Number(record.CancelledCount),
      PassRateBps: record.PassRateBps === null ? null : Number(record.PassRateBps),
      Status: record.Status,
      ScenarioIds: record.ScenarioIds,
      Targets: record.Targets,
      RepeatCount: Number(record.RepeatCount),
      IdempotencyKey: record.IdempotencyKey ?? "",
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
      SuiteId: data.SuiteId,
      BatchRunId: data.BatchRunId,
      SetId: data.SetId,
      Version: projectionVersion,
      Total: data.Total,
      Progress: data.Progress,
      CompletedCount: data.CompletedCount,
      FailedCount: data.FailedCount,
      ErroredCount: data.ErroredCount,
      CancelledCount: data.CancelledCount,
      PassRateBps: data.PassRateBps,
      Status: data.Status,
      ScenarioIds: data.ScenarioIds,
      Targets: data.Targets,
      RepeatCount: data.RepeatCount,
      IdempotencyKey: data.IdempotencyKey,
      CreatedAt: data.CreatedAt != null ? new Date(data.CreatedAt) : new Date(),
      UpdatedAt: new Date(data.UpdatedAt),
      StartedAt: data.StartedAt != null ? new Date(data.StartedAt) : null,
      FinishedAt: data.FinishedAt != null ? new Date(data.FinishedAt) : null,
      LastProcessedEventId: "",
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

    const { suiteId, batchRunId } = parseSuiteRunKey(String(aggregateId));

    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT
            ProjectionId, TenantId, SuiteId, BatchRunId, SetId,
            Version, Total, Progress,
            CompletedCount, FailedCount, ErroredCount, CancelledCount,
            PassRateBps, Status, ScenarioIds, Targets, RepeatCount, IdempotencyKey,
            toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(FinishedAt) AS FinishedAt,
            LastProcessedEventId
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND SuiteId = {suiteId:String}
            AND BatchRunId = {batchRunId:String}
          ORDER BY UpdatedAt DESC
          LIMIT 1
        `,
        query_params: { tenantId: context.tenantId, suiteId, batchRunId },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseSuiteRunRecord>();
      const row = rows[0];
      if (!row) return null;

      const projection: SuiteRunState = {
        id: row.ProjectionId,
        aggregateId: String(aggregateId),
        tenantId: createTenantId(context.tenantId),
        version: row.Version,
        data: this.mapClickHouseRecordToProjectionData(row),
      };

      return projection as ProjectionType;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error({ suiteId, batchRunId, tenantId: context.tenantId, error: errorMessage },
        "Failed to get projection from ClickHouse");
      throw new StoreError(
        "getProjection",
        "SuiteRunStateRepositoryClickHouse",
        `Failed to get projection for suite run ${suiteId}:${batchRunId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        { suiteId, batchRunId },
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
      const projectionRecord = this.mapProjectionDataToClickHouseRecord(
        projection.data as SuiteRunStateData,
        String(context.tenantId),
        projection.id,
        projection.version,
      );

      await this.clickHouseClient.insert({
        table: TABLE_NAME,
        values: [projectionRecord],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });

      logger.debug({ tenantId: context.tenantId, suiteId: (projection.data as SuiteRunStateData).SuiteId, projectionId: projection.id },
        "Stored suite run state projection to ClickHouse");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error({
        tenantId: context.tenantId,
        aggregateId: String(projection.aggregateId),
        projectionId: projection.id,
        error: errorMessage,
      }, "Failed to store projection in ClickHouse");
      throw new StoreError(
        "storeProjection",
        "SuiteRunStateRepositoryClickHouse",
        `Failed to store projection ${projection.id} for suite run ${projection.aggregateId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        { projectionId: projection.id, aggregateId: String(projection.aggregateId) },
        error,
      );
    }
  }
}
