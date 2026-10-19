import { DEFAULT_PARTITION_WINDOW_MS, queryWindowed } from "@langwatch/clickhouse-client";
import { EventUtils } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant, Temporal, toDate } from "@langwatch/time";
import { z } from "zod";

import {
  type LogRecordStorageRepository,
  type StoredLogRecordRow,
  TRACE_LOG_READ_CAP,
  type TraceLogReadTarget,
} from "../log-record-storage.repository.ts";
import type { TraceClickHouseResolver as ClickHouseClientResolver } from "./clickhouse.trace-member-client.repository.ts";
import { chNumber, chString, chStringMap } from "./stored-span-row.mapper.ts";

const logRecordRowSchema = z.looseObject({
  TraceId: chString,
  SpanId: chString,
  TimeUnixMs: chNumber,
  Body: chString.nullable(),
  Attributes: chStringMap,
  ResourceAttributes: chStringMap,
  ScopeName: chString.nullable(),
  ScopeVersion: chString.nullable(),
});

const logRecordRowsSchema = z.array(logRecordRowSchema);

const TABLE_NAME = "stored_log_records" as const;

/** Log's canonical log table, shared for reading with trace (clickhouse-table-ownership). */
const LOG_RECORDS_TABLE = "log_records" as const;

/** log_records is read 14 days back and 2 days forward of the hint, as log read it. */
const LOG_RECORDS_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const LOG_RECORDS_LOOKAHEAD_MS = 2 * 24 * 60 * 60 * 1000;

const logRecordsRowSchema = z.object({
  TraceId: z.string(),
  SpanId: z.string(),
  TimeUnixMs: z.union([z.number(), z.string()]),
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

function clickHouseTimestamp(epochMs: number): Date {
  return toDate(Temporal.Instant.fromEpochMilliseconds(epochMs));
}

export class LogRecordStorageClickHouseRepository implements LogRecordStorageRepository {
  static create(resolveClient: ClickHouseClientResolver): LogRecordStorageClickHouseRepository {
    return new LogRecordStorageClickHouseRepository(resolveClient);
  }

  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

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

    const client = await this.resolveClient(tenantId);

    // Bounds the read on the TimeUnixMs partition key to prune weekly
    // partitions instead of cold-scanning every one. With a turn-time hint,
    // ±2d around it; without, now-90d..now+2d. Routed through
    // queryWindowed for the metric, but stays
    // SINGLE-SHOT and byte-identical to the previous inline window.
    const hasWindow = typeof occurredAtMs === "number" && occurredAtMs > 0;

    return queryWindowed<StoredLogRecordRow[]>({
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

        const rows = logRecordRowsSchema.parse(await result.json());

        if (rows.length > limit) {
          rows.length = limit;
          logger.warn(
            { tenantId, traceId, limit },
            "Trace log read truncated at the row cap; the oldest rows are returned and later ones dropped",
          );
        }

        return rows.map(storedLogRecordRow);
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
    const client = await this.resolveClient(tenantId);
    const result = await client.query({
      query: `
        SELECT
          CorrelationTraceId AS TraceId,
          CorrelationSpanId AS SpanId,
          toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs,
          BodyText,
          AttributesFlatJson,
          ResourceAttributesFlatJson,
          ScopeName,
          ScopeVersion,
          EventName
        FROM ${LOG_RECORDS_TABLE} FINAL
        WHERE TenantId = {tenantId:String}
          AND CorrelationTraceId = {traceId:String}
          AND ${LOG_RECORDS_TABLE}.TimeUnixMs >= {windowStart:DateTime64(3)}
          AND ${LOG_RECORDS_TABLE}.TimeUnixMs <= {windowEnd:DateTime64(3)}
        ORDER BY TimeUnixNano ASC, RecordId ASC
        LIMIT {limit:UInt64}
      `,
      query_params: {
        tenantId,
        traceId,
        // Not `from`/`to`: the tenant guard reads a bare `{from:` as a FROM clause and refuses it.
        windowStart: clickHouseTimestamp(center - LOG_RECORDS_LOOKBACK_MS),
        windowEnd: clickHouseTimestamp(center + LOG_RECORDS_LOOKAHEAD_MS),
        limit,
      },
      format: "JSONEachRow",
    });
    const rows = logRecordsRowsSchema.parse(await result.json());
    if (rows.length >= limit) {
      logger.warn({ tenantId, traceId, limit }, "Trace's log_records read hit its row cap");
    }
    return rows.map(logRecordsRow);
  }

  async findLogsByTraceIds({
    tenantId,
    traces,
    limitPerTrace = TRACE_LOG_READ_CAP,
  }: {
    tenantId: string;
    traces: readonly TraceLogReadTarget[];
    limitPerTrace?: number;
  }): Promise<StoredLogRecordRow[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "LogRecordStorageClickHouseRepository.findLogsByTraceIds",
    );
    if (traces.length === 0) return [];

    const client = await this.resolveClient(tenantId);
    const now = nowInstant().epochMilliseconds;
    // Each trace's own window: ±2d around a hint, now-90d..now+2d without one.
    const windows = traceWindows({
      traces,
      before: DEFAULT_PARTITION_WINDOW_MS,
      after: DEFAULT_PARTITION_WINDOW_MS,
      unhinted: { fromMs: now - FALLBACK_LOOKBACK_MS, toMs: now + DEFAULT_PARTITION_WINDOW_MS },
    });
    const perTrace = perTraceWindowFilter({
      traceColumn: "TraceId",
      timeColumn: `${TABLE_NAME}.TimeUnixMs`,
    });

    // The union window prunes partitions; each trace's own window bounds its rows. Only the
    // light key columns are deduped and capped per trace; heavy ones load for the kept rows.
    return queryWindowed<StoredLogRecordRow[]>({
      table: TABLE_NAME,
      hintMs: windows.centreMs,
      windowMs: windows.halfWidthMs,
      fallback: "none",
      isEmpty: (rows) => rows.length === 0,
      run: async (window) => {
        const timeFilter = window ? window.sqlFor(`${TABLE_NAME}.TimeUnixMs`) : "";
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
          AND TraceId IN {traceIds:Array(String)}
          ${timeFilter}
          ${perTrace}
          AND (TenantId, TraceId, SpanId, ProjectionId, UpdatedAt) IN (
            SELECT TenantId, TraceId, SpanId, ProjectionId, LatestUpdatedAt
            FROM (
              SELECT
                TenantId,
                TraceId,
                SpanId,
                ProjectionId,
                max(UpdatedAt) AS LatestUpdatedAt,
                argMax(${TABLE_NAME}.TimeUnixMs, UpdatedAt) AS LatestTimeUnixMs
              FROM ${TABLE_NAME}
              WHERE TenantId = {tenantId:String}
                AND TraceId IN {traceIds:Array(String)}
                ${timeFilter}
                ${perTrace}
              GROUP BY TenantId, TraceId, SpanId, ProjectionId
            )
            ORDER BY TraceId ASC, LatestTimeUnixMs ASC
            LIMIT {limitPlusOne:UInt32} BY TraceId
          )
        ORDER BY TraceId ASC, TimeUnixMs ASC
      `,
          query_params: {
            tenantId,
            ...windows.params,
            limitPlusOne: limitPerTrace + 1,
            ...window?.params,
          },
          format: "JSONEachRow",
        });

        return capPerTrace({
          rows: logRecordRowsSchema.parse(await result.json()).map(storedLogRecordRow),
          limit: limitPerTrace,
          tenantId,
        });
      },
    });
  }

  async findLogRecordsByTraceIds({
    tenantId,
    traces,
    limitPerTrace = TRACE_LOG_READ_CAP,
  }: {
    tenantId: string;
    traces: readonly TraceLogReadTarget[];
    limitPerTrace?: number;
  }): Promise<StoredLogRecordRow[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "LogRecordStorageClickHouseRepository.findLogRecordsByTraceIds",
    );
    if (traces.length === 0) return [];

    const now = nowInstant().epochMilliseconds;
    const windows = traceWindows({
      traces,
      before: LOG_RECORDS_LOOKBACK_MS,
      after: LOG_RECORDS_LOOKAHEAD_MS,
      unhinted: { fromMs: now - LOG_RECORDS_LOOKBACK_MS, toMs: now + LOG_RECORDS_LOOKAHEAD_MS },
    });
    const perTrace = perTraceWindowFilter({
      traceColumn: "CorrelationTraceId",
      timeColumn: `${LOG_RECORDS_TABLE}.TimeUnixMs`,
    });
    const scope = `
          TenantId = {tenantId:String}
          AND CorrelationTraceId IN {traceIds:Array(String)}
          AND ${LOG_RECORDS_TABLE}.TimeUnixMs >= {windowStart:DateTime64(3)}
          AND ${LOG_RECORDS_TABLE}.TimeUnixMs <= {windowEnd:DateTime64(3)}
          ${perTrace}`;
    const client = await this.resolveClient(tenantId);
    // The cap picks each trace's oldest record keys first; heavy columns load for those only.
    const result = await client.query({
      query: `
        SELECT
          CorrelationTraceId AS TraceId,
          CorrelationSpanId AS SpanId,
          toUnixTimestamp64Milli(TimeUnixMs) AS TimeUnixMs,
          BodyText,
          AttributesFlatJson,
          ResourceAttributesFlatJson,
          ScopeName,
          ScopeVersion,
          EventName
        FROM ${LOG_RECORDS_TABLE} FINAL
        WHERE ${scope}
          AND (CorrelationTraceId, ${LOG_RECORDS_TABLE}.TimeUnixMs, RecordId) IN (
            SELECT CorrelationTraceId, ${LOG_RECORDS_TABLE}.TimeUnixMs, RecordId
            FROM ${LOG_RECORDS_TABLE} FINAL
            WHERE ${scope}
            ORDER BY CorrelationTraceId ASC, TimeUnixNano ASC, RecordId ASC
            LIMIT {limitPlusOne:UInt32} BY CorrelationTraceId
          )
        ORDER BY CorrelationTraceId ASC, TimeUnixNano ASC, RecordId ASC
      `,
      query_params: {
        tenantId,
        ...windows.params,
        windowStart: clickHouseTimestamp(windows.fromMs),
        windowEnd: clickHouseTimestamp(windows.toMs),
        limitPlusOne: limitPerTrace + 1,
      },
      format: "JSONEachRow",
    });

    return capPerTrace({
      rows: logRecordsRowsSchema.parse(await result.json()).map(logRecordsRow),
      limit: limitPerTrace,
      tenantId,
    });
  }
}

function storedLogRecordRow(row: z.infer<typeof logRecordRowSchema>): StoredLogRecordRow {
  return {
    traceId: row.TraceId,
    spanId: row.SpanId,
    timeUnixMs: row.TimeUnixMs,
    body: row.Body ?? "",
    attributes: row.Attributes ?? {},
    resourceAttributes: row.ResourceAttributes ?? {},
    scopeName: row.ScopeName ?? "",
    scopeVersion: row.ScopeVersion ?? null,
  };
}

function logRecordsRow(row: z.infer<typeof logRecordsRowSchema>): StoredLogRecordRow {
  const attributes = flatAttributesSchema.parse(JSON.parse(row.AttributesFlatJson));
  if (row.EventName && attributes["event.name"] === undefined) {
    attributes["event.name"] = row.EventName;
  }
  return {
    traceId: row.TraceId,
    spanId: row.SpanId,
    timeUnixMs: Number(row.TimeUnixMs),
    body: row.BodyText ?? "",
    attributes,
    resourceAttributes: flatAttributesSchema.parse(JSON.parse(row.ResourceAttributesFlatJson)),
    scopeName: row.ScopeName,
    scopeVersion: row.ScopeVersion || null,
  };
}

/** Each distinct trace's own window, and the union of them as a centre and half-width. */
function traceWindows({
  traces,
  before,
  after,
  unhinted,
}: {
  traces: readonly TraceLogReadTarget[];
  before: number;
  after: number;
  unhinted: { fromMs: number; toMs: number };
}) {
  const byTrace = new Map<string, { fromMs: number; toMs: number }>();
  for (const { traceId, occurredAtMs } of traces) {
    const hinted = typeof occurredAtMs === "number" && occurredAtMs > 0;
    const own = hinted ? { fromMs: occurredAtMs - before, toMs: occurredAtMs + after } : unhinted;
    const seen = byTrace.get(traceId);
    byTrace.set(
      traceId,
      seen
        ? { fromMs: Math.min(seen.fromMs, own.fromMs), toMs: Math.max(seen.toMs, own.toMs) }
        : own,
    );
  }
  const windows = [...byTrace.values()];
  const fromMs = Math.floor(Math.min(...windows.map((window) => window.fromMs)));
  const toMs = Math.ceil(Math.max(...windows.map((window) => window.toMs)));
  const centreMs = Math.floor((fromMs + toMs) / 2);
  return {
    fromMs,
    toMs,
    centreMs,
    halfWidthMs: Math.max(centreMs - fromMs, toMs - centreMs),
    params: {
      traceIds: [...byTrace.keys()],
      traceFromMs: windows.map((window) => Math.floor(window.fromMs)),
      traceToMs: windows.map((window) => Math.ceil(window.toMs)),
    },
  };
}

/** Bounds each row by its own trace's window, read from arrays parallel to `traceIds`. */
function perTraceWindowFilter({
  traceColumn,
  timeColumn,
}: {
  traceColumn: string;
  timeColumn: string;
}): string {
  const at = (array: string) =>
    `fromUnixTimestamp64Milli(arrayElement({${array}:Array(Int64)}, indexOf({traceIds:Array(String)}, ${traceColumn})))`;
  return `AND ${timeColumn} >= ${at("traceFromMs")} AND ${timeColumn} <= ${at("traceToMs")}`;
}

/** The read asked one row past the cap per trace, so a trace holding that row was cut. */
function capPerTrace({
  rows,
  limit,
  tenantId,
}: {
  rows: StoredLogRecordRow[];
  limit: number;
  tenantId: string;
}): StoredLogRecordRow[] {
  const kept: StoredLogRecordRow[] = [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const count = (counts.get(row.traceId) ?? 0) + 1;
    counts.set(row.traceId, count);
    if (count <= limit) kept.push(row);
    else if (count === limit + 1) {
      logger.warn(
        { tenantId, traceId: row.traceId, limit },
        "Trace log read truncated at the row cap; the oldest rows are returned and later ones dropped",
      );
    }
  }
  return kept;
}
