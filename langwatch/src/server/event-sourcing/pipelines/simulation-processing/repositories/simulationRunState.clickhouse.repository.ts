import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
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
  SimulationRunState,
  SimulationRunStateData,
} from "../projections/simulationRunState.foldProjection";
import type { SimulationRunStateRepository } from "./simulationRunState.repository";

const TABLE_NAME = "simulation_runs" as const;

const logger = createLogger(
  "langwatch:simulation-processing:run-state-repository",
);

interface ClickHouseSimulationRunRecord {
  ProjectionId: string;
  TenantId: string;
  ScenarioRunId: string;
  ScenarioId: string;
  BatchRunId: string;
  ScenarioSetId: string;
  Version: string;
  Status: string;
  Name: string | null;
  Description: string | null;
  Metadata: string | null;
  "Messages.Id": string[];
  "Messages.Role": string[];
  "Messages.Content": string[];
  "Messages.TraceId": string[];
  "Messages.Rest": string[];
  TraceIds: string[];
  Verdict: string | null;
  Reasoning: string | null;
  MetCriteria: string[];
  UnmetCriteria: string[];
  Error: string | null;
  DurationMs: string | null;
  TotalCost: number | null;
  RoleCosts: Record<string, number[]>;
  RoleLatencies: Record<string, number[]>;
  TraceMetricsJson: string;
  StartedAt: number | null;
  QueuedAt: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  FinishedAt: number | null;
  ArchivedAt: number | null;
  LastSnapshotOccurredAt: number;
}

type ClickHouseSimulationRunWriteRecord = WithDateWrites<
  ClickHouseSimulationRunRecord,
  "StartedAt" | "QueuedAt" | "CreatedAt" | "UpdatedAt" | "FinishedAt" | "ArchivedAt" | "LastSnapshotOccurredAt"
>;

export class SimulationRunStateRepositoryClickHouse<
  ProjectionType extends Projection = Projection,
> implements SimulationRunStateRepository<ProjectionType>
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  private mapClickHouseRecordToProjectionData(
    record: ClickHouseSimulationRunRecord,
  ): SimulationRunStateData {
    const ids = record["Messages.Id"] ?? [];
    return {
      ScenarioRunId: record.ScenarioRunId,
      ScenarioId: record.ScenarioId,
      BatchRunId: record.BatchRunId,
      ScenarioSetId: record.ScenarioSetId,
      Status: record.Status,
      Name: record.Name,
      Description: record.Description,
      Metadata: record.Metadata,
      Messages: ids.map((Id, i) => ({
        Id,
        Role: record["Messages.Role"]?.[i] ?? "",
        Content: record["Messages.Content"]?.[i] ?? "",
        TraceId: record["Messages.TraceId"]?.[i] ?? "",
        Rest: record["Messages.Rest"]?.[i] ?? "",
      })),
      TraceIds: record.TraceIds ?? [],
      Verdict: record.Verdict,
      Reasoning: record.Reasoning,
      MetCriteria: record.MetCriteria ?? [],
      UnmetCriteria: record.UnmetCriteria ?? [],
      Error: record.Error,
      DurationMs: record.DurationMs ? parseInt(record.DurationMs, 10) : null,
      TotalCost: record.TotalCost ?? null,
      RoleCosts: record.RoleCosts ?? {},
      RoleLatencies: record.RoleLatencies ?? {},
      TraceMetrics: record.TraceMetricsJson ? JSON.parse(record.TraceMetricsJson) : {},
      StartedAt: record.StartedAt === null ? null : Number(record.StartedAt),
      QueuedAt: record.QueuedAt === null || record.QueuedAt === undefined ? null : Number(record.QueuedAt),
      CreatedAt: Number(record.CreatedAt),
      UpdatedAt: Number(record.UpdatedAt),
      FinishedAt: record.FinishedAt === null ? null : Number(record.FinishedAt),
      ArchivedAt: record.ArchivedAt === null ? null : Number(record.ArchivedAt),
      LastSnapshotOccurredAt: Number(record.LastSnapshotOccurredAt ?? 0),
    };
  }

  private mapProjectionDataToClickHouseRecord(
    data: SimulationRunStateData,
    tenantId: string,
    projectionId: string,
    projectionVersion: string,
    scenarioRunId: string,
  ): ClickHouseSimulationRunWriteRecord {
    return {
      ProjectionId: projectionId,
      TenantId: tenantId,
      ScenarioRunId: scenarioRunId || data.ScenarioRunId,
      ScenarioId: data.ScenarioId,
      BatchRunId: data.BatchRunId,
      ScenarioSetId: data.ScenarioSetId,
      Version: projectionVersion,
      Status: data.Status,
      Name: data.Name,
      Description: data.Description,
      Metadata: data.Metadata,
      "Messages.Id": data.Messages.map((m) => m.Id),
      "Messages.Role": data.Messages.map((m) => m.Role),
      "Messages.Content": data.Messages.map((m) => m.Content),
      "Messages.TraceId": data.Messages.map((m) => m.TraceId),
      "Messages.Rest": data.Messages.map((m) => m.Rest),
      TraceIds: data.TraceIds,
      Verdict: data.Verdict,
      Reasoning: data.Reasoning,
      MetCriteria: data.MetCriteria,
      UnmetCriteria: data.UnmetCriteria,
      Error: data.Error,
      DurationMs: data.DurationMs?.toString() ?? null,
      TotalCost: data.TotalCost,
      RoleCosts: data.RoleCosts,
      RoleLatencies: data.RoleLatencies,
      TraceMetricsJson: Object.keys(data.TraceMetrics).length > 0 ? JSON.stringify(data.TraceMetrics) : "",
      StartedAt: new Date(data.StartedAt ?? data.CreatedAt),
      QueuedAt: data.QueuedAt != null ? new Date(data.QueuedAt) : null,
      CreatedAt: data.CreatedAt != null ? new Date(data.CreatedAt) : new Date(),
      UpdatedAt: new Date(data.UpdatedAt),
      FinishedAt: data.FinishedAt != null ? new Date(data.FinishedAt) : null,
      ArchivedAt: data.ArchivedAt != null ? new Date(data.ArchivedAt) : null,
      LastSnapshotOccurredAt: data.LastSnapshotOccurredAt ? new Date(data.LastSnapshotOccurredAt) : new Date(0),
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
      const client = await this.resolveClient(context.tenantId);
      const result = await client.query({
        query: `
          SELECT
            ProjectionId, TenantId, ScenarioRunId, ScenarioId, BatchRunId, ScenarioSetId,
            Version, Status, Name, Description, Metadata,
            \`Messages.Id\`, \`Messages.Role\`, \`Messages.Content\`,
            \`Messages.TraceId\`, \`Messages.Rest\`,
            TraceIds,
            Verdict, Reasoning, MetCriteria, UnmetCriteria, Error,
            toString(DurationMs) AS DurationMs,
            TotalCost, RoleCosts, RoleLatencies, TraceMetricsJson,
            toUnixTimestamp64Milli(StartedAt) AS StartedAt,
            if(QueuedAt IS NOT NULL, toUnixTimestamp64Milli(QueuedAt), NULL) AS QueuedAt,
            toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(FinishedAt) AS FinishedAt,
            toUnixTimestamp64Milli(ArchivedAt) AS ArchivedAt,
            toUnixTimestamp64Milli(LastSnapshotOccurredAt) AS LastSnapshotOccurredAt
          FROM ${TABLE_NAME} FINAL
          WHERE TenantId = {tenantId:String} AND ScenarioRunId = {scenarioRunId:String}
          ORDER BY UpdatedAt DESC
          LIMIT 1
        `,
        query_params: { tenantId: context.tenantId, scenarioRunId },
        format: "JSONEachRow",
        clickhouse_settings: { select_sequential_consistency: "1" },
      });

      const rows = await result.json<ClickHouseSimulationRunRecord>();
      const row = rows[0];
      if (!row) return null;

      const projection: SimulationRunState = {
        id: row.ProjectionId,
        aggregateId: scenarioRunId,
        tenantId: createTenantId(context.tenantId),
        version: row.Version,
        data: this.mapClickHouseRecordToProjectionData(row),
      };

      return projection as ProjectionType;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error({ scenarioRunId, tenantId: context.tenantId, error: errorMessage },
        "Failed to get projection from ClickHouse");
      throw new StoreError(
        "getProjection",
        "SimulationRunStateRepositoryClickHouse",
        `Failed to get projection for scenario run ${scenarioRunId}: ${errorMessage}`,
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
        scenarioRunId,
      );

      const client = await this.resolveClient(context.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [projectionRecord],
        format: "JSONEachRow",
        clickhouse_settings: {
          // Synchronous insert (no async batching) + quorum write.
          // Fold stores need read-after-write consistency: without quorum,
          // a subsequent store.get() on a replica may return stale state,
          // causing the fold to overwrite fields (e.g. ScenarioSetId lost,
          // Status reverted from SUCCESS to IN_PROGRESS).
          async_insert: 0,
          insert_quorum: "2",
        },
      });

    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error({
        tenantId: context.tenantId,
        scenarioRunId: String(projection.aggregateId),
        projectionId: projection.id,
        error: errorMessage,
      }, "Failed to store projection in ClickHouse");
      throw new StoreError(
        "storeProjection",
        "SimulationRunStateRepositoryClickHouse",
        `Failed to store projection ${projection.id} for scenario run ${projection.aggregateId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        { projectionId: projection.id, scenarioRunId: String(projection.aggregateId) },
        error,
      );
    }
  }

}
