import type { ClickHouseClient } from "@clickhouse/client";
import {
  ErrorCategory,
  SecurityError,
  StoreError,
  ValidationError,
} from "~/server/event-sourcing/library/services/errorHandling";
import { createLogger } from "../../../../../utils/logger/server";
import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import { createTenantId, EventUtils } from "../../../library";
import type {
  SimulationRunState,
  SimulationRunStateData,
} from "../projections/simulationRunState.foldProjection";
import type { WithDateWrites } from "~/server/clickhouse/types";
import type { SimulationRunStateRepository } from "./simulationRunState.repository";

const TABLE_NAME = "simulation_runs" as const;

const logger = createLogger(
  "langwatch:simulation-processing:simulation-run-state-repository",
);

/**
 * ClickHouse record matching the simulation_runs table schema exactly.
 */
interface ClickHouseSimulationRunRecord {
  Id: string;
  TenantId: string;
  ScenarioRunId: string;
  ScenarioId: string;
  BatchRunId: string;
  ScenarioSetId: string;
  Version: string;

  Status: string;
  Name: string | null;
  Description: string | null;
  Messages: string;
  TraceIds: string;

  Verdict: string | null;
  Reasoning: string | null;
  MetCriteria: string;
  UnmetCriteria: string;
  Error: string | null;

  DurationMs: string | null; // UInt64 comes back as string from ClickHouse
  CreatedAt: number | null; // DateTime64(3) — read back as ms via toUnixTimestamp64Milli
  UpdatedAt: number | null; // DateTime64(3)
  FinishedAt: number | null; // DateTime64(3)

}

type ClickHouseSimulationRunWriteRecord = WithDateWrites<
  Omit<ClickHouseSimulationRunRecord, "DurationMs"> & { DurationMs: number | null },
  "CreatedAt" | "UpdatedAt" | "FinishedAt"
>;

/**
 * ClickHouse repository for simulation run states.
 */
export class SimulationRunStateRepositoryClickHouse<
  ProjectionType extends Projection = Projection,
> implements SimulationRunStateRepository<ProjectionType> {
  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  private mapClickHouseRecordToProjectionData(
    record: ClickHouseSimulationRunRecord,
  ): SimulationRunStateData {
    return {
      ScenarioRunId: record.ScenarioRunId,
      ScenarioId: record.ScenarioId,
      BatchRunId: record.BatchRunId,
      ScenarioSetId: record.ScenarioSetId,
      Status: record.Status,
      Name: record.Name,
      Description: record.Description,
      Messages: record.Messages,
      TraceIds: record.TraceIds,
      Verdict: record.Verdict,
      Reasoning: record.Reasoning,
      MetCriteria: record.MetCriteria,
      UnmetCriteria: record.UnmetCriteria,
      Error: record.Error,
      DurationMs: record.DurationMs === null ? null : Number(record.DurationMs),
      CreatedAt: record.CreatedAt === null ? 0 : Number(record.CreatedAt),
      UpdatedAt: record.UpdatedAt === null ? 0 : Number(record.UpdatedAt),
      FinishedAt: record.FinishedAt === null ? null : Number(record.FinishedAt),
    };
  }

  private mapProjectionDataToClickHouseRecord(
    data: SimulationRunStateData,
    tenantId: string,
    projectionId: string,
    projectionVersion: string,
  ): ClickHouseSimulationRunWriteRecord {
    return {
      Id: projectionId,
      TenantId: tenantId,
      ScenarioRunId: data.ScenarioRunId,
      ScenarioId: data.ScenarioId,
      BatchRunId: data.BatchRunId,
      ScenarioSetId: data.ScenarioSetId,
      Version: projectionVersion,

      Status: data.Status,
      Name: data.Name,
      Description: data.Description,
      Messages: data.Messages,
      TraceIds: data.TraceIds,

      Verdict: data.Verdict,
      Reasoning: data.Reasoning,
      MetCriteria: data.MetCriteria,
      UnmetCriteria: data.UnmetCriteria,
      Error: data.Error,

      DurationMs: data.DurationMs,
      CreatedAt: data.CreatedAt ? new Date(data.CreatedAt) : new Date(0),
      UpdatedAt: data.UpdatedAt ? new Date(data.UpdatedAt) : new Date(0),
      FinishedAt: data.FinishedAt != null ? new Date(data.FinishedAt) : null,
    };
  }

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null> {
    EventUtils.validateTenantId(
      context,
      "SimulationRunStateRepositoryClickHouse.getProjection",
    );

    const scenarioRunId = String(aggregateId);

    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT
            Id,
            TenantId,
            ScenarioRunId,
            ScenarioId,
            BatchRunId,
            ScenarioSetId,
            Version,
            Status,
            Name,
            Description,
            Messages,
            TraceIds,
            Verdict,
            Reasoning,
            MetCriteria,
            UnmetCriteria,
            Error,
            DurationMs,
            toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(FinishedAt) AS FinishedAt
          FROM ${TABLE_NAME} FINAL
          WHERE TenantId = {tenantId:String}
            AND ScenarioRunId = {scenarioRunId:String}
          ORDER BY UpdatedAt DESC
          LIMIT 1
        `,
        query_params: {
          tenantId: context.tenantId,
          scenarioRunId: scenarioRunId,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseSimulationRunRecord>();
      const row = rows[0];
      if (!row) {
        return null;
      }

      const projectionData = this.mapClickHouseRecordToProjectionData(row);

      const projection: SimulationRunState = {
        id: row.Id,
        aggregateId: scenarioRunId,
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
          scenarioRunId,
          tenantId: context.tenantId,
          error: errorMessage,
        },
        "Failed to get projection from ClickHouse",
      );
      throw new StoreError(
        "getProjection",
        "SimulationRunStateRepositoryClickHouse",
        `Failed to get projection for simulation run ${scenarioRunId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        { scenarioRunId },
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
      "SimulationRunStateRepositoryClickHouse.storeProjection",
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
      const scenarioRunId = String(projection.aggregateId);
      const projectionRecord = this.mapProjectionDataToClickHouseRecord(
        projection.data as SimulationRunStateData,
        String(context.tenantId),
        projection.id,
        projection.version,
      );

      await this.clickHouseClient.insert({
        table: TABLE_NAME,
        values: [projectionRecord],
        format: "JSONEachRow",
      });

      logger.debug(
        {
          tenantId: context.tenantId,
          scenarioRunId,
          projectionId: projection.id,
        },
        "Stored simulation run state projection to ClickHouse",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        {
          tenantId: context.tenantId,
          scenarioRunId: String(projection.aggregateId),
          projectionId: projection.id,
          error: errorMessage,
        },
        "Failed to store projection in ClickHouse",
      );
      throw new StoreError(
        "storeProjection",
        "SimulationRunStateRepositoryClickHouse",
        `Failed to store projection ${projection.id} for simulation run ${projection.aggregateId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        {
          projectionId: projection.id,
          scenarioRunId: String(projection.aggregateId),
        },
        error,
      );
    }
  }
}
