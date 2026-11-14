import {
  clickhouseRead,
  column,
  fn,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "@langwatch/eventing";
import {
  classifyClickHouseError,
  createTenantId,
  EventUtils,
  SecurityError,
  StoreError,
  ValidationError,
} from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { Temporal, toDate } from "@langwatch/time";

import type {
  ExperimentRunState,
  ExperimentRunStateData,
} from "../../eventing/experiment-run-state.projection.ts";
import {
  makeExperimentRunKey,
  parseExperimentRunKey,
} from "../../rules/experiment-run-key.rules.ts";
import type { ExperimentClickHouseRepository } from "../experiment-clickhouse.repository.ts";
import type { ExperimentRunStateRepository } from "../experiment-run-state.repository.ts";
import type { ColumnHolds } from "./clickhouse.experiment-run.mapper.ts";
import { experimentRuns as runs } from "./clickhouse.experiment-runs.table.ts";

/**
 * The `DateTime64(3)` columns. The ClickHouse client serialises a `Date`; an
 * instant serialises to `{}`, so the conversion happens here and nowhere above.
 */
type ClickHouseDateTime = ReturnType<typeof toDate>;

/** Epoch millis as the `Date` the ClickHouse client binds to a `DateTime64(3)`. */
function clickHouseDateTime(epochMs: number): ClickHouseDateTime {
  return toDate(Temporal.Instant.fromEpochMilliseconds(epochMs));
}

const TABLE_NAME = "experiment_runs" as const;

/** The projection row as the built read answers it: times as epoch millis under `…Ms` keys. */
interface ExperimentRunStateReadRow {
  ProjectionId: string;
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
  TotalDurationText: string | null;
  AvgScoreBps: number | null;
  PassRateBps: number | null;
  Targets: string;
  CreatedAtMs: number | string;
  UpdatedAtMs: number | string;
  StartedAtMs: number | string | null;
  FinishedAtMs: number | string | null;
  StoppedAtMs: number | string | null;
  RecordedTargetResults: number | null;
  RecordedEvaluatorResults: number | null;
  RecordedConcurrency: number | null;
  LastProcessedEventId: string;
  TotalScoreSum: number;
  ScoreCount: number;
  PassedCount: number;
  GradedCount: number;
  LastEventOccurredAtMs: number | string;
}

/**
 * One run's latest version, by the IN-tuple election on `UpdatedAt`; goose 00105/00125's
 * columns read as NULL where the target lacks them (NO-HOLDS).
 */
function runStateRead({
  tenantId,
  experimentId,
  runId,
  holds,
}: {
  tenantId: string;
  experimentId: string;
  runId: string;
  holds: ColumnHolds;
}): ReaderReadStatement<ExperimentRunStateReadRow> {
  const millis = fn.toUnixTimestamp64Milli;
  return clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(runs)
    .select({
      ProjectionId: runs.ProjectionId,
      TenantId: runs.TenantId,
      RunId: runs.RunId,
      ExperimentId: runs.ExperimentId,
      WorkflowVersionId: runs.WorkflowVersionId,
      Version: runs.Version,
      Total: runs.Total,
      Progress: runs.Progress,
      CompletedCount: runs.CompletedCount,
      FailedCount: runs.FailedCount,
      TotalCost: runs.TotalCost,
      TotalDurationText: fn.toString(runs.TotalDurationMs),
      AvgScoreBps: runs.AvgScoreBps,
      PassRateBps: runs.PassRateBps,
      Targets: runs.Targets,
      CreatedAtMs: millis(runs.CreatedAt),
      UpdatedAtMs: millis(runs.UpdatedAt),
      StartedAtMs: millis(runs.StartedAt),
      FinishedAtMs: millis(runs.FinishedAt),
      StoppedAtMs: millis(runs.StoppedAt),
      RecordedTargetResults: fn.heldOr(runs.ExpectedTargetResults, {
        holds,
        otherwise: fn.nullAs(column.nullable(column.uint32())),
      }),
      RecordedEvaluatorResults: fn.heldOr(runs.ExpectedEvaluatorResults, {
        holds,
        otherwise: fn.nullAs(column.nullable(column.uint32())),
      }),
      RecordedConcurrency: fn.heldOr(runs.Concurrency, {
        holds,
        otherwise: fn.nullAs(column.nullable(column.uint16())),
      }),
      LastProcessedEventId: runs.LastProcessedEventId,
      TotalScoreSum: runs.TotalScoreSum,
      ScoreCount: runs.ScoreCount,
      PassedCount: runs.PassedCount,
      GradedCount: runs.GradedCount,
      LastEventOccurredAtMs: millis(runs.LastEventOccurredAt),
    })
    .where(({ and, eq, idBound }) =>
      and(eq(runs.ExperimentId, experimentId), idBound(runs.RunId, runId)),
    )
    .latestVersion()
    .limit(1)
    .build();
}

const asMillis = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

const logger = createLogger("langwatch:experiment-run-processing:run-state-repository");

type WithDateWrites<T, K extends keyof T> = {
  [P in keyof T]: P extends K
    ? T[P] extends number
      ? ClickHouseDateTime
      : T[P] extends number | null
        ? ClickHouseDateTime | null
        : T[P]
    : T[P];
};

interface ClickHouseExperimentRunRecord {
  ProjectionId: string;
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
  AvgScoreBps: number | null;
  PassRateBps: number | null;
  Targets: string;
  CreatedAt: number;
  UpdatedAt: number;
  StartedAt: number | null;
  FinishedAt: number | null;
  StoppedAt: number | null;
  ExpectedTargetResults: number | null;
  ExpectedEvaluatorResults: number | null;
  Concurrency: number | null;
  LastProcessedEventId: string;
  TotalScoreSum: number;
  ScoreCount: number;
  PassedCount: number;
  GradedCount: number;
  LastEventOccurredAt: number;
  _retention_days: number;
}

/** The record as a read answers it: retention is written, never read back. */
type ClickHouseExperimentRunReadRecord = Omit<ClickHouseExperimentRunRecord, "_retention_days">;

type ClickHouseExperimentRunWriteRecord = WithDateWrites<
  ClickHouseExperimentRunRecord,
  "CreatedAt" | "UpdatedAt" | "StartedAt" | "FinishedAt" | "StoppedAt" | "LastEventOccurredAt"
>;

export class ClickHouseExperimentRunStateRepository<
  ProjectionType extends Projection = Projection,
> implements ExperimentRunStateRepository<ProjectionType> {
  private constructor(
    private readonly clickhouse: ExperimentClickHouseRepository,
    private readonly defaultRetentionDays: () => number,
  ) {}

  static create<ProjectionType extends Projection = Projection>(options: {
    clickhouse: ExperimentClickHouseRepository;
    defaultRetentionDays: () => number;
  }): ClickHouseExperimentRunStateRepository<ProjectionType> {
    return new ClickHouseExperimentRunStateRepository<ProjectionType>(
      options.clickhouse,
      options.defaultRetentionDays,
    );
  }

  private mapClickHouseRecordToProjectionData(
    record: ClickHouseExperimentRunReadRecord,
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
      TotalDurationMs: record.TotalDurationMs ? parseInt(record.TotalDurationMs, 10) : null,
      AvgScoreBps: record.AvgScoreBps,
      PassRateBps: record.PassRateBps,
      Targets: record.Targets,
      CreatedAt: Number(record.CreatedAt),
      UpdatedAt: Number(record.UpdatedAt),
      StartedAt: record.StartedAt === null ? null : Number(record.StartedAt),
      FinishedAt: record.FinishedAt === null ? null : Number(record.FinishedAt),
      StoppedAt: record.StoppedAt === null ? null : Number(record.StoppedAt),
      ExpectedTargetResults: record.ExpectedTargetResults ?? null,
      ExpectedEvaluatorResults: record.ExpectedEvaluatorResults ?? null,
      Concurrency: record.Concurrency ?? null,
      TotalScoreSum: record.TotalScoreSum ?? 0,
      ScoreCount: record.ScoreCount ?? 0,
      PassedCount: record.PassedCount ?? 0,
      GradedCount: record.GradedCount ?? 0,
      LastEventOccurredAt: Number(record.LastEventOccurredAt ?? 0),
      TraceMetrics: {},
    };
  }

  private mapProjectionDataToClickHouseRecord({
    data,
    tenantId,
    projectionId,
    projectionVersion,
    lastProcessedEventId,
    runId,
  }: {
    data: ExperimentRunStateData;
    tenantId: string;
    projectionId: string;
    projectionVersion: string;
    lastProcessedEventId: string;
    runId: string;
  }): ClickHouseExperimentRunWriteRecord {
    return {
      ProjectionId: projectionId,
      TenantId: tenantId,
      RunId: data.RunId || runId,
      ExperimentId: data.ExperimentId,
      WorkflowVersionId: data.WorkflowVersionId,
      Version: projectionVersion,
      Total: data.Total,
      Progress: data.Progress,
      CompletedCount: data.CompletedCount,
      FailedCount: data.FailedCount,
      TotalCost: data.TotalCost,
      TotalDurationMs: data.TotalDurationMs?.toString() ?? null,
      AvgScoreBps: data.AvgScoreBps,
      PassRateBps: data.PassRateBps,
      Targets: data.Targets,
      CreatedAt: clickHouseDateTime(data.CreatedAt),
      UpdatedAt: clickHouseDateTime(data.UpdatedAt),
      StartedAt: clickHouseDateTime(data.StartedAt ?? data.CreatedAt),
      FinishedAt: data.FinishedAt != null ? clickHouseDateTime(data.FinishedAt) : null,
      StoppedAt: data.StoppedAt != null ? clickHouseDateTime(data.StoppedAt) : null,
      ExpectedTargetResults: data.ExpectedTargetResults ?? null,
      ExpectedEvaluatorResults: data.ExpectedEvaluatorResults ?? null,
      Concurrency: data.Concurrency ?? null,
      LastProcessedEventId: lastProcessedEventId,
      TotalScoreSum: data.TotalScoreSum,
      ScoreCount: data.ScoreCount,
      PassedCount: data.PassedCount,
      GradedCount: data.GradedCount,
      LastEventOccurredAt: clickHouseDateTime(data.LastEventOccurredAt ?? 0),
      // Placeholder; storeProjection / storeProjectionBatch overwrite this with
      // the resolved retention (platform default when the tenant has none).
      _retention_days: this.defaultRetentionDays(),
    };
  }

  async findProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null> {
    EventUtils.validateTenantId(context, "ClickHouseExperimentRunStateRepository.findProjection");

    // aggregateId is the composite key (experimentId:runId) — parse to raw values
    const { experimentId, runId } = parseExperimentRunKey(String(aggregateId));

    try {
      const client = await this.clickhouse.resolveClient(context.tenantId);
      const holds = (await client.holds?.({ table: TABLE_NAME })) ?? (() => true);
      const { rows } = await client.read({
        statement: runStateRead({ tenantId: context.tenantId, experimentId, runId, holds }),
        idBound: { fallback: "unbounded" },
      });
      const read = rows[0];
      if (!read) return null;
      const row = recordOf(read);

      const projection: ExperimentRunState = {
        id: row.ProjectionId,
        aggregateId: makeExperimentRunKey(experimentId, runId),
        tenantId: createTenantId(context.tenantId),
        version: row.Version,
        data: this.mapClickHouseRecordToProjectionData(row),
      };

      return projection as ProjectionType;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        { runId, tenantId: context.tenantId, error: errorMessage },
        "Failed to get projection from ClickHouse",
      );
      throw new StoreError({
        operation: "findProjection",
        store: "ClickHouseExperimentRunStateRepository",
        message: `Failed to get projection for run ${runId}: ${errorMessage}`,
        category: classifyClickHouseError(error),
        context: { runId },
        cause: error,
      });
    }
  }

  async storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    EventUtils.validateTenantId(context, "ClickHouseExperimentRunStateRepository.storeProjection");

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
      const client = await this.clickhouse.resolveClient(context.tenantId);
      const { runId } = parseExperimentRunKey(String(projection.aggregateId));
      const projectionRecord = this.mapProjectionDataToClickHouseRecord({
        data: projection.data as ExperimentRunStateData,
        tenantId: String(context.tenantId),
        projectionId: projection.id,
        projectionVersion: projection.version,
        lastProcessedEventId: projection.id,
        runId,
      });

      const retentionPolicy = context.metadata?.retentionPolicy as
        | { experiments?: number | null }
        | undefined;
      projectionRecord._retention_days =
        retentionPolicy?.experiments ?? this.defaultRetentionDays();

      await client.insert({
        table: TABLE_NAME,
        values: [projectionRecord],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        {
          tenantId: context.tenantId,
          runId: String(projection.aggregateId),
          projectionId: projection.id,
          error: errorMessage,
        },
        "Failed to store projection in ClickHouse",
      );
      throw new StoreError({
        operation: "storeProjection",
        store: "ClickHouseExperimentRunStateRepository",
        message: `Failed to store projection ${projection.id} for run ${projection.aggregateId}: ${errorMessage}`,
        category: classifyClickHouseError(error),
        context: { projectionId: projection.id, runId: String(projection.aggregateId) },
        cause: error,
      });
    }
  }

  async storeProjectionBatch(
    projections: ProjectionType[],
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    if (projections.length === 0) return;

    EventUtils.validateTenantId(
      context,
      "ClickHouseExperimentRunStateRepository.storeProjectionBatch",
    );

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
      const retentionPolicy = context.metadata?.retentionPolicy as
        | { experiments?: number | null }
        | undefined;
      const retentionDays = retentionPolicy?.experiments ?? this.defaultRetentionDays();
      const records = projections.map((projection) => {
        const { runId } = parseExperimentRunKey(String(projection.aggregateId));
        const record = this.mapProjectionDataToClickHouseRecord({
          data: projection.data as ExperimentRunStateData,
          tenantId: String(context.tenantId),
          projectionId: projection.id,
          projectionVersion: projection.version,
          lastProcessedEventId: projection.id,
          runId,
        });
        record._retention_days = retentionDays;
        return record;
      });

      const client = await this.clickhouse.resolveClient(context.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        {
          tenantId: context.tenantId,
          count: projections.length,
          error: errorMessage,
        },
        "Failed to batch store projections in ClickHouse",
      );
      throw new StoreError({
        operation: "storeProjectionBatch",
        store: "ClickHouseExperimentRunStateRepository",
        message: `Failed to batch store ${projections.length} projections: ${errorMessage}`,
        category: classifyClickHouseError(error),
        context: { count: projections.length },
        cause: error,
      });
    }
  }
}

/** The read row under the record's column names, as the projection mapping reads it. */
function recordOf(row: ExperimentRunStateReadRow): ClickHouseExperimentRunReadRecord {
  return {
    ProjectionId: row.ProjectionId,
    TenantId: row.TenantId,
    RunId: row.RunId,
    ExperimentId: row.ExperimentId,
    WorkflowVersionId: row.WorkflowVersionId,
    Version: row.Version,
    Total: row.Total,
    Progress: row.Progress,
    CompletedCount: row.CompletedCount,
    FailedCount: row.FailedCount,
    TotalCost: row.TotalCost,
    TotalDurationMs: row.TotalDurationText,
    AvgScoreBps: row.AvgScoreBps,
    PassRateBps: row.PassRateBps,
    Targets: row.Targets,
    CreatedAt: Number(row.CreatedAtMs),
    UpdatedAt: Number(row.UpdatedAtMs),
    StartedAt: asMillis(row.StartedAtMs),
    FinishedAt: asMillis(row.FinishedAtMs),
    StoppedAt: asMillis(row.StoppedAtMs),
    ExpectedTargetResults: row.RecordedTargetResults,
    ExpectedEvaluatorResults: row.RecordedEvaluatorResults,
    Concurrency: row.RecordedConcurrency,
    LastProcessedEventId: row.LastProcessedEventId,
    TotalScoreSum: row.TotalScoreSum,
    ScoreCount: row.ScoreCount,
    PassedCount: row.PassedCount,
    GradedCount: row.GradedCount,
    LastEventOccurredAt: Number(row.LastEventOccurredAtMs),
  };
}
