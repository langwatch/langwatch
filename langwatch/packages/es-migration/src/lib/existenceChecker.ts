import type { ClickHouseClient } from "@clickhouse/client";

export class ExistenceChecker {
  constructor(
    private readonly clickhouse: ClickHouseClient,
    private readonly aggregateType: string,
  ) {}

  /**
   * Load ALL existing (TenantId, AggregateId) pairs for this aggregate type.
   * Returns a Set of "tenantId:aggregateId" composite keys.
   * Used at startup to seed the in-memory done set for discovery mode.
   */
  async loadAllExisting(): Promise<Set<string>> {
    const keys = new Set<string>();
    let offset = 0;
    const pageSize = 10000;

    while (true) {
      const result = await this.clickhouse.query({
        query: `
          SELECT DISTINCT TenantId, AggregateId
          FROM event_log
          WHERE AggregateType = {aggregateType:String}
          ORDER BY TenantId, AggregateId
          LIMIT {limit:UInt64} OFFSET {offset:UInt64}
        `,
        query_params: {
          aggregateType: this.aggregateType,
          limit: pageSize,
          offset,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<{ TenantId: string; AggregateId: string }>();
      if (rows.length === 0) break;

      for (const row of rows) {
        keys.add(ExistenceChecker.compositeKey(row.TenantId, row.AggregateId));
      }

      if (rows.length < pageSize) break;
      offset += pageSize;
    }

    return keys;
  }

  /** Create a composite key for the done set. */
  static compositeKey(tenantId: string, aggregateId: string): string {
    return `${tenantId}:${aggregateId}`;
  }

  /**
   * Find which aggregates already exist in event_log, scoped per tenant.
   * Returns tenant → set of existing aggregate IDs.
   */
  async findExisting(
    tenantAggregates: Map<string, Set<string>>,
  ): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();

    for (const [tenantId, aggregateIds] of tenantAggregates) {
      if (aggregateIds.size === 0) continue;

      const queryResult = await this.clickhouse.query({
        query: `
          SELECT DISTINCT AggregateId
          FROM event_log
          WHERE AggregateType = {aggregateType:String}
            AND TenantId = {tenantId:String}
            AND AggregateId IN ({ids:Array(String)})
        `,
        query_params: {
          aggregateType: this.aggregateType,
          tenantId,
          ids: [...aggregateIds],
        },
        format: "JSONEachRow",
      });

      const rows = await queryResult.json<{ AggregateId: string }>();
      if (rows.length > 0) {
        result.set(tenantId, new Set(rows.map((r) => r.AggregateId)));
      }
    }

    return result;
  }
}
