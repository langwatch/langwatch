import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type {
  LogRecordStorageRepository,
  StoredLogRecordRow,
} from "./log-record-storage.repository";

const TABLE_NAME = "stored_log_records" as const;

/**
 * Partition-pruning window (±2 days) around a caller-supplied `occurredAtMs`
 * hint. Generous headroom for clock skew (`TimeUnixMs` is client-supplied) and
 * long-running turns.
 */
const PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Fallback lookback (no `occurredAtMs` hint): scan `now − 90d … now + 2d`.
 * `stored_log_records` is `PARTITION BY toYearWeek(TimeUnixMs)` and tiered to
 * S3 after the hot window, so a read with no time predicate walks every weekly
 * partition (incl. cold S3). 90d covers the "open a recent trace's raw logs"
 * use case while keeping the scan on hot partitions; the +2d upper bound
 * mirrors the hint path's clock-skew headroom.
 */
const FALLBACK_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

const logger = createLogger(
  "langwatch:app-layer:traces:log-record-storage-repository",
);

export class LogRecordStorageClickHouseRepository
  implements LogRecordStorageRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertLogRecord(
    record: NormalizedLogRecord,
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: record.tenantId },
      "LogRecordStorageClickHouseRepository.insertLogRecord",
    );

    try {
      const client = await this.resolveClient(record.tenantId);
      const now = new Date();
      await client.insert({
        table: TABLE_NAME,
        values: [
          {
            ProjectionId: record.id,
            TenantId: record.tenantId,
            TraceId: record.traceId,
            SpanId: record.spanId,
            TimeUnixMs: new Date(record.timeUnixMs),
            SeverityNumber: record.severityNumber,
            SeverityText: record.severityText,
            Body: record.body,
            Attributes: record.attributes,
            ResourceAttributes: record.resourceAttributes,
            ScopeName: record.scopeName,
            ScopeVersion: record.scopeVersion,
            CreatedAt: now,
            UpdatedAt: now,
            _retention_days: retentionDays,
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          tenantId: record.tenantId,
          traceId: record.traceId,
          spanId: record.spanId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert log record into ClickHouse",
      );
      throw error;
    }
  }

  async getLogsByTraceId(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
  ): Promise<StoredLogRecordRow[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "LogRecordStorageClickHouseRepository.getLogsByTraceId",
    );

    const client = await this.resolveClient(tenantId);

    // Bound the read on the TimeUnixMs partition key so it prunes weekly
    // partitions instead of cold-scanning every one (incl. tiered S3). With a
    // turn-time hint → ±2d around it; without → now − 90d … now + 2d.
    const hasWindow = typeof occurredAtMs === "number" && occurredAtMs > 0;
    const now = Date.now();
    const fromMs = hasWindow
      ? occurredAtMs - PARTITION_WINDOW_MS
      : now - FALLBACK_LOOKBACK_MS;
    const toMs = hasWindow
      ? occurredAtMs + PARTITION_WINDOW_MS
      : now + PARTITION_WINDOW_MS;

    // Qualify the bound with the table name: the outer SELECT aliases
    // `toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs`, and ClickHouse would
    // otherwise resolve a bare `TimeUnixMs` in WHERE to that ms-integer alias
    // instead of the DateTime64 column, making the partition bound nonsensical.
    const timeFilter =
      `AND ${TABLE_NAME}.TimeUnixMs >= fromUnixTimestamp64Milli({fromMs:Int64}) ` +
      `AND ${TABLE_NAME}.TimeUnixMs <= fromUnixTimestamp64Milli({toMs:Int64})`;

    // Dedup to the latest version of each distinct stored log (the table is a
    // ReplacingMergeTree(UpdatedAt) keyed on TenantId,TraceId,SpanId,ProjectionId);
    // the IN-tuple over max(UpdatedAt) returns one row per record. TenantId is
    // the first predicate (no other id is unique across tenants). The inner
    // subquery reads only the light key columns; the heavy Body / Attributes /
    // ResourceAttributes maps are materialised by the outer SELECT for one row
    // per (TenantId, TraceId, SpanId, ProjectionId) only.
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
      `,
      query_params: {
        tenantId,
        traceId,
        fromMs,
        toMs,
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
  }

  async insertLogRecords(
    records: NormalizedLogRecord[],
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    if (records.length === 0) return;

    for (const record of records) {
      EventUtils.validateTenantId(
        { tenantId: record.tenantId },
        "LogRecordStorageClickHouseRepository.insertLogRecords",
      );
    }

    const tenantId = records[0]!.tenantId;
    for (const record of records) {
      if (record.tenantId !== tenantId) {
        throw new SecurityError(
          "LogRecordStorageClickHouseRepository.insertLogRecords",
          "all records in a single batch must share the same tenantId",
          tenantId,
          { mismatchedTenantId: record.tenantId },
        );
      }
    }

    try {
      const client = await this.resolveClient(tenantId);
      const now = new Date();
      const values = records.map((record) => ({
        ProjectionId: record.id,
        TenantId: record.tenantId,
        TraceId: record.traceId,
        SpanId: record.spanId,
        TimeUnixMs: new Date(record.timeUnixMs),
        SeverityNumber: record.severityNumber,
        SeverityText: record.severityText,
        Body: record.body,
        Attributes: record.attributes,
        ResourceAttributes: record.resourceAttributes,
        ScopeName: record.scopeName,
        ScopeVersion: record.scopeVersion,
        CreatedAt: now,
        UpdatedAt: now,
        _retention_days: retentionDays,
      }));

      await client.insert({
        table: TABLE_NAME,
        values,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          count: records.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to bulk insert log records into ClickHouse",
      );
      throw error;
    }
  }
}
