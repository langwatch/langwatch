import {
  UsageStatsClickHouseRepository,
  type UsageStatsClickHouseClientResolver,
  type UsageStatsCountInput,
} from "../../ports/usage-stats-worker.ports";
import { z } from "zod";

const usageStatsCountRowsSchema = z.array(z.object({ Total: z.string() }));

export class ClickHouseUsageStatsRepository extends UsageStatsClickHouseRepository {
  private constructor(private readonly clients: UsageStatsClickHouseClientResolver) {
    super();
  }

  static create(
    clients: UsageStatsClickHouseClientResolver,
  ): ClickHouseUsageStatsRepository {
    return new ClickHouseUsageStatsRepository(clients);
  }

  async findScenarioRunCount({
    organizationId,
    projectIds,
  }: UsageStatsCountInput): Promise<number> {
    if (projectIds.length === 0) {
      return 0;
    }

    const client = await this.clients.tryResolve(organizationId);
    if (!client) {
      return 0;
    }

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

    const rows = usageStatsCountRowsSchema.parse(await result.json());
    return Number.parseInt(rows[0]?.Total ?? "0", 10);
  }

  async findTraceCount({
    organizationId,
    projectIds,
  }: UsageStatsCountInput): Promise<number> {
    if (projectIds.length === 0) {
      return 0;
    }

    const client = await this.clients.tryResolve(organizationId);
    if (!client) {
      return 0;
    }

    const result = await client.query({
      query: `
        SELECT toString(count(DISTINCT TraceId)) AS Total
        FROM trace_summaries
        WHERE TenantId IN ({projectIds:Array(String)})
      `,
      query_params: { projectIds },
      format: "JSONEachRow",
    });

    const rows = usageStatsCountRowsSchema.parse(await result.json());
    return Number.parseInt(rows[0]?.Total ?? "0", 10);
  }
}
