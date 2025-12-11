import type { ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import {
  ErrorCategory,
  SecurityError,
  StoreError,
  ValidationError,
} from "~/server/event-sourcing/library/services/errorHandling";
import { createLogger } from "../../../../../utils/logger";
import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import { EventUtils } from "../../../library";
import type {
  DailyTraceCount,
  DailyTraceCountData,
} from "../projections/dailyTraceCountProjection";
import type { DailyTraceCountRepository } from "./dailyTraceCountRepository";

const TABLE_NAME = "daily_trace_counts" as const;

/**
 * Converts a timestamp to DateTime64(9) format (nanoseconds as string).
 */
function timestampToDateTime64(timestampMs: number): string {
  const timestampNs = BigInt(timestampMs) * BigInt(1_000_000);
  return timestampNs.toString();
}

/**
 * ClickHouse repository for daily trace counts.
 * Uses AggregatingMergeTree with uniqState for idempotent unique counting.
 */
export class DailyTraceCountRepositoryClickHouse<
  ProjectionType extends Projection = Projection,
> implements DailyTraceCountRepository<ProjectionType>
{
  tracer = getLangWatchTracer(
    "langwatch.trace-processing.daily-trace-count-repository",
  );
  logger = createLogger(
    "langwatch:trace-processing:daily-trace-count-repository",
  );

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  /**
   * Returns null as daily trace counts are aggregated and not retrieved per trace.
   * Use a direct ClickHouse query to get aggregated counts.
   */
  async getProjection(
    _aggregateId: string,
    _context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null> {
    // Daily trace counts are aggregated - individual projections are not retrieved
    return null;
  }

  async storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "DailyTraceCountRepositoryClickHouse.storeProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": projection.aggregateId,
          "tenant.id": context.tenantId,
        },
      },
      async () => {
        EventUtils.validateTenantId(
          context,
          "DailyTraceCountRepositoryClickHouse.storeProjection",
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
          const data = projection.data as DailyTraceCountData;

          // Use INSERT ... SELECT with uniqState to aggregate trace IDs
          await this.clickHouseClient.query({
            query: `
              INSERT INTO ${TABLE_NAME} (TenantId, DateUtc, TraceCount, LastUpdatedAt)
              SELECT
                {tenantId:String} AS TenantId,
                {dateUtc:Date} AS DateUtc,
                uniqState({traceId:String}) AS TraceCount,
                {lastUpdatedAt:DateTime64(9)} AS LastUpdatedAt
            `,
            query_params: {
              tenantId: String(context.tenantId),
              dateUtc: data.DateUtc,
              traceId: data.TraceId,
              lastUpdatedAt: timestampToDateTime64(data.LastUpdatedAt),
            },
          });

          this.logger.debug(
            {
              tenantId: context.tenantId,
              traceId: data.TraceId,
              dateUtc: data.DateUtc,
              projectionId: projection.id,
            },
            "Stored daily trace count projection to ClickHouse",
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            {
              tenantId: context.tenantId,
              traceId: String(projection.aggregateId),
              projectionId: projection.id,
              error: errorMessage,
            },
            "Failed to store daily trace count projection in ClickHouse",
          );
          throw new StoreError(
            "storeProjection",
            "DailyTraceCountRepositoryClickHouse",
            `Failed to store projection ${projection.id} for trace ${projection.aggregateId}: ${errorMessage}`,
            ErrorCategory.CRITICAL,
            {
              projectionId: projection.id,
              traceId: String(projection.aggregateId),
            },
            error,
          );
        }
      },
    );
  }
}
