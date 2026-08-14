import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import { getApp } from "~/server/app-layer/app";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import { getAllClickHouseInstances } from "~/server/clickhouse/clickhouseClient";
import { ScenarioFailureHandler } from "~/server/scenarios/scenario-failure-handler";

const logger = createLogger("langwatch:tasks:backfillStalledSimulationRuns");

const TABLE_NAME = "simulation_runs" as const;

/**
 * One-shot backfill closing historical simulation runs that never received a
 * terminal event.
 *
 * The simulation_run_execution process manager's stall watchdog (ADR-094)
 * covers every run queued after it shipped, but runs abandoned before it —
 * including runs that fell outside the deleted boot sweeps' lookback windows
 * (30 days for IN_PROGRESS in #3195, 7 days for QUEUED in #3365) — have no
 * process instance, so nothing can ever finish them. With read-time stall
 * derivation deleted, those rows would render as in-progress forever. This
 * task finishes each one with a real terminal ERROR ("stalled") through the
 * same idempotent path in-process failures use, so the truth is recorded
 * rather than repainted.
 *
 * Run it once per environment after the process-manager deploy:
 *
 *   pnpm task backfillStalledSimulationRuns -- --dry-run   # count + sample only
 *   pnpm task backfillStalledSimulationRuns                # close the runs
 *
 * Idempotent: finishRun dedups on the run id, and closed runs leave the
 * population, so re-running converges to zero.
 */

/**
 * Only runs at least this quiet are closed. The watchdog's own threshold
 * (STALL_THRESHOLD_MS, 2x the child hard cap) already proves no live worker
 * holds a run, but this task also closes QUEUED/PENDING rows, where queue
 * wait is unbounded and staleness alone is weaker evidence. A full day of
 * silence removes any conceivable overlap with an in-flight deploy backlog
 * while losing none of the target population, which is weeks to years old.
 */
export const BACKFILL_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Sanity cap: the target population is at most thousands of rows. A result
 * larger than this means the query (or the deploy ordering) is wrong, and
 * mass-erroring live runs is the one outcome this task must never produce.
 */
const MAX_ROWS = 100_000;

/** Statuses a run can be left in when no terminal event was ever written. */
const NON_TERMINAL_STATUSES = ["QUEUED", "PENDING", "IN_PROGRESS"] as const;

/**
 * Minimal shape of a stalled historical run — only the ids needed to emit
 * its terminal failure event. Carries tenantId because the sweep is
 * cross-tenant; each terminal write is then scoped to its own run's tenant.
 */
export interface StalledHistoricalRun {
  tenantId: string;
  scenarioRunId: string;
  scenarioId: string;
  batchRunId: string;
  scenarioSetId: string;
  status: string;
}

/** Surfaces non-terminal runs whose last activity is older than the threshold. */
export interface StalledRunFinder {
  findStalledRuns(params: {
    now: number;
    thresholdMs: number;
  }): Promise<StalledHistoricalRun[]>;
}

/**
 * Emits the terminal failure event for a stalled run. Structurally satisfied
 * by ScenarioFailureHandler — the backfill reuses the exact path in-process
 * child failures use, so each run becomes a real finished(ERROR) event and
 * the downstream projections run.
 */
export interface StalledRunFailureEmitter {
  ensureFailureEventsEmitted(params: {
    projectId: string;
    scenarioId: string;
    setId: string;
    batchRunId: string;
    scenarioRunId: string;
    error: string;
  }): Promise<void>;
}

/**
 * Closes every stalled run the finder surfaces. Each run is handled
 * independently — one failing emit does not abort the rest. With `dryRun`
 * the population is only counted and sampled, nothing is written; that mode
 * doubles as the measurement answering "how many rows are actually at risk".
 */
export async function backfillStalledRuns({
  finder,
  emitter,
  dryRun,
  now = Date.now(),
  thresholdMs = BACKFILL_STALE_THRESHOLD_MS,
}: {
  finder: StalledRunFinder;
  emitter: StalledRunFailureEmitter;
  dryRun: boolean;
  now?: number;
  thresholdMs?: number;
}): Promise<{ found: number; closed: number; failed: number }> {
  const runs = await finder.findStalledRuns({ now, thresholdMs });

  if (runs.length === 0) {
    return { found: 0, closed: 0, failed: 0 };
  }

  if (dryRun) {
    logger.info(
      { found: runs.length, sample: runs.slice(0, 10) },
      "Dry run: stalled historical runs that would be closed",
    );
    return { found: runs.length, closed: 0, failed: 0 };
  }

  let closed = 0;
  let failed = 0;
  for (const run of runs) {
    try {
      await emitter.ensureFailureEventsEmitted({
        projectId: run.tenantId,
        scenarioId: run.scenarioId,
        setId: run.scenarioSetId,
        batchRunId: run.batchRunId,
        scenarioRunId: run.scenarioRunId,
        error: "stalled",
      });
      closed += 1;
    } catch (error) {
      failed += 1;
      logger.error(
        { error, scenarioRunId: run.scenarioRunId, tenantId: run.tenantId },
        "Failed to close stalled historical run",
      );
    }
  }

  return { found: runs.length, closed, failed };
}

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
export class ClickHouseStalledRunFinder implements StalledRunFinder {
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

export default async function execute(...args: string[]) {
  initializeDefaultApp();
  // Composition side effect: the App builds the event-sourcing pipelines the
  // failure handler dispatches through.
  getApp();

  const dryRun = args.includes("--dry-run");
  const emitter = ScenarioFailureHandler.create();
  const instances = await getAllClickHouseInstances();

  if (instances.length === 0) {
    logger.info("No ClickHouse instance configured; nothing to backfill");
    return;
  }

  const totals = { found: 0, closed: 0, failed: 0 };
  for (const { target, client } of instances) {
    const finder = new ClickHouseStalledRunFinder(client);
    const outcome = await backfillStalledRuns({ finder, emitter, dryRun });
    logger.info({ target, dryRun, ...outcome }, "Swept ClickHouse instance");
    totals.found += outcome.found;
    totals.closed += outcome.closed;
    totals.failed += outcome.failed;
  }

  logger.info(
    { dryRun, instances: instances.length, ...totals },
    "Finished stalled-simulation-run backfill",
  );
}
