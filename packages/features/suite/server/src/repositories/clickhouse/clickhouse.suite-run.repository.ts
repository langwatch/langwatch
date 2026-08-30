import {
  classifyClickHouseError,
  createTenantId,
  EventUtils,
  SecurityError,
  StoreError,
  ValidationError,
  type Projection,
  type ProjectionStore,
  type ProjectionStoreReadContext,
  type ProjectionStoreWriteContext,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  suiteRunStateDataSchema,
  type SuiteBatchHistoryInput,
  type SuiteRunStateData,
  type SuiteRunStateInput,
} from "@langwatch/suite-contract";
import { SuiteRunReadRepository } from "../suite-run.repository";
import type { SuiteClickHouseClient } from "../../ports/suite-clickhouse.port";

export type SuiteRunClickHouseRepositoryOptions = {
  resolveClient: (projectId: string) => Promise<SuiteClickHouseClient>;
  defaultRetentionDays: number;
};

const TABLE_NAME = "suite_runs" as const;
const logger = createLogger("langwatch:suite-run-processing:run-state-repository");

/** Reads the latest event-sourced Suite run rows, before background merges. */
export class ClickHouseSuiteRunRepository
  extends SuiteRunReadRepository
  implements ProjectionStore<Projection<SuiteRunStateData>>
{
  static create(options: SuiteRunClickHouseRepositoryOptions): ClickHouseSuiteRunRepository {
    return new ClickHouseSuiteRunRepository(options);
  }

  private constructor(private readonly options: SuiteRunClickHouseRepositoryOptions) {
    super();
  }

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<Projection<SuiteRunStateData> | null> {
    EventUtils.validateTenantId(context, "SuiteRunStateRepositoryClickHouse.getProjection");
    try {
      const client = await this.options.resolveClient(String(context.tenantId));
      const result = await client.query({
        query: projectionQuery(),
        query_params: { tenantId: context.tenantId, batchRunId: aggregateId },
        format: "JSONEachRow",
      });
      const rows = await result.json<Record<string, unknown>>();
      const row = rows[0];
      if (!row) return null;
      return {
        id: String(row.ProjectionId),
        aggregateId,
        tenantId: createTenantId(String(context.tenantId)),
        version: String(row.Version),
        data: mapRowToState(row),
      };
    } catch (error) {
      throw this.storeError({
        operation: "getProjection",
        message: `Failed to get projection for batch run ${aggregateId}`,
        context: { batchRunId: aggregateId },
        logContext: { batchRunId: aggregateId, tenantId: context.tenantId },
        logMessage: "Failed to get projection from ClickHouse",
        error,
      });
    }
  }

  async storeProjection(
    projection: Projection<SuiteRunStateData>,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    EventUtils.validateTenantId(context, "SuiteRunStateRepositoryClickHouse.storeProjection");
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
      const client = await this.options.resolveClient(String(context.tenantId));
      await client.insert({
        table: TABLE_NAME,
        values: [mapProjectionToRow(projection, context, this.options.defaultRetentionDays)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      throw this.storeError({
        operation: "storeProjection",
        message: `Failed to store projection ${projection.id} for batch run ${projection.aggregateId}`,
        context: { projectionId: projection.id, batchRunId: projection.aggregateId },
        logContext: {
          tenantId: context.tenantId,
          batchRunId: String(projection.aggregateId),
          projectionId: projection.id,
        },
        logMessage: "Failed to store projection in ClickHouse",
        error,
      });
    }
  }

  async storeProjectionBatch(
    projections: Projection<SuiteRunStateData>[],
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    if (projections.length === 0) return;
    EventUtils.validateTenantId(context, "SuiteRunStateRepositoryClickHouse.storeProjectionBatch");
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
      const client = await this.options.resolveClient(String(context.tenantId));
      await client.insert({
        table: TABLE_NAME,
        values: projections.map((projection) =>
          mapProjectionToRow(projection, context, this.options.defaultRetentionDays),
        ),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      throw this.storeError({
        operation: "storeProjectionBatch",
        message: `Failed to batch store ${projections.length} projections`,
        context: { count: projections.length },
        logContext: { tenantId: context.tenantId, count: projections.length },
        logMessage: "Failed to batch store suite projections in ClickHouse",
        error,
      });
    }
  }

  async tryGetSuiteRunState(input: SuiteRunStateInput): Promise<SuiteRunStateData | null> {
    const client = await this.options.resolveClient(input.projectId);
    const result = await client.query({
      query: `
        SELECT
          t.SuiteRunId AS SuiteRunId, t.BatchRunId AS BatchRunId,
          t.ScenarioSetId AS ScenarioSetId, t.SuiteId AS SuiteId,
          t.Status AS Status, t.Total AS Total,
          t.StartedCount AS StartedCount, t.CompletedCount AS CompletedCount,
          t.FailedCount AS FailedCount, t.Progress AS Progress,
          t.PassRateBps AS PassRateBps, t.PassedCount AS PassedCount,
          t.GradedCount AS GradedCount,
          toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
          toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
          toUnixTimestamp64Milli(t.StartedAt) AS StartedAt,
          toUnixTimestamp64Milli(t.FinishedAt) AS FinishedAt
        FROM suite_runs AS t
        WHERE t.TenantId = {projectId:String}
          AND t.BatchRunId = {batchRunId:String}
          AND (t.TenantId, t.BatchRunId, t.UpdatedAt) IN (
            SELECT TenantId, BatchRunId, max(UpdatedAt)
            FROM suite_runs
            WHERE TenantId = {projectId:String}
              AND BatchRunId = {batchRunId:String}
            GROUP BY TenantId, BatchRunId
          )
        LIMIT 1
      `,
      query_params: { projectId: input.projectId, batchRunId: input.batchRunId },
      format: "JSONEachRow",
    });
    const rows = await result.json<Record<string, unknown>>();
    return rows[0] ? mapRowToState(rows[0]) : null;
  }

  async getBatchHistory(input: SuiteBatchHistoryInput): Promise<SuiteRunStateData[]> {
    const client = await this.options.resolveClient(input.projectId);
    const limit = Math.min(input.limit ?? 50, 100);
    const scenarioSetIds = expandSetIdFilter(input.scenarioSetId);
    const result = await client.query({
      query: `
        SELECT
          t.SuiteRunId AS SuiteRunId, t.BatchRunId AS BatchRunId,
          t.ScenarioSetId AS ScenarioSetId, t.SuiteId AS SuiteId,
          t.Status AS Status, t.Total AS Total,
          t.StartedCount AS StartedCount, t.CompletedCount AS CompletedCount,
          t.FailedCount AS FailedCount, t.Progress AS Progress,
          t.PassRateBps AS PassRateBps, t.PassedCount AS PassedCount,
          t.GradedCount AS GradedCount,
          toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
          toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
          toUnixTimestamp64Milli(t.StartedAt) AS StartedAt,
          toUnixTimestamp64Milli(t.FinishedAt) AS FinishedAt
        FROM suite_runs AS t
        WHERE t.TenantId = {projectId:String}
          AND t.ScenarioSetId IN ({scenarioSetIds:Array(String)})
          AND (t.TenantId, t.ScenarioSetId, t.BatchRunId, t.UpdatedAt) IN (
            SELECT TenantId, ScenarioSetId, BatchRunId, max(UpdatedAt)
            FROM suite_runs
            WHERE TenantId = {projectId:String}
              AND ScenarioSetId IN ({scenarioSetIds:Array(String)})
            GROUP BY TenantId, ScenarioSetId, BatchRunId
          )
        ORDER BY t.CreatedAt DESC
        LIMIT {limit:UInt32}
      `,
      query_params: { projectId: input.projectId, scenarioSetIds, limit },
      format: "JSONEachRow",
    });
    const rows = await result.json<Record<string, unknown>>();
    return rows.map(mapRowToState);
  }
  private storeError(input: {
    operation: string;
    message: string;
    context: Record<string, unknown>;
    logContext: Record<string, unknown>;
    logMessage: string;
    error: unknown;
  }): StoreError {
    const errorMessage = input.error instanceof Error ? input.error.message : String(input.error);
    logger.warn({ ...input.logContext, error: input.error }, input.logMessage);
    return new StoreError(
      input.operation,
      "SuiteRunStateRepositoryClickHouse",
      `${input.message}: ${errorMessage}`,
      classifyClickHouseError(input.error),
      input.context,
      input.error,
    );
  }
}

function expandSetIdFilter(scenarioSetId: string): string[] {
  return scenarioSetId === "default" || scenarioSetId === "" ? ["default", ""] : [scenarioSetId];
}

function mapRowToState(row: Record<string, unknown>): SuiteRunStateData {
  return suiteRunStateDataSchema.parse({
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
    PassRateBps: row.PassRateBps == null ? null : Number(row.PassRateBps),
    PassedCount: Number(row.PassedCount ?? 0),
    GradedCount: Number(row.GradedCount ?? 0),
    CreatedAt: Number(row.CreatedAt),
    UpdatedAt: Number(row.UpdatedAt),
    LastEventOccurredAt: Number(row.LastEventOccurredAt ?? 0),
    StartedAt: row.StartedAt == null ? null : Number(row.StartedAt),
    FinishedAt: row.FinishedAt == null ? null : Number(row.FinishedAt),
  });
}

function projectionQuery(): string {
  return `
    SELECT
      t.ProjectionId AS ProjectionId, t.TenantId AS TenantId,
      t.Version AS Version, t.SuiteRunId AS SuiteRunId,
      t.BatchRunId AS BatchRunId, t.ScenarioSetId AS ScenarioSetId,
      t.SuiteId AS SuiteId, t.Status AS Status, t.Total AS Total,
      t.StartedCount AS StartedCount, t.CompletedCount AS CompletedCount,
      t.FailedCount AS FailedCount, t.Progress AS Progress,
      t.PassRateBps AS PassRateBps, t.PassedCount AS PassedCount,
      t.GradedCount AS GradedCount,
      toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
      toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
      toUnixTimestamp64Milli(t.LastEventOccurredAt) AS LastEventOccurredAt,
      toUnixTimestamp64Milli(t.StartedAt) AS StartedAt,
      toUnixTimestamp64Milli(t.FinishedAt) AS FinishedAt
    FROM suite_runs AS t
    WHERE t.TenantId = {tenantId:String}
      AND t.BatchRunId = {batchRunId:String}
      AND (t.TenantId, t.BatchRunId, t.UpdatedAt) IN (
        SELECT TenantId, BatchRunId, max(UpdatedAt)
        FROM suite_runs
        WHERE TenantId = {tenantId:String}
          AND BatchRunId = {batchRunId:String}
        GROUP BY TenantId, BatchRunId
      )
    LIMIT 1
  `;
}

function mapProjectionToRow(
  projection: Projection<SuiteRunStateData>,
  context: ProjectionStoreWriteContext,
  defaultRetentionDays: number,
): Record<string, unknown> {
  const data = projection.data;
  return {
    ProjectionId: projection.id,
    TenantId: context.tenantId,
    SuiteRunId: data.SuiteRunId || projection.id,
    BatchRunId: data.BatchRunId,
    ScenarioSetId: data.ScenarioSetId,
    SuiteId: data.SuiteId,
    Version: projection.version,
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
    FinishedAt: data.FinishedAt == null ? null : new Date(data.FinishedAt),
    LastEventOccurredAt: new Date(data.LastEventOccurredAt || 0),
    _retention_days: retentionDaysFromContext(context, defaultRetentionDays),
  };
}

function retentionDaysFromContext(
  context: ProjectionStoreWriteContext,
  defaultRetentionDays: number,
): number {
  const policy = context.metadata?.retentionPolicy;
  if (typeof policy === "object" && policy !== null && "scenarios" in policy) {
    const scenarios = policy.scenarios;
    if (typeof scenarios === "number") return scenarios;
  }
  return defaultRetentionDays;
}
