import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  fn,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import { STORAGE_METER_READ_SETTINGS } from "@langwatch/data-retention-contract/retention-tables";
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
import { suiteRunStateDataSchema, type SuiteRunStateData } from "@langwatch/suite-contract";

import { OPEN_SUITE_RUN_STATUSES } from "#rules/suite-run-open.rules";

import { suiteRuns } from "./clickhouse.suite-runs.table.ts";

type SuiteRunClickHouseRepositoryOptions = {
  /**
   * The process's one ClickHouse client. It routes each statement to the
   * server its tenant belongs on, so this repository holds no per-tenant
   * client and cannot obtain an unscoped one.
   */
  clickhouse: Pick<ClickHouseQueryClient, "read" | "insert">;
  /** Read at write time: the owner answers only once the process is running. */
  defaultRetentionDays: () => number;
};

const TABLE_NAME = suiteRuns.$table.name;

/** The fold state's columns, keyed apart from the stored names; times as epoch millis. */
const SUITE_RUN_STATE_COLUMNS = {
  suiteRunId: suiteRuns.SuiteRunId,
  batchRunId: suiteRuns.BatchRunId,
  scenarioSetId: suiteRuns.ScenarioSetId,
  suiteId: suiteRuns.SuiteId,
  status: suiteRuns.Status,
  total: suiteRuns.Total,
  startedCount: suiteRuns.StartedCount,
  completedCount: suiteRuns.CompletedCount,
  failedCount: suiteRuns.FailedCount,
  progress: suiteRuns.Progress,
  passRateBps: suiteRuns.PassRateBps,
  passedCount: suiteRuns.PassedCount,
  gradedCount: suiteRuns.GradedCount,
  createdAtMs: fn.toUnixTimestamp64Milli(suiteRuns.CreatedAt),
  updatedAtMs: fn.toUnixTimestamp64Milli(suiteRuns.UpdatedAt),
  lastEventOccurredAtMs: fn.toUnixTimestamp64Milli(suiteRuns.LastEventOccurredAt),
  startedAtMs: fn.toUnixTimestamp64Milli(suiteRuns.StartedAt),
  finishedAtMs: fn.toUnixTimestamp64Milli(suiteRuns.FinishedAt),
};

type SuiteRunReadRow = {
  suiteRunId: string;
  batchRunId: string;
  scenarioSetId: string;
  suiteId: string;
  status: string;
  total: number | string;
  startedCount: number | string;
  completedCount: number | string;
  failedCount: number | string;
  progress: number | string;
  passRateBps: number | string | null;
  passedCount: number | string | null;
  gradedCount: number | string | null;
  createdAtMs: number | string;
  updatedAtMs: number | string;
  lastEventOccurredAtMs: number | string | null;
  startedAtMs: number | string | null;
  finishedAtMs: number | string | null;
};
const logger = createLogger("langwatch:suite-run-processing:run-state-repository");

/** Reads the latest event-sourced Suite run rows, before background merges. */
export class ClickHouseSuiteRunRepository implements ProjectionStore<
  Projection<SuiteRunStateData>
> {
  static create(options: SuiteRunClickHouseRepositoryOptions): ClickHouseSuiteRunRepository {
    return new ClickHouseSuiteRunRepository(options);
  }

  private constructor(private readonly options: SuiteRunClickHouseRepositoryOptions) {}

  async findProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<Projection<SuiteRunStateData> | null> {
    EventUtils.validateTenantId(context, "SuiteRunStateRepositoryClickHouse.findProjection");
    try {
      const tenantId = String(context.tenantId);
      const { rows } = await this.options.clickhouse.read({
        statement: ClickHouseSuiteRunRepository.projectionRead({
          tenantId,
          batchRunId: aggregateId,
        }),
        table: TABLE_NAME,
        idBound: { fallback: "unbounded" },
      });
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.projectionId,
        aggregateId,
        tenantId: createTenantId(String(context.tenantId)),
        version: row.version,
        data: ClickHouseSuiteRunRepository.mapRowToState(row),
      };
    } catch (error) {
      throw this.storeError({
        operation: "findProjection",
        message: `Failed to get projection for batch run ${aggregateId}`,
        context: { batchRunId: aggregateId },
        logContext: { batchRunId: aggregateId, tenantId: context.tenantId },
        logMessage: "Failed to get projection from ClickHouse",
        error,
      });
    }
  }

  /** One tenant's suite runs still open, the latest row of each batch run. */
  async findOpenRuns({ tenantId }: { tenantId: string }): Promise<SuiteRunStateData[]> {
    const { rows } = await this.options.clickhouse.read({
      statement: ClickHouseSuiteRunRepository.openRunsRead({ tenantId }),
      table: TABLE_NAME,
      // A run started in any week can still be open, so the sweep has no lower time bound.
      declaresFullScan: true,
    });
    return rows.map((row) => ClickHouseSuiteRunRepository.mapRowToState(row));
  }

  /** One tenant's `_size_bytes` in `suite_runs`, every stored row counted, as the meter counts. */
  async getStoredBytes({
    tenantId,
    beforeMs,
  }: {
    tenantId: string;
    beforeMs?: number | undefined;
  }): Promise<number> {
    const { rows } = await this.options.clickhouse.read({
      statement: ClickHouseSuiteRunRepository.storedBytesRead({ tenantId, beforeMs }),
      table: TABLE_NAME,
      declaresFullScan: true,
    });
    return Number(rows[0]?.bytes ?? 0);
  }

  async storeProjection(
    projection: Projection<SuiteRunStateData>,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    EventUtils.validateTenantId(context, "SuiteRunStateRepositoryClickHouse.storeProjection");
    if (!EventUtils.isValidProjection(projection)) {
      throw new ValidationError({
        reason:
          "Invalid projection: projection must have id, aggregateId, tenantId, version, and data",
        field: "projection",
        value: projection,
      });
    }
    if (projection.tenantId !== context.tenantId) {
      throw new SecurityError({
        operation: "storeProjection",
        message: `Projection has tenantId '${projection.tenantId}' that does not match context tenantId '${context.tenantId}'`,
        tenantId: projection.tenantId,
        context: { contextTenantId: context.tenantId },
      });
    }
    try {
      await this.options.clickhouse.insert({
        tenantId: String(context.tenantId),
        table: TABLE_NAME,
        rows: [
          ClickHouseSuiteRunRepository.mapProjectionToRow(
            projection,
            context,
            this.options.defaultRetentionDays(),
          ),
        ],
        settings: { async_insert: 1, wait_for_async_insert: 0 },
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
        throw new SecurityError({
          operation: "storeProjectionBatch",
          message: `Projection has tenantId '${projection.tenantId}' that does not match context tenantId '${context.tenantId}'`,
          tenantId: projection.tenantId,
          context: { contextTenantId: context.tenantId },
        });
      }
    }
    try {
      await this.options.clickhouse.insert({
        tenantId: String(context.tenantId),
        table: TABLE_NAME,
        rows: projections.map((projection) =>
          ClickHouseSuiteRunRepository.mapProjectionToRow(
            projection,
            context,
            this.options.defaultRetentionDays(),
          ),
        ),
        settings: { async_insert: 1, wait_for_async_insert: 1 },
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
    return new StoreError({
      operation: input.operation,
      store: "SuiteRunStateRepositoryClickHouse",
      message: `${input.message}: ${errorMessage}`,
      category: classifyClickHouseError(input.error),
      context: input.context,
      cause: input.error,
    });
  }

  private static mapRowToState(row: SuiteRunReadRow): SuiteRunStateData {
    return suiteRunStateDataSchema.parse({
      SuiteRunId: row.suiteRunId,
      BatchRunId: row.batchRunId,
      ScenarioSetId: row.scenarioSetId,
      SuiteId: row.suiteId,
      Status: row.status,
      Total: Number(row.total),
      StartedCount: Number(row.startedCount),
      CompletedCount: Number(row.completedCount),
      FailedCount: Number(row.failedCount),
      Progress: Number(row.progress),
      PassRateBps: row.passRateBps == null ? null : Number(row.passRateBps),
      PassedCount: Number(row.passedCount ?? 0),
      GradedCount: Number(row.gradedCount ?? 0),
      CreatedAt: Number(row.createdAtMs),
      UpdatedAt: Number(row.updatedAtMs),
      LastEventOccurredAt: Number(row.lastEventOccurredAtMs ?? 0),
      StartedAt: row.startedAtMs == null ? null : Number(row.startedAtMs),
      FinishedAt: row.finishedAtMs == null ? null : Number(row.finishedAtMs),
    });
  }

  /** The latest run row by batch id, bounded by the run id index once ready. */
  static projectionRead({
    tenantId,
    batchRunId,
  }: {
    tenantId: string;
    batchRunId: string;
  }): ReaderReadStatement<SuiteRunReadRow & { projectionId: string; version: string }> {
    return clickhouseRead({ scope: tenantScope.single({ tenantId }) })
      .from(suiteRuns)
      .select({
        projectionId: suiteRuns.ProjectionId,
        version: suiteRuns.Version,
        ...SUITE_RUN_STATE_COLUMNS,
      })
      .where(({ idBound }) => idBound(suiteRuns.BatchRunId, batchRunId))
      .latestVersion()
      .limit(1)
      .build();
  }

  /** One tenant's open runs, the latest row of each batch run; status asked after the election. */
  static openRunsRead({ tenantId }: { tenantId: string }): ReaderReadStatement<SuiteRunReadRow> {
    return clickhouseRead({ scope: tenantScope.single({ tenantId }) })
      .from(suiteRuns)
      .select(SUITE_RUN_STATE_COLUMNS)
      .latestVersion()
      .where(({ oneOf }) => oneOf(suiteRuns.Status, [...OPEN_SUITE_RUN_STATUSES]))
      .orderBy(suiteRuns.BatchRunId, "ASC")
      .limitBy(1, suiteRuns.BatchRunId)
      .build();
  }

  /** The tenant's summed `_size_bytes` under the meter's caps; `beforeMs` keeps older rows only. */
  static storedBytesRead({
    tenantId,
    beforeMs,
  }: {
    tenantId: string;
    beforeMs?: number | undefined;
  }): ReaderReadStatement<{ bytes: number | string }> {
    const read = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
      .from(suiteRuns)
      .select({ bytes: fn.sum(suiteRuns._size_bytes) });
    return (
      beforeMs === undefined ? read : read.where(({ lt }) => lt(suiteRuns.StartedAt, beforeMs))
    )
      .settings(STORAGE_METER_READ_SETTINGS)
      .build();
  }

  private static mapProjectionToRow(
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
      _retention_days: ClickHouseSuiteRunRepository.retentionDaysFromContext(
        context,
        defaultRetentionDays,
      ),
    };
  }

  private static retentionDaysFromContext(
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
}
