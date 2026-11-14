import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import { z } from "zod";

import {
  type TraceClusteringSampleCounts,
  TraceClusteringSampleRepository,
  type TraceClusteringSampleRow,
} from "../../features/topic/repositories/trace-clustering-sample.repository.ts";
import { traceSummaries as summaries } from "./clickhouse.trace-summaries.table.ts";

const countsRowsSchema = z.array(
  z.object({
    total: z.string(),
    recent: z.string(),
    assigned: z.string(),
  }),
);

const pageRowsSchema = z.array(
  z.object({
    TraceId: z.string(),
    ComputedInput: z.string().nullable(),
    TopicId: z.string().nullable(),
    SubTopicId: z.string().nullable(),
    OccurredAtMs: z.string(),
  }),
);

/**
 * Topic clustering's two reads of trace_summaries, as topic ran them before trace owned them. The
 * page read stays raw: `latestVersion()` elects without the `OccurredAt` window (handoff Risk 6).
 */
export class ClickHouseTraceClusteringSampleRepository extends TraceClusteringSampleRepository {
  readonly #clickhouse: Pick<ClickHouseQueryClient, "query" | "read">;

  static create(
    clickhouse: Pick<ClickHouseQueryClient, "query" | "read">,
  ): ClickHouseTraceClusteringSampleRepository {
    return new ClickHouseTraceClusteringSampleRepository(clickhouse);
  }

  private constructor(clickhouse: Pick<ClickHouseQueryClient, "query" | "read">) {
    super();
    this.#clickhouse = clickhouse;
  }

  async countTraces(input: {
    tenantId: string;
    recentSinceMs: number;
    windowStartMs: number;
  }): Promise<TraceClusteringSampleCounts> {
    const scope = tenantScope.single({ tenantId: input.tenantId });
    // One GROUP BY pass folds each trace to its latest version; a cleared topic reads unassigned.
    const traces = clickhouseRead({ scope })
      .from(summaries)
      .select({
        LatestOccurredAt: fn.argMax(summaries.OccurredAt, summaries.UpdatedAt),
        // ifNull keeps a cleared (NULL) topic in the election: argMax skips NULL values.
        LatestTopicId: fn.argMax(fn.ifNull(summaries.TopicId, ""), summaries.UpdatedAt),
      })
      .where(({ range }) => range(summaries.OccurredAt, { from: input.windowStartMs }))
      .groupBy(summaries.TenantId, summaries.TraceId)
      .as("traces");
    const statement = clickhouseRead({ scope })
      .from(traces)
      .select(({ gte, ne }) => ({
        total: fn.toString(fn.count()),
        recent: fn.toString(fn.countIf(gte(traces.LatestOccurredAt, input.recentSinceMs))),
        assigned: fn.toString(fn.countIf(ne(traces.LatestTopicId, ""))),
      }))
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });

    const row = countsRowsSchema.parse(result.rows)[0];
    return {
      total: parseInt(row?.total ?? "0", 10),
      recent: parseInt(row?.recent ?? "0", 10),
      assigned: parseInt(row?.assigned ?? "0", 10),
    };
  }

  async findPageRows(input: {
    tenantId: string;
    windowStartMs: number;
    windowEndMs?: number;
    unassignedFrom?: { topicIds: readonly string[]; subtopicIds: readonly string[] };
    searchAfter?: readonly [number, string];
  }): Promise<TraceClusteringSampleRow[]> {
    const windowEnd =
      input.windowEndMs === undefined
        ? "now64(3)"
        : "fromUnixTimestamp64Milli({fetchWindowEndMs:UInt64})";
    const topicIds = input.unassignedFrom?.topicIds ?? [];
    const subtopicIds = input.unassignedFrom?.subtopicIds ?? [];
    const pageHaving: string[] = [];

    if (input.unassignedFrom) {
      const topicCondition =
        topicIds.length > 0
          ? `(argMax(TopicId, UpdatedAt) IS NULL OR argMax(TopicId, UpdatedAt) NOT IN ({topicIds:Array(String)}))`
          : "1=1";
      const subtopicCondition =
        subtopicIds.length > 0
          ? `(argMax(SubTopicId, UpdatedAt) IS NULL OR argMax(SubTopicId, UpdatedAt) NOT IN ({subtopicIds:Array(String)}))`
          : "1=1";
      pageHaving.push(`(${topicCondition} OR ${subtopicCondition})`);
    }

    if (input.searchAfter) {
      // Mixed sort (OccurredAt DESC, TraceId ASC), so a tuple comparison cannot express it.
      pageHaving.push(`(
        toUnixTimestamp64Milli(argMax(OccurredAt, UpdatedAt)) < {lastTs:UInt64}
        OR (
          toUnixTimestamp64Milli(argMax(OccurredAt, UpdatedAt)) = {lastTs:UInt64}
          AND TraceId > {lastTraceId:String}
        )
      )`);
    }

    const pageHavingClause = pageHaving.length ? `HAVING ${pageHaving.join(" AND ")}` : "";
    // The page CTE picks keys only; no outer ORDER BY/LIMIT, which buffered full rows at 3.5 GiB.
    const result = await this.#clickhouse.query<unknown>({
      tenantId: input.tenantId,
      table: summaries.$table.name,
      sql: `
        WITH page AS (
          SELECT TraceId
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fetchWindowStartMs:UInt64})
            AND OccurredAt < ${windowEnd}
          GROUP BY TenantId, TraceId
          ${pageHavingClause}
          ORDER BY argMax(OccurredAt, UpdatedAt) DESC, TraceId ASC
          LIMIT 2000
        )
        SELECT
          t.TraceId AS TraceId,
          t.ComputedInput AS ComputedInput,
          t.TopicId AS TopicId,
          t.SubTopicId AS SubTopicId,
          toString(toUnixTimestamp64Milli(t.OccurredAt)) AS OccurredAtMs
        FROM trace_summaries t
        WHERE TenantId = {tenantId:String}
          AND OccurredAt >= fromUnixTimestamp64Milli({fetchWindowStartMs:UInt64})
          AND OccurredAt < ${windowEnd}
          AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND OccurredAt >= fromUnixTimestamp64Milli({fetchWindowStartMs:UInt64})
              AND OccurredAt < ${windowEnd}
              AND TraceId IN (SELECT TraceId FROM page)
            GROUP BY TenantId, TraceId
          )
      `,
      params: {
        tenantId: input.tenantId,
        fetchWindowStartMs: input.windowStartMs,
        ...(input.windowEndMs === undefined ? {} : { fetchWindowEndMs: input.windowEndMs }),
        topicIds: topicIds.length > 0 ? [...topicIds] : ["__none__"],
        subtopicIds: subtopicIds.length > 0 ? [...subtopicIds] : ["__none__"],
        ...(input.searchAfter
          ? { lastTs: input.searchAfter[0], lastTraceId: input.searchAfter[1] }
          : {}),
      },
      // A page holds up to 2000 heavy ComputedInput values; fewer read streams
      // keep it under the per-query memory cap.
      settings: { max_threads: "2" },
    });

    return pageRowsSchema.parse(result.rows).map((row) => ({
      traceId: row.TraceId,
      computedInput: row.ComputedInput,
      topicId: row.TopicId,
      subtopicId: row.SubTopicId,
      occurredAtMs: parseInt(row.OccurredAtMs, 10),
    }));
  }
}
