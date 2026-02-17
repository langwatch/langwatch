import type { ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import {
  ErrorCategory,
  SecurityError,
  StoreError,
  ValidationError,
} from "~/server/event-sourcing/library/services/errorHandling";
import { createLogger } from "../../../../../utils/logger/server";
import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import { createTenantId, EventUtils } from "../../../library";
import type {
  TraceSummary,
  TraceSummaryData,
} from "../projections/traceSummary.foldProjection";
import type { WithDateWrites } from "~/server/clickhouse/types";
import type { TraceSummaryRepository } from "./traceSummaryRepository";

const TABLE_NAME = "trace_summaries" as const;

type ClickHouseSummaryWriteRecord = WithDateWrites<
  ClickHouseSummaryRecord,
  "OccurredAt" | "CreatedAt" | "LastUpdatedAt"
>;

/**
 * ClickHouse record matching the trace_summaries table schema exactly.
 */
interface ClickHouseSummaryRecord {
  Id: string;
  TenantId: string;
  TraceId: string;
  Version: string;
  Attributes: Record<string, string>;

  OccurredAt: number; // toUnixTimestamp64Milli() - trace execution start time (ms)
  CreatedAt: number; // toUnixTimestamp64Milli() - record creation time (ms)
  LastUpdatedAt: number; // toUnixTimestamp64Milli() - record update time (ms)

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

  // Status (stored as UInt8 in ClickHouse: 0 or 1)
  ContainsErrorStatus: number;
  ContainsOKStatus: number;
  ErrorMessage: string | null;
  Models: string[];

  // Cost
  TotalCost: number | null;
  TokensEstimated: boolean;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;

  // Output tracking
  OutputFromRootSpan: number; // stored as Bool in ClickHouse
  OutputSpanEndTimeMs: number;

  // Trace intelligence
  TopicId: string | null;
  SubTopicId: string | null;
  HasAnnotation: number | null; // stored as UInt8 in ClickHouse: 0 or 1
}


/**
 * ClickHouse repository for trace summaries.
 */
export class TraceSummaryRepositoryClickHouse<
  ProjectionType extends Projection = Projection,
> implements TraceSummaryRepository<ProjectionType> {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.trace-summary-repository",
  );
  private readonly logger = createLogger(
    "langwatch:trace-processing:trace-summary-repository",
  );

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  private mapClickHouseRecordToProjectionData(
    record: ClickHouseSummaryRecord,
  ): TraceSummaryData {
    return {
      TraceId: record.TraceId,
      SpanCount: record.SpanCount,
      TotalDurationMs: Number(record.TotalDurationMs),

      ComputedIOSchemaVersion: record.ComputedIOSchemaVersion,
      ComputedInput: record.ComputedInput,
      ComputedOutput: record.ComputedOutput,

      TimeToFirstTokenMs: record.TimeToFirstTokenMs,
      TimeToLastTokenMs: record.TimeToLastTokenMs,
      TokensPerSecond: record.TokensPerSecond,

      // ClickHouse Bool columns return as JSON booleans (true/false), not numbers
      ContainsErrorStatus: !!record.ContainsErrorStatus,
      ContainsOKStatus: !!record.ContainsOKStatus,
      ErrorMessage: record.ErrorMessage,
      Models: record.Models,

      TotalCost: record.TotalCost,
      TokensEstimated: !!record.TokensEstimated,
      TotalPromptTokenCount: record.TotalPromptTokenCount,
      TotalCompletionTokenCount: record.TotalCompletionTokenCount,

      OutputFromRootSpan: !!record.OutputFromRootSpan,
      OutputSpanEndTimeMs: Number(record.OutputSpanEndTimeMs),

      TopicId: record.TopicId,
      SubTopicId: record.SubTopicId,
      HasAnnotation:
        record.HasAnnotation != null ? !!record.HasAnnotation : null,

      Attributes: record.Attributes ?? {},

      OccurredAt: record.OccurredAt,
      CreatedAt: record.CreatedAt,
      LastUpdatedAt: record.LastUpdatedAt,
    };
  }

  private mapProjectionDataToClickHouseRecord(
    data: TraceSummaryData,
    tenantId: string,
    traceId: string,
    projectionId: string,
    projectionVersion: string,
  ): ClickHouseSummaryWriteRecord {
    return {
      Id: projectionId,
      TenantId: tenantId,
      TraceId: traceId,
      Version: projectionVersion,
      Attributes: data.Attributes,

      OccurredAt: new Date(data.OccurredAt),
      CreatedAt: new Date(data.CreatedAt),
      LastUpdatedAt: new Date(data.LastUpdatedAt),

      ComputedIOSchemaVersion: data.ComputedIOSchemaVersion,
      ComputedInput: data.ComputedInput,
      ComputedOutput: data.ComputedOutput,

      TimeToFirstTokenMs: data.TimeToFirstTokenMs,
      TimeToLastTokenMs: data.TimeToLastTokenMs,
      TotalDurationMs: data.TotalDurationMs,
      TokensPerSecond: data.TokensPerSecond,
      SpanCount: data.SpanCount,

      ContainsErrorStatus: data.ContainsErrorStatus ? 1 : 0,
      ContainsOKStatus: data.ContainsOKStatus ? 1 : 0,
      ErrorMessage: data.ErrorMessage,
      Models: data.Models,

      TotalCost: data.TotalCost,
      TokensEstimated: data.TokensEstimated,
      TotalPromptTokenCount: data.TotalPromptTokenCount,
      TotalCompletionTokenCount: data.TotalCompletionTokenCount,

      OutputFromRootSpan: data.OutputFromRootSpan ? 1 : 0,
      OutputSpanEndTimeMs: data.OutputSpanEndTimeMs,

      TopicId: data.TopicId,
      SubTopicId: data.SubTopicId,
      HasAnnotation: data.HasAnnotation != null ? (data.HasAnnotation ? 1 : 0) : null,
    };
  }

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
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
          "TraceSummaryRepositoryClickHouse.getProjection",
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
                toUnixTimestamp64Milli(OccurredAt) AS OccurredAt,
                toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
                toUnixTimestamp64Milli(LastUpdatedAt) AS LastUpdatedAt,
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
                OutputFromRootSpan,
                OutputSpanEndTimeMs,
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
            "Failed to get projection from ClickHouse",
          );
          throw new StoreError(
            "getProjection",
            "TraceSummaryRepositoryClickHouse",
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
          "TraceSummaryRepositoryClickHouse.storeProjection",
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
          const traceId = String(projection.aggregateId);
          const projectionRecord = this.mapProjectionDataToClickHouseRecord(
            projection.data as TraceSummaryData,
            String(context.tenantId),
            traceId,
            projection.id,
            projection.version,
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
            "TraceSummaryRepositoryClickHouse",
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

  async storeProjectionBatch(
    projections: ProjectionType[],
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    if (projections.length === 0) return;

    EventUtils.validateTenantId(
      context,
      "TraceSummaryRepositoryClickHouse.storeProjectionBatch",
    );

    const records = projections.map((projection) => {
      if (!EventUtils.isValidProjection(projection)) {
        throw new ValidationError(
          "Invalid projection in batch",
          "projection",
          projection,
        );
      }
      return this.mapProjectionDataToClickHouseRecord(
        projection.data as TraceSummaryData,
        String(context.tenantId),
        String(projection.aggregateId),
        projection.id,
        projection.version,
      );
    });

    try {
      await this.clickHouseClient.insert({
        table: TABLE_NAME,
        values: records,
        format: "JSONEachRow",
      });

      this.logger.debug(
        { tenantId: context.tenantId, count: records.length },
        "Batch stored projections to ClickHouse",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        { tenantId: context.tenantId, count: records.length, error: errorMessage },
        "Failed to batch store projections in ClickHouse",
      );
      throw new StoreError(
        "storeProjectionBatch",
        "TraceSummaryRepositoryClickHouse",
        `Failed to batch store ${records.length} projections: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        { count: records.length },
        error,
      );
    }
  }
}
