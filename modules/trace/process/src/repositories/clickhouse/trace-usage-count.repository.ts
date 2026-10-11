import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { TraceAttributeMatch } from "@langwatch/trace-contract";

import { TraceUsageCountRepository } from "../trace-usage-count.repository.ts";

type TotalRow = { total: string | number };
type HitRow = { hit: number };
/** How far before a window a counted trace may have started, and been seen first. */
const FIRST_SEEN_LOOKBACK_MS = 31 * 24 * 60 * 60 * 1_000;

type AttributeCountRow = { value: string; count: string | number };

/** Main's `queryTraceSummariesTotalUniq` for one project: HyperLogLog `uniq`, about 1% error. */
export class TraceUsageCountClickHouseRepository extends TraceUsageCountRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): TraceUsageCountClickHouseRepository {
    return new TraceUsageCountClickHouseRepository(clickhouse);
  }

  async countDistinctTraces(input: {
    tenantId: string;
    startDate: string;
    endDate: string;
  }): Promise<number> {
    const result = await this.#clickhouse.query<TotalRow>({
      tenantId: input.tenantId,
      sql: `
        SELECT uniq(TraceId) as total
        FROM trace_summaries
        WHERE TenantId = {tenantId:String}
          AND CreatedAt >= {startDate:DateTime64(3)}
          AND CreatedAt < {endDate:DateTime64(3)}
      `,
      params: {
        tenantId: input.tenantId,
        startDate: input.startDate,
        endDate: input.endDate,
      },
    });

    return Number(result.rows[0]?.total ?? 0);
  }

  /**
   * A trace counts where its earliest summary version was written; `OccurredAt` bounds the
   * partitions read to traces starting at most {@link FIRST_SEEN_LOOKBACK_MS} before the window.
   */
  async countTracesFirstSeen(input: {
    tenantId: string;
    fromMs: number;
    toMs: number;
  }): Promise<number> {
    const result = await this.#clickhouse.query<TotalRow>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT toString(count()) AS total
        FROM (
          SELECT TraceId, min(CreatedAt) AS FirstSeenAt
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({occurredFrom:Int64})
            AND CreatedAt >= fromUnixTimestamp64Milli({createdFrom:Int64})
            AND CreatedAt < fromUnixTimestamp64Milli({to:Int64})
          GROUP BY TraceId
        )
        WHERE FirstSeenAt >= fromUnixTimestamp64Milli({from:Int64})
      `,
      params: {
        tenantId: input.tenantId,
        occurredFrom: input.fromMs - FIRST_SEEN_LOOKBACK_MS,
        createdFrom: input.fromMs - FIRST_SEEN_LOOKBACK_MS,
        from: input.fromMs,
        to: input.toMs,
      },
    });

    return Number.parseInt(String(result.rows[0]?.total ?? "0"), 10);
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
