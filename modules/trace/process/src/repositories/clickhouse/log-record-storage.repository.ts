import {
  type ClickHouseQueryClient,
  DEFAULT_PARTITION_WINDOW_MS,
  queryWindowed,
  type WindowFragment,
} from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import {
  type LogRecordStorageRepository,
  type StoredLogRecordRow,
  TRACE_LOG_READ_CAP,
} from "../log-record-storage.repository.ts";
import { logRecords } from "./clickhouse.log-records.table.ts";
import { storedLogRecords } from "./clickhouse.stored-log-records.table.ts";
import { chNumber, chString, chStringMap } from "./stored-span-row.mapper.ts";

const logRecordRowSchema = z.looseObject({
  TraceId: chString,
  SpanId: chString,
  TimeMs: chNumber,
  Body: chString.nullable(),
  Attributes: chStringMap,
  ResourceAttributes: chStringMap,
  ScopeName: chString.nullable(),
  ScopeVersion: chString.nullable(),
});

const logRecordRowsSchema = z.array(logRecordRowSchema);

/** log_records is read 14 days back and 2 days forward of the hint, as log read it. */
const LOG_RECORDS_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const LOG_RECORDS_LOOKAHEAD_MS = 2 * 24 * 60 * 60 * 1000;

const logRecordsRowSchema = z.object({
  TraceId: z.string(),
  SpanId: z.string(),
  TimeMs: z.union([z.number(), z.string()]),
  BodyText: z.string().nullable(),
  AttributesFlatJson: z.string(),
  ResourceAttributesFlatJson: z.string(),
  ScopeName: z.string(),
  ScopeVersion: z.string(),
  EventName: z.string(),
});

const logRecordsRowsSchema = z.array(logRecordsRowSchema);

const flatAttributesSchema = z.record(z.string(), z.string());

/**
 * Fallback lookback when no occurredAtMs hint: now-90d..now+2d.
 */
const FALLBACK_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

const logger = createLogger("langwatch:app-layer:traces:log-record-storage-repository");

/**
 * The newest version of each stored log on the trace (elected on max(UpdatedAt) per record,
 * TenantId first), inside the window on the TimeUnixMs partition key, oldest first.
 */
function storedLogsStatement({
  tenantId,
  traceId,
  window,
  limit,
}: {
  tenantId: string;
  traceId: string;
  window: WindowFragment | null;
  limit: number;
}) {
  const read = clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(storedLogRecords)
    .select({
      TraceId: storedLogRecords.TraceId,
      SpanId: storedLogRecords.SpanId,
      TimeMs: fn.toUnixTimestamp64Milli(storedLogRecords.TimeUnixMs),
      Body: storedLogRecords.Body,
      Attributes: storedLogRecords.Attributes,
      ResourceAttributes: storedLogRecords.ResourceAttributes,
      ScopeName: storedLogRecords.ScopeName,
      ScopeVersion: storedLogRecords.ScopeVersion,
    })
    .where(({ eq }) => eq(storedLogRecords.TraceId, traceId));
  const windowed =
    window === null
      ? read
      : read.where(({ and, gte, lte }) =>
          and(
            gte(storedLogRecords.TimeUnixMs, window.fromMs),
            lte(storedLogRecords.TimeUnixMs, window.toMs),
          ),
        );
  return windowed.latestVersion().orderBy(storedLogRecords.TimeUnixMs, "ASC").limit(limit).build();
}

/** Log's merged records correlated to the trace, 14 days back and 2 forward of `center`. */
function logRecordsStatement({
  tenantId,
  traceId,
  center,
  limit,
}: {
  tenantId: string;
  traceId: string;
  center: number;
  limit: number;
}) {
  return clickhouseRead({ scope: tenantScope.single({ tenantId }) })
    .from(logRecords)
    .final()
    .select({
      TraceId: logRecords.CorrelationTraceId,
      SpanId: logRecords.CorrelationSpanId,
      TimeMs: fn.toUnixTimestamp64Milli(logRecords.TimeUnixMs),
      BodyText: logRecords.BodyText,
      AttributesFlatJson: logRecords.AttributesFlatJson,
      ResourceAttributesFlatJson: logRecords.ResourceAttributesFlatJson,
      ScopeName: logRecords.ScopeName,
      ScopeVersion: logRecords.ScopeVersion,
      EventName: logRecords.EventName,
    })
    .where(({ and, eq, gte, lte }) =>
      and(
        eq(logRecords.CorrelationTraceId, traceId),
        gte(logRecords.TimeUnixMs, center - LOG_RECORDS_LOOKBACK_MS),
        lte(logRecords.TimeUnixMs, center + LOG_RECORDS_LOOKAHEAD_MS),
      ),
    )
    .orderBy(logRecords.TimeUnixNano, "ASC")
    .orderBy(logRecords.RecordId, "ASC")
    .limit(limit)
    .build();
}

export class LogRecordStorageClickHouseRepository implements LogRecordStorageRepository {
  static create({
    reader,
  }: {
    reader: Pick<ClickHouseQueryClient, "read">;
  }): LogRecordStorageClickHouseRepository {
    return new LogRecordStorageClickHouseRepository(reader);
  }

  private constructor(private readonly reader: Pick<ClickHouseQueryClient, "read">) {}

  async findLogsByTraceId({
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

    // Bounds the read on the TimeUnixMs partition key: with a turn-time hint, ±2d around it;
    // without, now-90d..now+2d. Single-shot; queryWindowed only counts the outcome.
    const hasWindow = typeof occurredAtMs === "number" && occurredAtMs > 0;

    return queryWindowed<StoredLogRecordRow[]>({
      table: storedLogRecords.$table.name,
      hintMs: hasWindow ? occurredAtMs : null,
      windowMs: DEFAULT_PARTITION_WINDOW_MS,
      fallback: hasWindow ? "none" : { lookbackMs: FALLBACK_LOOKBACK_MS },
      isEmpty: (rows) => rows.length === 0,
      run: async (window) => {
        // One row past the cap so truncation is detectable without a count.
        const result = await this.reader.read({
          statement: storedLogsStatement({ tenantId, traceId, window, limit: limit + 1 }),
          table: storedLogRecords.$table.name,
        });

        const rows = logRecordRowsSchema.parse(result.rows);

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
          timeUnixMs: row.TimeMs,
          body: row.Body ?? "",
          attributes: row.Attributes ?? {},
          resourceAttributes: row.ResourceAttributes ?? {},
          scopeName: row.ScopeName ?? "",
          scopeVersion: row.ScopeVersion ?? null,
        }));
      },
    });
  }
  /** Log's newest version of each record correlated to the trace, oldest first. */
  async findLogRecordsByTraceId({
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
      "LogRecordStorageClickHouseRepository.findLogRecordsByTraceId",
    );
    const center =
      typeof occurredAtMs === "number" && occurredAtMs > 0
        ? occurredAtMs
        : nowInstant().epochMilliseconds;
    const result = await this.reader.read({
      statement: logRecordsStatement({ tenantId, traceId, center, limit }),
      table: logRecords.$table.name,
    });
    const rows = logRecordsRowsSchema.parse(result.rows);
    if (rows.length >= limit) {
      logger.warn({ tenantId, traceId, limit }, "Trace's log_records read hit its row cap");
    }
    return rows.map((row) => {
      const attributes = flatAttributesSchema.parse(JSON.parse(row.AttributesFlatJson));
      if (row.EventName && attributes["event.name"] === undefined) {
        attributes["event.name"] = row.EventName;
      }
      return {
        traceId: row.TraceId,
        spanId: row.SpanId,
        timeUnixMs: Number(row.TimeMs),
        body: row.BodyText ?? "",
        attributes,
        resourceAttributes: flatAttributesSchema.parse(JSON.parse(row.ResourceAttributesFlatJson)),
        scopeName: row.ScopeName,
        scopeVersion: row.ScopeVersion || null,
      };
    });
  }
}
