/** A full day avoids treating a queued deployment backlog as abandoned work. */
export const BACKFILL_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export interface StalledHistoricalRun {
  tenantId: string;
  scenarioRunId: string;
  scenarioId: string;
  batchRunId: string;
  scenarioSetId: string;
  status: string;
}

export abstract class StalledSimulationRunRepository {
  abstract findStalledRuns(params: {
    now: number;
    thresholdMs: number;
  }): Promise<StalledHistoricalRun[]>;
}

export type StalledRunFinder = StalledSimulationRunRepository;
