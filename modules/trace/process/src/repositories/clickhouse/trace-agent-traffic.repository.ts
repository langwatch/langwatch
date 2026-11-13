import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { TraceAgentSeen } from "@langwatch/trace-contract";

import { TraceAgentTrafficRepository } from "../trace-agent-traffic.repository.ts";

type AgentSeenRow = {
  agentName: string;
  agentId: string;
  model: string;
  spanCount: string | number;
  firstSeenMs: string | number;
  lastSeenMs: string | number;
};

/**
 * Distinct `gen_ai.agent.name` over `stored_spans`, bounded by `StartTime` so only the window's
 * partitions are read. Span counts may include not-yet-merged duplicates: an order, not a tally.
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
          SpanAttributes['gen_ai.agent.name'] AS agentName,
          anyIf(SpanAttributes['gen_ai.agent.id'], SpanAttributes['gen_ai.agent.id'] != '') AS agentId,
          anyIf(SpanAttributes['gen_ai.request.model'], SpanAttributes['gen_ai.request.model'] != '') AS model,
          count() AS spanCount,
          toUnixTimestamp64Milli(min(StartTime)) AS firstSeenMs,
          toUnixTimestamp64Milli(max(StartTime)) AS lastSeenMs
        FROM stored_spans
        WHERE TenantId = {tenantId:String}
          AND StartTime >= fromUnixTimestamp64Milli({since:Int64})
          AND SpanAttributes['gen_ai.agent.name'] != ''
        GROUP BY agentName
        ORDER BY spanCount DESC, agentName
        LIMIT {limit:UInt32}
      `,
      params: { tenantId: input.tenantId, since: input.sinceMs, limit: input.limit },
    });
    return result.rows.map((row) => ({
      agentName: row.agentName,
      agentId: row.agentId === "" ? null : row.agentId,
      model: row.model === "" ? null : row.model,
      spanCount: Number(row.spanCount),
      firstSeenMs: Number(row.firstSeenMs),
      lastSeenMs: Number(row.lastSeenMs),
    }));
  }
}
