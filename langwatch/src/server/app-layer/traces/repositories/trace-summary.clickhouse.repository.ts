import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
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
  "OccurredAt" | "CreatedAt" | "UpdatedAt" | "LastEventOccurredAt"
>;

interface ClickHouseSummaryRecord {
  ProjectionId: string;
  TenantId: string;
  TraceId: string;
  Version: string;
  Attributes: Record<string, string>;
  OccurredAt: number;
  CreatedAt: number;
  UpdatedAt: number;
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
  TopicId: string | null;
  SubTopicId: string | null;
  AnnotationIds: string[];
  HasAnnotation: number | null;
  ScenarioRoleCosts: Record<string, number>;
  ScenarioRoleLatencies: Record<string, number>;
  ScenarioRoleSpans: Record<string, string>;
  SpanCosts: Record<string, number>;
  LastEventOccurredAt: number;
  ArchivedAt: Date | null;
}

export class TraceSummaryClickHouseRepository implements TraceSummaryRepository {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

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
      const client = await this.resolveClient(tenantId);
      const record = this.toClickHouseRecord(
        data,
        tenantId,
        projectionId,
        TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
      );

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
        "Failed to store trace summary in ClickHouse",
      );
      throw error;
    }
  }

  async upsertBatch(
    entries: Array<{ data: TraceSummaryData; tenantId: string }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = entries[0]!.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "TraceSummaryClickHouseRepository.upsertBatch",
    );

    const mixedTenant = entries.find((e) => e.tenantId !== tenantId);
    if (mixedTenant) {
      throw new Error(
        `Mixed tenants in upsertBatch: expected ${tenantId}, got ${mixedTenant.tenantId}. ` +
        `Each batch must contain a single tenant to ensure correct DB routing.`,
      );
    }

    try {
      const client = await this.resolveClient(tenantId);
      const records = entries.map(({ data, tenantId: tid }) => {
        const projectionId =
          IdUtils.generateDeterministicTraceSummaryIdFromData(
            tid,
            data.traceId,
            data.occurredAt,
          );
        return this.toClickHouseRecord(
          data,
          tid,
          projectionId,
          TRACE_SUMMARY_PROJECTION_VERSION_LATEST,
        );
      });

      await client.insert({
        table: TABLE_NAME,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { tenantId, count: entries.length, error: errorMessage },
        "Failed to batch store trace summaries in ClickHouse",
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
      const client = await this.resolveClient(tenantId);
      const result = await client.query({
        query: `
          SELECT
            ProjectionId,
            TenantId,
            TraceId,
            Version,
            Attributes,
            toUnixTimestamp64Milli(OccurredAt) AS OccurredAt,
            toUnixTimestamp64Milli(CreatedAt) AS CreatedAt,
            toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt,
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
            TopicId,
            SubTopicId,
            AnnotationIds,
            HasAnnotation,
            ScenarioRoleCosts,
            ScenarioRoleLatencies,
            ScenarioRoleSpans,
            SpanCosts,
            toUnixTimestamp64Milli(ArchivedAt) AS ArchivedAt
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND TraceId = {traceId:String}
          ORDER BY UpdatedAt DESC
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
      topicId: record.TopicId,
      subTopicId: record.SubTopicId,
      annotationIds: record.AnnotationIds ?? [],
      attributes: record.Attributes ?? {},
      scenarioRoleCosts: record.ScenarioRoleCosts ?? {},
      scenarioRoleLatencies: record.ScenarioRoleLatencies ?? {},
      scenarioRoleSpans: record.ScenarioRoleSpans ?? {},
      spanCosts: record.SpanCosts ?? {},
      occurredAt: record.OccurredAt,
      createdAt: record.CreatedAt,
      updatedAt: record.UpdatedAt,
      lastEventOccurredAt: Number(record.LastEventOccurredAt ?? 0),
      archivedAt: record.ArchivedAt ? Number(record.ArchivedAt) : null,
    };
  }

  private toClickHouseRecord(
    data: TraceSummaryData,
    tenantId: string,
    projectionId: string,
    version: string,
  ): ClickHouseSummaryWriteRecord {
    return {
      ProjectionId: projectionId,
      TenantId: tenantId,
      TraceId: data.traceId,
      Version: version,
      Attributes: data.attributes,
      OccurredAt: new Date(data.occurredAt),
      CreatedAt: new Date(data.createdAt),
      UpdatedAt: new Date(data.updatedAt),
      LastEventOccurredAt: data.lastEventOccurredAt ? new Date(data.lastEventOccurredAt) : new Date(0),
      ComputedIOSchemaVersion: data.computedIOSchemaVersion,
      ComputedInput: data.computedInput,
      ComputedOutput: data.computedOutput,
      TimeToFirstTokenMs: data.timeToFirstTokenMs != null ? Math.round(data.timeToFirstTokenMs) : null,
      TimeToLastTokenMs: data.timeToLastTokenMs != null ? Math.round(data.timeToLastTokenMs) : null,
      TotalDurationMs: Math.round(data.totalDurationMs),
      TokensPerSecond: data.tokensPerSecond != null ? Math.round(data.tokensPerSecond) : null,
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
      TopicId: data.topicId,
      SubTopicId: data.subTopicId,
      AnnotationIds: data.annotationIds,
      HasAnnotation: data.annotationIds.length > 0 ? 1 : 0,
      ScenarioRoleCosts: data.scenarioRoleCosts ?? {},
      ScenarioRoleLatencies: data.scenarioRoleLatencies ?? {},
      ScenarioRoleSpans: data.scenarioRoleSpans ?? {},
      SpanCosts: data.spanCosts ?? {},
      ArchivedAt: data.archivedAt ? new Date(data.archivedAt) : null,
    };
  }
}
