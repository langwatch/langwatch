import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { WithDateWrites } from "~/server/clickhouse/types";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import {
  classifyClickHouseError,
  SecurityError,
  StoreError,
  ValidationError,
} from "~/server/event-sourcing/services/errorHandling";
import { createLogger } from "~/utils/logger/server";
import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../";
import { createTenantId, EventUtils } from "../../../";
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
  CancellationRequestedAt: number | null;
  LastSnapshotOccurredAt: number;
  LastEventOccurredAt: number;
  _retention_days: number;
}

type ClickHouseSimulationRunWriteRecord = WithDateWrites<
  ClickHouseSimulationRunRecord,
  "StartedAt" | "QueuedAt" | "CreatedAt" | "UpdatedAt" | "FinishedAt" | "ArchivedAt" | "CancellationRequestedAt" | "LastSnapshotOccurredAt" | "LastEventOccurredAt"
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
      CancellationRequestedAt: record.CancellationRequestedAt === null || record.CancellationRequestedAt === undefined ? null : Number(record.CancellationRequestedAt),
      LastSnapshotOccurredAt: Number(record.LastSnapshotOccurredAt ?? 0),
      LastEventOccurredAt: Number(record.LastEventOccurredAt ?? 0),
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
      TraceMetricsJson:
        Object.keys(data.TraceMetrics).length > 0 ? JSON.stringify(data.TraceMetrics) : "",
      StartedAt: new Date(data.StartedAt ?? data.CreatedAt),
      QueuedAt: data.QueuedAt != null ? new Date(data.QueuedAt) : null,
      CreatedAt: data.CreatedAt != null ? new Date(data.CreatedAt) : new Date(),
      UpdatedAt: new Date(data.UpdatedAt),
      FinishedAt: data.FinishedAt != null ? new Date(data.FinishedAt) : null,
      ArchivedAt: data.ArchivedAt != null ? new Date(data.ArchivedAt) : null,
      CancellationRequestedAt: data.CancellationRequestedAt != null ? new Date(data.CancellationRequestedAt) : null,
      LastSnapshotOccurredAt: data.LastSnapshotOccurredAt ? new Date(data.LastSnapshotOccurredAt) : new Date(0),
      LastEventOccurredAt: data.LastEventOccurredAt ? new Date(data.LastEventOccurredAt) : new Date(0),
      // Placeholder; storeProjection / storeProjectionBatch overwrite this with
      // the resolved retention (platform default when the tenant has none).
      _retention_days: PLATFORM_DEFAULT_RETENTION_DAYS,
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
      // Latest-version read over the ReplacingMergeTree(UpdatedAt) for a single
      // run. The inner scalar subquery finds the newest UpdatedAt reading only
      // the light sort-key columns; the outer `t.UpdatedAt = (...)` equality is
      // PREWHERE-able, so the heavy columns (Messages.*, TraceMetricsJson,
      // RoleCosts, etc.) are materialized for only the single surviving row.
      //
      // The earlier `(TenantId, ScenarioRunId, UpdatedAt) IN (max-subquery)`
      // tuple form was not applied as a PREWHERE on the version, so ClickHouse
      // read the heavy Messages.* arrays across EVERY version of the run before
      // discarding the stale ones. Runs with many snapshot versions exhausted
      // the server memory limit (Code 241). For a single-aggregate get, scalar
      // equality is preferable to the IN-tuple form (which stays the right
      // choice for multi-key list reads); the sibling read path
      // (simulation.clickhouse.repository.ts getScenarioRunData) already uses
      // this scalar form for the same reason.
      //
      // Outer references UpdatedAt via the table alias because the column is
      // also projected as `toUnixTimestamp64Milli(...) AS UpdatedAt` — without
      // the alias the comparison resolves to the projected UInt64 instead of
      // the raw DateTime64.
      const result = await client.query({
        query: `
          SELECT
            t.ProjectionId AS ProjectionId, t.TenantId AS TenantId,
            t.ScenarioRunId AS ScenarioRunId, t.ScenarioId AS ScenarioId,
            t.BatchRunId AS BatchRunId, t.ScenarioSetId AS ScenarioSetId,
            t.Version AS Version, t.Status AS Status, t.Name AS Name,
            t.Description AS Description, t.Metadata AS Metadata,
            t.\`Messages.Id\` AS \`Messages.Id\`,
            t.\`Messages.Role\` AS \`Messages.Role\`,
            t.\`Messages.Content\` AS \`Messages.Content\`,
            t.\`Messages.TraceId\` AS \`Messages.TraceId\`,
            t.\`Messages.Rest\` AS \`Messages.Rest\`,
            t.TraceIds AS TraceIds,
            t.Verdict AS Verdict, t.Reasoning AS Reasoning,
            t.MetCriteria AS MetCriteria, t.UnmetCriteria AS UnmetCriteria,
            t.Error AS Error,
            toString(t.DurationMs) AS DurationMs,
            t.TotalCost AS TotalCost, t.RoleCosts AS RoleCosts,
            t.RoleLatencies AS RoleLatencies,
            t.TraceMetricsJson AS TraceMetricsJson,
            toUnixTimestamp64Milli(t.StartedAt) AS StartedAt,
            if(t.QueuedAt IS NOT NULL, toUnixTimestamp64Milli(t.QueuedAt), NULL) AS QueuedAt,
            toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
            toUnixTimestamp64Milli(t.FinishedAt) AS FinishedAt,
            toUnixTimestamp64Milli(t.ArchivedAt) AS ArchivedAt,
            if(t.CancellationRequestedAt IS NOT NULL, toUnixTimestamp64Milli(t.CancellationRequestedAt), NULL) AS CancellationRequestedAt,
            toUnixTimestamp64Milli(t.LastSnapshotOccurredAt) AS LastSnapshotOccurredAt,
            toUnixTimestamp64Milli(t.LastEventOccurredAt) AS LastEventOccurredAt
          FROM ${TABLE_NAME} AS t
          WHERE t.TenantId = {tenantId:String}
            AND t.ScenarioRunId = {scenarioRunId:String}
            AND t.UpdatedAt = (
              SELECT max(s.UpdatedAt)
              FROM ${TABLE_NAME} AS s
              WHERE s.TenantId = {tenantId:String}
                AND s.ScenarioRunId = {scenarioRunId:String}
            )
          LIMIT 1
        `,
        query_params: { tenantId: context.tenantId, scenarioRunId },
        format: "JSONEachRow",
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
        classifyClickHouseError(error),
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

      const retentionPolicy = context.metadata?.retentionPolicy as { scenarios?: number | null } | undefined;
      projectionRecord._retention_days =
        retentionPolicy?.scenarios ?? PLATFORM_DEFAULT_RETENTION_DAYS;

      const client = await this.resolveClient(context.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [projectionRecord],
        format: "JSONEachRow",
        clickhouse_settings: {
          async_insert: 1,
          wait_for_async_insert: 0,
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
        classifyClickHouseError(error),
        { projectionId: projection.id, scenarioRunId: String(projection.aggregateId) },
        error,
      );
    }
  }

  async storeProjectionBatch(
    projections: ProjectionType[],
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    if (projections.length === 0) return;

    EventUtils.validateTenantId(
      context,
      "SimulationRunStateRepositoryClickHouse.storeProjectionBatch",
    );

    for (const projection of projections) {
      if (projection.tenantId !== context.tenantId) {
        throw new SecurityError(
          "storeProjectionBatch",
          `Projection has tenantId '${projection.tenantId}' that does not match context tenantId '${context.tenantId}'`,
          projection.tenantId,
          { contextTenantId: context.tenantId },
        );
      }
    }

    try {
      const retentionPolicy = context.metadata?.retentionPolicy as { scenarios?: number | null } | undefined;
      const retentionDays =
        retentionPolicy?.scenarios ?? PLATFORM_DEFAULT_RETENTION_DAYS;
      const records = projections.map((projection) => {
        const scenarioRunId = String(projection.aggregateId);
        const record = this.mapProjectionDataToClickHouseRecord(
          projection.data as SimulationRunStateData,
          String(context.tenantId),
          projection.id,
          projection.version,
          scenarioRunId,
        );
        record._retention_days = retentionDays;
        return record;
      });

      const client = await this.resolveClient(context.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error({
        tenantId: context.tenantId,
        count: projections.length,
        error: errorMessage,
      }, "Failed to batch store simulation projections in ClickHouse");
      throw new StoreError(
        "storeProjectionBatch",
        "SimulationRunStateRepositoryClickHouse",
        `Failed to batch store ${projections.length} projections: ${errorMessage}`,
        classifyClickHouseError(error),
        { count: projections.length },
        error,
      );
    }
  }
}
