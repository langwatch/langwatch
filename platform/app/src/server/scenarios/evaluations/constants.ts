/**
 * The queued job that runs the evaluators attached to a scenario run.
 *
 * One job per run, registered on the simulation pipeline's global queue
 * (`registerJob`). While the trace the run produced is still arriving the
 * job queues itself again with a growing delay, up to the attempt cap; the
 * last attempt records what is missing as a failed result instead.
 *
 * @see specs/scenarios/scenario-evaluators.feature
 */
export const SCENARIO_EVALUATIONS_JOB = {
  /** Job name on the global queue; the group key carries the run id. */
  NAME: "scenarioEvaluations",
  /** How many times the job runs before it records missing trace data as failed. */
  MAX_ATTEMPTS: 6,
  /** Delay before the second attempt; each later attempt waits twice as long. */
  BACKOFF_DELAY_MS: 3_000,
  /** How long one queued attempt of a run deduplicates a repeat of itself. */
  DEDUP_TTL_MS: 5 * 60 * 1000,
} as const;

/** How many characters of one resolved input a result stores for the UI. */
export const MAX_STORED_INPUT_LENGTH = 2_000;

/** The delay before the attempt after the given one, doubling per attempt. */
export function backoffDelayMs(attempt: number): number {
  return (
    SCENARIO_EVALUATIONS_JOB.BACKOFF_DELAY_MS * 2 ** Math.max(attempt - 1, 0)
  );
}
