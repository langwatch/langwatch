import type { ClickHouseClient } from "@clickhouse/client";
import { createSemaphore } from "~/server/evaluations-v3/execution/semaphore.js";

const FIND_EXISTING_TENANT_CONCURRENCY = 8;

export class ExistenceChecker {
  constructor(
    private readonly clickhouse: ClickHouseClient,
    private readonly aggregateType: string,
  ) {}

  /**
   * Load ALL existing (TenantId, AggregateId) pairs for this aggregate type.
   * Returns a Set of "tenantId:aggregateId" composite keys.
   * Used at startup to seed the in-memory done set for discovery mode.
   *
   * NOTE: this is a cross-tenant seed scan — it intentionally does not start
   * with a single `TenantId = {x}` predicate, because its purpose is to load
   * state for all tenants. It uses keyset pagination over the composite
   * (TenantId, AggregateId) sort key, which is stable under concurrent writes
   * and avoids the slow-OFFSET / shifted-page problems of LIMIT/OFFSET.
   */
  async loadAllExisting(): Promise<Set<string>> {
    const keys = new Set<string>();
    const pageSize = 10000;
    let lastTenantId = "";
    let lastAggregateId = "";

    while (true) {
      const result = await this.clickhouse.query({
        query: `
          SELECT DISTINCT TenantId, AggregateId
          FROM event_log
          WHERE AggregateType = {aggregateType:String}
            AND (TenantId, AggregateId) > ({lastTenantId:String}, {lastAggregateId:String})
          ORDER BY TenantId, AggregateId
          LIMIT {limit:UInt64}
        `,
        query_params: {
          aggregateType: this.aggregateType,
          lastTenantId,
          lastAggregateId,
          limit: pageSize,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<{ TenantId: string; AggregateId: string }>();
      if (rows.length === 0) break;

      for (const row of rows) {
        keys.add(ExistenceChecker.compositeKey(row.TenantId, row.AggregateId));
      }

      const last = rows[rows.length - 1]!;
      lastTenantId = last.TenantId;
      lastAggregateId = last.AggregateId;

      if (rows.length < pageSize) break;
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
            WHERE TenantId = {tenantId:String}
              AND AggregateType = {aggregateType:String}
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

    // Parallelize across tenants with a bounded concurrency limit so a batch
    // with many tenants doesn't spike ClickHouse load.
    const semaphore = createSemaphore(FIND_EXISTING_TENANT_CONCURRENCY);
    await Promise.all(
      [...tenantAggregates.entries()].map(async ([tenantId, aggregateIds]) => {
        await semaphore.acquire();
        try {
          await findForTenant(tenantId, aggregateIds);
        } finally {
          semaphore.release();
        }
      }),
    );

    return result;
  }
}
