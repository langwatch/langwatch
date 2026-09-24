import { z } from "zod";

import type { TraceClickHouseResolver } from "../trace-clickhouse-client.repository.ts";
import {
  type TraceClusteringSampleCounts,
  TraceClusteringSampleRepository,
  type TraceClusteringSampleRow,
} from "../trace-clustering-sample.repository.ts";

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

/** Topic clustering's two reads of trace_summaries, as topic ran them before trace owned them. */
export class ClickHouseTraceClusteringSampleRepository extends TraceClusteringSampleRepository {
  static create(options: {
    resolveClient: TraceClickHouseResolver;
  }): ClickHouseTraceClusteringSampleRepository {
    return new ClickHouseTraceClusteringSampleRepository(options.resolveClient);
  }

  private constructor(private readonly resolveClient: TraceClickHouseResolver) {
    super();
  }

  async countTraces(input: {
    tenantId: string;
    recentSinceMs: number;
    windowStartMs: number;
  }): Promise<TraceClusteringSampleCounts> {
    const client = await this.resolveClient(input.tenantId);
    // One GROUP BY pass folds each trace to its latest version; a cleared topic reads unassigned.
    const result = await client.query({
      query: `
        SELECT
          toString(count(*)) AS total,
          toString(countIf(latestOccurredAt >= fromUnixTimestamp64Milli({thirtyDaysAgo:UInt64}))) AS recent,
          toString(countIf(latestAssigned)) AS assigned
        FROM (
          SELECT
            argMax(OccurredAt, UpdatedAt) AS latestOccurredAt,
            argMax(TopicId IS NOT NULL AND TopicId != '', UpdatedAt) AS latestAssigned
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({twelveMonthsAgo:UInt64})
          GROUP BY TenantId, TraceId
        )
      `,
      query_params: {
        tenantId: input.tenantId,
        thirtyDaysAgo: input.recentSinceMs,
        twelveMonthsAgo: input.windowStartMs,
      },
      format: "JSONEachRow",
    });

    const row = countsRowsSchema.parse(await result.json())[0];
    return {
      total: parseInt(row?.total ?? "0", 10),
      recent: parseInt(row?.recent ?? "0", 10),
      assigned: parseInt(row?.assigned ?? "0", 10),
    };
  }

  async findPageRows(input: {
    tenantId: string;
    windowStartMs: number;
    unassignedFrom?: { topicIds: readonly string[]; subtopicIds: readonly string[] };
    searchAfter?: readonly [number, string];
  }): Promise<TraceClusteringSampleRow[]> {
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
    const client = await this.resolveClient(input.tenantId);
    // The page CTE picks keys only; no outer ORDER BY/LIMIT, which buffered full rows at 3.5 GiB.
    const result = await client.query({
      query: `
        WITH page AS (
          SELECT TraceId
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fetchWindowStartMs:UInt64})
            AND OccurredAt < now64(3)
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
          AND OccurredAt < now64(3)
          AND (t.TenantId, t.TraceId, t.UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND OccurredAt >= fromUnixTimestamp64Milli({fetchWindowStartMs:UInt64})
              AND OccurredAt < now64(3)
              AND TraceId IN (SELECT TraceId FROM page)
            GROUP BY TenantId, TraceId
          )
      `,
      query_params: {
        tenantId: input.tenantId,
        fetchWindowStartMs: input.windowStartMs,
        topicIds: topicIds.length > 0 ? [...topicIds] : ["__none__"],
        subtopicIds: subtopicIds.length > 0 ? [...subtopicIds] : ["__none__"],
        ...(input.searchAfter
          ? { lastTs: input.searchAfter[0], lastTraceId: input.searchAfter[1] }
          : {}),
      },
      format: "JSONEachRow",
      // A page holds up to 2000 heavy ComputedInput values; fewer read streams
      // keep it under the per-query memory cap.
      clickhouse_settings: { max_threads: "2" },
    });

    return pageRowsSchema.parse(await result.json()).map((row) => ({
      traceId: row.TraceId,
      computedInput: row.ComputedInput,
      topicId: row.TopicId,
      subtopicId: row.SubTopicId,
      occurredAtMs: parseInt(row.OccurredAtMs, 10),
    }));
  }
}
