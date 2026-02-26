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
	ExperimentRunState,
	ExperimentRunStateData,
} from "../projections/experimentRunState.foldProjection";
import type { ExperimentRunStateRepository } from "./experimentRunState.repository";

const TABLE_NAME = "experiment_runs" as const;

const logger = createLogger(
  "langwatch:experiment-run-processing:run-state-repository",
);

interface ClickHouseExperimentRunRecord {
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
  TotalDurationMs: string | null;
  AvgScore: number | null;
  PassRate: number | null;
  Targets: string;
  CreatedAt: number;
  UpdatedAt: number;
  StartedAt: number | null;
  FinishedAt: number | null;
  StoppedAt: number | null;
  LastProcessedEventId: string;
  TotalScoreSum: number;
  ScoreCount: number;
  PassedCount: number;
  PassFailCount: number;
}

type ClickHouseExperimentRunWriteRecord = WithDateWrites<
  Omit<ClickHouseExperimentRunRecord, "CreatedAt" | "UpdatedAt">,
  "StartedAt" | "FinishedAt" | "StoppedAt"
>;

export class ExperimentRunStateRepositoryClickHouse<
  ProjectionType extends Projection = Projection,
> implements ExperimentRunStateRepository<ProjectionType>
{
  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  private mapClickHouseRecordToProjectionData(
    record: ClickHouseExperimentRunRecord,
  ): ExperimentRunStateData {
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
      StartedAt: record.StartedAt === null ? null : Number(record.StartedAt),
      FinishedAt: record.FinishedAt === null ? null : Number(record.FinishedAt),
      StoppedAt: record.StoppedAt === null ? null : Number(record.StoppedAt),
      TotalScoreSum: record.TotalScoreSum ?? 0,
      ScoreCount: record.ScoreCount ?? 0,
      PassedCount: record.PassedCount ?? 0,
      PassFailCount: record.PassFailCount ?? 0,
    };
  }

  private mapProjectionDataToClickHouseRecord(
    data: ExperimentRunStateData,
    tenantId: string,
    projectionId: string,
    projectionVersion: string,
    lastProcessedEventId: string,
    runId: string,
  ): ClickHouseExperimentRunWriteRecord {
    return {
      Id: projectionId,
      TenantId: tenantId,
      RunId: runId || data.RunId,
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
      StartedAt: data.StartedAt != null ? new Date(data.StartedAt) : null,
      FinishedAt: data.FinishedAt != null ? new Date(data.FinishedAt) : null,
      StoppedAt: data.StoppedAt != null ? new Date(data.StoppedAt) : null,
      LastProcessedEventId: lastProcessedEventId,
      TotalScoreSum: data.TotalScoreSum,
      ScoreCount: data.ScoreCount,
      PassedCount: data.PassedCount,
      PassFailCount: data.PassFailCount,
    };
  }

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null> {
    EventUtils.validateTenantId(
      context,
      "ExperimentRunStateRepositoryClickHouse.getProjection",
    );

    const runId = String(aggregateId);

    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT
            Id, TenantId, RunId, ExperimentId, WorkflowVersionId, Version,
            Total, Progress, CompletedCount, FailedCount, TotalCost,
            toString(TotalDurationMs) AS TotalDurationMs,
            AvgScore, PassRate, Targets,
            toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(FinishedAt) AS FinishedAt,
            toUnixTimestamp64Milli(StoppedAt) AS StoppedAt,
            LastProcessedEventId,
            TotalScoreSum, ScoreCount, PassedCount, PassFailCount
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String} AND RunId = {runId:String}
          ORDER BY UpdatedAt DESC
          LIMIT 1
        `,
        query_params: { tenantId: context.tenantId, runId },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseExperimentRunRecord>();
      const row = rows[0];
      if (!row) return null;

      const projection: ExperimentRunState = {
        id: row.Id,
        aggregateId: runId,
        tenantId: createTenantId(context.tenantId),
        version: row.Version,
        data: this.mapClickHouseRecordToProjectionData(row),
      };

      return projection as ProjectionType;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error({ runId, tenantId: context.tenantId, error: errorMessage },
        "Failed to get projection from ClickHouse");
      throw new StoreError(
        "getProjection",
        "ExperimentRunStateRepositoryClickHouse",
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
      "ExperimentRunStateRepositoryClickHouse.storeProjection",
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
        projection.data as ExperimentRunStateData,
        String(context.tenantId),
        projection.id,
        projection.version,
        projection.id,
        runId,
      );

      await this.clickHouseClient.insert({
        table: TABLE_NAME,
        values: [projectionRecord],
        format: "JSONEachRow",
      });

      logger.debug({ tenantId: context.tenantId, runId, projectionId: projection.id },
        "Stored experiment run state projection to ClickHouse");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error({
        tenantId: context.tenantId,
        runId: String(projection.aggregateId),
        projectionId: projection.id,
        error: errorMessage,
      }, "Failed to store projection in ClickHouse");
      throw new StoreError(
        "storeProjection",
        "ExperimentRunStateRepositoryClickHouse",
        `Failed to store projection ${projection.id} for run ${projection.aggregateId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        { projectionId: projection.id, runId: String(projection.aggregateId) },
        error,
      );
    }
  }
}
