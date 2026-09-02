import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { SpanInsertData } from "@langwatch/trace-contract";
import type { TraceClickHouseWriteResolver } from "../../ports/clickhouse.port";
import { serializeAttributes } from "./stored-span-row.codec";

const logger = createLogger("langwatch:trace:span-storage-repository");

const TABLE_NAME = "stored_spans" as const;

/**
 * Settings for every `stored_spans` insert.
 *
 * `input_format_json_throw_on_bad_escape_sequence: 0` is load-bearing.
 * Span strings originate as JS UTF-16 and can carry a lone (unpaired) surrogate
 * half (`\uD800`–`\uDFFF`) — a value truncated mid-emoji, or binary/garbage text
 * an SDK captured as a string. `JSONEachRow` serializes such a half as a bare
 * `\uD800`-style escape with no second part, which ClickHouse's JSON parser
 * rejects by default ("missing second part of surrogate pair"), failing the
 * whole insert. The pipeline then retries and dead-letters, and the span is lost
 * forever (13 groups dead-lettered for one project in prod).
 *
 * With the setting at 0, ClickHouse keeps the bad escape sequence as-is instead
 * of throwing — exactly what its own error message recommends. This is done at
 * the insert boundary, per-batch and O(1), rather than walking and rewriting
 * every string of every span (attribute keys/values, names, statuses, event
 * names — unbounded per-span payload) on the hot ingest path just to pre-empt
 * the parser. The rare malformed string is stored verbatim; every valid string
 * is untouched.
 */
const SPAN_INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
  input_format_json_throw_on_bad_escape_sequence: 0,
} as const;

/**
 * Replaces specified number-typed fields with Date for the DateTime64 write
 * path. Declared here rather than imported because the application's copy sits
 * behind its own path alias; scenario and experiment each keep the same local
 * copy for the same reason.
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

/**
 * One `stored_spans` row, in the table's own column order.
 *
 * `stored_spans` is `ReplacingMergeTree(StartTime)` keyed on
 * `(TenantId, TraceId, SpanId)` and partitioned by `toYearWeek(StartTime)`, so
 * three of these columns are structural rather than payload: the key triple
 * decides which rows collapse into one, and `StartTime` is simultaneously the
 * version that decides WHICH of them survives and the value every read prunes
 * partitions on. A span written with the wrong `StartTime` is not merely
 * mis-stamped — it deduplicates against the wrong neighbour and lands in the
 * wrong weekly partition.
 */
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

/**
 * The `stored_spans` write path, harvested from the application's
 * `SpanStorageClickHouseRepository` so a background process can persist spans
 * without the application's read half — the blob-offload resolver, the
 * visibility gate and the windowed readers — coming with it.
 *
 * The one deliberate difference from the frozen twin: the retention fallback is
 * injected rather than read from the platform's constant, because a package
 * cannot read the deployment's environment. The number the worker passes is the
 * same one the event store already stamps its own rows with, so producer and
 * consumer cannot disagree about it.
 */
export class TraceSpanStorageClickHouseRepository {
  private constructor(
    private readonly options: {
      resolveClient: TraceClickHouseWriteResolver;
      defaultRetentionDays: number;
    },
  ) {}

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
   * One insert for the whole batch. This is the ingestion path: a per-span
   * insert would multiply the round trips, the async-insert buffers and the
   * parts ClickHouse then has to merge by the batch size, which is the cost the
   * batching exists to avoid. Never rewrite this as a loop over
   * {@link insertSpan}.
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
