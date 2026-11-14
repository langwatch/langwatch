import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  type SystemReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";

import {
  type StalledHistoricalRun,
  type StalledSimulationRunRepository,
} from "../stalled-simulation-run.repository.ts";
import { simulationRuns } from "./clickhouse.simulation-runs.table.ts";

/**
 * Sanity cap: the target population is at most thousands of rows. A result
 * larger than this means the query (or the deploy ordering) is wrong, and
 * mass-erroring live runs is the one outcome the backfill must never produce.
 */
const MAX_ROWS = 100_000;

/** Statuses a run can be left in when no terminal event was ever written. */
const NON_TERMINAL_STATUSES = ["QUEUED", "PENDING", "IN_PROGRESS"] as const;

/**
 * Finds the latest version of every non-terminal run whose last activity is
 * older than `now - thresholdMs`, across all tenants on the given client.
 * Cross-tenant sweep BY DESIGN — a backfill has no single tenant to scope to.
 */
type StalledSimulationRunClickHouseClient = Pick<ClickHouseQueryClient, "read">;

export class ClickHouseStalledSimulationRunRepository implements StalledSimulationRunRepository {
  static create(
    client: StalledSimulationRunClickHouseClient,
  ): ClickHouseStalledSimulationRunRepository {
    return new ClickHouseStalledSimulationRunRepository(client);
  }

  constructor(private readonly client: StalledSimulationRunClickHouseClient) {}

  /**
   * Every tenant's latest version of each non-terminal run idle since `staleBeforeMs`. A run
   * started in any week can still be stalled, so the sweep has no lower StartedAt bound.
   */
  static stalledRunsRead({
    staleBeforeMs,
  }: {
    staleBeforeMs: number;
  }): SystemReadStatement<StalledHistoricalRun> {
    return clickhouseRead({
      // Install-wide backfill: each terminal write it triggers is scoped to that run's tenant.
      scope: tenantScope.allTenants({ reason: "stalled simulation run sweep, every tenant" }),
    })
      .from(simulationRuns)
      .select({
        tenantId: simulationRuns.TenantId,
        scenarioRunId: simulationRuns.ScenarioRunId,
        scenarioId: simulationRuns.ScenarioId,
        batchRunId: simulationRuns.BatchRunId,
        scenarioSetId: simulationRuns.ScenarioSetId,
        status: simulationRuns.Status,
      })
      .latestVersion()
      .where(({ and, lt, isNull, oneOf }) =>
        and(
          lt(simulationRuns.UpdatedAt, staleBeforeMs),
          isNull(simulationRuns.FinishedAt),
          isNull(simulationRuns.ArchivedAt),
          oneOf(simulationRuns.Status, [...NON_TERMINAL_STATUSES]),
        ),
      )
      .orderBy(simulationRuns.UpdatedAt, "ASC")
      .limit(MAX_ROWS)
      .build();
  }

  async findStalledRuns({
    now,
    thresholdMs,
  }: {
    now: number;
    thresholdMs: number;
  }): Promise<StalledHistoricalRun[]> {
    const staleBeforeMs = now - thresholdMs;

    const { rows } = await this.client.read({
      statement: ClickHouseStalledSimulationRunRepository.stalledRunsRead({ staleBeforeMs }),
      table: simulationRuns.$table.name,
    });

    if (rows.length >= MAX_ROWS) {
      throw new Error(
        `Stalled-run sweep hit the ${MAX_ROWS}-row sanity cap; refusing to mass-error what is probably a live population. Check the query and deploy ordering before re-running.`,
      );
    }
    return rows;
  }
}
