import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { WithDateWrites } from "~/server/clickhouse/types";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { AnalyticsTraceFactData } from "../types";
import type { AnalyticsTraceFactsRepository } from "./analytics-trace-facts.repository";

const TABLE_NAME = "analytics_trace_facts" as const;

const logger = createLogger(
  "langwatch:app-layer:analytics:trace-facts-repository",
);

type ClickHouseTraceFactWriteRecord = WithDateWrites<
  ClickHouseTraceFactRecord,
  "OccurredAt" | "CreatedAt" | "UpdatedAt"
>;

interface ClickHouseTraceFactRecord {
  TenantId: string;
  TraceId: string;
  OccurredAt: number;
  UserId: string;
  ThreadId: string;
  CustomerId: string;
  Labels: string[];
  TopicId: string | null;
  SubTopicId: string | null;
  Metadata: Record<string, string>;
  TotalCost: number | null;
  TotalDurationMs: number;
  TotalPromptTokens: number | null;
  TotalCompletionTokens: number | null;
  TokensPerSecond: number | null;
  TimeToFirstTokenMs: number | null;
  ContainsError: number;
  HasAnnotation: number | null;
  SpanCount: number;
  ModelNames: string[];
  ModelPromptTokens: number[];
  ModelCompletionTokens: number[];
  ModelCosts: number[];
  EventTypes: string[];
  EventScoreKeys: string[];
  EventScoreValues: number[];
  EventDetailKeys: string[];
  EventDetailValues: string[];
  ThumbsUpDownVote: number | null;
  RAGDocumentIds: string[];
  RAGDocumentContents: string[];
  CreatedAt: number;
  UpdatedAt: number;
}

export class AnalyticsTraceFactsClickHouseRepository
  implements AnalyticsTraceFactsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async upsert(data: AnalyticsTraceFactData, tenantId: string): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId },
      "AnalyticsTraceFactsClickHouseRepository.upsert",
    );

    try {
      const client = await this.resolveClient(tenantId);
      const record = this.toClickHouseRecord(data, tenantId);

      await client.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, traceId: data.traceId, error: errorMessage },
        "Failed to store analytics trace fact in ClickHouse",
      );
      throw error;
    }
  }

  async getByTraceId(
    tenantId: string,
    traceId: string,
  ): Promise<AnalyticsTraceFactData | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "AnalyticsTraceFactsClickHouseRepository.getByTraceId",
    );

    try {
      const client = await this.resolveClient(tenantId);
      const result = await client.query({
        query: `
          SELECT
            TenantId,
            TraceId,
            toUnixTimestamp64Milli(OccurredAt) AS OccurredAt,
            UserId,
            ThreadId,
            CustomerId,
            Labels,
            TopicId,
            SubTopicId,
            Metadata,
            TotalCost,
            TotalDurationMs,
            TotalPromptTokens,
            TotalCompletionTokens,
            TokensPerSecond,
            TimeToFirstTokenMs,
            ContainsError,
            HasAnnotation,
            SpanCount,
            ModelNames,
            ModelPromptTokens,
            ModelCompletionTokens,
            ModelCosts,
            EventTypes,
            EventScoreKeys,
            EventScoreValues,
            EventDetailKeys,
            EventDetailValues,
            ThumbsUpDownVote,
            RAGDocumentIds,
            RAGDocumentContents,
            toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND TraceId = {traceId:String}
          ORDER BY UpdatedAt DESC
          LIMIT 1
        `,
        query_params: { tenantId, traceId },
        format: "JSONEachRow",
        clickhouse_settings: { select_sequential_consistency: "1" },
      });

      const rows = await result.json<ClickHouseTraceFactRecord>();
      const row = rows[0];
      if (!row) return null;

      return this.fromClickHouseRecord(row);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, traceId, error: errorMessage },
        "Failed to get analytics trace fact from ClickHouse",
      );
      throw error;
    }
  }

  private fromClickHouseRecord(
    record: ClickHouseTraceFactRecord,
  ): AnalyticsTraceFactData {
    return {
      traceId: record.TraceId,
      occurredAt: record.OccurredAt,
      userId: record.UserId,
      threadId: record.ThreadId,
      customerId: record.CustomerId,
      labels: record.Labels,
      topicId: record.TopicId,
      subTopicId: record.SubTopicId,
      metadata: record.Metadata ?? {},
      totalCost: record.TotalCost,
      totalDurationMs: Number(record.TotalDurationMs),
      totalPromptTokens: record.TotalPromptTokens,
      totalCompletionTokens: record.TotalCompletionTokens,
      tokensPerSecond: record.TokensPerSecond,
      timeToFirstTokenMs: record.TimeToFirstTokenMs,
      containsError: !!record.ContainsError,
      hasAnnotation:
        record.HasAnnotation != null ? !!record.HasAnnotation : null,
      spanCount: record.SpanCount,
      modelNames: record.ModelNames,
      modelPromptTokens: record.ModelPromptTokens,
      modelCompletionTokens: record.ModelCompletionTokens,
      modelCosts: record.ModelCosts,
      eventTypes: record.EventTypes,
      eventScoreKeys: record.EventScoreKeys,
      eventScoreValues: record.EventScoreValues,
      eventDetailKeys: record.EventDetailKeys,
      eventDetailValues: record.EventDetailValues,
      thumbsUpDownVote: record.ThumbsUpDownVote,
      ragDocumentIds: record.RAGDocumentIds,
      ragDocumentContents: record.RAGDocumentContents,
      createdAt: record.CreatedAt,
      updatedAt: record.UpdatedAt,
    };
  }

  private toClickHouseRecord(
    data: AnalyticsTraceFactData,
    tenantId: string,
  ): ClickHouseTraceFactWriteRecord {
    return {
      TenantId: tenantId,
      TraceId: data.traceId,
      OccurredAt: new Date(data.occurredAt),
      UserId: data.userId,
      ThreadId: data.threadId,
      CustomerId: data.customerId,
      Labels: data.labels,
      TopicId: data.topicId,
      SubTopicId: data.subTopicId,
      Metadata: data.metadata,
      TotalCost: data.totalCost,
      TotalDurationMs: Math.round(data.totalDurationMs),
      TotalPromptTokens: data.totalPromptTokens,
      TotalCompletionTokens: data.totalCompletionTokens,
      TokensPerSecond:
        data.tokensPerSecond != null
          ? Math.round(data.tokensPerSecond)
          : null,
      TimeToFirstTokenMs:
        data.timeToFirstTokenMs != null
          ? Math.round(data.timeToFirstTokenMs)
          : null,
      ContainsError: data.containsError ? 1 : 0,
      HasAnnotation:
        data.hasAnnotation != null ? (data.hasAnnotation ? 1 : 0) : null,
      SpanCount: data.spanCount,
      ModelNames: data.modelNames,
      ModelPromptTokens: data.modelPromptTokens,
      ModelCompletionTokens: data.modelCompletionTokens,
      ModelCosts: data.modelCosts,
      EventTypes: data.eventTypes,
      EventScoreKeys: data.eventScoreKeys,
      EventScoreValues: data.eventScoreValues,
      EventDetailKeys: data.eventDetailKeys,
      EventDetailValues: data.eventDetailValues,
      ThumbsUpDownVote: data.thumbsUpDownVote,
      RAGDocumentIds: data.ragDocumentIds,
      RAGDocumentContents: data.ragDocumentContents,
      CreatedAt: new Date(data.createdAt),
      UpdatedAt: new Date(data.updatedAt),
    };
  }
}
