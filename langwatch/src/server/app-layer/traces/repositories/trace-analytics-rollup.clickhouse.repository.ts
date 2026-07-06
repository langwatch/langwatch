import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import type { TraceAnalyticsRollupRow } from "~/server/event-sourcing/pipelines/trace-processing/projections/traceAnalyticsRollup.mapProjection";
import { SecurityError } from "~/server/event-sourcing/services/errorHandling";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { createLogger } from "~/utils/logger/server";
import type { TraceAnalyticsRollupRepository } from "./trace-analytics-rollup.repository";

const TABLE_NAME = "trace_analytics_rollup" as const;

const logger = createLogger(
  "langwatch:app-layer:traces:trace-analytics-rollup-repository",
);

/**
 * ClickHouse columns are `SimpleAggregateFunction(sum, ...)`. Inserts carry
 * plain scalars, but the JSONEachRow contract requires UInt64 / Int64 columns
 * to be serialized as STRINGS — JSON numbers can't safely round-trip a 64-bit
 * integer (precision-loss at >2^53). Float64 columns stay as numbers.
 *
 * Mismatch reproduces as `CANNOT_PARSE_QUOTED_STRING: expected opening quote`
 * at insert time, so every 64-bit-integer column is typed `string` below and
 * stringified in `toClickHouseRecord`. The async_insert path coalesces per-span
 * writes into batches at the server.
 */
interface ClickHouseRollupWriteRecord {
  TenantId: string;
  BucketStart: Date;
  Model: string;
  SpanType: string;
  // UInt64 columns — serialize as strings.
  SpanCount: string;
  ErrorCount: string;
  PromptTokensSum: string;
  CompletionTokensSum: string;
  CacheReadTokensSum: string;
  CacheWriteTokensSum: string;
  ReasoningTokensSum: string;
  // Float64 column — serialize as a number.
  CostSum: number;
  NonBilledCostSum: number;
  // Int64 column — serialize as a string for the same precision reason.
  DurationSum: string;
  // UInt16 — small enough to fit in a JSON number.
  _retention_days: number;
}

function toClickHouseRecord(
  row: TraceAnalyticsRollupRow,
  retentionDays: number,
): ClickHouseRollupWriteRecord {
  return {
    TenantId: row.tenantId,
    BucketStart: row.bucketStart,
    Model: row.model,
    SpanType: row.spanType,
    SpanCount: String(row.spanCount),
    ErrorCount: String(row.errorCount),
    CostSum: row.costSum,
    NonBilledCostSum: row.nonBilledCostSum,
    DurationSum: String(row.durationSum),
    PromptTokensSum: String(row.promptTokensSum),
    CompletionTokensSum: String(row.completionTokensSum),
    CacheReadTokensSum: String(row.cacheReadTokensSum),
    CacheWriteTokensSum: String(row.cacheWriteTokensSum),
    ReasoningTokensSum: String(row.reasoningTokensSum),
    _retention_days: retentionDays,
  };
}

export class TraceAnalyticsRollupClickHouseRepository
  implements TraceAnalyticsRollupRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insertRow(
    row: TraceAnalyticsRollupRow,
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "TraceAnalyticsRollupClickHouseRepository.insertRow",
    );

    try {
      const client = await this.resolveClient(row.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [toClickHouseRecord(row, retentionDays)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          tenantId: row.tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert trace_analytics_rollup row into ClickHouse",
      );
      throw error;
    }
  }

  async insertRows(
    rows: TraceAnalyticsRollupRow[],
    retentionDays = PLATFORM_DEFAULT_RETENTION_DAYS,
  ): Promise<void> {
    if (rows.length === 0) return;

    for (const row of rows) {
      EventUtils.validateTenantId(
        { tenantId: row.tenantId },
        "TraceAnalyticsRollupClickHouseRepository.insertRows",
      );
    }

    // One client per tenant — mirroring SpanStorageClickHouseRepository.insertSpans,
    // a mixed-tenant batch would silently route one tenant's data through
    // another's private ClickHouse instance.
    const tenantId = rows[0]!.tenantId;
    for (const row of rows) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError(
          "TraceAnalyticsRollupClickHouseRepository.insertRows",
          "all rows in a single batch must share the same tenantId",
          tenantId,
          { mismatchedTenantId: row.tenantId },
        );
      }
    }

    try {
      const client = await this.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: rows.map((row) => toClickHouseRecord(row, retentionDays)),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.error(
        {
          count: rows.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to bulk insert trace_analytics_rollup rows into ClickHouse",
      );
      throw error;
    }
  }
}
