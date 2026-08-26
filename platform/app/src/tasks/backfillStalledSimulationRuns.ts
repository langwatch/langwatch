import { createLogger } from "@langwatch/observability";
import type { ScenarioExecutionService } from "@langwatch/scenario-contract";
import { getApp } from "~/server/app-layer/app";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import type { StalledRunFinder } from "~/server/event-sourcing/pipelines/simulation-processing/repositories/stalledSimulationRuns.clickhouse.repository";
import {
  BACKFILL_STALE_THRESHOLD_MS,
  getStalledRunFindersByInstance,
} from "~/server/event-sourcing/pipelines/simulation-processing/repositories/stalledSimulationRuns.clickhouse.repository";

const logger = createLogger("langwatch:tasks:backfillStalledSimulationRuns");

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
 * Closes every stalled run the finder surfaces. Each run is handled
 * independently — one failing emit does not abort the rest. With `dryRun`
 * the population is only counted and sampled, nothing is written; that mode
 * doubles as the measurement answering "how many rows are actually at risk".
 */
export async function backfillStalledRuns({
  finder,
  execution,
  dryRun,
  now = Date.now(),
  thresholdMs = BACKFILL_STALE_THRESHOLD_MS,
}: {
  finder: StalledRunFinder;
  execution: ScenarioExecutionService;
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
      await execution.finishUnsuccessfulRun({
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

export default async function execute(...args: string[]) {
  initializeDefaultApp();
  // Composition side effect: the App builds the event-sourcing pipelines the
  // failure handler dispatches through.
  const app = getApp();

  const dryRun = args.includes("--dry-run");
  const finders = await getStalledRunFindersByInstance();

  if (finders.length === 0) {
    logger.info("No ClickHouse instance configured; nothing to backfill");
    return;
  }

  const totals = { found: 0, closed: 0, failed: 0 };
  for (const { target, finder } of finders) {
    const outcome = await backfillStalledRuns({
      finder,
      execution: app.scenarioExecution,
      dryRun,
    });
    logger.info({ target, dryRun, ...outcome }, "Swept ClickHouse instance");
    totals.found += outcome.found;
    totals.closed += outcome.closed;
    totals.failed += outcome.failed;
  }

  logger.info(
    { dryRun, instances: finders.length, ...totals },
    "Finished stalled-simulation-run backfill",
  );
}
