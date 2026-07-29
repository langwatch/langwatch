import { createLogger } from "@langwatch/observability";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { parseClickHouseDateTimeMs } from "~/server/clickhouse/dateTime";
import { READ_BACK_FOLD_INSERT_SETTINGS } from "~/server/clickhouse/queryDefaults";
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
import { queryWindowed } from "../../clients/clickhouse/windowed-read";
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

  /** The persistable-signal verdict (migration 00064) — see TraceAnalyticsRow. */
  HasSignal: boolean;
  /** Per-write random identity, the LWW tiebreak's deterministic last key. */
  WriterNonce: string;

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
    RootSpanStartTimeMs: String(
      Math.max(0, Math.round(row.rootSpanStartTimeMs)),
    ),
    TraceNameFromFallback: row.traceNameFromFallback,
    RootMetadataFromFallback: row.rootMetadataFromFallback,
    TraceNameUserOverridden: row.traceNameUserOverridden,
    LastEventOccurredAt: String(
      Math.max(0, Math.round(row.lastEventOccurredAt)),
    ),
    EarliestSpanStartMs: String(
      Math.max(0, Math.round(row.earliestSpanStartMs)),
    ),

    AppliedEventIds: [...appliedEventIds],

    HasSignal: row.hasSignal,
    // A fresh nonce PER WRITE, not per row object: two writers racing the same
    // committed version produce rows the progress ranking cannot always split,
    // and this key makes `queryLatestVersion`'s LIMIT 1 deterministic across
    // reads (migration 00064). Which one wins is arbitrary — no key can know
    // which fold got further — but it is the SAME arbitrary winner every time,
    // which is what the applied-event-id dedup needs.
    WriterNonce: newWriterNonce(),

    _retention_days: retentionDays,
  };
}

/** 16 hex chars of randomness — collision-free in practice for a tiebreak key. */
function newWriterNonce(): string {
  return Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("");
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
        clickhouse_settings: READ_BACK_FOLD_INSERT_SETTINGS,
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
        clickhouse_settings: READ_BACK_FOLD_INSERT_SETTINGS,
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
   * Mapped onto `queryWindowed` with `fallback: "none"` purely so the read lands
   * on `clickhouse_windowed_read_total{table="trace_analytics"}` exactly once
   * (ADR-068): windowed calls count as `hit`, the executor's unwindowed retry as
   * `unwindowed`, a throw as `error`. Their ratio is this path's window-fit
   * signal and the baseline for the planned rate-derived limiter. `"none"` is
   * the only correct fallback here — the fold executor owns the miss retry (see
   * the unwindowed-inner note on {@link queryLatestVersion}), so a second
   * recovery ladder inside the repository would re-run a read the executor is
   * about to re-issue anyway. Same FALLBACK POLICY as the trace_summaries
   * read-back arm — but not the same cost, and the difference matters: that
   * table is `ORDER BY (TenantId, TraceId)`, so its dedup subquery is a sort-key
   * prefix seek, while this one is `(TenantId, OccurredAt, TraceId)` with the
   * key third. Leaving the dedup scope unwindowed is required for correctness
   * (see {@link queryLatestVersion}), so on this table it is a tenant-wide
   * scan across every partition, narrowed only by the skip index — the outer
   * window prunes the read but cannot prune the dedup. That, not the outer
   * read, is this query's cost floor; ADR-066's "cache misses are O(one row)"
   * describes the row count returned, not the granules opened.
   *
   * The centre/half-width round-trip is exact: fromMs/toMs are integers, so
   * their mean and half-difference are exactly representable in float64 and
   * reconstruct the caller's bounds verbatim.
   *
   * `sqlFor` is deliberately NOT used. Its docstring tells adopters to render
   * the same predicate into the inner and outer scopes of a dedup subquery;
   * this read must not do that (again, see {@link queryLatestVersion}), so the
   * bound is threaded through as plain fromMs/toMs and rendered by the query
   * builder into the OUTER scope alone.
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

    try {
      return await queryWindowed<{
        row: TraceAnalyticsRow;
        appliedEventIds: string[];
      } | null>({
        table: TABLE_NAME,
        hintMs: window !== undefined ? (window.fromMs + window.toMs) / 2 : null,
        ...(window !== undefined
          ? { windowMs: (window.toMs - window.fromMs) / 2 }
          : {}),
        fallback: "none",
        isEmpty: (result) => result === null,
        run: async (fragment) =>
          await this.queryLatestVersion({
            tenantId,
            traceId,
            window: fragment
              ? { fromMs: fragment.fromMs, toMs: fragment.toMs }
              : undefined,
          }),
      });
    } catch (error) {
      // Logged with its identifiers, like every other read in this file.
      // `queryWindowed` counts the error and rethrows but knows nothing about
      // the row, so without this the deploy window ADR-066 documents — workers
      // rolling ahead of migration 00056, every read throwing
      // UNKNOWN_IDENTIFIER — surfaces as an untraceable line.
      logger.error(
        { tenantId, traceId, error },
        "Failed to read back trace analytics row",
      );
      throw error;
    }
  }

  /**
   * One ClickHouse attempt for {@link findByTraceIdWithApplied}.
   *
   * Dedups with the IN-tuple pattern (max(UpdatedAt) per key), never FINAL: the
   * ReplacingMergeTree only physically collapses rows sharing the full sort key
   * `(TenantId, OccurredAt, TraceId)`. Freezing the anchor (ADR-071 step 3) is
   * what lets a trace's versions share that key, but rows written before the
   * freeze — and a trace whose anchor a post-miss rebuild re-stamped — still
   * carry more than one OccurredAt, so superseded versions persist until TTL.
   * The inner dedup subquery reads only three narrow scalar columns —
   * `TenantId`, `TraceId` and `max(UpdatedAt)`, the last of which is the RMT
   * version column rather than part of the sort key — and no heavy Attributes
   * map. It is NOT a keyed seek: `TraceId` is third in the sort key and the
   * inner scope carries no `OccurredAt` predicate (deliberately — see below), so
   * it is a tenant-wide scan over the trace's versions. What keeps it cheap is
   * the narrow column set, not the key prefix.
   *
   * `window` bounds OccurredAt on the OUTER read only, keeping it a
   * partition-pruned point read. The inner dedup is deliberately UNWINDOWED so
   * it resolves the TRUE latest version: windowing it too would let a trace
   * whose latest version's OccurredAt drifted outside the window read back as a
   * stale older version (a non-null result no fallback catches). Unwindowed, the
   * same case yields an empty outer read, which the executor's unwindowed retry
   * recovers.
   *
   * ORDER BY breaks UpdatedAt ties, and is NOT the
   * `ORDER BY <version> DESC LIMIT 1` anti-pattern in
   * dev/docs/best_practices/clickhouse-queries.md: the IN-tuple has already cut
   * the input to the rows sharing max(UpdatedAt) — normally one, occasionally
   * two — so the sort reads no column `SELECT *` was not already materialising
   * for those same rows, rather than every unmerged version of the trace.
   *
   * The tie is reachable despite that doc's "no ties possible" claim.
   * `AbstractFoldProjection` stamps `max(Date.now(), prev + 1)`, which is
   * monotonic only WITHIN one state chain; two writers that resumed from the
   * same committed version can land on the same ms. Both rows then satisfy the
   * IN-tuple and a bare LIMIT 1 picks arbitrarily — handing the fold stale
   * state it resumes from and rewrites, silently dropping the other version's
   * contributions and its applied-id watermark.
   *
   * The tiebreak orders by how far each version's fold actually got:
   *   1. `LastEventOccurredAt DESC` — the fold's own progress watermark
   *      (`max(prev, event.occurredAt)`, so non-decreasing): the version that
   *      applied the latest event wins.
   *   2. `SpanCount DESC` — folds only ever increment it, so among versions
   *      that saw the same latest event time, more spans folded = more complete.
   *   3. `length(AppliedEventIds) DESC` — more deliveries absorbed. Last of the
   *      three because the watermark is a bounded ring, so it saturates.
   *   4. `OccurredAt ASC` — a last-resort tie-break, and NOT a progress signal:
   *      since ADR-071 step 3 OccurredAt is the frozen storage anchor, equal
   *      across a trace's versions except where a rebuild from an absent row
   *      re-derived it — which can land either side of the original — so no
   *      direction of it says which version folded further. The three keys above
   *      it are the progress ranking. Reading the array length costs only its
   *      offsets column, and every other key is a scalar already in the row.
   *
   * The four progress keys are BEST-EFFORT, not total: two concurrent versions
   * can be equal on every one — same latest event, same span count, same
   * saturated watermark length, and (precisely because the anchor is now
   * frozen) the same OccurredAt. `WriterNonce DESC` (migration 00064) closes
   * what that used to leave open: a bare `LIMIT 1` picked ARBITRARILY, so two
   * reads could crown different winners and the fold would resume from one
   * version while the applied-id watermark it trusted came from the other. The
   * nonce cannot know which fold got further — no persisted key can — but it
   * makes the pick DETERMINISTIC: the same winner every read, which is what
   * the dedup machinery actually needs. Rows written before the nonce existed
   * carry '' and rank below any nonce-carrying version.
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
        ORDER BY
          LastEventOccurredAt DESC,
          SpanCount DESC,
          length(AppliedEventIds) DESC,
          OccurredAt ASC,
          WriterNonce DESC
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
 * pre-migration record simply omits the 00056 / 00061 fields, so the parsers
 * fall back to the documented defaults (0 / empty / false).
 *
 * DateTime64 columns MUST go through `parseClickHouseDateTimeMs`, never
 * `new Date(str)`: ClickHouse emits them without a zone suffix
 * ("2026-07-24 12:00:00.123") and V8 reads a bare datetime as LOCAL time. On a
 * non-UTC host that skews the storage anchor by the machine's offset, and the
 * fold reads that anchor back as frozen and writes it out again — so the row
 * moves partition and shifts its TTL deadline by the offset, permanently, on
 * the first cache miss. (The span timing baseline is immune by construction:
 * `EarliestSpanStartMs` rides as a UInt64 epoch-ms string, which is exactly why
 * migration 00056 chose that type for the read-back columns.)
 */
function fromRecord(record: Record<string, unknown>): TraceAnalyticsRow {
  return {
    tenantId: String(record.TenantId ?? ""),
    traceId: String(record.TraceId ?? ""),
    version: String(record.Version ?? ""),
    occurredAtMs: parseClickHouseDateTimeMs(String(record.OccurredAt)),
    createdAtMs: parseClickHouseDateTimeMs(String(record.CreatedAt)),
    updatedAtMs: parseClickHouseDateTimeMs(String(record.UpdatedAt)),

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

    // Absent on a pre-00064 record → true: every row an old build wrote had,
    // by construction, passed the persistable-signal gate.
    hasSignal:
      record.HasSignal === null || record.HasSignal === undefined
        ? true
        : Boolean(record.HasSignal),

    spanCount: asNumber(record.SpanCount),
    annotationIds: asStringArray(record.AnnotationIds),
    rootSpanStartTimeMs: asNumber(record.RootSpanStartTimeMs),
    traceNameFromFallback: Boolean(record.TraceNameFromFallback),
    rootMetadataFromFallback: Boolean(record.RootMetadataFromFallback),
    traceNameUserOverridden: Boolean(record.TraceNameUserOverridden),
    lastEventOccurredAt: asNumber(record.LastEventOccurredAt),
    earliestSpanStartMs: asNumber(record.EarliestSpanStartMs),
  };
}
