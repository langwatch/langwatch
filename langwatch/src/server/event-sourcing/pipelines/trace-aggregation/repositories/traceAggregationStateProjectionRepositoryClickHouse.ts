import { type ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type {
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import type { Projection } from "../../../library";
import { EventUtils, createTenantId } from "../../../library";
import { createLogger } from "../../../../../utils/logger";
import type { TraceAggregationStateProjectionRepository } from "./traceAggregationStateProjectionRepository";
import type { TraceAggregationStateProjectionData } from "../projections/traceAggregationStateProjection";
import type { TraceAggregationStateProjection } from "../projections/traceAggregationStateProjection";

const TABLE_NAME = "trace_aggregation_projections" as const;

const VALID_AGGREGATION_STATUSES = [
  "idle",
  "in_progress",
  "completed",
] as const satisfies readonly TraceAggregationStateProjectionData["aggregationStatus"][];

interface ClickHouseProjectionRecord {
  TenantId: string;
  AggregateId: string;
  ProjectionId: string;
  ProjectionVersion: number;
  // Projection status fields
  AggregationStatus: TraceAggregationStateProjectionData["aggregationStatus"];
  StartedAt: number | null;
  CompletedAt: number | null;
  // Aggregated trace data fields (from TraceAggregationCompletedEventData)
  TraceId: string | null;
  SpanIds: string[] | null;
  TotalSpans: number;
  StartTimeUnixMs: number | null;
  EndTimeUnixMs: number | null;
  DurationMs: number | null;
  ServiceNames: string[] | null;
  RootSpanId: string | null;
  // Metadata fields
  UpdatedAt: number;
}

/**
 * ClickHouse projection repository for trace aggregation state.
 * Stores projections in ClickHouse for persistence and scalability.
 *
 * The `getProjection` method uses `ORDER BY TotalSpans DESC` to select the row
 * with the highest span count, ensuring we get the most complete aggregation even
 * before background merges complete. The ReplacingMergeTree will eventually merge
 * duplicate rows, keeping only the one with the highest TotalSpans value.
 */
export class TraceAggregationStateProjectionRepositoryClickHouse<
  ProjectionType extends Projection = Projection,
> implements TraceAggregationStateProjectionRepository<ProjectionType>
{
  tracer = getLangWatchTracer(
    "langwatch.trace-aggregation-state-projection-repository.clickhouse",
  );
  logger = createLogger(
    "langwatch:trace-aggregation-state-projection-repository:clickhouse",
  );

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  /**
   * Validates that a value is a valid aggregation status.
   */
  private isValidAggregationStatus(
    value: unknown,
  ): value is TraceAggregationStateProjectionData["aggregationStatus"] {
    return (
      typeof value === "string" &&
      VALID_AGGREGATION_STATUSES.includes(
        value as TraceAggregationStateProjectionData["aggregationStatus"],
      )
    );
  }

  /**
   * Maps a ClickHouse record to projection data.
   */
  private mapClickHouseRecordToProjectionData(
    record: ClickHouseProjectionRecord,
  ): TraceAggregationStateProjectionData {
    if (!this.isValidAggregationStatus(record.AggregationStatus)) {
      throw new Error(
        `[CORRUPTED_DATA] Invalid aggregationStatus value: ${String(
          record.AggregationStatus,
        )}`,
      );
    }

    return {
      aggregationStatus: record.AggregationStatus,
      startedAt: record.StartedAt ?? undefined,
      completedAt: record.CompletedAt ?? undefined,
      traceId: record.TraceId ?? undefined,
      spanIds: record.SpanIds?.length ? record.SpanIds : undefined,
      totalSpans: record.TotalSpans > 0 ? record.TotalSpans : undefined,
      startTimeUnixMs: record.StartTimeUnixMs ?? undefined,
      endTimeUnixMs: record.EndTimeUnixMs ?? undefined,
      durationMs: record.DurationMs ?? undefined,
      serviceNames: record.ServiceNames?.length
        ? record.ServiceNames
        : undefined,
      rootSpanId: record.RootSpanId ?? undefined,
    };
  }

  /**
   * Maps projection data to a ClickHouse record.
   */
  private mapProjectionDataToClickHouseRecord(
    data: TraceAggregationStateProjectionData,
    tenantId: string,
    aggregateId: string,
    projectionId: string,
    projectionVersion: number,
  ): ClickHouseProjectionRecord {
    return {
      TenantId: tenantId,
      AggregateId: aggregateId,
      ProjectionId: projectionId,
      ProjectionVersion: projectionVersion,
      AggregationStatus: data.aggregationStatus,
      StartedAt: data.startedAt ?? null,
      CompletedAt: data.completedAt ?? null,
      TraceId: data.traceId ?? null,
      SpanIds: data.spanIds ?? null,
      TotalSpans: data.totalSpans ?? 0,
      StartTimeUnixMs: data.startTimeUnixMs ?? null,
      EndTimeUnixMs: data.endTimeUnixMs ?? null,
      DurationMs: data.durationMs ?? null,
      ServiceNames: data.serviceNames ?? null,
      RootSpanId: data.rootSpanId ?? null,
      UpdatedAt: Date.now(),
    };
  }

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null> {
    return await this.tracer.withActiveSpan(
      "TraceAggregationStateProjectionRepositoryClickHouse.getProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": aggregateId,
          "tenant.id": context.tenantId,
        },
      },
      async () => {
        // Validate tenant context
        EventUtils.validateTenantId(
          context,
          "TraceAggregationStateProjectionRepositoryClickHouse.getProjection",
        );

        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                ProjectionId,
                ProjectionVersion,
                AggregationStatus,
                StartedAt,
                CompletedAt,
                TraceId,
                SpanIds,
                TotalSpans,
                StartTimeUnixMs,
                EndTimeUnixMs,
                DurationMs,
                ServiceNames,
                RootSpanId,
                UpdatedAt
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND AggregateId = {aggregateId:String}
              ORDER BY TotalSpans DESC
              LIMIT 1
            `,
            query_params: {
              tenantId: context.tenantId,
              aggregateId: String(aggregateId),
            },
            format: "JSONEachRow",
          });

          const rows = await result.json<ClickHouseProjectionRecord>();
          const row = rows[0];
          if (!row) {
            return null;
          }

          const projectionData = this.mapClickHouseRecordToProjectionData(row);

          const projection: TraceAggregationStateProjection = {
            id: row.ProjectionId,
            aggregateId: String(aggregateId),
            tenantId: createTenantId(context.tenantId),
            version: row.ProjectionVersion,
            data: projectionData,
          };

          return projection as ProjectionType;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            {
              aggregateId: String(aggregateId),
              tenantId: context.tenantId,
              error: errorMessage,
            },
            "Failed to get projection from ClickHouse",
          );
          throw new Error(
            `Failed to get projection for aggregate ${String(
              aggregateId,
            )}: ${errorMessage}`,
            { cause: error },
          );
        }
      },
    );
  }

  async storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "TraceAggregationStateProjectionRepositoryClickHouse.storeProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": projection.aggregateId,
          "tenant.id": context.tenantId,
        },
      },
      async () => {
        // Validate tenant context
        EventUtils.validateTenantId(
          context,
          "TraceAggregationStateProjectionRepositoryClickHouse.storeProjection",
        );

        // Validate projection
        if (!EventUtils.isValidProjection(projection)) {
          throw new Error(
            "[VALIDATION] Invalid projection: projection must have id, aggregateId, tenantId, version, and data",
          );
        }

        // Validate that projection tenantId matches context tenantId
        if (projection.tenantId !== context.tenantId) {
          throw new Error(
            `[SECURITY] Projection has tenantId '${projection.tenantId}' that does not match context tenantId '${context.tenantId}'`,
          );
        }

        try {
          const projectionRecord = this.mapProjectionDataToClickHouseRecord(
            projection.data as TraceAggregationStateProjectionData,
            String(context.tenantId),
            String(projection.aggregateId),
            projection.id,
            projection.version,
          );

          // Use INSERT - ReplacingMergeTree will automatically keep the row with highest TotalSpans
          // when merging occurs. The ORDER BY key is (TenantId, AggregateId) to ensure idempotency.
          await this.clickHouseClient.insert({
            table: TABLE_NAME,
            values: [projectionRecord],
            format: "JSONEachRow",
          });

          this.logger.debug(
            {
              tenantId: context.tenantId,
              aggregateId: projection.aggregateId,
              projectionId: projection.id,
            },
            "Stored projection to ClickHouse",
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            {
              tenantId: context.tenantId,
              aggregateId: projection.aggregateId,
              projectionId: projection.id,
              error: errorMessage,
            },
            "Failed to store projection in ClickHouse",
          );
          throw new Error(
            `Failed to store projection ${projection.id} for aggregate ${projection.aggregateId}: ${errorMessage}`,
            { cause: error },
          );
        }
      },
    );
  }
}
