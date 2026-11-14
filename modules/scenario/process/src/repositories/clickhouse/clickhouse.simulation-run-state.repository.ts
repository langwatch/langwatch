import { queryWindowed } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  column,
  type ColumnRef,
  fn,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
  ReadTimeWindow,
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
import { nowInstant, toDate } from "@langwatch/time";

import type {
  SimulationRunState,
  SimulationRunStateData,
} from "../../eventing/simulation-run-state.projection.ts";
import {
  type ClickHouseEvaluationColumns,
  columnsToEvaluations,
  evaluationsToColumns,
} from "../../rules/simulation-evaluation-columns.rules.ts";
import type { SimulationRunStateRepository } from "../simulation-run-state.repository.ts";
import { simulationRuns } from "./clickhouse.simulation-runs.table.ts";
import { type SimulationEventingClickHouseResolver } from "./clickhouse.simulation-session.store.ts";
import {
  type ClickHouseCriteriaColumns,
  columnsToCriteria,
  criteriaToColumns,
} from "./simulation-criteria.mapper.ts";

const TABLE_NAME = "simulation_runs" as const;

/**
 * How far the latest-version lookup reaches past the row window. StartedAt moves
 * (hours, until the run starts), so a latest version just outside the row window
 * still wins the lookup and the read answers empty, never an older version.
 */
export const LATEST_VERSION_LOOKUP_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

/** A StartedAt range in whole milliseconds, both ends inclusive. */
interface StartedAtRange {
  fromMs: number;
  toMs: number;
}

/** The StartedAt ranges of a run-state read: none without a window. */
type StartedAtBounds =
  | { kind: "unbounded" }
  | {
      kind: "bounded";
      /** For the row read. */
      row: StartedAtRange;
      /** For the latest-version lookup, wider by {@link LATEST_VERSION_LOOKUP_MARGIN_MS}. */
      latestVersion: StartedAtRange;
    };

/** A row of the run-state latest-row read. */
type LatestRunRow =
  ReturnType<typeof latestRowReadOf> extends ReaderReadStatement<infer Row> ? Row : never;

const logger = createLogger("langwatch:simulation-processing:run-state-repository");

interface ClickHouseSimulationRunRecord
  extends ClickHouseEvaluationColumns, Partial<ClickHouseCriteriaColumns> {
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
  InconclusiveCriteria?: string[];
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

type WithDateWrites<RecordType, DateKeys extends keyof RecordType> = Omit<RecordType, DateKeys> & {
  [Key in DateKeys]: Date | null;
};

type SimulationClickHouseClientResolver = SimulationEventingClickHouseResolver;

type ClickHouseSimulationRunWriteRecord = WithDateWrites<
  ClickHouseSimulationRunRecord,
  | "StartedAt"
  | "QueuedAt"
  | "CreatedAt"
  | "UpdatedAt"
  | "FinishedAt"
  | "ArchivedAt"
  | "CancellationRequestedAt"
  | "LastSnapshotOccurredAt"
  | "LastEventOccurredAt"
>;

export class ClickHouseSimulationRunStateRepository<
  ProjectionType extends Projection = Projection,
> implements SimulationRunStateRepository<ProjectionType> {
  static create<ProjectionType extends Projection = Projection>(options: {
    resolveClient: SimulationClickHouseClientResolver;
    defaultRetentionDays: () => number;
  }): ClickHouseSimulationRunStateRepository<ProjectionType> {
    return new ClickHouseSimulationRunStateRepository(options);
  }

  constructor(
    private readonly options: {
      resolveClient: SimulationClickHouseClientResolver;
      defaultRetentionDays: () => number;
    },
  ) {}

  private mapLatestRowToProjectionData(row: LatestRunRow): SimulationRunStateData {
    const millis = (value: number | string | null): number | null =>
      value === null ? null : Number(value);
    return {
      ScenarioRunId: row.ScenarioRunId,
      ScenarioId: row.ScenarioId,
      BatchRunId: row.BatchRunId,
      ScenarioSetId: row.ScenarioSetId,
      Status: row.Status,
      Name: row.Name,
      Description: row.Description,
      Metadata: row.Metadata,
      Messages: row.messageIds.map((Id, i) => ({
        Id,
        Role: row.messageRoles[i] ?? "",
        Content: row.messageContents[i] ?? "",
        TraceId: row.messageTraceIds[i] ?? "",
        Rest: row.messageRests[i] ?? "",
      })),
      TraceIds: [...row.TraceIds],
      Verdict: row.Verdict,
      Reasoning: row.Reasoning,
      MetCriteria: [...row.MetCriteria],
      UnmetCriteria: [...row.UnmetCriteria],
      InconclusiveCriteria: [...row.InconclusiveCriteria],
      Criteria: columnsToCriteria({
        "Criteria.Criterion": [...row.criteriaCriterion],
        "Criteria.Requirement": [...row.criteriaRequirement],
        "Criteria.Status": [...row.criteriaStatus],
        "Criteria.Reasoning": [...row.criteriaReasoning],
      }),
      Error: row.Error,
      Evaluations: columnsToEvaluations({
        "Evaluations.EvaluatorId": [...row.evaluationEvaluatorIds],
        "Evaluations.Name": [...row.evaluationNames],
        "Evaluations.Status": [...row.evaluationStatuses],
        "Evaluations.Required": [...row.evaluationRequired],
        "Evaluations.Passed": [...row.evaluationPassed],
        "Evaluations.Score": [...row.evaluationScores],
        "Evaluations.Label": [...row.evaluationLabels],
        "Evaluations.Details": [...row.evaluationDetails],
        "Evaluations.CostAmount": [...row.evaluationCostAmounts],
        "Evaluations.CostCurrency": [...row.evaluationCostCurrencies],
        "Evaluations.InputsJson": [...row.evaluationInputsJson],
      }),
      DurationMs: row.durationMs ? parseInt(row.durationMs, 10) : null,
      TotalCost: row.TotalCost ?? null,
      RoleCosts: copiedMap(row.RoleCosts),
      RoleLatencies: copiedMap(row.RoleLatencies),
      TraceMetrics: row.TraceMetricsJson ? JSON.parse(row.TraceMetricsJson) : {},
      StartedAt: millis(row.startedAtMs),
      QueuedAt: millis(row.queuedAtMs),
      CreatedAt: Number(row.createdAtMs),
      UpdatedAt: Number(row.updatedAtMs),
      FinishedAt: millis(row.finishedAtMs),
      ArchivedAt: millis(row.archivedAtMs),
      CancellationRequestedAt: millis(row.cancellationRequestedAtMs),
      LastSnapshotOccurredAt: Number(row.lastSnapshotOccurredAtMs ?? 0),
      LastEventOccurredAt: Number(row.lastEventOccurredAtMs ?? 0),
    };
  }

  private mapProjectionDataToClickHouseRecord({
    data,
    tenantId,
    projectionId,
    projectionVersion,
    scenarioRunId,
  }: {
    data: SimulationRunStateData;
    tenantId: string;
    projectionId: string;
    projectionVersion: string;
    scenarioRunId: string;
  }): ClickHouseSimulationRunWriteRecord {
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
      InconclusiveCriteria: data.InconclusiveCriteria,
      ...criteriaToColumns(data.Criteria ?? []),
      Error: data.Error,
      ...evaluationsToColumns(data.Evaluations),
      DurationMs: data.DurationMs?.toString() ?? null,
      TotalCost: data.TotalCost,
      RoleCosts: data.RoleCosts,
      RoleLatencies: data.RoleLatencies,
      TraceMetricsJson:
        Object.keys(data.TraceMetrics).length > 0 ? JSON.stringify(data.TraceMetrics) : "",
      StartedAt: new Date(data.StartedAt ?? data.CreatedAt),
      QueuedAt: data.QueuedAt != null ? new Date(data.QueuedAt) : null,
      CreatedAt: data.CreatedAt != null ? new Date(data.CreatedAt) : toDate(nowInstant()),
      UpdatedAt: new Date(data.UpdatedAt),
      FinishedAt: data.FinishedAt != null ? new Date(data.FinishedAt) : null,
      ArchivedAt: data.ArchivedAt != null ? new Date(data.ArchivedAt) : null,
      CancellationRequestedAt:
        data.CancellationRequestedAt != null ? new Date(data.CancellationRequestedAt) : null,
      LastSnapshotOccurredAt: data.LastSnapshotOccurredAt
        ? new Date(data.LastSnapshotOccurredAt)
        : new Date(0),
      LastEventOccurredAt: data.LastEventOccurredAt
        ? new Date(data.LastEventOccurredAt)
        : new Date(0),
      // Placeholder; storeProjection / storeProjectionBatch overwrite this with
      // the resolved retention (platform default when the tenant has none).
      _retention_days: this.options.defaultRetentionDays(),
    };
  }

  /**
   * The StartedAt bounds for a read within `window`: the row read to the window,
   * the latest-version lookup to the window widened by
   * {@link LATEST_VERSION_LOOKUP_MARGIN_MS}. No window, no bounds.
   */
  static startedAtBounds({ window }: { window: ReadTimeWindow | undefined }): StartedAtBounds {
    return startedAtBoundsOf({ window });
  }

  /**
   * A fold read-back carries the fold's read window (ADR-066), applied verbatim
   * with no fallback here: the fold executor retries a miss without the window.
   * Any other read takes the run's id index range once the index is ready, else every partition.
   */
  async findProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null> {
    EventUtils.validateTenantId(context, "SimulationRunStateRepositoryClickHouse.findProjection");

    const scenarioRunId = String(aggregateId);
    const window = context.readWindow;

    try {
      const row = window
        ? await queryWindowed<LatestRunRow | null>({
            table: TABLE_NAME,
            hintMs: (window.fromMs + window.toMs) / 2,
            windowMs: (window.toMs - window.fromMs) / 2,
            fallback: "none",
            isEmpty: (result) => result === null,
            run: (fragment) =>
              this.#findLatestRow({
                tenantId: context.tenantId,
                scenarioRunId,
                window: fragment ? window : undefined,
              }),
          })
        : await this.#findLatestRowById({ tenantId: context.tenantId, scenarioRunId });
      if (!row) return null;

      const projection: SimulationRunState = {
        id: row.ProjectionId,
        aggregateId: scenarioRunId,
        tenantId: createTenantId(context.tenantId),
        version: row.Version,
        data: this.mapLatestRowToProjectionData(row),
      };

      return projection as ProjectionType;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        { scenarioRunId, tenantId: context.tenantId, readWindow: window, error },
        "Failed to get projection from ClickHouse",
      );
      throw new StoreError({
        operation: "findProjection",
        store: "SimulationRunStateRepositoryClickHouse",
        message: `Failed to get projection for scenario run ${scenarioRunId}: ${errorMessage}`,
        category: classifyClickHouseError(error),
        context: { scenarioRunId },
        cause: error,
      });
    }
  }

  /**
   * The run's latest version: `UpdatedAt` equal to a scalar `max(UpdatedAt)` (PREWHERE-able for
   * the heavy columns; the IN form ran out of memory on runs with many snapshots). Windowed: both
   * reads bounded by StartedAt, the election wider. Unwindowed: both bounded by the run id index.
   */
  static latestRowRead(input: {
    tenantId: string;
    scenarioRunId: string;
    window: ReadTimeWindow | undefined;
    holds: (name: string) => boolean;
  }): ReaderReadStatement<LatestRunRow> {
    return latestRowReadOf(input);
  }

  async #findLatestRow({
    tenantId,
    scenarioRunId,
    window,
  }: {
    tenantId: string;
    scenarioRunId: string;
    window: ReadTimeWindow | undefined;
  }): Promise<LatestRunRow | null> {
    const client = await this.options.resolveClient(tenantId);
    const holds = await client.holds({ table: simulationRuns.$table.name });
    const { rows } = await client.read({
      statement: ClickHouseSimulationRunStateRepository.latestRowRead({
        tenantId,
        scenarioRunId,
        window,
        holds,
      }),
      table: simulationRuns.$table.name,
    });
    return rows[0] ?? null;
  }

  /** The run's latest row by id, bounded by the run id index once ready, else every partition. */
  async #findLatestRowById({
    tenantId,
    scenarioRunId,
  }: {
    tenantId: string;
    scenarioRunId: string;
  }): Promise<LatestRunRow | null> {
    const client = await this.options.resolveClient(tenantId);
    const holds = await client.holds({ table: simulationRuns.$table.name });
    const { rows } = await client.read({
      statement: ClickHouseSimulationRunStateRepository.latestRowRead({
        tenantId,
        scenarioRunId,
        window: undefined,
        holds,
      }),
      table: simulationRuns.$table.name,
      idBound: { fallback: "unbounded" },
    });
    return rows[0] ?? null;
  }

  async storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    EventUtils.validateTenantId(context, "SimulationRunStateRepositoryClickHouse.storeProjection");

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
      const scenarioRunId = String(projection.aggregateId);
      const projectionRecord = this.mapProjectionDataToClickHouseRecord({
        data: projection.data as SimulationRunStateData,
        tenantId: String(context.tenantId),
        projectionId: projection.id,
        projectionVersion: projection.version,
        scenarioRunId,
      });

      const retentionPolicy = context.metadata?.retentionPolicy as
        | { scenarios?: number | null }
        | undefined;
      projectionRecord._retention_days =
        retentionPolicy?.scenarios ?? this.options.defaultRetentionDays();

      const client = await this.options.resolveClient(context.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [projectionRecord],
        format: "JSONEachRow",
        // The fold reads this row back via `findProjection` on a state-store
        // miss, so the write must be visible before returning — without the
        // wait, the next event folds from empty and drops the run's identity
        // fields (ScenarioId, BatchRunId, ScenarioSetId) from set/batch listings.
        clickhouse_settings: {
          async_insert: 1,
          wait_for_async_insert: 1,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        {
          tenantId: context.tenantId,
          scenarioRunId: String(projection.aggregateId),
          projectionId: projection.id,
          error,
        },
        "Failed to store projection in ClickHouse",
      );
      throw new StoreError({
        operation: "storeProjection",
        store: "SimulationRunStateRepositoryClickHouse",
        message: `Failed to store projection ${projection.id} for scenario run ${projection.aggregateId}: ${errorMessage}`,
        category: classifyClickHouseError(error),
        context: {
          projectionId: projection.id,
          scenarioRunId: String(projection.aggregateId),
        },
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
      "SimulationRunStateRepositoryClickHouse.storeProjectionBatch",
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
        | { scenarios?: number | null }
        | undefined;
      const retentionDays = retentionPolicy?.scenarios ?? this.options.defaultRetentionDays();
      const records = projections.map((projection) => {
        const scenarioRunId = String(projection.aggregateId);
        const record = this.mapProjectionDataToClickHouseRecord({
          data: projection.data as SimulationRunStateData,
          tenantId: String(context.tenantId),
          projectionId: projection.id,
          projectionVersion: projection.version,
          scenarioRunId,
        });
        record._retention_days = retentionDays;
        return record;
      });

      const client = await this.options.resolveClient(context.tenantId);
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
          error,
        },
        "Failed to batch store simulation projections in ClickHouse",
      );
      throw new StoreError({
        operation: "storeProjectionBatch",
        store: "SimulationRunStateRepositoryClickHouse",
        message: `Failed to batch store ${projections.length} projections: ${errorMessage}`,
        category: classifyClickHouseError(error),
        context: { count: projections.length },
        cause: error,
      });
    }
  }
}

export { ClickHouseSimulationRunStateRepository as SimulationRunStateRepositoryClickHouse };

/** A role map as the projection holds it: its arrays copied out of the read-only row. */
function copiedMap(
  map: Readonly<Record<string, readonly number[]>> | null | undefined,
): Record<string, number[]> {
  return Object.fromEntries(Object.entries(map ?? {}).map(([key, values]) => [key, [...values]]));
}

/** See {@link ClickHouseSimulationRunStateRepository.startedAtBounds}. */
function startedAtBoundsOf({ window }: { window: ReadTimeWindow | undefined }): StartedAtBounds {
  if (!window) return { kind: "unbounded" };

  return {
    kind: "bounded",
    row: { fromMs: Math.floor(window.fromMs), toMs: Math.ceil(window.toMs) },
    latestVersion: {
      fromMs: Math.floor(window.fromMs - LATEST_VERSION_LOOKUP_MARGIN_MS),
      toMs: Math.ceil(window.toMs + LATEST_VERSION_LOOKUP_MARGIN_MS),
    },
  };
}

function latestRowReadOf({
  tenantId,
  scenarioRunId,
  window,
  holds,
}: {
  tenantId: string;
  scenarioRunId: string;
  window: ReadTimeWindow | undefined;
  holds: (name: string) => boolean;
}) {
  const t = simulationRuns;
  const bounds = startedAtBoundsOf({ window });
  const held = (of: ColumnRef<typeof simulationRuns.$table.name, string, readonly string[]>) =>
    fn.heldOr(of, { holds, otherwise: fn.emptyArrayAs(column.array(column.string())) });
  return clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(t)
    .select({
      ProjectionId: t.ProjectionId,
      TenantId: t.TenantId,
      ScenarioRunId: t.ScenarioRunId,
      ScenarioId: t.ScenarioId,
      BatchRunId: t.BatchRunId,
      ScenarioSetId: t.ScenarioSetId,
      Version: t.Version,
      Status: t.Status,
      Name: t.Name,
      Description: t.Description,
      Metadata: t.Metadata,
      messageIds: t["Messages.Id"],
      messageRoles: t["Messages.Role"],
      messageContents: t["Messages.Content"],
      messageTraceIds: t["Messages.TraceId"],
      messageRests: t["Messages.Rest"],
      TraceIds: t.TraceIds,
      Verdict: t.Verdict,
      Reasoning: t.Reasoning,
      MetCriteria: t.MetCriteria,
      UnmetCriteria: t.UnmetCriteria,
      InconclusiveCriteria: t.InconclusiveCriteria,
      criteriaCriterion: held(t["Criteria.Criterion"]),
      criteriaRequirement: held(t["Criteria.Requirement"]),
      criteriaStatus: fn.heldOr(t["Criteria.Status"], {
        holds,
        otherwise: fn.emptyArrayAs(column.array(column.lowCardinality(column.string()))),
      }),
      criteriaReasoning: held(t["Criteria.Reasoning"]),
      Error: t.Error,
      evaluationEvaluatorIds: t["Evaluations.EvaluatorId"],
      evaluationNames: t["Evaluations.Name"],
      evaluationStatuses: t["Evaluations.Status"],
      evaluationRequired: t["Evaluations.Required"],
      evaluationPassed: t["Evaluations.Passed"],
      evaluationScores: t["Evaluations.Score"],
      evaluationLabels: t["Evaluations.Label"],
      evaluationDetails: t["Evaluations.Details"],
      evaluationCostAmounts: t["Evaluations.CostAmount"],
      evaluationCostCurrencies: t["Evaluations.CostCurrency"],
      evaluationInputsJson: t["Evaluations.InputsJson"],
      durationMs: fn.toString(t.DurationMs),
      TotalCost: t.TotalCost,
      RoleCosts: t.RoleCosts,
      RoleLatencies: t.RoleLatencies,
      TraceMetricsJson: t.TraceMetricsJson,
      startedAtMs: fn.toUnixTimestamp64Milli(t.StartedAt),
      queuedAtMs: fn.toUnixTimestamp64Milli(t.QueuedAt),
      createdAtMs: fn.toUnixTimestamp64Milli(t.CreatedAt),
      updatedAtMs: fn.toUnixTimestamp64Milli(t.UpdatedAt),
      finishedAtMs: fn.toUnixTimestamp64Milli(t.FinishedAt),
      archivedAtMs: fn.toUnixTimestamp64Milli(t.ArchivedAt),
      cancellationRequestedAtMs: fn.toUnixTimestamp64Milli(t.CancellationRequestedAt),
      lastSnapshotOccurredAtMs: fn.toUnixTimestamp64Milli(t.LastSnapshotOccurredAt),
      lastEventOccurredAtMs: fn.toUnixTimestamp64Milli(t.LastEventOccurredAt),
    })
    .where(({ and, eq, gte, lte, idBound, scalar }) => {
      const latest = scalar((sub) =>
        sub
          .from(t)
          .select({ latestUpdatedAt: fn.max(t.UpdatedAt) })
          .where((inner) =>
            bounds.kind === "bounded"
              ? inner.and(
                  inner.eq(t.ScenarioRunId, scenarioRunId),
                  inner.gte(t.StartedAt, bounds.latestVersion.fromMs),
                  inner.lte(t.StartedAt, bounds.latestVersion.toMs),
                )
              : inner.idBound(t.ScenarioRunId, scenarioRunId),
          ),
      );
      // A fold read-back's own window, applied verbatim (ADR-066): no id bound.
      return bounds.kind === "bounded"
        ? and(
            eq(t.ScenarioRunId, scenarioRunId),
            gte(t.StartedAt, bounds.row.fromMs),
            lte(t.StartedAt, bounds.row.toMs),
            eq(t.UpdatedAt, latest),
          )
        : and(idBound(t.ScenarioRunId, scenarioRunId), eq(t.UpdatedAt, latest));
    })
    .limit(1)
    .build();
}
