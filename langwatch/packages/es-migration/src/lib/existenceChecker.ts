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
   * Chunks large ID lists to avoid exceeding ClickHouse's HTTP field size limit.
   */
  async findExisting(
    tenantAggregates: Map<string, Set<string>>,
  ): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    const CHUNK_SIZE = 500;

    const findForTenant = async (tenantId: string, aggregateIds: Set<string>): Promise<void> => {
      if (aggregateIds.size === 0) return;

      const allIds = [...aggregateIds];
      const existing = new Set<string>();

      // Chunks within a tenant stay sequential to avoid overwhelming CH
      for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
        const chunk = allIds.slice(i, i + CHUNK_SIZE);

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
            ids: chunk,
          },
          format: "JSONEachRow",
        });

        const rows = await queryResult.json<{ AggregateId: string }>();
        for (const row of rows) {
          existing.add(row.AggregateId);
        }
      }

      if (existing.size > 0) {
        result.set(tenantId, existing);
      }
    };

    // Parallelize across tenants
    await Promise.all(
      [...tenantAggregates.entries()].map(([tenantId, aggregateIds]) =>
        findForTenant(tenantId, aggregateIds),
      ),
    );

    return result;
  }
}
