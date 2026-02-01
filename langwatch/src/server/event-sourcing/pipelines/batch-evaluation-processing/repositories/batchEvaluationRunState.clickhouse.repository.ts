import type { ClickHouseClient } from "@clickhouse/client";
import {
  ErrorCategory,
  SecurityError,
  StoreError,
  ValidationError,
} from "~/server/event-sourcing/library/services/errorHandling";
import { createLogger } from "../../../../../utils/logger";
import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import { createTenantId, EventUtils } from "../../../library";
import type {
  BatchEvaluationRunState,
  BatchEvaluationRunStateData,
} from "../projections/batchEvaluationRunState.projection.handler";
import type { BatchEvaluationRunStateRepository } from "./batchEvaluationRunState.repository";

const TABLE_NAME = "batch_evaluation_runs" as const;

const logger = createLogger(
  "langwatch:batch-evaluation-processing:run-state-repository",
);

/**
 * ClickHouse record matching the batch_evaluation_runs table schema exactly.
 */
interface ClickHouseBatchEvaluationRunRecord {
  Id: string;
  TenantId: string;
  RunId: string;
  ExperimentId: string;
  WorkflowVersionId: string | null;
  Version: string;

  Total: number;
  Progress: number;
  CompletedCount: number;
  FailedCount: number;
  TotalCost: number | null;
  TotalDurationMs: string | null; // UInt64 as string
  AvgScore: number | null;
  PassRate: number | null;
  Targets: string;

  CreatedAt: string; // DateTime64(3) as string
  UpdatedAt: string;
  FinishedAt: string | null;
  StoppedAt: string | null;

  LastProcessedEventId: string;
}

/**
 * Converts a Unix millisecond timestamp to ClickHouse DateTime64(3) format.
 */
function timestampToDateTime64(timestampMs: number | null): string | null {
  if (timestampMs === null) return null;
  return timestampMs.toString();
}

/**
 * Converts a ClickHouse DateTime64(3) string to Unix millisecond timestamp.
 */
function dateTime64ToTimestamp(dateTime64: string | null): number | null {
  if (dateTime64 === null) return null;
  return parseInt(dateTime64, 10);
}

/**
 * ClickHouse repository for batch evaluation run states.
 */
export class BatchEvaluationRunStateRepositoryClickHouse<
  ProjectionType extends Projection = Projection,
> implements BatchEvaluationRunStateRepository<ProjectionType>
{
  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  private mapClickHouseRecordToProjectionData(
    record: ClickHouseBatchEvaluationRunRecord,
  ): BatchEvaluationRunStateData {
    return {
      RunId: record.RunId,
      ExperimentId: record.ExperimentId,
      WorkflowVersionId: record.WorkflowVersionId,
      Total: record.Total,
      Progress: record.Progress,
      CompletedCount: record.CompletedCount,
      FailedCount: record.FailedCount,
      TotalCost: record.TotalCost,
      TotalDurationMs: record.TotalDurationMs
        ? parseInt(record.TotalDurationMs, 10)
        : null,
      AvgScore: record.AvgScore,
      PassRate: record.PassRate,
      Targets: record.Targets,
      CreatedAt: dateTime64ToTimestamp(record.CreatedAt) ?? 0,
      UpdatedAt: dateTime64ToTimestamp(record.UpdatedAt) ?? 0,
      FinishedAt: dateTime64ToTimestamp(record.FinishedAt),
      StoppedAt: dateTime64ToTimestamp(record.StoppedAt),
    };
  }

  private mapProjectionDataToClickHouseRecord(
    data: BatchEvaluationRunStateData,
    tenantId: string,
    projectionId: string,
    projectionVersion: string,
    lastProcessedEventId: string,
  ): ClickHouseBatchEvaluationRunRecord {
    return {
      Id: projectionId,
      TenantId: tenantId,
      RunId: data.RunId,
      ExperimentId: data.ExperimentId,
      WorkflowVersionId: data.WorkflowVersionId,
      Version: projectionVersion,

      Total: data.Total,
      Progress: data.Progress,
      CompletedCount: data.CompletedCount,
      FailedCount: data.FailedCount,
      TotalCost: data.TotalCost,
      TotalDurationMs: data.TotalDurationMs?.toString() ?? null,
      AvgScore: data.AvgScore,
      PassRate: data.PassRate,
      Targets: data.Targets,

      CreatedAt: timestampToDateTime64(data.CreatedAt) ?? "0",
      UpdatedAt: timestampToDateTime64(data.UpdatedAt) ?? "0",
      FinishedAt: timestampToDateTime64(data.FinishedAt),
      StoppedAt: timestampToDateTime64(data.StoppedAt),

      LastProcessedEventId: lastProcessedEventId,
    };
  }

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null> {
    EventUtils.validateTenantId(
      context,
      "BatchEvaluationRunStateRepositoryClickHouse.getProjection",
    );

    const runId = String(aggregateId);

    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT
            Id,
            TenantId,
            RunId,
            ExperimentId,
            WorkflowVersionId,
            Version,
            Total,
            Progress,
            CompletedCount,
            FailedCount,
            TotalCost,
            toString(TotalDurationMs) AS TotalDurationMs,
            AvgScore,
            PassRate,
            Targets,
            toString(CreatedAt) AS CreatedAt,
            toString(UpdatedAt) AS UpdatedAt,
            toString(FinishedAt) AS FinishedAt,
            toString(StoppedAt) AS StoppedAt,
            LastProcessedEventId
          FROM ${TABLE_NAME} FINAL
          WHERE TenantId = {tenantId:String}
            AND RunId = {runId:String}
          ORDER BY Version DESC
          LIMIT 1
        `,
        query_params: {
          tenantId: context.tenantId,
          runId: runId,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseBatchEvaluationRunRecord>();
      const row = rows[0];
      if (!row) {
        return null;
      }

      const projectionData = this.mapClickHouseRecordToProjectionData(row);

      const projection: BatchEvaluationRunState = {
        id: row.Id,
        aggregateId: runId,
        tenantId: createTenantId(context.tenantId),
        version: row.Version,
        data: projectionData,
      };

      return projection as ProjectionType;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        {
          runId,
          tenantId: context.tenantId,
          error: errorMessage,
        },
        "Failed to get projection from ClickHouse",
      );
      throw new StoreError(
        "getProjection",
        "BatchEvaluationRunStateRepositoryClickHouse",
        `Failed to get projection for run ${runId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        { runId },
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
      "BatchEvaluationRunStateRepositoryClickHouse.storeProjection",
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
      const runId = String(projection.aggregateId);
      const projectionRecord = this.mapProjectionDataToClickHouseRecord(
        projection.data as BatchEvaluationRunStateData,
        String(context.tenantId),
        projection.id,
        projection.version,
        projection.id, // Use projection ID as lastProcessedEventId for now
      );

      await this.clickHouseClient.insert({
        table: TABLE_NAME,
        values: [projectionRecord],
        format: "JSONEachRow",
      });

      logger.debug(
        {
          tenantId: context.tenantId,
          runId,
          projectionId: projection.id,
        },
        "Stored batch evaluation run state projection to ClickHouse",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        {
          tenantId: context.tenantId,
          runId: String(projection.aggregateId),
          projectionId: projection.id,
          error: errorMessage,
        },
        "Failed to store projection in ClickHouse",
      );
      throw new StoreError(
        "storeProjection",
        "BatchEvaluationRunStateRepositoryClickHouse",
        `Failed to store projection ${projection.id} for run ${projection.aggregateId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        {
          projectionId: projection.id,
          runId: String(projection.aggregateId),
        },
        error,
      );
    }
  }
}
