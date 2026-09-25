import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { TraceModelSpend, TraceModelSpendWindow } from "@langwatch/trace-contract";

import { TraceModelSpendRepository } from "../trace-model-spend.repository.ts";

type ModelSpendRow = {
  Model: string;
  SpentUsd: number | string;
  BilledUsd: number | string;
  Requests: number | string;
};

/**
 * Main's `PersonalUsageClickHouseRepository.findModelBreakdown`, deduped by
 * `argMax(..., UpdatedAt)`.
 */
export class ClickHouseTraceModelSpendRepository extends TraceModelSpendRepository {
  readonly #clickhouse: ClickHouseQueryClient;

  private constructor(clickhouse: ClickHouseQueryClient) {
    super();
    this.#clickhouse = clickhouse;
  }

  static create(clickhouse: ClickHouseQueryClient): ClickHouseTraceModelSpendRepository {
    return new ClickHouseTraceModelSpendRepository(clickhouse);
  }

  async findModelSpend(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
    limit: number;
  }): Promise<TraceModelSpend[]> {
    const result = await this.#clickhouse.query<ModelSpendRow>({
      tenantId: input.tenantId,
      table: "trace_summaries",
      sql: `
        SELECT
          Model,
          sum(TraceSpentUsd) AS SpentUsd,
          sum(coalesce(TraceSpentUsd, 0) - NonBilledUsd) AS BilledUsd,
          count() AS Requests
        FROM (
          SELECT
            TraceId,
            arrayJoin(argMax(Models, UpdatedAt)) AS Model,
            argMax(TotalCost, UpdatedAt) AS TraceSpentUsd,
            argMax(coalesce(NonBilledCost, if(Attributes['langwatch.cost.non_billable'] = 'true', TotalCost, 0), 0), UpdatedAt) AS NonBilledUsd
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
            AND OccurredAt <  fromUnixTimestamp64Milli({toMs:Int64})
            AND notEmpty(Models)
          GROUP BY TraceId
        )
        GROUP BY Model
        ORDER BY SpentUsd DESC
        LIMIT {lim:UInt32}
      `,
      params: {
        tenantId: input.tenantId,
        fromMs: input.window.startMs,
        toMs: input.window.endMs,
        lim: input.limit,
      },
      settings: { max_bytes_before_external_group_by: 500_000_000 },
    });

    return result.rows.map((row) => ({
      label: row.Model,
      spentUsd: Number(row.SpentUsd) || 0,
      billedUsd: Number(row.BilledUsd) || 0,
      requests: Number(row.Requests) || 0,
    }));
  }
}
