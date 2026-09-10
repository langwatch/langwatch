import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import type { UsageStatsCountInput } from "../../app/ops.app.ts";
import { UsageStatsClickHouseRepository } from "../observe/usage-stats.repository.ts";
import { z } from "zod";

const usageStatsCountRowsSchema = z.array(z.object({ Total: z.string() }));

/**
 * An organization's usage, counted over the process's one ClickHouse client.
 *
 * Each project is counted by name rather than the whole organization in one
 * `TenantId IN (...)` sweep: the client routes a statement by the tenant it
 * names, so a per-project statement reaches the server that project's rows are
 * actually on, and an organization split across a private route and the shared
 * one is counted correctly rather than reported as whatever one endpoint held.
 *
 * There is no branch here for "no client". A deployment that named no
 * ClickHouse refuses at boot naming this module and the member; a read that
 * cannot reach the store raises, because a usage report that answers zero
 * traces for a busy organization is indistinguishable from a quiet one.
 */
export class ClickHouseUsageStatsRepository extends UsageStatsClickHouseRepository {
  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  static create(clickhouse: ClickHouseQueryClient): ClickHouseUsageStatsRepository {
    return new ClickHouseUsageStatsRepository(clickhouse);
  }

  async findScenarioRunCount({ projectIds }: UsageStatsCountInput): Promise<number> {
    return this.sumOverProjects(projectIds, (projectId) =>
      this.count({
        projectId,
        table: "simulation_runs",
        sql: `
        SELECT toString(count()) AS Total
        FROM simulation_runs AS t
        WHERE t.TenantId = {projectId:String}
          AND t.ArchivedAt IS NULL
          AND (t.TenantId, t.ScenarioSetId, t.BatchRunId, t.ScenarioRunId, t.UpdatedAt) IN (
            SELECT TenantId, ScenarioSetId, BatchRunId, ScenarioRunId, max(UpdatedAt)
            FROM simulation_runs
            WHERE TenantId = {projectId:String}
            GROUP BY TenantId, ScenarioSetId, BatchRunId, ScenarioRunId
          )
      `,
      }),
    );
  }

  async findTraceCount({ projectIds }: UsageStatsCountInput): Promise<number> {
    return this.sumOverProjects(projectIds, (projectId) =>
      this.count({
        projectId,
        table: "trace_summaries",
        sql: `
        SELECT toString(count(DISTINCT TraceId)) AS Total
        FROM trace_summaries
        WHERE TenantId = {projectId:String}
      `,
      }),
    );
  }

  /** One project's count, named as its own tenant so the client routes it. */
  private async count(input: {
    projectId: string;
    table: string;
    sql: string;
  }): Promise<number> {
    const { rows } = await this.clickhouse.query<unknown>({
      tenantId: input.projectId,
      table: input.table,
      kind: "read",
      sql: input.sql,
      params: { projectId: input.projectId },
    });

    const parsed = usageStatsCountRowsSchema.parse(rows);
    return Number.parseInt(parsed[0]?.Total ?? "0", 10);
  }

  private async sumOverProjects(
    projectIds: readonly string[],
    count: (projectId: string) => Promise<number>,
  ): Promise<number> {
    const totals = await Promise.all([...new Set(projectIds)].map(count));
    return totals.reduce((sum, total) => sum + total, 0);
  }
}
