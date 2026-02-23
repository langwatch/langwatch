import type { ClickHouseClient } from "@clickhouse/client";
import type { WithDateWrites } from "~/server/clickhouse/types";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import { IdUtils } from "~/server/event-sourcing/pipelines/trace-processing/utils/id.utils";
import { createLogger } from "~/utils/logger/server";
import type { TraceSummaryData } from "../types";
import type { TraceSummaryRepository } from "./trace-summary.repository";

const TABLE_NAME = "trace_summaries" as const;

const logger = createLogger(
  "langwatch:app-layer:traces:trace-summary-repository",
);

type ClickHouseSummaryWriteRecord = WithDateWrites<
  ClickHouseSummaryRecord,
  "OccurredAt" | "CreatedAt" | "LastUpdatedAt"
>;

interface ClickHouseSummaryRecord {
  Id: string;
  TenantId: string;
  TraceId: string;
  Version: string;
  Attributes: Record<string, string>;
  OccurredAt: number;
  CreatedAt: number;
  LastUpdatedAt: number;
  ComputedIOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TotalDurationMs: number;
  TokensPerSecond: number | null;
  SpanCount: number;
  ContainsErrorStatus: number;
  ContainsOKStatus: number;
  ErrorMessage: string | null;
  Models: string[];
  TotalCost: number | null;
  TokensEstimated: boolean;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  OutputFromRootSpan: number;
  OutputSpanEndTimeMs: number;
  BlockedByGuardrail: number;
  SatisfactionScore: number | null;
  TopicId: string | null;
  SubTopicId: string | null;
  HasAnnotation: number | null;
}

export class TraceSummaryClickHouseRepository implements TraceSummaryRepository {
  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async upsert(data: TraceSummaryData, tenantId: string): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId },
      "TraceSummaryClickHouseRepository.upsert",
    );

    const projectionId = IdUtils.generateDeterministicTraceSummaryIdFromData(
      tenantId,
      data.traceId,
      data.occurredAt,
    );

    try {
      const record = this.toClickHouseRecord(
        data,
        tenantId,
        projectionId,
        TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
      );

      await this.clickHouseClient.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
      });

      logger.debug(
        { tenantId, traceId: data.traceId, projectionId },
        "Stored trace summary to ClickHouse",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, traceId: data.traceId, error: errorMessage },
        "Failed to store trace summary in ClickHouse",
      );
      throw error;
    }
  }

  async getByTraceId(
    tenantId: string,
    traceId: string,
  ): Promise<TraceSummaryData | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "TraceSummaryClickHouseRepository.getByTraceId",
    );

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
            BlockedByGuardrail,
            SatisfactionScore,
            TopicId,
            SubTopicId,
            HasAnnotation
          FROM ${TABLE_NAME} FINAL
          WHERE TenantId = {tenantId:String}
            AND TraceId = {traceId:String}
          ORDER BY LastUpdatedAt DESC
          LIMIT 1
        `,
        query_params: { tenantId, traceId },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseSummaryRecord>();
      const row = rows[0];
      if (!row) return null;

      return this.fromClickHouseRecord(row);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, traceId, error: errorMessage },
        "Failed to get trace summary from ClickHouse",
      );
      throw error;
    }
  }

  private fromClickHouseRecord(
    record: ClickHouseSummaryRecord,
  ): TraceSummaryData {
    return {
      traceId: record.TraceId,
      spanCount: record.SpanCount,
      totalDurationMs: Number(record.TotalDurationMs),
      computedIOSchemaVersion: record.ComputedIOSchemaVersion,
      computedInput: record.ComputedInput,
      computedOutput: record.ComputedOutput,
      timeToFirstTokenMs: record.TimeToFirstTokenMs,
      timeToLastTokenMs: record.TimeToLastTokenMs,
      tokensPerSecond: record.TokensPerSecond,
      containsErrorStatus: !!record.ContainsErrorStatus,
      containsOKStatus: !!record.ContainsOKStatus,
      errorMessage: record.ErrorMessage,
      models: record.Models,
      totalCost: record.TotalCost,
      tokensEstimated: !!record.TokensEstimated,
      totalPromptTokenCount: record.TotalPromptTokenCount,
      totalCompletionTokenCount: record.TotalCompletionTokenCount,
      outputFromRootSpan: !!record.OutputFromRootSpan,
      outputSpanEndTimeMs: Number(record.OutputSpanEndTimeMs),
      blockedByGuardrail: !!record.BlockedByGuardrail,
      satisfactionScore: record.SatisfactionScore,
      topicId: record.TopicId,
      subTopicId: record.SubTopicId,
      hasAnnotation:
        record.HasAnnotation != null ? !!record.HasAnnotation : null,
      attributes: record.Attributes ?? {},
      occurredAt: record.OccurredAt,
      createdAt: record.CreatedAt,
      lastUpdatedAt: record.LastUpdatedAt,
    };
  }

  private toClickHouseRecord(
    data: TraceSummaryData,
    tenantId: string,
    projectionId: string,
    version: string,
  ): ClickHouseSummaryWriteRecord {
    return {
      Id: projectionId,
      TenantId: tenantId,
      TraceId: data.traceId,
      Version: version,
      Attributes: data.attributes,
      OccurredAt: new Date(data.occurredAt),
      CreatedAt: new Date(data.createdAt),
      LastUpdatedAt: new Date(data.lastUpdatedAt),
      ComputedIOSchemaVersion: data.computedIOSchemaVersion,
      ComputedInput: data.computedInput,
      ComputedOutput: data.computedOutput,
      TimeToFirstTokenMs: data.timeToFirstTokenMs,
      TimeToLastTokenMs: data.timeToLastTokenMs,
      TotalDurationMs: data.totalDurationMs,
      TokensPerSecond: data.tokensPerSecond,
      SpanCount: data.spanCount,
      ContainsErrorStatus: data.containsErrorStatus ? 1 : 0,
      ContainsOKStatus: data.containsOKStatus ? 1 : 0,
      ErrorMessage: data.errorMessage,
      Models: data.models,
      TotalCost: data.totalCost,
      TokensEstimated: data.tokensEstimated,
      TotalPromptTokenCount: data.totalPromptTokenCount,
      TotalCompletionTokenCount: data.totalCompletionTokenCount,
      OutputFromRootSpan: data.outputFromRootSpan ? 1 : 0,
      OutputSpanEndTimeMs: data.outputSpanEndTimeMs,
      BlockedByGuardrail: data.blockedByGuardrail ? 1 : 0,
      SatisfactionScore: data.satisfactionScore,
      TopicId: data.topicId,
      SubTopicId: data.subTopicId,
      HasAnnotation:
        data.hasAnnotation != null ? (data.hasAnnotation ? 1 : 0) : null,
    };
  }
}
