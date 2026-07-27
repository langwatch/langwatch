import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import {
  asNullableNumber,
  asNullableString,
  asNumber,
  asStringArray,
  asStringMap,
} from "~/server/clickhouse/recordDecode";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { TraceAnalyticsRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalytics.foldProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import type { TraceAnalyticsRepository } from "./trace-analytics.repository";

const TABLE_NAME = "trace_analytics" as const;

const logger = createLogger(
  "langwatch:app-layer:traces:trace-analytics-repository",
);

/**
 * ClickHouse write shape for the slim `trace_analytics` table (ADR-034 Phase 2,
 * migration 00039).
 *
 * The 64-bit-integer columns (`TotalDurationMs`) are serialised as STRINGS in
 * the JSONEachRow body — JSON numbers can't safely round-trip values past 2^53
 * (Phase 1 hit `CANNOT_PARSE_QUOTED_STRING` for the same reason in the rollup
 * repository). Float64 columns stay as numbers. UInt16 / UInt32 / Bool fit in
 * JSON numbers and pass through unstringified.
 */
interface ClickHouseTraceAnalyticsWriteRecord {
  TenantId: string;
  TraceId: string;
  Version: string;
  OccurredAt: Date;
  CreatedAt: Date;
  UpdatedAt: Date;

  TraceName: string;
  TopicId: string | null;
  SubTopicId: string | null;
  UserId: string | null;
  ConversationId: string | null;
  CustomerId: string | null;
  Origin: string;
  Models: string[];
  Labels: string[];

  TotalCost: number | null;
  NonBilledCost: number | null;
  // Int64 column — stringified for JSON precision.
  TotalDurationMs: string;
  TimeToFirstTokenMs: number | null;
  TokensPerSecond: number | null;
  PromptTokens: number | null;
  CompletionTokens: number | null;
  CacheReadTokens: number | null;
  CacheWriteTokens: number | null;
  ReasoningTokens: number | null;
  HasError: boolean;
  HasAnnotation: boolean | null;

  Attributes: Record<string, string>;

  // ── Read-back state (ADR-066, migration 00056) ─────────────────────────
  SpanCount: number;
  AnnotationIds: string[];
  // UInt64 epoch-ms columns ride as strings, like TotalDurationMs — exact
  // integer round-trip, TZ-immune (the fold compares these numerically).
  RootSpanStartTimeMs: string;
  TraceNameFromFallback: boolean;
  RootMetadataFromFallback: boolean;
  TraceNameUserOverridden: boolean;
  LastEventOccurredAt: string;

  // ── Durable dedup watermark (ADR-066, migration 00056) ─────────────────
  AppliedEventIds: string[];

  _retention_days: number;
}

function toClickHouseRecord(
  row: TraceAnalyticsRow,
  retentionDays: number,
  appliedEventIds: readonly string[] = [],
): ClickHouseTraceAnalyticsWriteRecord {
  return {
    TenantId: row.tenantId,
    TraceId: row.traceId,
    Version: row.version,
    OccurredAt: new Date(row.occurredAtMs),
    CreatedAt: new Date(row.createdAtMs),
    UpdatedAt: new Date(row.updatedAtMs),

    TraceName: row.traceName,
    TopicId: row.topicId,
    SubTopicId: row.subTopicId,
    UserId: row.userId,
    ConversationId: row.conversationId,
    CustomerId: row.customerId,
    Origin: row.origin,
    Models: row.models,
    Labels: row.labels,

    TotalCost: row.totalCost,
    NonBilledCost: row.nonBilledCost,
    TotalDurationMs: String(Math.round(row.totalDurationMs)),
    TimeToFirstTokenMs:
      row.timeToFirstTokenMs !== null
        ? Math.round(row.timeToFirstTokenMs)
        : null,
    TokensPerSecond:
      row.tokensPerSecond !== null ? Math.round(row.tokensPerSecond) : null,
    PromptTokens: row.promptTokens,
    CompletionTokens: row.completionTokens,
    CacheReadTokens: row.cacheReadTokens,
    CacheWriteTokens: row.cacheWriteTokens,
    ReasoningTokens: row.reasoningTokens,
    HasError: row.hasError,
    HasAnnotation: row.hasAnnotation,

    Attributes: row.attributes,

    SpanCount: Math.max(0, Math.round(row.spanCount)),
    AnnotationIds: row.annotationIds,
    RootSpanStartTimeMs: String(Math.max(0, Math.round(row.rootSpanStartTimeMs))),
    TraceNameFromFallback: row.traceNameFromFallback,
    RootMetadataFromFallback: row.rootMetadataFromFallback,
    TraceNameUserOverridden: row.traceNameUserOverridden,
    LastEventOccurredAt: String(Math.max(0, Math.round(row.lastEventOccurredAt))),

    AppliedEventIds: [...appliedEventIds],

    _retention_days: retentionDays,
  };
}

export class TraceAnalyticsClickHouseRepository
  implements TraceAnalyticsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async upsert(
    row: TraceAnalyticsRow,
    retentionDays: number = PLATFORM_DEFAULT_RETENTION_DAYS,
    appliedEventIds?: readonly string[],
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "TraceAnalyticsClickHouseRepository.upsert",
    );

    try {
      const client = await this.resolveClient(row.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [toClickHouseRecord(row, retentionDays, appliedEventIds)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      logger.error(
        {
          tenantId: row.tenantId,
          traceId: row.traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to upsert trace_analytics row into ClickHouse",
      );
      throw error;
    }
  }

  async upsertBatch(
    entries: Array<{
      row: TraceAnalyticsRow;
      retentionDays?: number;
      appliedEventIds?: readonly string[];
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = entries[0]!.row.tenantId;
    EventUtils.validateTenantId(
      { tenantId },
      "TraceAnalyticsClickHouseRepository.upsertBatch",
    );
    for (const { row } of entries) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "TraceAnalyticsClickHouseRepository.upsertBatch",
          "all rows in a single batch must share the same tenantId",
          tenantId,
          { mismatchedTenantId: row.tenantId },
        );
      }
    }

    try {
      const client = await this.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: entries.map(({ row, retentionDays, appliedEventIds }) =>
          toClickHouseRecord(
            row,
            retentionDays ?? PLATFORM_DEFAULT_RETENTION_DAYS,
            appliedEventIds,
          ),
        ),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          tenantId,
          count: entries.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to batch upsert trace_analytics rows into ClickHouse",
      );
      throw error;
    }
  }

  /**
   * The trace's last committed slim row plus its applied-event-id watermark
   * (ADR-066, migration 00056) — the CH-fallthrough behind a Redis cache miss.
   *
   * Dedups with the IN-tuple pattern (max(UpdatedAt) per key), never FINAL: the
   * ReplacingMergeTree only physically collapses rows sharing the full sort key
   * `(TenantId, OccurredAt, TraceId)`, and OccurredAt shifts when an
   * earlier-starting span arrives late, so superseded versions persist until
   * TTL. The inner dedup subquery reads only sort-key columns — no heavy
   * Attributes map — so it stays a cheap keyed seek.
   *
   * `window` bounds OccurredAt on the OUTER read only, keeping it a
   * partition-pruned point read. The inner dedup is deliberately UNWINDOWED so
   * it resolves the TRUE latest version: windowing it too would let a trace
   * whose latest version's OccurredAt drifted outside the window read back as a
   * stale older version (a non-null result no fallback catches). Unwindowed, the
   * same case yields an empty outer read, which the executor's unwindowed retry
   * recovers.
   */
  async findByTraceIdWithApplied({
    tenantId,
    traceId,
    window,
  }: {
    tenantId: string;
    traceId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{ row: TraceAnalyticsRow; appliedEventIds: string[] } | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "TraceAnalyticsClickHouseRepository.findByTraceIdWithApplied",
    );
    const client = await this.resolveClient(tenantId);

    const partitionFilter =
      window !== undefined
        ? "AND OccurredAt BETWEEN fromUnixTimestamp64Milli({from:Int64}) AND fromUnixTimestamp64Milli({to:Int64})"
        : "";

    const result = await client.query({
      query: `
        SELECT *
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND TraceId = {traceId:String}
          ${partitionFilter}
          AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
            GROUP BY TenantId, TraceId
          )
        LIMIT 1
      `,
      query_params: {
        tenantId,
        traceId,
        ...(window !== undefined
          ? { from: window.fromMs, to: window.toMs }
          : {}),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    const record = rows[0];
    if (!record) return null;
    return {
      row: fromRecord(record),
      appliedEventIds: asStringArray(record.AppliedEventIds),
    };
  }
}

/**
 * Decode a raw ClickHouse record into a {@link TraceAnalyticsRow}. The inverse
 * of {@link toClickHouseRecord}: DateTime64 columns come back as strings, the
 * UInt64 epoch-ms columns as strings, arrays/maps as themselves. A
 * pre-migration record simply omits the 00056 fields, so the parsers fall back
 * to the documented defaults (0 / empty / false).
 */
function fromRecord(record: Record<string, unknown>): TraceAnalyticsRow {
  return {
    tenantId: String(record.TenantId ?? ""),
    traceId: String(record.TraceId ?? ""),
    version: String(record.Version ?? ""),
    occurredAtMs: new Date(String(record.OccurredAt)).getTime(),
    createdAtMs: new Date(String(record.CreatedAt)).getTime(),
    updatedAtMs: new Date(String(record.UpdatedAt)).getTime(),

    traceName: String(record.TraceName ?? ""),
    topicId: asNullableString(record.TopicId),
    subTopicId: asNullableString(record.SubTopicId),
    userId: asNullableString(record.UserId),
    conversationId: asNullableString(record.ConversationId),
    customerId: asNullableString(record.CustomerId),
    origin: String(record.Origin ?? ""),
    models: asStringArray(record.Models),
    labels: asStringArray(record.Labels),

    totalCost: asNullableNumber(record.TotalCost),
    nonBilledCost: asNullableNumber(record.NonBilledCost),
    totalDurationMs: asNumber(record.TotalDurationMs),
    timeToFirstTokenMs: asNullableNumber(record.TimeToFirstTokenMs),
    tokensPerSecond: asNullableNumber(record.TokensPerSecond),
    promptTokens: asNullableNumber(record.PromptTokens),
    completionTokens: asNullableNumber(record.CompletionTokens),
    cacheReadTokens: asNullableNumber(record.CacheReadTokens),
    cacheWriteTokens: asNullableNumber(record.CacheWriteTokens),
    reasoningTokens: asNullableNumber(record.ReasoningTokens),
    hasError: Boolean(record.HasError),
    hasAnnotation:
      record.HasAnnotation === null || record.HasAnnotation === undefined
        ? null
        : Boolean(record.HasAnnotation),

    attributes: asStringMap(record.Attributes),

    spanCount: asNumber(record.SpanCount),
    annotationIds: asStringArray(record.AnnotationIds),
    rootSpanStartTimeMs: asNumber(record.RootSpanStartTimeMs),
    traceNameFromFallback: Boolean(record.TraceNameFromFallback),
    rootMetadataFromFallback: Boolean(record.RootMetadataFromFallback),
    traceNameUserOverridden: Boolean(record.TraceNameUserOverridden),
    lastEventOccurredAt: asNumber(record.LastEventOccurredAt),
  };
}
