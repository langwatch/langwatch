import { EventUtils, SecurityError } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { nowInstant, toDate } from "@langwatch/time";
import { z } from "zod";

import type { SpanAnalyticsRow } from "../../eventing/span-analytics.projection.ts";
import { type SpanAnalyticsKey, SpanAnalyticsRepository } from "../span-analytics.repository.ts";
import type { TraceClickHouseWriteResolver } from "./clickhouse.trace-member-client.repository.ts";

const TABLE_NAME = "span_analytics" as const;

const spanKeysSchema = z.array(z.object({ TraceId: z.string(), SpanId: z.string() }));

const logger = createLogger("langwatch:trace:span-analytics-repository");

/** The `span_analytics` write shape; UInt64 columns ride as strings for JSON precision. */
interface ClickHouseSpanAnalyticsWriteRecord {
  TenantId: string;
  TraceId: string;
  SpanId: string;
  ParentSpanId: string | null;
  StartTime: Date;
  EndTime: Date;
  DurationMs: string;
  SpanName: string;
  SpanKind: number;
  StatusCode: number | null;
  Cost: number | null;
  NonBilledCost: number | null;
  SpanType: string;
  ErrorType: string;
  RagContextCount: number;
  InputHash: string;
  DeploymentEnvironment: string;
  ProjectedAt: Date;
  _retention_days: number;
}

function toClickHouseRecord({
  row,
  retentionDays,
  projectedAt,
}: {
  row: SpanAnalyticsRow;
  retentionDays: number;
  projectedAt: Date;
}): ClickHouseSpanAnalyticsWriteRecord {
  return {
    TenantId: row.tenantId,
    TraceId: row.traceId,
    SpanId: row.spanId,
    ParentSpanId: row.parentSpanId,
    StartTime: new Date(row.startTimeUnixMs),
    EndTime: new Date(row.endTimeUnixMs),
    DurationMs: String(Math.max(0, Math.round(row.durationMs))),
    SpanName: row.spanName,
    SpanKind: row.spanKind,
    StatusCode: row.statusCode,
    Cost: row.cost,
    NonBilledCost: row.nonBilledCost,
    SpanType: row.spanType,
    ErrorType: row.errorType,
    RagContextCount: row.ragContextCount,
    InputHash: row.inputHash,
    DeploymentEnvironment: row.deploymentEnvironment,
    ProjectedAt: projectedAt,
    _retention_days: retentionDays,
  };
}

/** Appends span_analytics rows through the tenant's own ClickHouse. */
export class SpanAnalyticsClickHouseRepository extends SpanAnalyticsRepository {
  private constructor(private readonly options: { resolveClient: TraceClickHouseWriteResolver }) {
    super();
  }

  static create(options: {
    resolveClient: TraceClickHouseWriteResolver;
  }): SpanAnalyticsClickHouseRepository {
    return new SpanAnalyticsClickHouseRepository(options);
  }

  async insertRows({
    rows,
    retentionDays,
  }: {
    rows: SpanAnalyticsRow[];
    retentionDays: number;
  }): Promise<void> {
    const [first] = rows;
    if (!first) return;
    const tenantId = first.tenantId;
    EventUtils.validateTenantId({ tenantId }, "SpanAnalyticsClickHouseRepository.insertRows");
    // One client per tenant: a mixed batch would route one tenant's rows through another's
    // private ClickHouse.
    for (const row of rows) {
      if (row.tenantId !== tenantId) {
        throw new SecurityError({
          operation: "SpanAnalyticsClickHouseRepository.insertRows",
          message: "all rows in a single batch must share the same tenantId",
          tenantId,
          context: { mismatchedTenantId: row.tenantId },
        });
      }
    }

    // The ReplacingMergeTree version. The store writes each span once (first copy wins);
    // a residual duplicate merges to the later copy within its weekly partition.
    const projectedAt = toDate(nowInstant());
    try {
      const client = await this.options.resolveClient(tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: rows.map((row) => toClickHouseRecord({ row, retentionDays, projectedAt })),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    } catch (error) {
      logger.warn(
        {
          tenantId,
          count: rows.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to insert span_analytics rows into ClickHouse",
      );
      throw error;
    }
  }

  async existingSpanKeys({
    tenantId,
    keys,
    startTimeFromMs,
    startTimeToMs,
  }: {
    tenantId: string;
    keys: SpanAnalyticsKey[];
    startTimeFromMs: number;
    startTimeToMs: number;
  }): Promise<SpanAnalyticsKey[]> {
    if (keys.length === 0) return [];
    EventUtils.validateTenantId({ tenantId }, "SpanAnalyticsClickHouseRepository.existingSpanKeys");
    try {
      const client = await this.options.resolveClient(tenantId);
      // The StartTime bound keeps the lookup to the few weekly partitions the batch can sit in.
      const result = await client.query({
        query: `
          SELECT TraceId, SpanId
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND (TraceId, SpanId) IN arrayZip({traceIds:Array(String)}, {spanIds:Array(String)})
            AND StartTime BETWEEN fromUnixTimestamp64Milli({fromMs:Int64}) AND fromUnixTimestamp64Milli({toMs:Int64})
        `,
        query_params: {
          tenantId,
          traceIds: keys.map((key) => key.traceId),
          spanIds: keys.map((key) => key.spanId),
          fromMs: startTimeFromMs,
          toMs: startTimeToMs,
        },
        format: "JSONEachRow",
      });
      return spanKeysSchema
        .parse(await result.json())
        .map((row) => ({ traceId: row.TraceId, spanId: row.SpanId }));
    } catch (error) {
      logger.warn(
        {
          tenantId,
          count: keys.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to look up existing span_analytics keys in ClickHouse",
      );
      throw error;
    }
  }
}
