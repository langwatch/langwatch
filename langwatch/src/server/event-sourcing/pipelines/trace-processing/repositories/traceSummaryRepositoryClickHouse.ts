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
  TraceSummary,
  TraceSummaryData,
} from "../projections/traceSummaryProjection";
import type { TraceSummaryRepository } from "./traceSummaryRepository";

const TABLE_NAME = "trace_summaries" as const;

/**
 * ClickHouse record matching the trace_summaries table schema exactly.
 */
interface ClickHouseSummaryRecord {
  Id: string;
  TenantId: string;
  TraceId: string;
  Version: string;
  Attributes: Record<string, string>;

  CreatedAt: string; // DateTime64(3) - millisecond precision
  LastUpdatedAt: string;

  // I/O
  ComputedIOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;

  // Timing
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TotalDurationMs: number;
  TokensPerSecond: number | null;
  SpanCount: number;

  // Status
  ContainsErrorStatus: boolean;
  ContainsOKStatus: boolean;
  ErrorMessage: string | null;
  Models: string[];

  // Cost
  TotalCost: number | null;
  TokensEstimated: boolean;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;

  // Trace intelligence
  TopicId: string | null;
  SubTopicId: string | null;
  HasAnnotation: boolean | null;
}

/**
 * Converts a Unix millisecond timestamp to ClickHouse DateTime64(3) format.
 * DateTime64(3) expects milliseconds since epoch.
 *
 * @param timestampMs - Unix timestamp in milliseconds
 * @returns Millisecond timestamp as string for ClickHouse DateTime64(3)
 */
function timestampToDateTime64(timestampMs: number): string {
  // DateTime64(3) uses milliseconds precision
  return timestampMs.toString();
}

/**
 * Converts a ClickHouse DateTime64(3) string to Unix millisecond timestamp.
 *
 * @param dateTime64 - Millisecond timestamp string from ClickHouse DateTime64(3)
 * @returns Unix timestamp in milliseconds
 */
function dateTime64ToTimestamp(dateTime64: string): number {
  return parseInt(dateTime64, 10);
}

/**
 * ClickHouse repository for trace summaries.
 */
export class TraceSummaryRepositoryClickHouse<
  ProjectionType extends Projection = Projection,
> implements TraceSummaryRepository<ProjectionType>
{
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.trace-summary-repository"
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:trace-summary-repository"
  );

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  private mapClickHouseRecordToProjectionData(
    record: ClickHouseSummaryRecord
  ): TraceSummaryData {
    return {
      TraceId: record.TraceId,
      SpanCount: record.SpanCount,
      TotalDurationMs: record.TotalDurationMs,

      ComputedIOSchemaVersion: record.ComputedIOSchemaVersion,
      ComputedInput: record.ComputedInput,
      ComputedOutput: record.ComputedOutput,

      TimeToFirstTokenMs: record.TimeToFirstTokenMs,
      TimeToLastTokenMs: record.TimeToLastTokenMs,
      TokensPerSecond: record.TokensPerSecond,

      ContainsErrorStatus: record.ContainsErrorStatus,
      ContainsOKStatus: record.ContainsOKStatus,
      ErrorMessage: record.ErrorMessage,
      Models: record.Models,

      TotalCost: record.TotalCost,
      TokensEstimated: record.TokensEstimated,
      TotalPromptTokenCount: record.TotalPromptTokenCount,
      TotalCompletionTokenCount: record.TotalCompletionTokenCount,

      TopicId: record.TopicId,
      SubTopicId: record.SubTopicId,
      HasAnnotation: record.HasAnnotation,

      Attributes: record.Attributes ?? {},

      CreatedAt: dateTime64ToTimestamp(record.CreatedAt),
      LastUpdatedAt: dateTime64ToTimestamp(record.LastUpdatedAt),
    };
  }

  private mapProjectionDataToClickHouseRecord(
    data: TraceSummaryData,
    tenantId: string,
    traceId: string,
    projectionId: string,
    projectionVersion: string
  ): ClickHouseSummaryRecord {
    return {
      Id: projectionId,
      TenantId: tenantId,
      TraceId: traceId,
      Version: projectionVersion,
      Attributes: data.Attributes,

      CreatedAt: timestampToDateTime64(data.CreatedAt),
      LastUpdatedAt: timestampToDateTime64(data.LastUpdatedAt),

      ComputedIOSchemaVersion: data.ComputedIOSchemaVersion,
      ComputedInput: data.ComputedInput,
      ComputedOutput: data.ComputedOutput,

      TimeToFirstTokenMs: data.TimeToFirstTokenMs,
      TimeToLastTokenMs: data.TimeToLastTokenMs,
      TotalDurationMs: data.TotalDurationMs,
      TokensPerSecond: data.TokensPerSecond,
      SpanCount: data.SpanCount,

      ContainsErrorStatus: data.ContainsErrorStatus,
      ContainsOKStatus: data.ContainsOKStatus,
      ErrorMessage: data.ErrorMessage,
      Models: data.Models,

      TotalCost: data.TotalCost,
      TokensEstimated: data.TokensEstimated,
      TotalPromptTokenCount: data.TotalPromptTokenCount,
      TotalCompletionTokenCount: data.TotalCompletionTokenCount,

      TopicId: data.TopicId,
      SubTopicId: data.SubTopicId,
      HasAnnotation: data.HasAnnotation,
    };
  }

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext
  ): Promise<ProjectionType | null> {
    return await this.tracer.withActiveSpan(
      "TraceSummaryRepositoryClickHouse.getProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.id": aggregateId,
          "tenant.id": context.tenantId,
        },
      },
      async () => {
        EventUtils.validateTenantId(
          context,
          "TraceSummaryRepositoryClickHouse.getProjection"
        );

        const traceId = String(aggregateId);

        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                Id,
                TenantId,
                TraceId,
                Version,
                Attributes,
                toString(CreatedAt) AS CreatedAt,
                toString(LastUpdatedAt) AS LastUpdatedAt,
                ComputedIOSchemaVersion,
                ComputedInput,
                ComputedOutput,
                TimeToFirstTokenMs,
                TimeToLastTokenMs,
                TotalDurationMs,
                TokensPerSecond,
                SpanCount,
                ContainsErrorStatus,
                ContainsOKStatus,
                ErrorMessage,
                Models,
                TotalCost,
                TokensEstimated,
                TotalPromptTokenCount,
                TotalCompletionTokenCount,
                TopicId,
                SubTopicId,
                HasAnnotation
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND TraceId = {traceId:String}
              ORDER BY LastUpdatedAt DESC
              LIMIT 1
            `,
            query_params: {
              tenantId: context.tenantId,
              traceId: traceId,
            },
            format: "JSONEachRow",
          });

          const rows = await result.json<ClickHouseSummaryRecord>();
          const row = rows[0];
          if (!row) {
            return null;
          }

          const projectionData = this.mapClickHouseRecordToProjectionData(row);

          const projection: TraceSummary = {
            id: row.Id,
            aggregateId: traceId,
            tenantId: createTenantId(context.tenantId),
            version: row.Version,
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
            "Failed to get projection from ClickHouse"
          );
          throw new StoreError(
            "getProjection",
            "TraceSummaryRepositoryClickHouse",
            `Failed to get projection for trace ${traceId}: ${errorMessage}`,
            ErrorCategory.CRITICAL,
            { traceId },
            error
          );
        }
      }
    );
  }

  async storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "TraceSummaryRepositoryClickHouse.storeProjection",
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
          "TraceSummaryRepositoryClickHouse.storeProjection"
        );

        if (!EventUtils.isValidProjection(projection)) {
          throw new ValidationError(
            "Invalid projection: projection must have id, aggregateId, tenantId, version, and data",
            "projection",
            projection
          );
        }

        if (projection.tenantId !== context.tenantId) {
          throw new SecurityError(
            "storeProjection",
            `Projection has tenantId '${projection.tenantId}' that does not match context tenantId '${context.tenantId}'`,
            projection.tenantId,
            { contextTenantId: context.tenantId }
          );
        }

        try {
          const traceId = String(projection.aggregateId);
          const projectionRecord = this.mapProjectionDataToClickHouseRecord(
            projection.data as TraceSummaryData,
            String(context.tenantId),
            traceId,
            projection.id,
            projection.version
          );

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
            "Stored projection to ClickHouse"
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
            "Failed to store projection in ClickHouse"
          );
          throw new StoreError(
            "storeProjection",
            "TraceSummaryRepositoryClickHouse",
            `Failed to store projection ${projection.id} for trace ${projection.aggregateId}: ${errorMessage}`,
            ErrorCategory.CRITICAL,
            {
              projectionId: projection.id,
              traceId: String(projection.aggregateId),
            },
            error
          );
        }
      }
    );
  }
}
