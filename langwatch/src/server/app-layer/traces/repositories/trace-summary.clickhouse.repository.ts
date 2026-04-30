import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type { WithDateWrites } from "~/server/clickhouse/types";
import { TRACE_SUMMARY_PROJECTION_VERSION_LATEST } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import { IdUtils } from "~/server/event-sourcing/pipelines/trace-processing/utils/id.utils";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import { validateBatchTenants } from "../../_shared/clickhouse-batch";
import type { TraceSummaryData } from "../types";
import type { TraceSummaryFieldsBase } from "./_summary-fields.types";
import type { TraceSummaryRepository } from "./trace-summary.repository";

const TABLE_NAME = "trace_summaries" as const;

const logger = createLogger(
  "langwatch:app-layer:traces:trace-summary-repository",
);

type ClickHouseSummaryWriteRecord = Omit<
  WithDateWrites<
    ClickHouseSummaryRecord,
    "OccurredAt" | "CreatedAt" | "UpdatedAt" | "LastEventOccurredAt"
  >,
  "Events.Timestamp"
> & {
  "Events.Timestamp": Date[];
};

interface ClickHouseSummaryRecord extends TraceSummaryFieldsBase {
  ProjectionId: string;
  Version: string;
  Attributes: Record<string, string>;
  HasAnnotation: number | null;
  "Events.SpanId": string[];
  "Events.Timestamp": string[];
  "Events.Name": string[];
  "Events.Attributes": Record<string, string>[];
  LastEventOccurredAt: number;
}

export class TraceSummaryClickHouseRepository
  implements TraceSummaryRepository
{
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

    const tenantId = validateBatchTenants(
      entries,
      "TraceSummaryClickHouseRepository.upsertBatch",
    );

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
    options?: { occurredAtMs?: number },
  ): Promise<TraceSummaryData | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "TraceSummaryClickHouseRepository.getByTraceId",
    );

    // First attempt: when the caller has a rough timestamp, narrow the
    // scan to a ±2-day window around it for partition pruning. The
    // IO/Attributes columns are heavy and without pruning ClickHouse
    // scans every partition including cold S3 tier — this trims drawer-
    // open latency from ~1s to ~100ms.
    //
    // The hint is *best-effort*. If the hint window misses (clock skew,
    // stale URL, the row's `timestamp` ≠ trace's actual OccurredAt) we
    // fall back to an unconstrained scan so the drawer doesn't 404 on a
    // trace that genuinely exists. The fallback is the slow path; the
    // happy path stays fast.
    const PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
    const hasHint = options?.occurredAtMs !== undefined;

    try {
      if (hasHint) {
        const hinted = await this.queryByTraceId(tenantId, traceId, {
          fromMs: options!.occurredAtMs! - PARTITION_WINDOW_MS,
          toMs: options!.occurredAtMs! + PARTITION_WINDOW_MS,
        });
        if (hinted) return hinted;
        logger.debug(
          { tenantId, traceId, occurredAtMs: options!.occurredAtMs },
          "Trace summary not found in hint window — retrying without partition prune",
        );
      }
      return await this.queryByTraceId(tenantId, traceId);
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

  private async queryByTraceId(
    tenantId: string,
    traceId: string,
    window?: { fromMs: number; toMs: number },
  ): Promise<TraceSummaryData | null> {
    const outerTimeFilter = window
      ? "AND t.OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64}) " +
        "AND t.OccurredAt <= fromUnixTimestamp64Milli({toMs:Int64})"
      : "";
    const innerTimeFilter = window
      ? "AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64}) " +
        "AND OccurredAt <= fromUnixTimestamp64Milli({toMs:Int64})"
      : "";

    const client = await this.resolveClient(tenantId);
    // IN-tuple dedup over the ReplacingMergeTree: the inner SELECT scans
    // only (TenantId, TraceId, UpdatedAt) — small, sparse — to find the
    // latest version, then the outer SELECT pulls the heavy columns
    // (ComputedInput, ComputedOutput, Attributes, etc.) for that one row.
    // See dev/docs/best_practices/clickhouse-queries.md.
    const result = await client.query({
      query: `
        SELECT
          t.ProjectionId AS ProjectionId,
          t.TenantId AS TenantId,
          t.TraceId AS TraceId,
          t.Version AS Version,
          t.Attributes AS Attributes,
          toUnixTimestamp64Milli(t.OccurredAt) AS OccurredAt,
          toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
          toUnixTimestamp64Milli(t.UpdatedAt) AS UpdatedAt,
          t.ComputedIOSchemaVersion AS ComputedIOSchemaVersion,
          t.ComputedInput AS ComputedInput,
          t.ComputedOutput AS ComputedOutput,
          t.TimeToFirstTokenMs AS TimeToFirstTokenMs,
          t.TimeToLastTokenMs AS TimeToLastTokenMs,
          t.TotalDurationMs AS TotalDurationMs,
          t.TokensPerSecond AS TokensPerSecond,
          t.SpanCount AS SpanCount,
          t.ContainsErrorStatus AS ContainsErrorStatus,
          t.ContainsOKStatus AS ContainsOKStatus,
          t.ErrorMessage AS ErrorMessage,
          t.Models AS Models,
          t.TotalCost AS TotalCost,
          t.TokensEstimated AS TokensEstimated,
          t.TotalPromptTokenCount AS TotalPromptTokenCount,
          t.TotalCompletionTokenCount AS TotalCompletionTokenCount,
          t.OutputFromRootSpan AS OutputFromRootSpan,
          t.OutputSpanEndTimeMs AS OutputSpanEndTimeMs,
          t.BlockedByGuardrail AS BlockedByGuardrail,
          t.RootSpanName AS RootSpanName,
          t.RootSpanType AS RootSpanType,
          t.ContainsAi AS ContainsAi,
          t.ContainsPrompt AS ContainsPrompt,
          t.SelectedPromptId AS SelectedPromptId,
          t.SelectedPromptSpanId AS SelectedPromptSpanId,
          t.LastUsedPromptId AS LastUsedPromptId,
          t.LastUsedPromptVersionNumber AS LastUsedPromptVersionNumber,
          t.LastUsedPromptVersionId AS LastUsedPromptVersionId,
          t.LastUsedPromptSpanId AS LastUsedPromptSpanId,
          t.TopicId AS TopicId,
          t.SubTopicId AS SubTopicId,
          t.AnnotationIds AS AnnotationIds,
          t.HasAnnotation AS HasAnnotation,
          t.ScenarioRoleCosts AS ScenarioRoleCosts,
          t.ScenarioRoleLatencies AS ScenarioRoleLatencies,
          t.ScenarioRoleSpans AS ScenarioRoleSpans,
          t.SpanCosts AS SpanCosts,
          t.TraceName AS TraceName,
          t.\`Events.SpanId\` AS \`Events.SpanId\`,
          t.\`Events.Timestamp\` AS \`Events.Timestamp\`,
          t.\`Events.Name\` AS \`Events.Name\`,
          t.\`Events.Attributes\` AS \`Events.Attributes\`
        FROM ${TABLE_NAME} AS t
        WHERE t.TenantId = {tenantId:String}
          AND t.TraceId = {traceId:String}
          ${outerTimeFilter}
          AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
              ${innerTimeFilter}
            GROUP BY TenantId, TraceId
          )
        LIMIT 1
      `,
      query_params: window
        ? { tenantId, traceId, fromMs: window.fromMs, toMs: window.toMs }
        : { tenantId, traceId },
      format: "JSONEachRow",
    });

    const rows = await result.json<ClickHouseSummaryRecord>();
    const row = rows[0];
    if (!row) return null;
    return this.fromClickHouseRecord(row);
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
      rootSpanName: record.RootSpanName,
      rootSpanType: record.RootSpanType,
      containsAi: !!record.ContainsAi,
      containsPrompt: !!record.ContainsPrompt,
      selectedPromptId: record.SelectedPromptId,
      selectedPromptSpanId: record.SelectedPromptSpanId,
      // Internal tiebreakers are not persisted; reconstruct as null on read.
      selectedPromptStartTimeMs: null,
      lastUsedPromptId: record.LastUsedPromptId,
      lastUsedPromptVersionNumber: record.LastUsedPromptVersionNumber,
      lastUsedPromptVersionId: record.LastUsedPromptVersionId,
      lastUsedPromptSpanId: record.LastUsedPromptSpanId,
      lastUsedPromptStartTimeMs: null,
      topicId: record.TopicId,
      subTopicId: record.SubTopicId,
      annotationIds: record.AnnotationIds ?? [],
      traceName: record.TraceName ?? "",
      attributes: record.Attributes ?? {},
      scenarioRoleCosts: record.ScenarioRoleCosts ?? {},
      scenarioRoleLatencies: record.ScenarioRoleLatencies ?? {},
      scenarioRoleSpans: record.ScenarioRoleSpans ?? {},
      spanCosts: record.SpanCosts ?? {},
      events: (record["Events.SpanId"] ?? []).map((spanId, i) => ({
        spanId,
        timestamp: new Date(record["Events.Timestamp"]![i]!).getTime(),
        name: record["Events.Name"]![i]!,
        attributes: record["Events.Attributes"]![i] ?? {},
      })),
      occurredAt: record.OccurredAt,
      createdAt: record.CreatedAt,
      updatedAt: record.UpdatedAt,
      lastEventOccurredAt: Number(record.LastEventOccurredAt ?? 0),
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
      LastEventOccurredAt: data.lastEventOccurredAt
        ? new Date(data.lastEventOccurredAt)
        : new Date(0),
      ComputedIOSchemaVersion: data.computedIOSchemaVersion,
      ComputedInput: data.computedInput,
      ComputedOutput: data.computedOutput,
      TimeToFirstTokenMs:
        data.timeToFirstTokenMs != null
          ? Math.round(data.timeToFirstTokenMs)
          : null,
      TimeToLastTokenMs:
        data.timeToLastTokenMs != null
          ? Math.round(data.timeToLastTokenMs)
          : null,
      TotalDurationMs: Math.round(data.totalDurationMs),
      TokensPerSecond:
        data.tokensPerSecond != null ? Math.round(data.tokensPerSecond) : null,
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
      RootSpanName: data.rootSpanName,
      RootSpanType: data.rootSpanType,
      ContainsAi: data.containsAi ? 1 : 0,
      ContainsPrompt: data.containsPrompt ? 1 : 0,
      SelectedPromptId: data.selectedPromptId,
      SelectedPromptSpanId: data.selectedPromptSpanId,
      LastUsedPromptId: data.lastUsedPromptId,
      LastUsedPromptVersionNumber: data.lastUsedPromptVersionNumber,
      LastUsedPromptVersionId: data.lastUsedPromptVersionId,
      LastUsedPromptSpanId: data.lastUsedPromptSpanId,
      TopicId: data.topicId,
      SubTopicId: data.subTopicId,
      AnnotationIds: data.annotationIds,
      HasAnnotation: data.annotationIds.length > 0 ? 1 : 0,
      TraceName: data.traceName,
      ScenarioRoleCosts: data.scenarioRoleCosts ?? {},
      ScenarioRoleLatencies: data.scenarioRoleLatencies ?? {},
      ScenarioRoleSpans: data.scenarioRoleSpans ?? {},
      SpanCosts: data.spanCosts ?? {},
      "Events.SpanId": (data.events ?? []).map((e) => e.spanId),
      "Events.Timestamp": (data.events ?? []).map((e) => new Date(e.timestamp)),
      "Events.Name": (data.events ?? []).map((e) => e.name),
      "Events.Attributes": (data.events ?? []).map((e) => e.attributes),
    };
  }
}
