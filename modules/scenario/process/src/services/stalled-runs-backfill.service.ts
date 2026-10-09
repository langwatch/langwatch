import { createLogger } from "@langwatch/observability";
import type { ScenarioExecutionService } from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";

import {
  BACKFILL_STALE_THRESHOLD_MS,
  type SimulationStalledRun,
} from "#eventing/simulation-eventing.store";

/** The one write the backfill makes: closing a run that can no longer finish. */
type StalledRunCloser = Pick<ScenarioExecutionService, "finishUnsuccessfulRun">;

export type StalledRunFinder = {
  findStalledRuns(input: { now: number; thresholdMs: number }): Promise<SimulationStalledRun[]>;
};

const logger = createLogger("langwatch:scenario:closeStalledRuns");

/**
 * The `scenario:close-stalled-runs` step: closes historical runs that never received a terminal
 * event (newer runs are the ADR-094 watchdog's). One failing close does not stop the rest, but
 * any failure throws once all were tried, so the step retries. A dry run only counts.
 */
export class StalledRunsBackfillService {
  private constructor(
    private readonly collaborators: Readonly<{
      finder: StalledRunFinder;
      execution: StalledRunCloser;
    }>,
  ) {}

  static create({
    finder,
    execution,
  }: {
    finder: StalledRunFinder;
    execution: StalledRunCloser;
  }): StalledRunsBackfillService {
    return new StalledRunsBackfillService({ finder, execution });
  }

  backfill({
    dryRun,
    now = nowInstant().epochMilliseconds,
    thresholdMs = BACKFILL_STALE_THRESHOLD_MS,
  }: {
    dryRun: boolean;
    now?: number;
    thresholdMs?: number;
  }): Promise<{ found: number; closed: number; failed: number; dryRun: boolean }> {
    return closeStalledRuns({ ...this.collaborators, dryRun, now, thresholdMs });
  }
}

async function closeStalledRuns({
  finder,
  execution,
  dryRun,
  now,
  thresholdMs,
}: {
  finder: StalledRunFinder;
  execution: StalledRunCloser;
  dryRun: boolean;
  now: number;
  thresholdMs: number;
}): Promise<{ found: number; closed: number; failed: number; dryRun: boolean }> {
  const runs = await finder.findStalledRuns({ now, thresholdMs });

  if (dryRun || runs.length === 0) {
    if (dryRun) {
      logger.info(
        { found: runs.length, sample: runs.slice(0, 10) },
        "Dry run: stalled historical runs that would be closed",
      );
    }
    return { found: runs.length, closed: 0, failed: 0, dryRun };
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

  if (failed > 0) {
    throw new Error(`${failed} stalled runs failed to close (${closed} closed); the step retries`);
  }
  return { found: runs.length, closed, failed, dryRun };
}
