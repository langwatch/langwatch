import type { Authorization } from "@langwatch/authorization";
import {
  type ClickHouseQueryClient,
  queryWindowed,
  tenantScopeKey,
} from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  evaluationOutcomeRecordedEventDataSchema,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,
} from "@langwatch/trace-contract";
import { z } from "zod";

import type {
  TraceAnalyticsRow,
  TraceEvaluationOutcome,
} from "../../eventing/trace-derived.projection.ts";
import {
  type TraceAnalyticsWrittenMetadataColumns,
  traceAnalyticsMetadataColumns,
  traceAnalyticsWrittenMetadataColumns,
} from "../../rules/trace-widget-columns.rules.ts";
import {
  TraceAnalyticsProjectionRepository,
  type TraceAnalyticsProjectionRead,
} from "../trace-analytics-projection.repository.ts";
import { traceAnalytics } from "./clickhouse.trace-analytics.table.ts";
import type { TraceClickHouseWriteResolver } from "./clickhouse.trace-member-client.repository.ts";

const analyticsRecordRowsSchema = z.array(z.record(z.string(), z.unknown()));

const occurredAtRowsSchema = z.array(
  z.object({ TraceId: z.string(), OccurredAtMs: z.union([z.number(), z.string()]) }),
);

const evaluationOutcomesSchema = z.record(
  z.string(),
  evaluationOutcomeRecordedEventDataSchema.omit({ evaluationId: true }),
);

const asString = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" || typeof value === "bigint"
    ? String(value)
    : "";

const TABLE_NAME = "trace_analytics" as const;

const logger = createLogger("langwatch:trace:trace-analytics-repository");

const READ_BACK_FOLD_INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
  input_format_skip_unknown_fields: 0,
  // The fold no longer sends goose 00126's MATERIALIZED columns (see
  // traceAnalyticsWrittenMetadataColumns). Kept for when it writes them again (ADR-006 step 4).
  insert_allow_materialized_columns: 1,
} as const;

/**
 * ClickHouse write shape for `trace_analytics` (ADR-034 Phase 2, migration
 * 00039). 64-bit-integer columns are serialised as strings in JSONEachRow
 * (JSON numbers can't round-trip past 2^53); other types stay unstringified.
 */
type ClickHouseTraceAnalyticsWriteRecord = {
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
  UnpricedSpanCount: number;
  UnpricedModels: string[];
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

  // ── The stock widgets' metadata columns (migrations 00126, 00128) ──────
} & TraceAnalyticsWrittenMetadataColumns & {
    // ── Read-back state (ADR-066, migration 00056) ─────────────────────────
    SpanCount: number;
    AnnotationIds: string[];
    // UInt64 epoch-ms columns ride as strings, like TotalDurationMs, exact
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

    // ── Evaluation outcomes and the rows they left (trace ADR-003, migration 00129) ──
    EvaluationOutcomes: string;
    EvaluationRowsDigest: string;

    _retention_days: number;
  };

/** Every column the fold writes, named, so a column the row lacks is never defaulted silently. */
function writeColumns(
  records: readonly ClickHouseTraceAnalyticsWriteRecord[],
): [string, ...string[]] {
  const [first] = records;
  if (!first) throw new Error("trace_analytics insert with no rows");
  return Object.keys(first) as [string, ...string[]];
}

/** The proof's reading scope: analytics rows are read as traces. */
function analyticsScope(authorization: Authorization) {
  return tenantScope.fromProof({ authorization, reads: "traces" });
}

/** The columns `latestOf` decodes; the MATERIALIZED metadata ones re-derive from the map. */
const LATEST_ROW_SELECTION = {
  TenantId: traceAnalytics.TenantId,
  TraceId: traceAnalytics.TraceId,
  Version: traceAnalytics.Version,
  OccurredAt: traceAnalytics.OccurredAt,
  CreatedAt: traceAnalytics.CreatedAt,
  UpdatedAt: traceAnalytics.UpdatedAt,
  TraceName: traceAnalytics.TraceName,
  TopicId: traceAnalytics.TopicId,
  SubTopicId: traceAnalytics.SubTopicId,
  UserId: traceAnalytics.UserId,
  ConversationId: traceAnalytics.ConversationId,
  CustomerId: traceAnalytics.CustomerId,
  Origin: traceAnalytics.Origin,
  Models: traceAnalytics.Models,
  Labels: traceAnalytics.Labels,
  TotalCost: traceAnalytics.TotalCost,
  NonBilledCost: traceAnalytics.NonBilledCost,
  UnpricedSpanCount: traceAnalytics.UnpricedSpanCount,
  UnpricedModels: traceAnalytics.UnpricedModels,
  TotalDurationMs: traceAnalytics.TotalDurationMs,
  TimeToFirstTokenMs: traceAnalytics.TimeToFirstTokenMs,
  TokensPerSecond: traceAnalytics.TokensPerSecond,
  PromptTokens: traceAnalytics.PromptTokens,
  CompletionTokens: traceAnalytics.CompletionTokens,
  CacheReadTokens: traceAnalytics.CacheReadTokens,
  CacheWriteTokens: traceAnalytics.CacheWriteTokens,
  ReasoningTokens: traceAnalytics.ReasoningTokens,
  HasError: traceAnalytics.HasError,
  HasAnnotation: traceAnalytics.HasAnnotation,
  Attributes: traceAnalytics.Attributes,
  SpanCount: traceAnalytics.SpanCount,
  AnnotationIds: traceAnalytics.AnnotationIds,
  RootSpanStartTimeMs: traceAnalytics.RootSpanStartTimeMs,
  TraceNameFromFallback: traceAnalytics.TraceNameFromFallback,
  RootMetadataFromFallback: traceAnalytics.RootMetadataFromFallback,
  TraceNameUserOverridden: traceAnalytics.TraceNameUserOverridden,
  LastEventOccurredAt: traceAnalytics.LastEventOccurredAt,
  AppliedEventIds: traceAnalytics.AppliedEventIds,
  EarliestSpanStartMs: traceAnalytics.EarliestSpanStartMs,
  EvaluationOutcomes: traceAnalytics.EvaluationOutcomes,
  EvaluationRowsDigest: traceAnalytics.EvaluationRowsDigest,
};

/** Each trace's anchor, its latest version's OccurredAt: by the caller's window, else the index. */
function anchorsStatement({
  authorization,
  traceIds,
  window,
}: {
  authorization: Authorization;
  traceIds: readonly string[];
  window?: { fromMs: number; toMs: number };
}) {
  const ids = [...new Set(traceIds)];
  const read = clickhouseRead({ scope: analyticsScope(authorization) })
    .from(traceAnalytics)
    .withinWindows()
    .select({
      TraceId: traceAnalytics.TraceId,
      OccurredAtMs: fn.toUnixTimestamp64Milli(
        fn.argMax(traceAnalytics.OccurredAt, traceAnalytics.UpdatedAt),
      ),
    });
  const bounded =
    window === undefined
      ? read.where(({ idBound }) => idBound(traceAnalytics.TraceId, ids))
      : read.where(({ and, gte, lte, oneOf }) =>
          and(
            oneOf(traceAnalytics.TraceId, ids),
            gte(traceAnalytics.OccurredAt, window.fromMs),
            lte(traceAnalytics.OccurredAt, window.toMs),
          ),
        );
  return bounded.groupBy(traceAnalytics.TenantId, traceAnalytics.TraceId).build();
}

/** One trace's analytics rows under the proof's windowed fence, before the election. */
function latestRowRead(authorization: Authorization) {
  return clickhouseRead({ scope: analyticsScope(authorization) })
    .from(traceAnalytics)
    .withinWindows()
    .select(LATEST_ROW_SELECTION);
}

/**
 * Elects the latest version, then ranks rows sharing `max(UpdatedAt)`: reachable because the
 * fold's stamp is monotonic only per state chain, and the IN-tuple keeps every tie for this
 * ORDER BY. Full tiebreak rationale in dev/docs/best_practices/clickhouse-queries.md.
 */
function rankedLatestVersion(read: ReturnType<typeof latestRowRead>) {
  return read
    .latestVersion()
    .orderBy(traceAnalytics.TenantId, "ASC")
    .orderBy(traceAnalytics.LastEventOccurredAt, "DESC")
    .orderBy(traceAnalytics.SpanCount, "DESC")
    .orderBy(fn.length(traceAnalytics.AppliedEventIds), "DESC")
    .orderBy(traceAnalytics.OccurredAt, "ASC")
    .orderBy(fn.toString(traceAnalytics.AppliedEventIds), "DESC")
    .limit(1)
    .build();
}

/** The latest version by the TraceId index, which bounds the election as well. */
function latestVersionByIdStatement({
  authorization,
  traceId,
}: {
  authorization: Authorization;
  traceId: string;
}) {
  return rankedLatestVersion(
    latestRowRead(authorization).where(({ idBound }) => idBound(traceAnalytics.TraceId, traceId)),
  );
}

/** The latest version; a caller's window bounds the outer read only, never the election. */
function latestVersionStatement({
  authorization,
  traceId,
  window,
}: {
  authorization: Authorization;
  traceId: string;
  window?: { fromMs: number; toMs: number };
}) {
  const read = latestRowRead(authorization).where(({ eq }) => eq(traceAnalytics.TraceId, traceId));
  return rankedLatestVersion(
    window === undefined
      ? read
      : read.where(
          ({ and, gte, lte }) =>
            and(
              gte(traceAnalytics.OccurredAt, window.fromMs),
              lte(traceAnalytics.OccurredAt, window.toMs),
            ),
          { inElection: false },
        ),
  );
}

export class TraceAnalyticsClickHouseRepository extends TraceAnalyticsProjectionRepository {
  /** Writes resolve the tenant's own client; reads go through the proof's fence (ADR-177). */
  private constructor(
    private readonly options: {
      resolveClient: TraceClickHouseWriteResolver;
      reader: Pick<ClickHouseQueryClient, "read">;
    },
  ) {
    super();
  }

  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
    reader: Pick<ClickHouseQueryClient, "read">;
  }): TraceAnalyticsClickHouseRepository {
    return new TraceAnalyticsClickHouseRepository(options);
  }

  async upsert({
    row,
    retentionDays,
    appliedEventIds,
  }: {
    row: TraceAnalyticsRow;
    retentionDays: number;
    appliedEventIds?: readonly string[];
  }): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "TraceAnalyticsClickHouseRepository.upsert",
    );

    try {
      const client = await this.options.resolveClient(row.tenantId);
      const values = [
        TraceAnalyticsClickHouseRepository.toClickHouseRecord(row, retentionDays, appliedEventIds),
      ];
      await client.insert({
        table: TABLE_NAME,
        values,
        columns: writeColumns(values),
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
    entries: {
      row: TraceAnalyticsRow;
      retentionDays: number;
      appliedEventIds?: readonly string[];
    }[],
  ): Promise<void> {
    if (entries.length === 0) return;

    const tenantId = entries[0]!.row.tenantId;
    EventUtils.validateTenantId({ tenantId }, "TraceAnalyticsClickHouseRepository.upsertBatch");
    for (const { row } of entries) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError({
          operation: "TraceAnalyticsClickHouseRepository.upsertBatch",
          message: "all rows in a single batch must share the same tenantId",
          tenantId,
          context: { mismatchedTenantId: row.tenantId },
        });
      }
    }

    try {
      const client = await this.options.resolveClient(tenantId);
      const values = entries.map(({ row, retentionDays, appliedEventIds }) =>
        TraceAnalyticsClickHouseRepository.toClickHouseRecord(row, retentionDays, appliedEventIds),
      );
      await client.insert({
        table: TABLE_NAME,
        values,
        columns: writeColumns(values),
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
   * (ADR-066), the CH-fallthrough behind a Redis miss. `fallback: "none"`:
   * the fold executor owns the miss retry; its own-only proof reads the row it wrote.
   */
  async findByTraceId({
    authorization,
    traceId,
    window,
  }: {
    authorization: Authorization;
    traceId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<TraceAnalyticsProjectionRead | null> {
    try {
      // No window: the index's range (once ready) bounds the inner dedup too, since it covers every
      // version's OccurredAt; flag off, this is today's unbounded read.
      if (window === undefined) {
        return await this.queryLatestVersionById({ authorization, traceId });
      }
      return await queryWindowed<TraceAnalyticsProjectionRead | null>({
        table: TABLE_NAME,
        hintMs: window !== undefined ? (window.fromMs + window.toMs) / 2 : null,
        ...(window !== undefined ? { windowMs: (window.toMs - window.fromMs) / 2 } : {}),
        fallback: "none",
        isEmpty: (result) => result === null,
        run: async (fragment) =>
          this.queryLatestVersion({
            authorization,
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
      logger.warn(
        { traceId, scope: tenantScopeKey({ authorization, reads: "traces" }), error },
        "Failed to read back trace analytics row",
      );
      throw error;
    }
  }

  /**
   * Many traces' anchors in one read, bounded by the caller's window on the partition key, or by
   * the TraceId index when there is none.
   */
  override async findOccurredAtByTraceIds({
    authorization,
    traceIds,
    window,
  }: {
    authorization: Authorization;
    traceIds: readonly string[];
    window?: { fromMs: number; toMs: number };
  }): Promise<{ traceId: string; occurredAtMs: number }[]> {
    if (traceIds.length === 0) return [];
    if (window === undefined) return this.queryOccurredAtByTraceIds({ authorization, traceIds });
    const result = await this.options.reader.read({
      // ID_BOUND_SKIP: many ids at once, bounded by the caller's OccurredAt window instead.
      statement: anchorsStatement({ authorization, traceIds, window }),
      table: traceAnalytics.$table.name,
    });
    return TraceAnalyticsClickHouseRepository.anchorsOf(result.rows);
  }

  private static anchorsOf(rows: unknown): { traceId: string; occurredAtMs: number }[] {
    return occurredAtRowsSchema.parse(rows).map((row) => ({
      traceId: row.TraceId,
      occurredAtMs: Number(row.OccurredAtMs),
    }));
  }

  /** {@link findOccurredAtByTraceIds} with no window: the index bounds it once ready. */
  private async queryOccurredAtByTraceIds({
    authorization,
    traceIds,
  }: {
    authorization: Authorization;
    traceIds: readonly string[];
  }): Promise<{ traceId: string; occurredAtMs: number }[]> {
    const result = await this.options.reader.read({
      statement: anchorsStatement({ authorization, traceIds }),
      table: traceAnalytics.$table.name,
      idBound: { fallback: "unbounded" },
    });
    return TraceAnalyticsClickHouseRepository.anchorsOf(result.rows);
  }

  /**
   * {@link findByTraceId} with no window: the trace_analytics index's range bounds the inner
   * dedup too, since it covers every version's OccurredAt; before it is ready, today's unbounded
   * read. The fold executor owns the miss retry, so nothing widens here.
   */
  private async queryLatestVersionById({
    authorization,
    traceId,
  }: {
    authorization: Authorization;
    traceId: string;
  }): Promise<TraceAnalyticsProjectionRead | null> {
    const result = await this.options.reader.read({
      statement: latestVersionByIdStatement({ authorization, traceId }),
      table: traceAnalytics.$table.name,
      idBound: { fallback: "none" },
    });
    return TraceAnalyticsClickHouseRepository.latestOf(
      analyticsRecordRowsSchema.parse(result.rows),
    );
  }

  /**
   * One ClickHouse attempt for {@link findByTraceId}. Dedups with the IN-tuple pattern, never
   * FINAL. A caller's `window` bounds the outer read only (ADR-071).
   */
  private async queryLatestVersion({
    authorization,
    traceId,
    window,
  }: {
    authorization: Authorization;
    traceId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<TraceAnalyticsProjectionRead | null> {
    const result = await this.options.reader.read({
      // ID_BOUND_SKIP: a fold read-back's own window, on the outer read only (ADR-071).
      statement: latestVersionStatement({ authorization, traceId, window }),
      table: traceAnalytics.$table.name,
    });
    return TraceAnalyticsClickHouseRepository.latestOf(
      analyticsRecordRowsSchema.parse(result.rows),
    );
  }

  private static latestOf(
    rows: readonly Record<string, unknown>[],
  ): TraceAnalyticsProjectionRead | null {
    const record = rows[0];
    if (!record) return null;
    const outcomes = TraceAnalyticsClickHouseRepository.decodeOutcomes({
      text: asString(record.EvaluationOutcomes),
      traceId: asString(record.TraceId),
    });
    return {
      row: {
        ...TraceAnalyticsClickHouseRepository.fromRecord(record),
        evaluationOutcomes: outcomes.readable ? outcomes.outcomes : {},
      },
      appliedEventIds: TraceAnalyticsClickHouseRepository.asStringArray(record.AppliedEventIds),
      ...(outcomes.readable ? {} : { undecodable: true as const }),
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
      UnpricedSpanCount: Math.max(0, Math.round(row.unpricedSpanCount)),
      UnpricedModels: row.unpricedModels,
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
      ...traceAnalyticsWrittenMetadataColumns(
        row.metadataColumns ?? traceAnalyticsMetadataColumns(row.attributes),
      ),

      SpanCount: Math.max(0, Math.round(row.spanCount)),
      AnnotationIds: row.annotationIds,
      RootSpanStartTimeMs: String(Math.max(0, Math.round(row.rootSpanStartTimeMs))),
      TraceNameFromFallback: row.traceNameFromFallback,
      RootMetadataFromFallback: row.rootMetadataFromFallback,
      TraceNameUserOverridden: row.traceNameUserOverridden,
      LastEventOccurredAt: String(Math.max(0, Math.round(row.lastEventOccurredAt))),
      EarliestSpanStartMs: String(Math.max(0, Math.round(row.earliestSpanStartMs))),

      AppliedEventIds: [...appliedEventIds],

      EvaluationOutcomes: TraceAnalyticsClickHouseRepository.encodeOutcomes(
        row.evaluationOutcomes ?? {},
      ),
      EvaluationRowsDigest: row.evaluationRowsDigest ?? "",

      // NOTE: `row.hasSignal` is deliberately NOT serialised — there is no
      // HasSignal column. Readers derive the verdict from the columns above via
      // analytics' has-signal predicate, and `fromRecord` re-derives it on the
      // way back, so the flag round-trips without a schema change.
      _retention_days: retentionDays,
    };
  }

  /**
   * Decode a raw ClickHouse record into a {@link TraceAnalyticsRow}. DateTime64
   * columns MUST go through `parseClickHouseDateTimeMs`, never `new Date(str)`:
   * ClickHouse emits them zone-less, skewing the anchor by the host's offset.
   */
  private static fromRecord(record: Record<string, unknown>): TraceAnalyticsRow {
    return {
      tenantId: asString(record.TenantId),
      traceId: asString(record.TraceId),
      version: asString(record.Version),
      occurredAtMs: TraceAnalyticsClickHouseRepository.parseClickHouseDateTimeMs(
        String(record.OccurredAt),
      ),
      createdAtMs: TraceAnalyticsClickHouseRepository.parseClickHouseDateTimeMs(
        String(record.CreatedAt),
      ),
      updatedAtMs: TraceAnalyticsClickHouseRepository.parseClickHouseDateTimeMs(
        String(record.UpdatedAt),
      ),

      traceName: asString(record.TraceName),
      topicId: TraceAnalyticsClickHouseRepository.asNullableString(record.TopicId),
      subTopicId: TraceAnalyticsClickHouseRepository.asNullableString(record.SubTopicId),
      userId: TraceAnalyticsClickHouseRepository.asNullableString(record.UserId),
      conversationId: TraceAnalyticsClickHouseRepository.asNullableString(record.ConversationId),
      customerId: TraceAnalyticsClickHouseRepository.asNullableString(record.CustomerId),
      origin: asString(record.Origin),
      models: TraceAnalyticsClickHouseRepository.asStringArray(record.Models),
      labels: TraceAnalyticsClickHouseRepository.asStringArray(record.Labels),

      totalCost: TraceAnalyticsClickHouseRepository.asNullableNumber(record.TotalCost),
      nonBilledCost: TraceAnalyticsClickHouseRepository.asNullableNumber(record.NonBilledCost),
      unpricedSpanCount: TraceAnalyticsClickHouseRepository.asNumber(record.UnpricedSpanCount),
      unpricedModels: TraceAnalyticsClickHouseRepository.asStringArray(record.UnpricedModels),
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
      // Not read back: the fold re-derives them from the map on its next write.
      metadataColumns: traceAnalyticsMetadataColumns(
        TraceAnalyticsClickHouseRepository.asStringMap(record.Attributes),
      ),

      // Derived, not read — there is no HasSignal column. Mirrors
      // analytics' has-signal predicate door for door, including the version
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
        asString(record.Version) < TRACE_ANALYTICS_PROJECTION_VERSION_PRE_SPLIT,

      spanCount: TraceAnalyticsClickHouseRepository.asNumber(record.SpanCount),
      annotationIds: TraceAnalyticsClickHouseRepository.asStringArray(record.AnnotationIds),
      rootSpanStartTimeMs: TraceAnalyticsClickHouseRepository.asNumber(record.RootSpanStartTimeMs),
      traceNameFromFallback: Boolean(record.TraceNameFromFallback),
      rootMetadataFromFallback: Boolean(record.RootMetadataFromFallback),
      traceNameUserOverridden: Boolean(record.TraceNameUserOverridden),
      lastEventOccurredAt: TraceAnalyticsClickHouseRepository.asNumber(record.LastEventOccurredAt),
      earliestSpanStartMs: TraceAnalyticsClickHouseRepository.asNumber(record.EarliestSpanStartMs),
      evaluationRowsDigest: asString(record.EvaluationRowsDigest),
    };
  }

  /** '' for none, so a trace without outcomes keeps the column's default. */
  private static encodeOutcomes(
    outcomes: Readonly<Record<string, TraceEvaluationOutcome>>,
  ): string {
    return Object.keys(outcomes).length === 0 ? "" : JSON.stringify(outcomes);
  }

  /**
   * The column's JSON; '' (an older row) is none. Anything unparseable is unreadable, never none:
   * folding onto none would store '' over the outcomes, so the read reports the row undecodable.
   */
  private static decodeOutcomes({
    text,
    traceId,
  }: {
    text: string;
    traceId: string;
  }): { readable: true; outcomes: Record<string, TraceEvaluationOutcome> } | { readable: false } {
    if (text === "") return { readable: true, outcomes: {} };
    try {
      return { readable: true, outcomes: evaluationOutcomesSchema.parse(JSON.parse(text)) };
    } catch (error) {
      logger.warn(
        { traceId, error },
        "Unreadable trace_analytics EvaluationOutcomes; the fold rebuilds the trace from its events",
      );
      return { readable: false };
    }
  }
}
