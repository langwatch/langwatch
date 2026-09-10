import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { TraceClickHouseWriteResolver } from "../../ports/clickhouse.port.ts";
import type { TraceWindowedReadMetricsPort } from "../../ports/trace-windowed-read-metrics.port.ts";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
  type TraceAnalyticsRow,
} from "../../projections/trace-derived.projection.ts";
import {
  TraceAnalyticsProjectionRepository,
  type TraceAnalyticsProjectionRead,
} from "../projection/trace-analytics-projection.repository.ts";
import { queryWindowed } from "./windowed-read.mapper.ts";

const TABLE_NAME = "trace_analytics" as const;

const logger = createLogger("langwatch:trace:trace-analytics-repository");

const READ_BACK_FOLD_INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
  input_format_skip_unknown_fields: 0,
} as const;

/**
 * ClickHouse write shape for the slim `trace_analytics` table (ADR-034
 * Phase 2, migration 00039). 64-bit-integer columns (`TotalDurationMs`) are
 * serialised as strings in the JSONEachRow body, since JSON numbers can't
 * safely round-trip past 2^53; Float64/UInt16/UInt32/Bool stay unstringified.
 */
interface ClickHouseTraceAnalyticsWriteRecord {
  TenantId: string;
  TraceId: string;
  Version: string;
  /** The frozen storage anchor (ADR-071 step 3), not the min span start. */
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

  // ── Span timing baseline (ADR-071 step 3, migration 00061) ─────────────
  // The earliest span start, split out of OccurredAt when that column became
  // the frozen storage anchor. Same string-carried UInt64 treatment.
  EarliestSpanStartMs: string;

  // ── Durable dedup watermark (ADR-066, migration 00056) ─────────────────
  AppliedEventIds: string[];

  _retention_days: number;
}

export class TraceAnalyticsClickHouseRepository extends TraceAnalyticsProjectionRepository {
  private constructor(
    private readonly options: {
      resolveClient: TraceClickHouseWriteResolver;
      defaultRetentionDays: number;
      windowedReadMetrics?: TraceWindowedReadMetricsPort;
    },
  ) {
    super();
  }

  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
    defaultRetentionDays: number;
    windowedReadMetrics?: TraceWindowedReadMetricsPort;
  }): TraceAnalyticsClickHouseRepository {
    return new TraceAnalyticsClickHouseRepository(options);
  }

  async upsert({
    row,
    retentionDays = this.options.defaultRetentionDays,
    appliedEventIds,
  }: {
    row: TraceAnalyticsRow;
    retentionDays?: number;
    appliedEventIds?: readonly string[];
  }): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "TraceAnalyticsClickHouseRepository.upsert",
    );

    try {
      const client = await this.options.resolveClient(row.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [
          TraceAnalyticsClickHouseRepository.toClickHouseRecord(
            row,
            retentionDays,
            appliedEventIds,
          ),
        ],
        format: "JSONEachRow",
        clickhouse_settings: READ_BACK_FOLD_INSERT_SETTINGS,
      });
    } catch (error) {
      logger.warn(
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

  override async upsertBatch(
    entries: Array<{
      row: TraceAnalyticsRow;
      retentionDays?: number;
      appliedEventIds?: readonly string[];
    }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = entries[0]!.row.tenantId;
    EventUtils.validateTenantId({ tenantId }, "TraceAnalyticsClickHouseRepository.upsertBatch");
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
      const client = await this.options.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: entries.map(({ row, retentionDays, appliedEventIds }) =>
          TraceAnalyticsClickHouseRepository.toClickHouseRecord(
            row,
            retentionDays ?? this.options.defaultRetentionDays,
            appliedEventIds,
          ),
        ),
        format: "JSONEachRow",
        clickhouse_settings: READ_BACK_FOLD_INSERT_SETTINGS,
      });
    } catch (error) {
      logger.warn(
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
   * (ADR-066, migration 00056), the CH-fallthrough behind a Redis cache
   * miss. `fallback: "none"`: the fold executor owns the miss retry (see
   * {@link queryLatestVersion}), so a second ladder here would be wasted.
   */
  async findByTraceId({
    tenantId,
    traceId,
    window,
  }: {
    tenantId: string;
    traceId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<TraceAnalyticsProjectionRead | null> {
    EventUtils.validateTenantId(
      { tenantId },
      "TraceAnalyticsClickHouseRepository.findByTraceId",
    );

    try {
      return await queryWindowed<{
        row: TraceAnalyticsRow;
        appliedEventIds: string[];
      } | null>({
        table: TABLE_NAME,
        metrics: this.options.windowedReadMetrics,
        hintMs: window !== undefined ? (window.fromMs + window.toMs) / 2 : null,
        ...(window !== undefined ? { windowMs: (window.toMs - window.fromMs) / 2 } : {}),
        fallback: "none",
        isEmpty: (result) => result === null,
        run: async (fragment) =>
          await this.queryLatestVersion({
            tenantId,
            traceId,
            window: fragment ? { fromMs: fragment.fromMs, toMs: fragment.toMs } : undefined,
          }),
      });
    } catch (error) {
      // Logged with its identifiers, like every other read in this file.
      // `queryWindowed` counts the error and rethrows but knows nothing about
      // the row, so without this the deploy window ADR-066 documents — workers
      // rolling ahead of migration 00056, every read throwing
      // UNKNOWN_IDENTIFIER — surfaces as an untraceable line.
      logger.warn({ tenantId, traceId, error }, "Failed to read back trace analytics row");
      throw error;
    }
  }

  /**
   * How two versions sharing `max(UpdatedAt)` are ranked, as SQL — reachable
   * because `AbstractFoldProjection`'s monotonic stamp is only monotonic
   * within one state chain. Full tiebreak rationale (progress watermark,
   * span count, applied-id length/contents, frozen OccurredAt) in
   * dev/docs/best_practices/clickhouse-queries.md, "Breaking Ties Among
   * Versions Sharing max(UpdatedAt)".
   */
  private static readonly LATEST_VERSION_ORDER = `
        ORDER BY
          LastEventOccurredAt DESC,
          SpanCount DESC,
          length(AppliedEventIds) DESC,
          OccurredAt ASC,
          toString(AppliedEventIds) DESC`;

  /**
   * One ClickHouse attempt for {@link findByTraceId}. Dedups
   * with the IN-tuple pattern, never FINAL. `window` bounds OccurredAt on
   * the outer read only — the inner dedup is deliberately unwindowed, per
   * the "range filter on a movable column inside a dedup subquery" rule in
   * dev/docs/best_practices/clickhouse-queries.md, since OccurredAt can
   * drift after a post-miss rebuild re-stamps the frozen anchor (ADR-071).
   */
  private async queryLatestVersion({
    tenantId,
    traceId,
    window,
  }: {
    tenantId: string;
    traceId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{ row: TraceAnalyticsRow; appliedEventIds: string[] } | null> {
    const client = await this.options.resolveClient(tenantId);

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
        ${TraceAnalyticsClickHouseRepository.LATEST_VERSION_ORDER}
        LIMIT 1
      `,
      query_params: {
        tenantId,
        traceId,
        ...(window !== undefined ? { from: window.fromMs, to: window.toMs } : {}),
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<Record<string, unknown>>();
    const record = rows[0];
    if (!record) return null;
    return {
      row: TraceAnalyticsClickHouseRepository.fromRecord(record),
      appliedEventIds: TraceAnalyticsClickHouseRepository.asStringArray(record.AppliedEventIds),
    };
  }

  private static parseClickHouseDateTimeMs(value: string): number {
    const milliseconds = new Date(value.replace(" ", "T") + "Z").getTime();
    return Number.isNaN(milliseconds) ? 0 : milliseconds;
  }

  private static asNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private static asNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private static asNullableString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private static asStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }

  private static asStringMap(value: unknown): Record<string, string> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }

  private static toClickHouseRecord(
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
        row.timeToFirstTokenMs !== null ? Math.round(row.timeToFirstTokenMs) : null,
      TokensPerSecond: row.tokensPerSecond !== null ? Math.round(row.tokensPerSecond) : null,
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
      EarliestSpanStartMs: String(Math.max(0, Math.round(row.earliestSpanStartMs))),

      AppliedEventIds: [...appliedEventIds],

      // NOTE: `row.hasSignal` is deliberately NOT serialised — there is no
      // HasSignal column. Readers derive the verdict from the columns above via
      // TRACE_ANALYTICS_HAS_SIGNAL_SQL, and `fromRecord` re-derives it on the
      // way back, so the flag round-trips without a schema change.
      _retention_days: retentionDays,
    };
  }

  /**
   * Decode a raw ClickHouse record into a {@link TraceAnalyticsRow}, the
   * inverse of {@link toClickHouseRecord}. DateTime64 columns MUST go
   * through `parseClickHouseDateTimeMs`, never `new Date(str)`: ClickHouse
   * emits them zone-less, so V8 reads them as local time — skewing the
   * frozen storage anchor by the host's offset permanently on a cache miss.
   */
  private static fromRecord(record: Record<string, unknown>): TraceAnalyticsRow {
    return {
      tenantId: String(record.TenantId ?? ""),
      traceId: String(record.TraceId ?? ""),
      version: String(record.Version ?? ""),
      occurredAtMs: TraceAnalyticsClickHouseRepository.parseClickHouseDateTimeMs(
        String(record.OccurredAt),
      ),
      createdAtMs: TraceAnalyticsClickHouseRepository.parseClickHouseDateTimeMs(
        String(record.CreatedAt),
      ),
      updatedAtMs: TraceAnalyticsClickHouseRepository.parseClickHouseDateTimeMs(
        String(record.UpdatedAt),
      ),

      traceName: String(record.TraceName ?? ""),
      topicId: TraceAnalyticsClickHouseRepository.asNullableString(record.TopicId),
      subTopicId: TraceAnalyticsClickHouseRepository.asNullableString(record.SubTopicId),
      userId: TraceAnalyticsClickHouseRepository.asNullableString(record.UserId),
      conversationId: TraceAnalyticsClickHouseRepository.asNullableString(record.ConversationId),
      customerId: TraceAnalyticsClickHouseRepository.asNullableString(record.CustomerId),
      origin: String(record.Origin ?? ""),
      models: TraceAnalyticsClickHouseRepository.asStringArray(record.Models),
      labels: TraceAnalyticsClickHouseRepository.asStringArray(record.Labels),

      totalCost: TraceAnalyticsClickHouseRepository.asNullableNumber(record.TotalCost),
      nonBilledCost: TraceAnalyticsClickHouseRepository.asNullableNumber(record.NonBilledCost),
      totalDurationMs: TraceAnalyticsClickHouseRepository.asNumber(record.TotalDurationMs),
      timeToFirstTokenMs: TraceAnalyticsClickHouseRepository.asNullableNumber(
        record.TimeToFirstTokenMs,
      ),
      tokensPerSecond: TraceAnalyticsClickHouseRepository.asNullableNumber(record.TokensPerSecond),
      promptTokens: TraceAnalyticsClickHouseRepository.asNullableNumber(record.PromptTokens),
      completionTokens: TraceAnalyticsClickHouseRepository.asNullableNumber(
        record.CompletionTokens,
      ),
      cacheReadTokens: TraceAnalyticsClickHouseRepository.asNullableNumber(record.CacheReadTokens),
      cacheWriteTokens: TraceAnalyticsClickHouseRepository.asNullableNumber(
        record.CacheWriteTokens,
      ),
      reasoningTokens: TraceAnalyticsClickHouseRepository.asNullableNumber(record.ReasoningTokens),
      hasError: Boolean(record.HasError),
      hasAnnotation:
        record.HasAnnotation === null || record.HasAnnotation === undefined
          ? null
          : Boolean(record.HasAnnotation),

      attributes: TraceAnalyticsClickHouseRepository.asStringMap(record.Attributes),

      // Derived, not read — there is no HasSignal column. Mirrors
      // TRACE_ANALYTICS_HAS_SIGNAL_SQL door for door, including the version
      // door: a pre-00056 row decodes SpanCount/EarliestSpanStartMs as default
      // 0, but everything written back then had passed the write-gate.
      hasSignal:
        TraceAnalyticsClickHouseRepository.asNumber(record.SpanCount) > 0 ||
        TraceAnalyticsClickHouseRepository.asNumber(record.EarliestSpanStartMs) > 0 ||
        !["", "0"].includes(
          TraceAnalyticsClickHouseRepository.asStringMap(record.Attributes)[
            "langwatch.reserved.log_record_count"
          ] ?? "",
        ) ||
        String(record.Version ?? "") < TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,

      spanCount: TraceAnalyticsClickHouseRepository.asNumber(record.SpanCount),
      annotationIds: TraceAnalyticsClickHouseRepository.asStringArray(record.AnnotationIds),
      rootSpanStartTimeMs: TraceAnalyticsClickHouseRepository.asNumber(record.RootSpanStartTimeMs),
      traceNameFromFallback: Boolean(record.TraceNameFromFallback),
      rootMetadataFromFallback: Boolean(record.RootMetadataFromFallback),
      traceNameUserOverridden: Boolean(record.TraceNameUserOverridden),
      lastEventOccurredAt: TraceAnalyticsClickHouseRepository.asNumber(record.LastEventOccurredAt),
      earliestSpanStartMs: TraceAnalyticsClickHouseRepository.asNumber(record.EarliestSpanStartMs),
    };
  }
}
