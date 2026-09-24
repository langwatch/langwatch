import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import { TraceUsageCountRepository } from "../trace-usage-count.repository.ts";

type TotalRow = { total: string | number };

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
}
