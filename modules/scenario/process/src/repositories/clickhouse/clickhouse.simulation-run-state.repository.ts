import { ClickHouseColumns, queryWindowed } from "@langwatch/clickhouse-client";
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
  EVALUATION_COLUMNS_SQL,
  evaluationsToColumns,
} from "../../rules/simulation-evaluation-columns.rules.ts";
import type { SimulationRunStateRepository } from "../simulation-run-state.repository.ts";
import { type SimulationEventingClickHouseResolver } from "./clickhouse.simulation-session.store.ts";
import {
  type ClickHouseCriteriaColumns,
  columnsToCriteria,
  CRITERIA_COLUMNS,
  criteriaToColumns,
} from "./simulation-criteria.mapper.ts";

const TABLE_NAME = "simulation_runs" as const;

/**
 * How far the latest-version lookup reaches past the row window. StartedAt moves
 * (hours, until the run starts), so a latest version just outside the row window
 * still wins the lookup and the read answers empty, never an older version.
 */
export const LATEST_VERSION_LOOKUP_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

/** The StartedAt predicates of a run-state read, and their params. */
interface StartedAtBounds {
  /** For the row read (alias `t`). */
  row: string;
  /** For the latest-version lookup (alias `s`). */
  latestVersion: string;
  params: Record<string, number>;
}

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
      InconclusiveCriteria: record.InconclusiveCriteria ?? [],
      Criteria: columnsToCriteria(record),
      Error: record.Error,
      Evaluations: columnsToEvaluations(record),
      DurationMs: record.DurationMs ? parseInt(record.DurationMs, 10) : null,
      TotalCost: record.TotalCost ?? null,
      RoleCosts: record.RoleCosts ?? {},
      RoleLatencies: record.RoleLatencies ?? {},
      TraceMetrics: record.TraceMetricsJson ? JSON.parse(record.TraceMetricsJson) : {},
      StartedAt: record.StartedAt === null ? null : Number(record.StartedAt),
      QueuedAt:
        record.QueuedAt === null || record.QueuedAt === undefined ? null : Number(record.QueuedAt),
      CreatedAt: Number(record.CreatedAt),
      UpdatedAt: Number(record.UpdatedAt),
      FinishedAt: record.FinishedAt === null ? null : Number(record.FinishedAt),
      ArchivedAt: record.ArchivedAt === null ? null : Number(record.ArchivedAt),
      CancellationRequestedAt:
        record.CancellationRequestedAt === null || record.CancellationRequestedAt === undefined
          ? null
          : Number(record.CancellationRequestedAt),
      LastSnapshotOccurredAt: Number(record.LastSnapshotOccurredAt ?? 0),
      LastEventOccurredAt: Number(record.LastEventOccurredAt ?? 0),
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
    if (!window) return { row: "", latestVersion: "", params: {} };

    return {
      row:
        "AND t.StartedAt >= fromUnixTimestamp64Milli({fromMs:Int64}) " +
        "AND t.StartedAt <= fromUnixTimestamp64Milli({toMs:Int64})",
      latestVersion:
        "AND s.StartedAt >= fromUnixTimestamp64Milli({lookupFromMs:Int64}) " +
        "AND s.StartedAt <= fromUnixTimestamp64Milli({lookupToMs:Int64})",
      params: {
        fromMs: Math.floor(window.fromMs),
        toMs: Math.ceil(window.toMs),
        lookupFromMs: Math.floor(window.fromMs - LATEST_VERSION_LOOKUP_MARGIN_MS),
        lookupToMs: Math.ceil(window.toMs + LATEST_VERSION_LOOKUP_MARGIN_MS),
      },
    };
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
        ? await queryWindowed<ClickHouseSimulationRunRecord | null>({
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
        data: this.mapClickHouseRecordToProjectionData(row),
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

  async #findLatestRow({
    tenantId,
    scenarioRunId,
    window,
  }: {
    tenantId: string;
    scenarioRunId: string;
    window: ReadTimeWindow | undefined;
  }): Promise<ClickHouseSimulationRunRecord | null> {
    const bounds = ClickHouseSimulationRunStateRepository.startedAtBounds({ window });
    const client = await this.options.resolveClient(tenantId);
    const columns = await this.#latestRowColumns(client);
    // Latest-version read via scalar equality on UpdatedAt (PREWHERE-able for heavy columns).
    // IN-tuple form causes OOM on runs with many snapshots; scalar is better for single-row gets.
    const result = await client.query({
      // ID_BOUND_SKIP: a fold read-back's own window, applied verbatim (ADR-066).
      query: `
          SELECT ${columns}
          FROM ${TABLE_NAME} AS t
          WHERE t.TenantId = {tenantId:String}
            AND t.ScenarioRunId = {scenarioRunId:String}
            ${bounds.row}
            AND t.UpdatedAt = (
              SELECT max(s.UpdatedAt)
              FROM ${TABLE_NAME} AS s
              WHERE s.TenantId = {tenantId:String}
                AND s.ScenarioRunId = {scenarioRunId:String}
                ${bounds.latestVersion}
            )
          LIMIT 1
        `,
      query_params: { tenantId, scenarioRunId, ...bounds.params },
      format: "JSONEachRow",
    });
    const rows = await result.json<ClickHouseSimulationRunRecord>();
    return rows[0] ?? null;
  }

  /** The run's latest row by id, bounded by the run id index once ready, else every partition. */
  async #findLatestRowById({
    tenantId,
    scenarioRunId,
  }: {
    tenantId: string;
    scenarioRunId: string;
  }): Promise<ClickHouseSimulationRunRecord | null> {
    const client = await this.options.resolveClient(tenantId);
    const columns = await this.#latestRowColumns(client);
    const result = await client.query({
      query: `
          SELECT ${columns}
          FROM ${TABLE_NAME} AS t
          WHERE t.TenantId = {tenantId:String}
            AND t.ScenarioRunId = {scenarioRunId:String}
            {{idBound:simulation_runs.ScenarioRunId:scenarioRunId:t}}
            AND t.UpdatedAt = (
              SELECT max(s.UpdatedAt)
              FROM ${TABLE_NAME} AS s
              WHERE s.TenantId = {tenantId:String}
                AND s.ScenarioRunId = {scenarioRunId:String}
                {{idBound:simulation_runs.ScenarioRunId:scenarioRunId:s}}
            )
          LIMIT 1
        `,
      query_params: { tenantId, scenarioRunId },
      format: "JSONEachRow",
      idBound: { fallback: "unbounded" },
    });
    const rows = await result.json<ClickHouseSimulationRunRecord>();
    return rows[0] ?? null;
  }

  /** The latest-row select list, criteria columns named as this tenant's target holds them. */
  async #latestRowColumns(
    client: Awaited<ReturnType<SimulationClickHouseClientResolver>>,
  ): Promise<string> {
    const input = { table: TABLE_NAME, alias: "t", columns: CRITERIA_COLUMNS };
    const criteria = (await client.select?.(input)) ?? ClickHouseColumns.named(input);
    return `
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
            t.InconclusiveCriteria AS InconclusiveCriteria,
            ${criteria},
            t.Error AS Error,
            ${EVALUATION_COLUMNS_SQL.replaceAll("`Evaluations.", "t.`Evaluations.")},
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
            toUnixTimestamp64Milli(t.LastEventOccurredAt) AS LastEventOccurredAt`;
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
