import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import {
  CLAUDE_CODE_KIND_ATTR,
  CLAUDE_CODE_LOG_RETENTION_DAYS,
} from "~/server/app-layer/traces/claude-code-log-to-span";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type {
  LogRecordStorageRepository,
  StoredLogRecordRow,
} from "./log-record-storage.repository";

const TABLE_NAME = "stored_log_records" as const;

const logger = createLogger(
  "langwatch:app-layer:traces:log-record-storage-repository",
);

export class LogRecordStorageClickHouseRepository
  implements LogRecordStorageRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertLogRecord(record: NormalizedLogRecord, retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: record.tenantId },
      "LogRecordStorageClickHouseRepository.insertLogRecord",
    );

    try {
      const client = await this.resolveClient(record.tenantId);
      const now = new Date();
      // Raw claude_code logs the span fold consumes turn into pure duplication
      // once the claudeCodeSpanSync reactor folds them into stored_spans, so GC
      // them far sooner than the platform default (the spans inherit the real
      // retention). The existing `_retention_days` DELETE TTL does the eviction;
      // we just stamp the shorter floor on these rows here. Stamped, not min'd
      // against the caller's value, so an indefinite (0) project retention can't
      // make a fold-intermediate log live forever.
      const effectiveRetentionDays = record.attributes[CLAUDE_CODE_KIND_ATTR]
        ? CLAUDE_CODE_LOG_RETENTION_DAYS
        : retentionDays;
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
            _retention_days: effectiveRetentionDays,
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

  async getMarkedClaudeCodeLogsByTrace(
    tenantId: string,
    traceId: string,
    occurredAtMs?: number,
  ): Promise<StoredLogRecordRow[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "LogRecordStorageClickHouseRepository.getMarkedClaudeCodeLogsByTrace",
    );

    const client = await this.resolveClient(tenantId);

    // `stored_log_records` is `PARTITION BY toYearWeek(TimeUnixMs)` and tiered to
    // S3 after the hot window. Filtering only on TenantId + TraceId can't prune
    // partitions, so the read walks every weekly partition (incl. cold S3) — a
    // burst of S3 GETs on every claude-code log re-fold. When the caller knows
    // the turn's approximate time we bound the scan to a ±2-day window around it.
    // A turn's logs all land within its lifetime, so the window is generous
    // headroom; without a hint we fall back to the unbounded scan (correctness
    // is identical either way).
    const partitionWindowMs = 2 * 24 * 60 * 60 * 1000;
    const hasWindow = typeof occurredAtMs === "number" && occurredAtMs > 0;
    // Qualify the bound with the table name: the outer SELECT aliases
    // `toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs`, and ClickHouse would
    // otherwise resolve a bare `TimeUnixMs` in WHERE to that ms-integer alias
    // instead of the DateTime64 column, making the partition bound nonsensical.
    const timeFilter = hasWindow
      ? `AND ${TABLE_NAME}.TimeUnixMs >= fromUnixTimestamp64Milli({fromMs:Int64}) ` +
        `AND ${TABLE_NAME}.TimeUnixMs <= fromUnixTimestamp64Milli({toMs:Int64})`
      : "";
    const timeParams = hasWindow
      ? {
          fromMs: occurredAtMs - partitionWindowMs,
          toMs: occurredAtMs + partitionWindowMs,
        }
      : {};

    // Dedup to the latest version of each distinct stored log (the table is a
    // ReplacingMergeTree(UpdatedAt) keyed on TenantId,TraceId,SpanId,ProjectionId);
    // the IN-tuple over max(UpdatedAt) returns one row per record. TenantId is
    // the first predicate (no other id is unique across tenants). The partition
    // window is applied to both scopes so the dedup sees the same row set.
            const result = await client.query({
      query: `
        SELECT
          TraceId,
          SpanId,
          toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs,
          Attributes,
          ResourceAttributes,
          ScopeName,
          ScopeVersion
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND TraceId = {traceId:String}
          ${timeFilter}
          AND Attributes[{kindKey:String}] != ''
          AND (TenantId, TraceId, SpanId, ProjectionId, UpdatedAt) IN (
            SELECT TenantId, TraceId, SpanId, ProjectionId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
              ${timeFilter}
              AND Attributes[{kindKey:String}] != ''
            GROUP BY TenantId, TraceId, SpanId, ProjectionId
          )
        ORDER BY TimeUnixMs ASC
      `,
      query_params: {
        tenantId,
        traceId,
        kindKey: CLAUDE_CODE_KIND_ATTR,
        ...timeParams,
      },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{
      TraceId: string;
      SpanId: string;
      TimeUnixMs: number;
      Attributes: Record<string, string>;
      ResourceAttributes: Record<string, string>;
      ScopeName: string | null;
      ScopeVersion: string | null;
    }>;

    return rows.map((row) => ({
      traceId: row.TraceId,
      spanId: row.SpanId,
      timeUnixMs: row.TimeUnixMs,
      attributes: row.Attributes ?? {},
      resourceAttributes: row.ResourceAttributes ?? {},
      scopeName: row.ScopeName ?? "",
      scopeVersion: row.ScopeVersion ?? null,
    }));
  }
}
