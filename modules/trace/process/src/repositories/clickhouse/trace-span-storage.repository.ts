import { DEFAULT_PARTITION_WINDOW_MS, queryWindowed } from "@langwatch/clickhouse-client";
import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { NormalizedSpan, SpanInsertData } from "@langwatch/trace-contract";

import { TraceStoredSpanReaderRepository } from "../read/trace-stored-span-reader.repository.ts";
import { TraceSpanStorageRepository } from "../span-storage-write.repository.ts";
import type { TraceClickHouseWriteResolver } from "../trace-clickhouse-client.repository.ts";
import {
  type FullSpanRow,
  mapChRowToNormalized,
  serializeAttributes,
} from "./stored-span-row.mapper.ts";

const logger = createLogger("langwatch:trace:span-storage-repository");

const TABLE_NAME = "stored_spans" as const;

// Span insert settings: input_format_json_throw_on_bad_escape_sequence=0
// tolerates lone surrogates from truncated emoji/garbage text; filters 13+ prod dead-letters
const SPAN_INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
  input_format_json_throw_on_bad_escape_sequence: 0,
} as const;

// Derivation projection: scalar columns only (drops Events/Links which cause read errors);
// mapChRowToNormalized defaults to []. Never backs spans that render
const DERIVATION_SPAN_SELECT = `
  SpanId,
  TraceId,
  TenantId,
  ParentSpanId,
  ParentTraceId,
  ParentIsRemote,
  Sampled,
  toUnixTimestamp64Milli(StartTime) AS StartTimeMs,
  toUnixTimestamp64Milli(EndTime) AS EndTimeMs,
  DurationMs,
  SpanName,
  SpanKind,
  ResourceAttributes,
  SpanAttributes,
  StatusCode,
  StatusMessage,
  ScopeName,
  ScopeVersion,
  Cost,
  NonBilledCost
`;

// Single-span fetch settings: max_memory_usage caps pathological spans;
// lazy_materialization keeps 15 KB vs 9.7 MB on deferred heavy columns
const SINGLE_SPAN_FETCH_SETTINGS = {
  max_memory_usage: String(2 * 1024 * 1024 * 1024),
  query_plan_optimize_lazy_materialization: "1",
} as const;

/**
 * Replaces specified number-typed fields with Date for the DateTime64 write
 * path. Declared here, not imported, because the application's copy sits
 * behind its own path alias; scenario and experiment keep the same local copy.
 */
type WithDateWrites<T, K extends keyof T> = {
  [P in keyof T]: P extends K
    ? T[P] extends number
      ? Date
      : T[P] extends number | null
        ? Date | null
        : T[P] extends number[]
          ? Date[]
          : T[P]
    : T[P];
};

type ClickHouseSpanWriteRecord = WithDateWrites<
  ClickHouseSpanRecord,
  "StartTime" | "EndTime" | "Events.Timestamp" | "CreatedAt" | "UpdatedAt"
>;

// stored_spans row: ReplacingMergeTree keyed on (TenantId, TraceId, SpanId),
// partitioned by toYearWeek(StartTime). Wrong StartTime breaks dedup and partitioning
interface ClickHouseSpanRecord {
  ProjectionId: string;
  TenantId: string;
  TraceId: string;
  SpanId: string;
  ParentSpanId: string | null;
  ParentTraceId: string | null;
  ParentIsRemote: boolean | null;
  Sampled: boolean;
  StartTime: number;
  EndTime: number;
  DurationMs: number;
  SpanName: string;
  SpanKind: number;
  ServiceName: string;
  ResourceAttributes: Record<string, string>;
  SpanAttributes: Record<string, string>;
  StatusCode: number | null;
  StatusMessage: string | null;
  ScopeName: string;
  ScopeVersion: string | null;
  "Events.Timestamp": number[];
  "Events.Name": string[];
  "Events.Attributes": Record<string, string>[];
  "Links.TraceId": string[];
  "Links.SpanId": string[];
  "Links.Attributes": Record<string, string>[];
  DroppedAttributesCount: 0;
  DroppedEventsCount: 0;
  DroppedLinksCount: 0;
  Cost: number | null;
  NonBilledCost: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  _retention_days: number;
}

// stored_spans write path harvested from application (no read half needed).
// Retention fallback injected (package cannot read deployment environment)
export class TraceSpanStorageClickHouseRepository extends TraceSpanStorageRepository {
  private constructor(
    private readonly options: {
      resolveClient: TraceClickHouseWriteResolver;
      defaultRetentionDays: number;
    },
  ) {
    super();
  }

  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
    /** The fallback stamped on a span that declares no retention of its own. */
    defaultRetentionDays: number;
  }): TraceSpanStorageClickHouseRepository {
    return new TraceSpanStorageClickHouseRepository(options);
  }

  async insertSpan(span: SpanInsertData): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: span.tenantId },
      "TraceSpanStorageClickHouseRepository.insertSpan",
    );

    try {
      const client = await this.options.resolveClient(span.tenantId);
      const record = this.toClickHouseRecord(span);
      await client.insert({
        table: TABLE_NAME,
        values: [record],
        format: "JSONEachRow",
        clickhouse_settings: SPAN_INSERT_SETTINGS,
      });
    } catch (error) {
      logger.warn(
        {
          tenantId: span.tenantId,
          spanId: span.spanId,
          traceId: span.traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert span into ClickHouse",
      );
      throw error;
    }
  }

  /**
   * One insert for the whole batch — the ingestion path. A per-span insert
   * would multiply round trips, async-insert buffers and merge parts by the
   * batch size. Never rewrite this as a loop over {@link insertSpan}.
   */
  async insertSpans(spans: SpanInsertData[]): Promise<void> {
    if (spans.length === 0) return;

    for (const span of spans) {
      EventUtils.validateTenantId(
        { tenantId: span.tenantId },
        "TraceSpanStorageClickHouseRepository.insertSpans",
      );
    }

    // Enforce that a single bulk insert only writes spans for one tenant —
    // the client is resolved once from the first span's tenantId, so mixed
    // batches would silently route another tenant's data through the wrong
    // (possibly private) ClickHouse instance.
    const tenantId = spans[0]!.tenantId;
    for (const span of spans) {
      if (span.tenantId !== tenantId) {
        throw new SecurityError(
          "TraceSpanStorageClickHouseRepository.insertSpans",
          "all spans in a single batch must share the same tenantId",
          tenantId,
          { mismatchedTenantId: span.tenantId },
        );
      }
    }

    try {
      const client = await this.options.resolveClient(tenantId);
      const records = spans.map((span) => this.toClickHouseRecord(span));
      await client.insert({
        table: TABLE_NAME,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: SPAN_INSERT_SETTINGS,
      });
    } catch (error) {
      logger.warn(
        {
          count: spans.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to bulk insert spans into ClickHouse",
      );
      throw error;
    }
  }

  // One read: single stored span by identity for derivation consumer. HINT REQUIRED
  // (span's own start, not ingest time). Returns empty events/links. Do not render
  async findNormalizedSpanById(input: {
    tenantId: string;
    traceId: string;
    spanId: string;
    occurredAtMs: number;
  }): Promise<NormalizedSpan | null> {
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "TraceSpanStorageClickHouseRepository.findNormalizedSpanById",
    );

    try {
      return await queryWindowed<NormalizedSpan | null>({
        table: TABLE_NAME,
        hintMs: input.occurredAtMs,
        windowMs: DEFAULT_PARTITION_WINDOW_MS,
        fallback: "none",
        isEmpty: (row) => row === null,
        run: (window) => this.fetchNormalizedSpanRow(input, window),
      });
    } catch (error) {
      logger.warn(
        {
          tenantId: input.tenantId,
          traceId: input.traceId,
          spanId: input.spanId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to get normalized span by id from ClickHouse",
      );
      throw error;
    }
  }

  // Latest version by IN-tuple dedup: the inner GROUP BY reads only keys and
  // UpdatedAt, the outer SELECT reads heavy columns for the winning row only.
  private async fetchNormalizedSpanRow(
    input: { tenantId: string; traceId: string; spanId: string },
    window: { fromMs: number; toMs: number } | null,
  ): Promise<NormalizedSpan | null> {
    const partition =
      window === null
        ? ""
        : "AND StartTime BETWEEN fromUnixTimestamp64Milli({fromMs:Int64}) AND fromUnixTimestamp64Milli({toMs:Int64})";
    const client = await this.options.resolveClient(input.tenantId);
    const result = await client.query<FullSpanRow>({
      query: `
        SELECT ${DERIVATION_SPAN_SELECT}
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND TraceId = {traceId:String}
          AND SpanId = {spanId:String}
          ${partition}
          AND (TenantId, TraceId, SpanId, UpdatedAt) IN (
            SELECT TenantId, TraceId, SpanId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
              AND SpanId = {spanId:String}
              ${partition}
            GROUP BY TenantId, TraceId, SpanId
          )
        LIMIT 1
      `,
      query_params: {
        tenantId: input.tenantId,
        traceId: input.traceId,
        spanId: input.spanId,
        ...(window === null ? {} : { fromMs: window.fromMs, toMs: window.toMs }),
      },
      clickhouse_settings: SINGLE_SPAN_FETCH_SETTINGS,
      format: "JSONEachRow",
    });

    const rows = await result.json<FullSpanRow>();
    if (rows.length === 0) return null;
    return mapChRowToNormalized(rows[0]!);
  }

  private toClickHouseRecord(span: SpanInsertData): ClickHouseSpanWriteRecord {
    const serviceNameAny =
      span.spanAttributes["service.name"] ?? span.resourceAttributes["service.name"];
    const serviceName = typeof serviceNameAny === "string" ? serviceNameAny : "unknown";

    return {
      ProjectionId: span.id,
      TenantId: span.tenantId,
      TraceId: span.traceId,
      SpanId: span.spanId,
      ParentSpanId: span.parentSpanId,
      ParentTraceId: span.parentTraceId,
      ParentIsRemote: span.parentIsRemote,
      Sampled: span.sampled,
      StartTime: new Date(span.startTimeUnixMs),
      EndTime: new Date(span.endTimeUnixMs),
      DurationMs: Math.round(span.durationMs),
      SpanName: span.name,
      SpanKind: span.kind,
      ServiceName: serviceName,
      ResourceAttributes: serializeAttributes(span.resourceAttributes),
      SpanAttributes: serializeAttributes(span.spanAttributes),
      StatusCode: span.statusCode,
      StatusMessage: span.statusMessage,
      ScopeName: span.instrumentationScope.name,
      ScopeVersion: span.instrumentationScope.version ?? null,
      "Events.Timestamp": span.events.map((e) => new Date(e.timeUnixMs)),
      "Events.Name": span.events.map((e) => e.name),
      "Events.Attributes": span.events.map((e) => serializeAttributes(e.attributes)),
      "Links.TraceId": span.links.map((l) => l.traceId),
      "Links.SpanId": span.links.map((l) => l.spanId),
      "Links.Attributes": span.links.map((l) => serializeAttributes(l.attributes)),
      DroppedAttributesCount: 0,
      DroppedEventsCount: 0,
      DroppedLinksCount: 0,
      Cost: span.cost,
      NonBilledCost: span.nonBilledCost,
      CreatedAt: new Date(),
      UpdatedAt: new Date(),
      _retention_days: span.retentionDays ?? this.options.defaultRetentionDays,
    } satisfies ClickHouseSpanWriteRecord;
  }
}

/**
 * The stored-span read half over the same repository the write half uses —
 * one row shape, key triple and partition column, so a mismatched spelling
 * resolves nothing while looking correct. Split for CAPABILITIES, not shape.
 */
export class TraceStoredSpanReaderClickHouseRepository extends TraceStoredSpanReaderRepository {
  private constructor(private readonly repository: TraceSpanStorageClickHouseRepository) {
    super();
  }

  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
    /** The fallback stamped on a span that declares no retention of its own. */
    defaultRetentionDays: number;
  }): TraceStoredSpanReaderClickHouseRepository {
    return new TraceStoredSpanReaderClickHouseRepository(
      TraceSpanStorageClickHouseRepository.create(options),
    );
  }

  findNormalizedSpan(input: {
    tenantId: string;
    traceId: string;
    spanId: string;
    occurredAtMs: number;
  }): Promise<NormalizedSpan | null> {
    return this.repository.findNormalizedSpanById(input);
  }
}
