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
    traceId: z.string(),
    computedInput: z.string().nullable(),
    topicId: z.string().nullable(),
    subtopicId: z.string().nullable(),
    occurredAtMs: z.string(),
  }),
);

/** Topic clustering's two reads of trace_summaries, as topic ran them before trace owned them. */
export class ClickHouseTraceClusteringSampleRepository extends TraceClusteringSampleRepository {
  readonly #clickhouse: Pick<ClickHouseQueryClient, "read">;

  static create(
    clickhouse: Pick<ClickHouseQueryClient, "read">,
  ): ClickHouseTraceClusteringSampleRepository {
    return new ClickHouseTraceClusteringSampleRepository(clickhouse);
  }

  private constructor(clickhouse: Pick<ClickHouseQueryClient, "read">) {
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
    const scope = tenantScope.single({ tenantId: input.tenantId });
    const until = input.windowEndMs ?? fn.now64(3);
    const latestOccurredAt = fn.argMax(summaries.OccurredAt, summaries.UpdatedAt);
    const latestTopicId = fn.argMax(summaries.TopicId, summaries.UpdatedAt);
    const latestSubtopicId = fn.argMax(summaries.SubTopicId, summaries.UpdatedAt);
    const topicIds = [...(input.unassignedFrom?.topicIds ?? [])];
    const subtopicIds = [...(input.unassignedFrom?.subtopicIds ?? [])];
    const { searchAfter } = input;
    // An empty known list makes `NOT IN` hold for every trace, so the either-or filter drops out.
    const filtersTopics = topicIds.length > 0 && subtopicIds.length > 0;
    const statement = clickhouseRead({ scope })
      .from(summaries)
      // The page picks keys only; no outer ORDER BY/LIMIT, which buffered full rows at 3.5 GiB.
      .with("page", (sub) => {
        const keys = sub
          .from(summaries)
          .select({ TraceId: summaries.TraceId })
          .where(({ and, gte, lt }) =>
            and(gte(summaries.OccurredAt, input.windowStartMs), lt(summaries.OccurredAt, until)),
          )
          .groupBy(summaries.TenantId, summaries.TraceId);
        const unassigned = filtersTopics
          ? keys.having(({ isNull, not, oneOf, or }) =>
              or(
                or(isNull(latestTopicId), not(oneOf(latestTopicId, topicIds))),
                or(isNull(latestSubtopicId), not(oneOf(latestSubtopicId, subtopicIds))),
              ),
            )
          : keys;
        // Mixed sort (OccurredAt DESC, TraceId ASC), so a tuple comparison cannot express it.
        const after =
          searchAfter === undefined
            ? unassigned
            : unassigned.having(({ and, eq, gt, lt, or }) =>
                or(
                  lt(latestOccurredAt, searchAfter[0]),
                  and(eq(latestOccurredAt, searchAfter[0]), gt(summaries.TraceId, searchAfter[1])),
                ),
              );
        return after
          .orderBy(latestOccurredAt, "DESC")
          .orderBy(summaries.TraceId, "ASC")
          .limit(2000);
      })
      .select({
        traceId: summaries.TraceId,
        computedInput: summaries.ComputedInput,
        topicId: summaries.TopicId,
        subtopicId: summaries.SubTopicId,
        occurredAtMs: fn.toString(fn.toUnixTimestamp64Milli(summaries.OccurredAt)),
      })
      .where(({ and, gte, lt, oneOf }) =>
        and(
          gte(summaries.OccurredAt, input.windowStartMs),
          lt(summaries.OccurredAt, until),
          oneOf(summaries.TraceId, { cte: "page" }),
        ),
      )
      .latestVersion()
      // A page holds up to 2000 heavy ComputedInput values; fewer streams keep it under the cap.
      .settings({ max_threads: 2 })
      .build();
    const result = await this.#clickhouse.read({ statement, table: summaries.$table.name });

    return pageRowsSchema.parse(result.rows).map((row) => ({
      ...row,
      occurredAtMs: parseInt(row.occurredAtMs, 10),
    }));
  }
}
