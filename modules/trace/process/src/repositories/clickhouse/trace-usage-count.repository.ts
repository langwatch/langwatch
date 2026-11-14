import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import { nowInstant } from "@langwatch/time";
import type { TraceAttributeMatch } from "@langwatch/trace-contract";

import { TraceUsageCountRepository } from "../trace-usage-count.repository.ts";
import { traceSummaries as summaries } from "./clickhouse.trace-summaries.table.ts";

/** How far before a window a counted trace may have started, and been seen first. */
const FIRST_SEEN_LOOKBACK_MS = 31 * 24 * 60 * 60 * 1_000;
const LAST_DAY_MS = 24 * 60 * 60 * 1_000;

/** ClickHouse reads of per-project trace counts over `trace_summaries`, as typed reads. */
export class TraceUsageCountClickHouseRepository extends TraceUsageCountRepository {
  readonly #clickhouse: Pick<ClickHouseQueryClient, "read">;

  private constructor(clickhouse: Pick<ClickHouseQueryClient, "read">) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(
    clickhouse: Pick<ClickHouseQueryClient, "read">,
  ): TraceUsageCountClickHouseRepository {
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
    const lookbackFrom = input.fromMs - FIRST_SEEN_LOOKBACK_MS;
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(summaries)
      .select({ traceId: summaries.TraceId })
      .where(({ and, gt, gte, range }) =>
        and(
          gt(summaries.TraceId, input.afterTraceId),
          gte(summaries.OccurredAt, lookbackFrom),
          range(summaries.CreatedAt, { from: lookbackFrom, until: input.toMs }),
        ),
      )
      .groupBy(summaries.TraceId)
      .having(({ gte }) => gte(fn.min(summaries.CreatedAt), input.fromMs))
      .orderBy(summaries.TraceId)
      .limit(input.limit)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });
    return result.rows.map((row) => row.traceId);
  }

  /** Main's automation runaway count: exact distinct traces over the trailing 24 hours. */
  async countTracesInLastDay(input: { tenantId: string }): Promise<number> {
    const since = nowInstant().epochMilliseconds - LAST_DAY_MS;
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(summaries)
      .select({ total: fn.toString(fn.countDistinct(summaries.TraceId)) })
      .where(({ gte }) => gte(summaries.OccurredAt, since))
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });

    return Number.parseInt(String(result.rows[0]?.total ?? "0"), 10);
  }

  async hasTraceWithAttribute(input: {
    tenantId: string;
    sinceMs: number;
    attribute: TraceAttributeMatch;
  }): Promise<boolean> {
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(summaries)
      .select({ traceId: summaries.TraceId })
      .where(({ and, eq, gte }) =>
        and(
          gte(summaries.OccurredAt, input.sinceMs),
          eq(fn.mapGet(summaries.Attributes, input.attribute.key), input.attribute.value),
        ),
      )
      .limit(1)
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });

    return result.rows.length > 0;
  }

  /** Counts raw summary rows, not deduped traces, as main's governance source breakdown did. */
  async findTraceCountsByAttribute(input: {
    tenantId: string;
    sinceMs: number;
    attribute: TraceAttributeMatch;
    groupByKey: string;
  }): Promise<{ value: string; count: number }[]> {
    const value = fn.mapGet(summaries.Attributes, input.groupByKey);
    const statement = clickhouseRead({ scope: tenantScope.single({ tenantId: input.tenantId }) })
      .from(summaries)
      .select({ value, count: fn.count() })
      .where(({ and, eq, gte }) =>
        and(
          gte(summaries.OccurredAt, input.sinceMs),
          eq(fn.mapGet(summaries.Attributes, input.attribute.key), input.attribute.value),
        ),
      )
      .groupBy(value)
      .orderBy("count", "DESC")
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });

    return result.rows.map((row) => ({ value: row.value, count: Number(row.count ?? 0) }));
  }
}
