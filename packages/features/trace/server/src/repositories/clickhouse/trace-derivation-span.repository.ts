import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { DerivedTraceEvent, NormalizedSpan } from "@langwatch/trace-contract";
import type { TraceClickHouseWriteResolver } from "../../ports/clickhouse.port";
import { type FullSpanRow, mapChRowToNormalized } from "./stored-span-row.codec";
import { DEFAULT_PARTITION_WINDOW_MS, queryWindowed } from "./windowed-read";

const logger = createLogger("langwatch:trace:derivation-span-repository");

const TABLE_NAME = "stored_spans" as const;

/**
 * The columns a derivation reads, and no nested group.
 *
 * Narrower than the single-span fetch's projection on purpose: a whole trace's
 * worth of rows is what makes this read expensive, and `Events.*` / `Links.*`
 * are both the largest columns and the ones production throws
 * `Attempt to read after eof (while reading column Links.Attributes)` on.
 * {@link mapChRowToNormalized} defaults both to `[]`, which is why a span read
 * this way must never be rendered.
 */
const DERIVATION_TRACE_SPAN_SELECT = `
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

/**
 * How many spans one derivation will read.
 *
 * A trace is a customer's own shape and has no upper bound; a derivation over
 * one is a per-role sum, so the cap costs accuracy on a pathological trace and
 * bounds the memory every other trace pays for it. The same number the
 * projection path caps its own span processing at.
 */
const DERIVATION_SPAN_LIMIT = 10_000;

/**
 * How many span events one derivation will read.
 *
 * A span carries an unbounded number of events and a trace an unbounded number
 * of spans, so the product is what has to be capped rather than either factor.
 * The number matches the light-span ceiling the application's own events read
 * uses, so a filter evaluated in this process sees the same prefix it saw in
 * the application.
 */
const DERIVATION_EVENT_LIMIT = 10_000;

/**
 * Per-query ceiling for the whole-trace fetch.
 *
 * `max_memory_usage` keeps one runaway trace failing on its own read rather
 * than on the pod, and the dedup is done in SQL so a re-exported span cannot
 * be counted twice into a role total.
 */
const DERIVATION_FETCH_SETTINGS = {
  max_memory_usage: "2000000000",
  max_execution_time: "30",
} as const;

/**
 * Every stored span of one trace, for the scenario role derivation.
 *
 * The dedup is `argMax(..., UpdatedAt)` grouped by `SpanId` rather than
 * `LIMIT 1 BY`: the table is a `ReplacingMergeTree` and a re-exported span sits
 * as two physical rows until a merge, so a read that returned both would double
 * that span's cost and latency into its role's total. `LIMIT 1 BY` would
 * materialise every selected column for whole granules to do the same job.
 */
export class TraceDerivationSpanClickHouseRepository {
  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
  }): TraceDerivationSpanClickHouseRepository {
    return new TraceDerivationSpanClickHouseRepository(options);
  }

  private constructor(private readonly options: { resolveClient: TraceClickHouseWriteResolver }) {}

  async findNormalizedSpansByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<NormalizedSpan[]> {
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "TraceDerivationSpanClickHouseRepository.findNormalizedSpansByTraceId",
    );

    try {
      return await queryWindowed<NormalizedSpan[]>({
        table: TABLE_NAME,
        hintMs: input.occurredAtMs ?? null,
        windowMs: DEFAULT_PARTITION_WINDOW_MS,
        fallback: "unbounded",
        isEmpty: (rows) => rows.length === 0,
        run: (window) => this.fetchTraceSpanRows(input, window),
      });
    } catch (error) {
      logger.warn(
        {
          tenantId: input.tenantId,
          traceId: input.traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to read a trace's stored spans from ClickHouse",
      );
      throw error;
    }
  }

  /**
   * Every span event of one trace, flattened.
   *
   * `ARRAY JOIN` runs OUTSIDE the dedup subquery on purpose: the expansion
   * multiplies each surviving row by its event count, so deduplicating after it
   * would do the same tuple comparison `events_per_span` times over. The inner
   * query therefore reads only the three nested `Events.*` columns — never
   * `SpanAttributes` or `Links.*`, which is what makes an events read cheap
   * where a whole-span read is not.
   */
  async findDerivedEventsByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<DerivedTraceEvent[]> {
    EventUtils.validateTenantId(
      { tenantId: input.tenantId },
      "TraceDerivationSpanClickHouseRepository.findDerivedEventsByTraceId",
    );

    try {
      return await queryWindowed<DerivedTraceEvent[]>({
        table: TABLE_NAME,
        hintMs: input.occurredAtMs ?? null,
        windowMs: DEFAULT_PARTITION_WINDOW_MS,
        fallback: "unbounded",
        isEmpty: (rows) => rows.length === 0,
        run: (window) => this.fetchTraceEventRows(input, window),
      });
    } catch (error) {
      logger.warn(
        {
          tenantId: input.tenantId,
          traceId: input.traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to read a trace's span events from ClickHouse",
      );
      throw error;
    }
  }

  private async fetchTraceEventRows(
    input: { tenantId: string; traceId: string },
    window: { fromMs: number; toMs: number } | null,
  ): Promise<DerivedTraceEvent[]> {
    const partition =
      window === null
        ? ""
        : "AND StartTime BETWEEN fromUnixTimestamp64Milli({fromMs:Int64}) AND fromUnixTimestamp64Milli({toMs:Int64})";
    const client = await this.options.resolveClient(input.tenantId);
    const result = await client.query<TraceEventRow>({
      query: `
        SELECT
          SpanId AS spanId,
          toUnixTimestamp64Milli(event_timestamp) AS timestamp,
          event_name AS name,
          event_attrs AS attributes
        FROM (
          SELECT
            SpanId,
            argMax("Events.Timestamp", UpdatedAt) AS Events_Timestamp,
            argMax("Events.Name", UpdatedAt) AS Events_Name,
            argMax("Events.Attributes", UpdatedAt) AS Events_Attributes
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND TraceId = {traceId:String}
            ${partition}
          GROUP BY SpanId
        )
        ARRAY JOIN
          Events_Timestamp AS event_timestamp,
          Events_Name AS event_name,
          Events_Attributes AS event_attrs
        ORDER BY event_timestamp ASC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: input.tenantId,
        traceId: input.traceId,
        limit: DERIVATION_EVENT_LIMIT,
        ...(window === null ? {} : { fromMs: window.fromMs, toMs: window.toMs }),
      },
      clickhouse_settings: DERIVATION_FETCH_SETTINGS,
      format: "JSONEachRow",
    });

    return (await result.json<TraceEventRow>()).map((row) => ({
      spanId: row.spanId,
      timestamp: typeof row.timestamp === "string" ? parseInt(row.timestamp, 10) : row.timestamp,
      name: row.name,
      attributes: row.attributes ?? {},
    }));
  }

  private async fetchTraceSpanRows(
    input: { tenantId: string; traceId: string; limit?: number },
    window: { fromMs: number; toMs: number } | null,
  ): Promise<NormalizedSpan[]> {
    const partition =
      window === null
        ? ""
        : "AND StartTime BETWEEN fromUnixTimestamp64Milli({fromMs:Int64}) AND fromUnixTimestamp64Milli({toMs:Int64})";
    const client = await this.options.resolveClient(input.tenantId);
    const result = await client.query<FullSpanRow>({
      query: `
        SELECT ${DERIVATION_TRACE_SPAN_SELECT}
        FROM (
          SELECT
            SpanId,
            argMax(TraceId, UpdatedAt) AS TraceId,
            argMax(TenantId, UpdatedAt) AS TenantId,
            argMax(ParentSpanId, UpdatedAt) AS ParentSpanId,
            argMax(ParentTraceId, UpdatedAt) AS ParentTraceId,
            argMax(ParentIsRemote, UpdatedAt) AS ParentIsRemote,
            argMax(Sampled, UpdatedAt) AS Sampled,
            argMax(StartTime, UpdatedAt) AS StartTime,
            argMax(EndTime, UpdatedAt) AS EndTime,
            argMax(DurationMs, UpdatedAt) AS DurationMs,
            argMax(SpanName, UpdatedAt) AS SpanName,
            argMax(SpanKind, UpdatedAt) AS SpanKind,
            argMax(ResourceAttributes, UpdatedAt) AS ResourceAttributes,
            argMax(SpanAttributes, UpdatedAt) AS SpanAttributes,
            argMax(StatusCode, UpdatedAt) AS StatusCode,
            argMax(StatusMessage, UpdatedAt) AS StatusMessage,
            argMax(ScopeName, UpdatedAt) AS ScopeName,
            argMax(ScopeVersion, UpdatedAt) AS ScopeVersion,
            argMax(Cost, UpdatedAt) AS Cost,
            argMax(NonBilledCost, UpdatedAt) AS NonBilledCost
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND TraceId = {traceId:String}
            ${partition}
          GROUP BY SpanId
        )
        ORDER BY StartTimeMs ASC
        LIMIT {limit:UInt32}
      `,
      query_params: {
        tenantId: input.tenantId,
        traceId: input.traceId,
        limit: input.limit ?? DERIVATION_SPAN_LIMIT,
        ...(window === null ? {} : { fromMs: window.fromMs, toMs: window.toMs }),
      },
      clickhouse_settings: DERIVATION_FETCH_SETTINGS,
      format: "JSONEachRow",
    });

    return (await result.json<FullSpanRow>()).map((row) => mapChRowToNormalized(row));
  }
}

/** One flattened `Events.*` tuple, as ClickHouse hands it back. */
type TraceEventRow = {
  spanId: string;
  timestamp: number | string;
  name: string;
  attributes?: Record<string, string> | null;
};

export { DERIVATION_EVENT_LIMIT, DERIVATION_SPAN_LIMIT };
