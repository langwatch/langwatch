/**
 * Org-wide counts for the self-hosted daily usage telemetry sender
 * (`usageStatsWorker.ts` → `collectUsageStats.ts`). Both reads span every
 * project the reporting organization owns — the "tenant" for this report is
 * the organization, not a single project — so the first predicate is
 * `TenantId IN (...)` over that organization's project ids, not a single
 * `TenantId = {tenantId:String}`. Moved here unchanged from
 * `collectUsageStats.ts` so the CH client is reached through a repository
 * instead of resolved inline.
 */

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { getClickHouseClientForOrganization } from "~/server/clickhouse/clickhouseClient";

export interface InstanceUsageCountsInput {
  organizationId: string;
  projectIds: string[];
}

export interface InstanceUsageStatsRepository {
  findTraceCount(input: InstanceUsageCountsInput): Promise<number>;
  findScenarioRunCount(input: InstanceUsageCountsInput): Promise<number>;
}

export class InstanceUsageStatsClickHouseRepository
  implements InstanceUsageStatsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async findScenarioRunCount({
    organizationId,
    projectIds,
  }: InstanceUsageCountsInput): Promise<number> {
    if (projectIds.length === 0) return 0;

    const client = await this.resolveClient(organizationId);
    if (!client) return 0;

    const result = await client.query({
      query: `
        SELECT toString(count()) AS Total
        FROM simulation_runs AS t
        WHERE t.TenantId IN ({projectIds:Array(String)})
          AND t.ArchivedAt IS NULL
          AND (t.TenantId, t.ScenarioSetId, t.BatchRunId, t.ScenarioRunId, t.UpdatedAt) IN (
            SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
            FROM simulation_runs
            WHERE TenantId IN ({projectIds:Array(String)})
            GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
          )
      `,
      query_params: { projectIds },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{ Total: string }>;
    return parseInt(rows[0]?.Total ?? "0", 10);
  }

  async findTraceCount({
    organizationId,
    projectIds,
  }: InstanceUsageCountsInput): Promise<number> {
    if (projectIds.length === 0) return 0;

    const client = await this.resolveClient(organizationId);
    if (!client) return 0;

    const result = await client.query({
      query: `
        SELECT toString(count(DISTINCT TraceId)) AS Total
        FROM trace_summaries
        WHERE TenantId IN ({projectIds:Array(String)})
      `,
      query_params: { projectIds },
      format: "JSONEachRow",
    });

    const rows = (await result.json()) as Array<{ Total: string }>;
    return parseInt(rows[0]?.Total ?? "0", 10);
  }
}

/**
 * Production default: resolves the organization's shared/private ClickHouse
 * client the same way `collectUsageStats.ts` always has.
 */
export function createDefaultInstanceUsageStatsRepository(): InstanceUsageStatsClickHouseRepository {
  return new InstanceUsageStatsClickHouseRepository(
    getClickHouseClientForOrganization,
  );
}
