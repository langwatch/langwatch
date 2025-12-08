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
import { createTenantId, EventUtils } from "../../../library";
import type {
  TraceProjection,
  TraceProjectionData,
} from "../projections/traceAggregationStateProjection";
import type { TraceAggregationStateProjectionRepository } from "./traceAggregationStateProjectionRepository";

const TABLE_NAME = "trace_projections" as const;

/**
 * ClickHouse record matching the trace_projections table schema.
 * Version is stored as DateTime64(9) in ClickHouse (nanoseconds since epoch).
 */
interface ClickHouseProjectionRecord {
  Id: string;
  TenantId: string;
  TraceId: string;
  Version: string; // DateTime64(9) as string in ClickHouse format
  IOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  ComputedMetadata: Record<string, string>;
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TotalDurationMs: number;
  TokensPerSecond: number | null;
  SpanCount: number;
  ContainsErrorStatus: boolean;
  ContainsOKStatus: boolean;
  Models: string[];
  TopicId: string | null;
  SubTopicId: string | null;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  HasAnnotation: boolean | null;
  CreatedAt: string; // DateTime64(9) as string
  LastUpdatedAt: string; // DateTime64(9) as string
}

/**
 * Converts a Unix timestamp in milliseconds to ClickHouse DateTime64(9) string format.
 * DateTime64(9) stores nanoseconds since epoch, so we multiply by 1,000,000.
 */
function timestampToDateTime64(timestampMs: number): string {
  const timestampNs = BigInt(timestampMs) * BigInt(1_000_000);
  return timestampNs.toString();
}

/**
 * Converts a ClickHouse DateTime64(9) string to Unix timestamp in milliseconds.
 */
function dateTime64ToTimestamp(dateTime64: string): number {
  const timestampNs = BigInt(dateTime64);
  return Number(timestampNs / BigInt(1_000_000));
}

/**
 * ClickHouse projection repository for trace projections.
 * Stores trace metrics in ClickHouse matching the trace_projections table schema.
 * Uses ReplacingMergeTree with Version to keep the latest projection per trace.
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
   * Maps a ClickHouse record to projection data.
   */
  private mapClickHouseRecordToProjectionData(
    record: ClickHouseProjectionRecord,
  ): TraceProjectionData {
    return {
      TraceId: record.TraceId,
      SpanCount: record.SpanCount,
      TotalDurationMs: record.TotalDurationMs,
      IOSchemaVersion: record.IOSchemaVersion,
      ComputedInput: record.ComputedInput,
      ComputedOutput: record.ComputedOutput,
      ComputedMetadata: record.ComputedMetadata,
      TimeToFirstTokenMs: record.TimeToFirstTokenMs,
      TimeToLastTokenMs: record.TimeToLastTokenMs,
      TokensPerSecond: record.TokensPerSecond,
      ContainsErrorStatus: record.ContainsErrorStatus,
      ContainsOKStatus: record.ContainsOKStatus,
      Models: record.Models,
      TopicId: record.TopicId,
      SubTopicId: record.SubTopicId,
      TotalPromptTokenCount: record.TotalPromptTokenCount,
      TotalCompletionTokenCount: record.TotalCompletionTokenCount,
      HasAnnotation: record.HasAnnotation,
      CreatedAt: dateTime64ToTimestamp(record.CreatedAt),
      LastUpdatedAt: dateTime64ToTimestamp(record.LastUpdatedAt),
    };
  }

  /**
   * Maps projection data to a ClickHouse record.
   */
  private mapProjectionDataToClickHouseRecord(
    data: TraceProjectionData,
    tenantId: string,
    traceId: string,
    projectionId: string,
    projectionVersion: number,
  ): ClickHouseProjectionRecord {
    return {
      Id: projectionId,
      TenantId: tenantId,
      TraceId: traceId,
      Version: timestampToDateTime64(projectionVersion),
      IOSchemaVersion: data.IOSchemaVersion,
      ComputedInput: data.ComputedInput,
      ComputedOutput: data.ComputedOutput,
      ComputedMetadata: data.ComputedMetadata,
      TimeToFirstTokenMs: data.TimeToFirstTokenMs,
      TimeToLastTokenMs: data.TimeToLastTokenMs,
      TotalDurationMs: data.TotalDurationMs,
      TokensPerSecond: data.TokensPerSecond,
      SpanCount: data.SpanCount,
      ContainsErrorStatus: data.ContainsErrorStatus,
      ContainsOKStatus: data.ContainsOKStatus,
      Models: data.Models,
      TopicId: data.TopicId,
      SubTopicId: data.SubTopicId,
      TotalPromptTokenCount: data.TotalPromptTokenCount,
      TotalCompletionTokenCount: data.TotalCompletionTokenCount,
      HasAnnotation: data.HasAnnotation,
      CreatedAt: timestampToDateTime64(data.CreatedAt),
      LastUpdatedAt: timestampToDateTime64(data.LastUpdatedAt),
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

        // aggregateId is the traceId in this pipeline
        const traceId = String(aggregateId);

        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                Id,
                TenantId,
                TraceId,
                Version,
                IOSchemaVersion,
                ComputedInput,
                ComputedOutput,
                ComputedMetadata,
                TimeToFirstTokenMs,
                TimeToLastTokenMs,
                TotalDurationMs,
                TokensPerSecond,
                SpanCount,
                ContainsErrorStatus,
                ContainsOKStatus,
                Models,
                TopicId,
                SubTopicId,
                TotalPromptTokenCount,
                TotalCompletionTokenCount,
                HasAnnotation,
                CreatedAt,
                LastUpdatedAt
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
              ORDER BY Version DESC
              LIMIT 1
            `,
            query_params: {
              tenantId: context.tenantId,
              traceId: traceId,
            },
            format: "JSONEachRow",
          });

          const rows = await result.json<ClickHouseProjectionRecord>();
          const row = rows[0];
          if (!row) {
            return null;
          }

          const projectionData = this.mapClickHouseRecordToProjectionData(row);

          const projection: TraceProjection = {
            id: row.Id,
            aggregateId: traceId,
            tenantId: createTenantId(context.tenantId),
            version: dateTime64ToTimestamp(row.Version),
            data: projectionData,
          };

          return projection as ProjectionType;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(
            {
              traceId: traceId,
              tenantId: context.tenantId,
              error: errorMessage,
            },
            "Failed to get projection from ClickHouse",
          );
          throw new StoreError(
            "getProjection",
            "TraceAggregationStateProjectionRepositoryClickHouse",
            `Failed to get projection for trace ${traceId}: ${errorMessage}`,
            ErrorCategory.CRITICAL,
            { traceId },
            error,
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
          throw new ValidationError(
            "Invalid projection: projection must have id, aggregateId, tenantId, version, and data",
            "projection",
            projection,
          );
        }

        // Validate that projection tenantId matches context tenantId
        if (projection.tenantId !== context.tenantId) {
          throw new SecurityError(
            "storeProjection",
            `Projection has tenantId '${projection.tenantId}' that does not match context tenantId '${context.tenantId}'`,
            projection.tenantId,
            { contextTenantId: context.tenantId },
          );
        }

        try {
          const traceId = String(projection.aggregateId);
          const projectionRecord = this.mapProjectionDataToClickHouseRecord(
            projection.data as TraceProjectionData,
            String(context.tenantId),
            traceId,
            projection.id,
            projection.version,
          );

          // Use INSERT - ReplacingMergeTree will automatically keep the row with highest Version
          // when merging occurs. The ORDER BY key is (TenantId, TraceId, Version) to ensure idempotency.
          await this.clickHouseClient.insert({
            table: TABLE_NAME,
            values: [projectionRecord],
            format: "JSONEachRow",
          });

          this.logger.debug(
            {
              tenantId: context.tenantId,
              traceId: traceId,
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
              traceId: String(projection.aggregateId),
              projectionId: projection.id,
              error: errorMessage,
            },
            "Failed to store projection in ClickHouse",
          );
          throw new StoreError(
            "storeProjection",
            "TraceAggregationStateProjectionRepositoryClickHouse",
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
