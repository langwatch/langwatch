import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  type Expression,
  fn,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import type { TraceAgentSeen } from "@langwatch/trace-contract";
import { z } from "zod";

import { TraceAgentTrafficRepository } from "../trace-agent-traffic.repository.ts";
import { storedSpans as spans } from "./clickhouse.stored-spans.table.ts";

const agentSeenRowSchema = z.object({
  agentName: z.string(),
  agentId: z.string(),
  model: z.string(),
  spanCount: z.coerce.number(),
  firstSeenMs: z.coerce.number(),
  lastSeenMs: z.coerce.number(),
});

const attribute = (key: string) => fn.mapGet(spans.SpanAttributes, key);

/** The key on most spans of a `sumMapIf` pair, ties to the greater key, `''` when it holds none. */
const mostSpans = <T extends string>(
  sums: Expression<readonly [readonly string[], readonly number[]], T>,
) =>
  fn.arrayElement(
    fn.arrayReverseSortBy(
      (key, count) => fn.tuple(count, key),
      fn.tupleElement(sums, "0"),
      fn.tupleElement(sums, "1"),
    ),
    1,
  );

/**
 * Distinct `gen_ai.agent.name` over `stored_spans`, bounded by `StartTime` so only the window's
 * partitions are read. Id and model are the non-empty values on most spans, ties broken by value,
 * so an agent mixing models reads the same on every pass. Counts may include unmerged duplicates.
 */
export class TraceAgentTrafficClickHouseRepository extends TraceAgentTrafficRepository {
  readonly #clickhouse: Pick<ClickHouseQueryClient, "read">;

  private constructor(clickhouse: Pick<ClickHouseQueryClient, "read">) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(
    clickhouse: Pick<ClickHouseQueryClient, "read">,
  ): TraceAgentTrafficClickHouseRepository {
    return new TraceAgentTrafficClickHouseRepository(clickhouse);
  }

  async findAgentsSeen(input: {
    tenantId: string;
    sinceMs: number;
    limit: number;
  }): Promise<TraceAgentSeen[]> {
    const { rows } = await this.#clickhouse.read({
      statement: TraceAgentTrafficClickHouseRepository.agentsSeenRead(input),
      table: spans.$table.name,
    });
    return rows.map((raw) => {
      const row = agentSeenRowSchema.parse(raw);
      return {
        ...row,
        agentId: row.agentId === "" ? null : row.agentId,
        model: row.model === "" ? null : row.model,
      };
    });
  }

  /** Per agent, id and model: span counts in the window, then each agent's most-used values. */
  static agentsSeenRead({
    tenantId,
    sinceMs,
    limit,
  }: {
    tenantId: string;
    sinceMs: number;
    limit: number;
  }): ReaderReadStatement<z.input<typeof agentSeenRowSchema>> {
    const scope = tenantScope.single({ tenantId });
    const agentName = attribute("gen_ai.agent.name");
    const seenId = attribute("gen_ai.agent.id");
    const seenModel = attribute("gen_ai.request.model");
    const seen = clickhouseRead({ scope })
      .from(spans)
      .select({
        agentName,
        seenId,
        seenModel,
        spans: fn.count(),
        firstAt: fn.min(spans.StartTime),
        lastAt: fn.max(spans.StartTime),
      })
      .where(({ and, gte, ne }) => and(gte(spans.StartTime, sinceMs), ne(agentName, "")))
      .groupBy(agentName, seenId, seenModel)
      .as("seen");
    return clickhouseRead({ scope })
      .from(seen)
      .select(({ ne }) => {
        const spanCounts = fn.array(seen.spans);
        return {
          agentName: seen.agentName,
          agentId: mostSpans(fn.sumMapIf(fn.array(seen.seenId), spanCounts, ne(seen.seenId, ""))),
          model: mostSpans(
            fn.sumMapIf(fn.array(seen.seenModel), spanCounts, ne(seen.seenModel, "")),
          ),
          spanCount: fn.sum(seen.spans),
          firstSeenMs: fn.toUnixTimestamp64Milli(fn.min(seen.firstAt)),
          lastSeenMs: fn.toUnixTimestamp64Milli(fn.max(seen.lastAt)),
        };
      })
      .groupBy(seen.agentName)
      .orderBy("spanCount", "DESC")
      .orderBy("agentName")
      .limit(limit)
      .build();
  }
}
