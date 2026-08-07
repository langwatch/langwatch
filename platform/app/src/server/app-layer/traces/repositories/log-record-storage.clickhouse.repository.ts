import { createLogger } from "@langwatch/observability";
import {
  DEFAULT_PARTITION_WINDOW_MS,
  queryWindowed,
} from "~/server/app-layer/clients/clickhouse/windowed-read";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import {
  type LogRecordStorageRepository,
  type StoredLogRecordRow,
  TRACE_LOG_READ_CAP,
} from "./log-record-storage.repository";

const TABLE_NAME = "stored_log_records" as const;

/**
 * Fallback lookback (no `occurredAtMs` hint): scan `now − 90d … now + 2d`.
 * `stored_log_records` is `PARTITION BY toYearWeek(TimeUnixMs)` and tiered to
 * S3 after the hot window, so a read with no time predicate walks every weekly
 * partition (incl. cold S3). 90d covers the "open a recent trace's raw logs"
 * use case while keeping the scan on hot partitions; the +2d upper bound
 * (the {@link DEFAULT_PARTITION_WINDOW_MS} half-width) mirrors the hint path's
 * clock-skew headroom.
 */
const FALLBACK_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

const logger = createLogger(
  "langwatch:app-layer:traces:log-record-storage-repository",
);

export class LogRecordStorageClickHouseRepository
  implements LogRecordStorageRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async getLogsByTraceId({
    tenantId,
    traceId,
    occurredAtMs,
    limit = TRACE_LOG_READ_CAP,
  }: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<StoredLogRecordRow[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "LogRecordStorageClickHouseRepository.getLogsByTraceId",
    );

    const client = await this.resolveClient(tenantId);

    // Bound the read on the TimeUnixMs partition key so it prunes weekly
    // partitions instead of cold-scanning every one (incl. tiered S3). With a
    // turn-time hint → ±2d around it; without → now − 90d … now + 2d.
    //
    // Routed through the shared `queryWindowed` adopter for the
    // clickhouse_windowed_read_total metric, but the read stays SINGLE-SHOT and
    // byte-identical to the previous inline window:
    //   * hint present → `fallback: "none"`, so an empty hinted window is
    //     authoritative and never re-widens (the pre-adopter behaviour).
    //   * no hint → the `{ lookbackMs }` fallback runs the fixed
    //     `now − 90d … now + 2d` frame directly (the +2d upper bound is the
    //     DEFAULT_PARTITION_WINDOW_MS clock-skew headroom).
    const hasWindow = typeof occurredAtMs === "number" && occurredAtMs > 0;

    return queryWindowed<StoredLogRecordRow[]>({
      table: TABLE_NAME,
      hintMs: hasWindow ? occurredAtMs : null,
      windowMs: DEFAULT_PARTITION_WINDOW_MS,
      fallback: hasWindow ? "none" : { lookbackMs: FALLBACK_LOOKBACK_MS },
      isEmpty: (rows) => rows.length === 0,
      run: async (window) => {
        // Qualify the bound with the table name: the outer SELECT aliases
        // `toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs`, and ClickHouse
        // would otherwise resolve a bare `TimeUnixMs` in WHERE to that
        // ms-integer alias instead of the DateTime64 column, making the
        // partition bound nonsensical. `window` is always present here (both
        // the hinted "none" and the no-hint lookback yield a fragment); the
        // guard keeps the unbounded shape safe regardless.
        const timeFilter = window
          ? window.sqlFor(`${TABLE_NAME}.TimeUnixMs`)
          : "";

        // Dedup to the latest version of each distinct stored log (the table is
        // a ReplacingMergeTree(UpdatedAt) keyed on
        // TenantId,TraceId,SpanId,ProjectionId); the IN-tuple over max(UpdatedAt)
        // returns one row per record. TenantId is the first predicate (no other
        // id is unique across tenants). The inner subquery reads only the light
        // key columns; the heavy Body / Attributes / ResourceAttributes maps are
        // materialised by the outer SELECT for one row per (TenantId, TraceId,
        // SpanId, ProjectionId) only.
        const result = await client.query({
          query: `
        SELECT
          TraceId,
          SpanId,
          toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs,
          Body,
          Attributes,
          ResourceAttributes,
          ScopeName,
          ScopeVersion
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND TraceId = {traceId:String}
          ${timeFilter}
          AND (TenantId, TraceId, SpanId, ProjectionId, UpdatedAt) IN (
            SELECT TenantId, TraceId, SpanId, ProjectionId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
              ${timeFilter}
            GROUP BY TenantId, TraceId, SpanId, ProjectionId
          )
        ORDER BY TimeUnixMs ASC
        LIMIT {limitPlusOne:UInt32}
      `,
          query_params: {
            tenantId,
            traceId,
            // One row past the cap so truncation is detectable without a count.
            limitPlusOne: limit + 1,
            ...(window?.params ?? {}),
          },
          format: "JSONEachRow",
        });

        const rows = (await result.json()) as Array<{
          TraceId: string;
          SpanId: string;
          TimeUnixMs: number;
          Body: string | null;
          Attributes: Record<string, string>;
          ResourceAttributes: Record<string, string>;
          ScopeName: string | null;
          ScopeVersion: string | null;
        }>;

        if (rows.length > limit) {
          rows.length = limit;
          logger.warn(
            { tenantId, traceId, limit },
            "Trace log read truncated at the row cap; the oldest rows are returned and later ones dropped",
          );
        }

        return rows.map((row) => ({
          traceId: row.TraceId,
          spanId: row.SpanId,
          timeUnixMs: row.TimeUnixMs,
          body: row.Body ?? "",
          attributes: row.Attributes ?? {},
          resourceAttributes: row.ResourceAttributes ?? {},
          scopeName: row.ScopeName ?? "",
          scopeVersion: row.ScopeVersion ?? null,
        }));
      },
    });
  }
}
