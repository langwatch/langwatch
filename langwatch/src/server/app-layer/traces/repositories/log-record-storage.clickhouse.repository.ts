import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { NormalizedLogRecord } from "~/server/event-sourcing/pipelines/trace-processing/schemas/logRecords";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type {
  LogRecordOccurredAtHint,
  LogRecordsForTrace,
  LogRecordStorageRepository,
} from "./log-record-storage.repository";
import { MAX_LOG_RECORDS_PER_TRACE_READ } from "./log-record-storage.repository";

const TABLE_NAME = "stored_log_records" as const;

/**
 * Partition-pruning window around the trace's occurrence hint. `stored_log_records`
 * partitions on `toYearWeek(TimeUnixMs)`, so a ±2-day window keeps the read on
 * the trace's own partitions instead of scanning all weeks (incl. cold storage).
 */
const PARTITION_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

interface LogRecordQueryRow {
  ProjectionId: string;
  TenantId: string;
  TraceId: string;
  SpanId: string;
  TimeUnixMs: string;
  SeverityNumber: number;
  SeverityText: string;
  Body: string;
  Attributes: Record<string, string>;
  ResourceAttributes: Record<string, string>;
  ScopeName: string;
  ScopeVersion: string | null;
}

const LOG_RECORD_SELECT = `
  ProjectionId,
  TenantId,
  TraceId,
  SpanId,
  toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs,
  SeverityNumber,
  SeverityText,
  Body,
  Attributes,
  ResourceAttributes,
  ScopeName,
  ScopeVersion
` as const;

const logger = createLogger(
  "langwatch:app-layer:traces:log-record-storage-repository",
);

function mapLogRecordRow(row: LogRecordQueryRow): NormalizedLogRecord {
  return {
    id: row.ProjectionId,
    tenantId: row.TenantId,
    traceId: row.TraceId,
    spanId: row.SpanId,
    timeUnixMs: Number(row.TimeUnixMs),
    severityNumber: row.SeverityNumber,
    severityText: row.SeverityText,
    body: row.Body,
    attributes: row.Attributes ?? {},
    resourceAttributes: row.ResourceAttributes ?? {},
    scopeName: row.ScopeName,
    scopeVersion: row.ScopeVersion,
  };
}

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

  async findByTraceId({
    tenantId,
    traceId,
    occurredAtMs,
  }: { tenantId: string; traceId: string } & LogRecordOccurredAtHint): Promise<LogRecordsForTrace> {
    EventUtils.validateTenantId(
      { tenantId },
      "LogRecordStorageClickHouseRepository.findByTraceId",
    );

    const window =
      occurredAtMs === undefined
        ? undefined
        : { fromMs: occurredAtMs - PARTITION_WINDOW_MS, toMs: occurredAtMs + PARTITION_WINDOW_MS };

    const run = async (
      partition: { fromMs: number; toMs: number } | undefined,
    ): Promise<LogRecordsForTrace> => {
      const client = await this.resolveClient(tenantId);
      const partitionAnd = partition
        ? "AND TimeUnixMs >= fromUnixTimestamp64Milli({fromMs:Int64}) " +
          "AND TimeUnixMs <= fromUnixTimestamp64Milli({toMs:Int64})"
        : "";
      const queryParams = {
        tenantId,
        traceId,
        maxRecords: MAX_LOG_RECORDS_PER_TRACE_READ,
        ...(partition ? { fromMs: partition.fromMs, toMs: partition.toMs } : {}),
      };
      // Capped row read + a separate exact count, both pruned by the same
      // (TenantId, TraceId) sorting-key prefix + partition window. The count
      // lets the projector report how many records were elided past the cap.
      const [rowsResult, countResult] = await Promise.all([
        client.query({
          query: `
            SELECT ${LOG_RECORD_SELECT}
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
              ${partitionAnd}
            ORDER BY TimeUnixMs ASC
            LIMIT {maxRecords:UInt32}
          `,
          query_params: queryParams,
          format: "JSONEachRow",
        }),
        client.query({
          query: `
            SELECT count() AS total
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND TraceId = {traceId:String}
              ${partitionAnd}
          `,
          query_params: queryParams,
          format: "JSONEachRow",
        }),
      ]);
      const rows = await rowsResult.json<LogRecordQueryRow>();
      const counts = await countResult.json<{ total: string | number }>();
      const totalCount = Number(counts[0]?.total ?? rows.length);
      return { records: rows.map(mapLogRecordRow), totalCount };
    };

    // Hinted read first; fall back to an unconstrained scan if the window
    // misses (stale URL hint, clock skew, long-running trace).
    if (!window) return run(undefined);
    const hinted = await run(window);
    if (hinted.records.length > 0) return hinted;
    return run(undefined);
  }
}
