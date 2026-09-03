import { createLogger } from "@langwatch/observability";
import type { ScenarioExecutionService } from "@langwatch/scenario-contract";
import { Task } from "@langwatch/task";
import {
  BACKFILL_STALE_THRESHOLD_MS,
  type SimulationStalledRun,
} from "#adapters/simulation-eventing.adapter";

export type StalledRunFinder = {
  findStalledRuns(input: { now: number; thresholdMs: number }): Promise<SimulationStalledRun[]>;
};

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
 * Idempotent: finishRun dedups on the run id, and closed runs leave the
 * population, so re-running converges to zero.
 *
 * It has no entrypoint in this process yet, and that is a composed-collaborator
 * gap rather than an oversight: the worker's `ScenarioExecutionService`
 * (`app/worker-scenario-processing.composition.ts`) rejects
 * `finishUnsuccessfulRun` by name — "Scenario failure handling is not composed
 * in this process" — so a runner wired here today would fail every row it
 * found. The sweep itself takes both collaborators as parameters, so the day
 * that call is composed the runner is a handful of lines over
 * `SimulationStalledRunAdapter.create(client)` and this function.
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

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * stalled-runs-backfill`. Not yet registered in `apps/tasks`' catalogue:
 * `execution` is the worker's `ScenarioExecutionService`
 * (`app/worker-scenario-processing.composition.ts`), and `apps/tasks` does
 * not compose scenario processing today — `finishUnsuccessfulRun` would
 * refuse by name for every row a runner found. `DRY_RUN` is read here, at
 * the process boundary; {@link backfillStalledRuns} above takes it as a
 * parsed value so it stays testable without an environment.
 */
export class StalledRunsBackfillTask extends Task {
  readonly name = "stalled-runs-backfill";
  readonly description = "Closes historical simulation runs that never received a terminal event.";

  private constructor(
    private readonly finder: StalledRunFinder,
    private readonly execution: ScenarioExecutionService,
  ) {
    super();
  }

  static create({
    finder,
    execution,
  }: {
    finder: StalledRunFinder;
    execution: ScenarioExecutionService;
  }): StalledRunsBackfillTask {
    return new StalledRunsBackfillTask(finder, execution);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const result = await backfillStalledRuns({
      finder: this.finder,
      execution: this.execution,
      dryRun: process.env.STALLED_RUNS_BACKFILL_DRY_RUN === "true",
    });
    logger.info(result, "stalled-runs-backfill finished");
  }
}
