import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { TraceAgentSeen } from "@langwatch/trace-contract";
import { z } from "zod";

import { TraceAgentTrafficRepository } from "../trace-agent-traffic.repository.ts";

const agentSeenRowSchema = z.object({
  agentName: z.string(),
  agentId: z.string(),
  model: z.string(),
  spanCount: z.coerce.number(),
  firstSeenMs: z.coerce.number(),
  lastSeenMs: z.coerce.number(),
});
type AgentSeenRow = z.input<typeof agentSeenRowSchema>;

/**
 * Distinct `gen_ai.agent.name` over `stored_spans`, bounded by `StartTime` so only the window's
 * partitions are read. Id and model are the non-empty values on most spans, ties broken by value,
 * so an agent mixing models reads the same on every pass. Counts may include unmerged duplicates.
 */
export class TraceAgentTrafficClickHouseRepository extends TraceAgentTrafficRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): TraceAgentTrafficClickHouseRepository {
    return new TraceAgentTrafficClickHouseRepository(clickhouse);
  }

  async findAgentsSeen(input: {
    tenantId: string;
    sinceMs: number;
    limit: number;
  }): Promise<TraceAgentSeen[]> {
    const result = await this.#clickhouse.query<AgentSeenRow>({
      tenantId: input.tenantId,
      table: "stored_spans",
      sql: `
        SELECT
          agentName,
          sumMapIf([seenId], [spans], seenId != '') AS ids,
          sumMapIf([seenModel], [spans], seenModel != '') AS models,
          arrayReverseSort((key, count) -> (count, key), ids.1, ids.2)[1] AS agentId,
          arrayReverseSort((key, count) -> (count, key), models.1, models.2)[1] AS model,
          sum(spans) AS spanCount,
          toUnixTimestamp64Milli(min(firstAt)) AS firstSeenMs,
          toUnixTimestamp64Milli(max(lastAt)) AS lastSeenMs
        FROM (
          SELECT
            SpanAttributes['gen_ai.agent.name'] AS agentName,
            SpanAttributes['gen_ai.agent.id'] AS seenId,
            SpanAttributes['gen_ai.request.model'] AS seenModel,
            count() AS spans,
            min(StartTime) AS firstAt,
            max(StartTime) AS lastAt
          FROM stored_spans
          WHERE TenantId = {tenantId:String}
            AND StartTime >= fromUnixTimestamp64Milli({since:Int64})
            AND SpanAttributes['gen_ai.agent.name'] != ''
          GROUP BY agentName, seenId, seenModel
        )
        GROUP BY agentName
        ORDER BY spanCount DESC, agentName
        LIMIT {limit:UInt32}
      `,
      params: { tenantId: input.tenantId, since: input.sinceMs, limit: input.limit },
    });
    return result.rows.map((raw) => {
      const row = agentSeenRowSchema.parse(raw);
      return {
        ...row,
        agentId: row.agentId === "" ? null : row.agentId,
        model: row.model === "" ? null : row.model,
      };
    });
  }
}
