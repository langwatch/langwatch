import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { TraceClickHouseWriteResolver } from "../trace-clickhouse-client.repository.ts";
import type { TraceAnalyticsRollupRow } from "../../eventing/trace-rollup.projection.ts";
import { TraceAnalyticsRollupRepository } from "../projection/trace-analytics-rollup.repository.ts";

const TABLE_NAME = "trace_analytics_rollup" as const;

const logger = createLogger("langwatch:trace:trace-analytics-rollup-repository");

/**
 * 64-bit int columns serialize as strings to prevent JSON precision loss.
 */
interface ClickHouseRollupWriteRecord {
  TenantId: string;
  BucketStart: Date;
  Model: string;
  SpanType: string;
  // UInt64 columns — serialize as strings.
  SpanCount: string;
  TraceCount: string;
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
    TraceCount: String(row.traceCount),
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

export class TraceAnalyticsRollupClickHouseRepository extends TraceAnalyticsRollupRepository {
  private constructor(
    private readonly options: {
      resolveClient: TraceClickHouseWriteResolver;
      defaultRetentionDays: number;
    },
  ) {
    super();
  }

  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
    defaultRetentionDays: number;
  }): TraceAnalyticsRollupClickHouseRepository {
    return new TraceAnalyticsRollupClickHouseRepository(options);
  }

  async insertRow({
    row,
    retentionDays = this.options.defaultRetentionDays,
  }: {
    row: TraceAnalyticsRollupRow;
    retentionDays?: number;
  }): Promise<void> {
    EventUtils.validateTenantId(
      { tenantId: row.tenantId },
      "TraceAnalyticsRollupClickHouseRepository.insertRow",
    );

    try {
      const client = await this.options.resolveClient(row.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [toClickHouseRecord(row, retentionDays)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
        {
          tenantId: row.tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert trace_analytics_rollup row into ClickHouse",
      );
      throw error;
    }
  }

  async insertRows({
    rows,
    retentionDays = this.options.defaultRetentionDays,
  }: {
    rows: TraceAnalyticsRollupRow[];
    retentionDays?: number;
  }): Promise<void> {
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
      const client = await this.options.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: rows.map((row) => toClickHouseRecord(row, retentionDays)),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
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
