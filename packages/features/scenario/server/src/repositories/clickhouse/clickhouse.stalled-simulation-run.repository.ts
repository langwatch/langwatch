import type { ClickHouseClient } from "@clickhouse/client";
import {
  type StalledHistoricalRun,
  type StalledSimulationRunRepository,
} from "../stalled-simulation-run.repository";

const TABLE_NAME = "simulation_runs" as const;

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
 *
 * - Dedups the ReplacingMergeTree(UpdatedAt) to the latest version per run via
 *   the IN-tuple pattern (light key columns only, so the scan is
 *   memory-bounded).
 * - Deliberately has NO lookback lower bound: reaching rows older than the
 *   deleted sweeps' windows is the entire point, and as a one-shot manual
 *   task the single cold-partition scan is an accepted cost (the boot sweeps
 *   this replaces bounded their scan because they ran on every boot).
 *
 * Cross-tenant sweep BY DESIGN: a backfill has no single tenant to scope to,
 * so this intentionally omits the per-tenant `WHERE TenantId =` filter
 * clickhouse-queries.md mandates for tenant-scoped reads. TenantId is
 * SELECTed (not filtered), and each terminal write downstream is scoped to
 * its own run's tenant — the same "system sweeps" carve-out the deleted boot
 * reconciler documented.
 */
export class ClickHouseStalledSimulationRunRepository implements StalledSimulationRunRepository {
  static create(client: ClickHouseClient): ClickHouseStalledSimulationRunRepository {
    return new ClickHouseStalledSimulationRunRepository(client);
  }

  constructor(private readonly client: ClickHouseClient) {}

  async findStalledRuns({
    now,
    thresholdMs,
  }: {
    now: number;
    thresholdMs: number;
  }): Promise<StalledHistoricalRun[]> {
    const staleBeforeMs = now - thresholdMs;

    const result = await this.client.query({
      query: `
        SELECT
          TenantId AS tenantId,
          ScenarioRunId AS scenarioRunId,
          ScenarioId AS scenarioId,
          BatchRunId AS batchRunId,
          ScenarioSetId AS scenarioSetId,
          Status AS status
        FROM ${TABLE_NAME}
        -- The table's full dedup key is (TenantId, ScenarioSetId, BatchRunId,
        -- ScenarioRunId), but ScenarioRunId is a globally-unique KSUID, so
        -- grouping by (TenantId, ScenarioRunId) still collapses every version
        -- of a run. Same shortcut the deleted boot sweeps took.
        WHERE (TenantId, ScenarioRunId, UpdatedAt) IN (
            SELECT TenantId, ScenarioRunId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            GROUP BY TenantId, ScenarioRunId
          )
          AND UpdatedAt < fromUnixTimestamp64Milli({staleBeforeMs:Int64})
          AND FinishedAt IS NULL
          AND ArchivedAt IS NULL
          AND Status IN {nonTerminalStatuses:Array(String)}
        ORDER BY UpdatedAt ASC
        LIMIT {maxRows:UInt32}
      `,
      query_params: {
        staleBeforeMs,
        nonTerminalStatuses: [...NON_TERMINAL_STATUSES],
        maxRows: MAX_ROWS,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json<StalledHistoricalRun>();
    if (rows.length >= MAX_ROWS) {
      throw new Error(
        `Stalled-run sweep hit the ${MAX_ROWS}-row sanity cap; refusing to mass-error what is probably a live population. Check the query and deploy ordering before re-running.`,
      );
    }
    return rows;
  }
}

export { ClickHouseStalledSimulationRunRepository as ClickHouseStalledRunFinder };
