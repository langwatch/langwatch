import { TraceWindowedReadService } from "../../services/trace-windowed-read.service";
import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { DEFAULT_PARTITION_WINDOW_MS } from "../../services/trace-windowed-read.service";
import type { TraceClickHouseResolver as ClickHouseClientResolver } from "../../ports/clickhouse.port";
import {
  type LogRecordStorageRepository,
  type StoredLogRecordRow,
  TRACE_LOG_READ_CAP,
} from "../log-record-storage.repository";

const TABLE_NAME = "stored_log_records" as const;

/**
 * Fallback lookback (no occurredAtMs hint): now-90d..now+2d. stored_log_records is PARTITION BY toYearWeek(TimeUnixMs), tiered to S3 past the hot window, so an unbounded read walks every weekly partition. 90d covers "open a recent trace's raw logs" while staying on hot partitions; +2d mirrors the hint path's clock-skew headroom ({@link DEFAULT_PARTITION_WINDOW_MS}).
 */
const FALLBACK_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

const logger = createLogger("langwatch:app-layer:traces:log-record-storage-repository");

export class LogRecordStorageClickHouseRepository implements LogRecordStorageRepository {
  static create(resolveClient: ClickHouseClientResolver): LogRecordStorageClickHouseRepository {
    return new LogRecordStorageClickHouseRepository(resolveClient);
  }

  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async getLogsByTraceId(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
    limit: number = TRACE_LOG_READ_CAP,
  ): Promise<StoredLogRecordRow[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "LogRecordStorageClickHouseRepository.getLogsByTraceId",
    );

    const client = await this.resolveClient(tenantId);

    // Bounds the read on the TimeUnixMs partition key to prune weekly
    // partitions instead of cold-scanning every one. With a turn-time hint,
    // ±2d around it; without, now-90d..now+2d. Routed through
    // TraceWindowedReadService.queryWindowed for the metric, but stays
    // SINGLE-SHOT and byte-identical to the previous inline window.
    const hasWindow = typeof occurredAtMs === "number" && occurredAtMs > 0;

    return TraceWindowedReadService.queryWindowed<StoredLogRecordRow[]>({
      table: TABLE_NAME,
      hintMs: hasWindow ? occurredAtMs : null,
      windowMs: DEFAULT_PARTITION_WINDOW_MS,
      fallback: hasWindow ? "none" : { lookbackMs: FALLBACK_LOOKBACK_MS },
      isEmpty: (rows) => rows.length === 0,
      run: async (window) => {
        // Qualifies the bound with the table name: the outer SELECT aliases
        // toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs, and CH would
        // otherwise resolve a bare TimeUnixMs in WHERE to that ms-integer
        // alias instead of the DateTime64 column, making the partition bound
        // nonsensical. window is always present here (hinted or lookback).
        const timeFilter = window ? window.sqlFor(`${TABLE_NAME}.TimeUnixMs`) : "";

        // Dedup to the latest version of each stored log (RMT(UpdatedAt) keyed
        // TenantId,TraceId,SpanId,ProjectionId); IN-tuple over max(UpdatedAt)
        // returns one row per record, TenantId first (no other id is unique
        // across tenants). Inner subquery reads only light key columns; heavy
        // Body/Attributes/ResourceAttributes materialise per matched row only.
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
            ...window?.params,
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
