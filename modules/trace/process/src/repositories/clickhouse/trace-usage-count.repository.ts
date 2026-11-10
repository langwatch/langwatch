import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { TraceAttributeMatch, TraceUsageDay } from "@langwatch/trace-contract";

import { TraceUsageCountRepository } from "../trace-usage-count.repository.ts";

type TotalRow = { total: string | number };
type HitRow = { hit: number };
/** How far before a window a counted trace may have started, and been seen first. */
const FIRST_SEEN_LOOKBACK_MS = 31 * 24 * 60 * 60 * 1_000;

type TraceIdRow = { traceId: string };
type UsageDayRow = {
  day: string;
  traceCount: string | number;
  errorCount: string | number;
  totalCost: string | number;
  lastTraceAt: string | number;
  lastFailedTraceAt: string | number;
};
type AttributeCountRow = { value: string; count: string | number };

/** ClickHouse reads of per-project trace counts over `trace_summaries` and its rollup. */
export class TraceUsageCountClickHouseRepository extends TraceUsageCountRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): TraceUsageCountClickHouseRepository {
    return new TraceUsageCountClickHouseRepository(clickhouse);
  }

  /**
   * A trace is listed where its earliest summary version was written. The sort key is
   * (TenantId, TraceId), so `afterTraceId` skips earlier pages by index; `OccurredAt` bounds the
   * partitions read to traces starting at most {@link FIRST_SEEN_LOOKBACK_MS} before the window.
   */
  async findTraceIdsFirstSeen(input: {
    tenantId: string;
    fromMs: number;
    toMs: number;
    afterTraceId: string;
    limit: number;
  }): Promise<string[]> {
    const result = await this.#clickhouse.query<TraceIdRow>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT TraceId AS traceId
        FROM trace_summaries
        WHERE TenantId = {tenantId:String}
          AND TraceId > {afterTraceId:String}
          AND OccurredAt >= fromUnixTimestamp64Milli({lookbackFrom:Int64})
          AND CreatedAt >= fromUnixTimestamp64Milli({lookbackFrom:Int64})
          AND CreatedAt < fromUnixTimestamp64Milli({to:Int64})
        GROUP BY TraceId
        HAVING min(CreatedAt) >= fromUnixTimestamp64Milli({from:Int64})
        ORDER BY TraceId
        LIMIT {limit:UInt32}
      `,
      params: {
        tenantId: input.tenantId,
        afterTraceId: input.afterTraceId,
        lookbackFrom: input.fromMs - FIRST_SEEN_LOOKBACK_MS,
        from: input.fromMs,
        to: input.toMs,
        limit: input.limit,
      },
    });
    return result.rows.map((row) => row.traceId);
  }

  /** Main's automation runaway count: exact distinct traces over the trailing 24 hours. */
  async countTracesInLastDay(input: { tenantId: string }): Promise<number> {
    const result = await this.#clickhouse.query<TotalRow>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT toString(count(DISTINCT TraceId)) AS total
        FROM trace_summaries
        WHERE TenantId = {tenantId:String}
          AND OccurredAt >= now() - INTERVAL 24 HOUR
      `,
      params: { tenantId: input.tenantId },
    });

    return Number.parseInt(String(result.rows[0]?.total ?? "0"), 10);
  }

  /**
   * One query over the per-minute rollup for the organization's projects, grouped by UTC day: at
   * most 1,440 buckets per project, model and span type a day, never a per-trace scan.
   */
  async findTraceUsageByDay(input: {
    organizationId: string;
    projectIds: readonly string[];
    sinceMs: number;
    untilMs?: number;
  }): Promise<TraceUsageDay[]> {
    const [first] = input.projectIds;
    const until =
      input.untilMs === undefined
        ? ""
        : "AND BucketStart < fromUnixTimestamp64Milli({until:Int64})";
    if (first === undefined) return [];
    const result = await this.#clickhouse.query<UsageDayRow>({
      tenantId: first,
      organizationId: input.organizationId,
      tenantIds: input.projectIds,
      table: "trace_analytics_rollup",
      sql: `
        SELECT
          toString(toDate(BucketStart, 'UTC')) AS day,
          toString(sum(TraceCount)) AS traceCount,
          toString(sum(ErrorCount)) AS errorCount,
          sum(CostSum) AS totalCost,
          toString(toUnixTimestamp64Milli(max(BucketStart))) AS lastTraceAt,
          toString(toUnixTimestamp64Milli(maxIf(BucketStart, ErrorCount > 0))) AS lastFailedTraceAt
        FROM trace_analytics_rollup
        WHERE TenantId IN ({projectIds:Array(String)})
          AND BucketStart >= fromUnixTimestamp64Milli({since:Int64})
          ${until}
        GROUP BY day
        ORDER BY day
      `,
      params: {
        projectIds: [...input.projectIds],
        since: input.sinceMs,
        ...(input.untilMs !== undefined && { until: input.untilMs }),
      },
    });
    return result.rows.map((row) => {
      // maxIf over no failed bucket answers the epoch, which no real trace has.
      const lastFailedTraceAt = Number(row.lastFailedTraceAt);
      return {
        day: row.day,
        traceCount: Number(row.traceCount),
        errorCount: Number(row.errorCount),
        totalCost: Number(row.totalCost),
        lastTraceAt: Number(row.lastTraceAt),
        lastFailedTraceAt: lastFailedTraceAt > 0 ? lastFailedTraceAt : null,
      };
    });
  }

  async hasTraceWithAttribute(input: {
    tenantId: string;
    sinceMs: number;
    attribute: TraceAttributeMatch;
  }): Promise<boolean> {
    const result = await this.#clickhouse.query<HitRow>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT 1 AS hit
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})
          AND ts.Attributes[{attributeKey:String}] = {attributeValue:String}
        LIMIT 1
      `,
      params: {
        tenantId: input.tenantId,
        since: input.sinceMs,
        attributeKey: input.attribute.key,
        attributeValue: input.attribute.value,
      },
    });

    return result.rows.length > 0;
  }

  /** Counts raw summary rows, not deduped traces, as main's governance source breakdown did. */
  async findTraceCountsByAttribute(input: {
    tenantId: string;
    sinceMs: number;
    attribute: TraceAttributeMatch;
    groupByKey: string;
  }): Promise<{ value: string; count: number }[]> {
    const result = await this.#clickhouse.query<AttributeCountRow>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT
          ts.Attributes[{groupByKey:String}] AS value,
          count() AS count
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})
          AND ts.Attributes[{attributeKey:String}] = {attributeValue:String}
        GROUP BY value
        ORDER BY count DESC
      `,
      params: {
        tenantId: input.tenantId,
        since: input.sinceMs,
        attributeKey: input.attribute.key,
        attributeValue: input.attribute.value,
        groupByKey: input.groupByKey,
      },
    });

    return result.rows.map((row) => ({ value: row.value, count: Number(row.count ?? 0) }));
  }
}
