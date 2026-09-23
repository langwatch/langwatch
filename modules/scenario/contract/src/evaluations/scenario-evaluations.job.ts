/** Queued job grading scenario runs; retries on TraceDataPendingError with
 * exponential backoff until the attempt cap is reached.
 */

import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import { backoffDelayMs, SCENARIO_EVALUATIONS_JOB } from "./constants.ts";
import { TraceDataPendingError } from "./run-scenario-evaluations.ts";
import type { ScenarioEvaluationsJobPayload } from "./types.ts";

const logger = createLogger("langwatch:scenarios:evaluations:job");

export interface ScenarioEvaluationsJobDeps {
  /** Grades the run; throws `TraceDataPendingError` to ask for a retry. */
  run(params: {
    payload: ScenarioEvaluationsJobPayload;
    isFinalAttempt: boolean;
  }): Promise<unknown>;
  /** Queues the payload again after the delay. */
  reschedule(params: { payload: ScenarioEvaluationsJobPayload; delayMs: number }): Promise<void>;
}

/** Whether the attempt is the last one the job makes. */
export function isFinalAttempt(attempt: number): boolean {
  return attempt >= SCENARIO_EVALUATIONS_JOB.MAX_ATTEMPTS;
}

/** The job identity one attempt deduplicates on. */
export function scenarioEvaluationsJobId(
  payload: Pick<ScenarioEvaluationsJobPayload, "tenantId" | "scenarioRunId" | "attempt">,
): string {
  return `${payload.tenantId}:${payload.scenarioRunId}:scenario-evaluations:${payload.attempt}`;
}

export function createScenarioEvaluationsJobHandler(
  deps: ScenarioEvaluationsJobDeps,
): (payload: ScenarioEvaluationsJobPayload) => Promise<void> {
  return async (payload) => {
    const isFinal = isFinalAttempt(payload.attempt);
    try {
      await deps.run({ payload, isFinalAttempt: isFinal });
    } catch (error) {
      if (!(error instanceof TraceDataPendingError) || isFinal) {
        throw error;
      }
      const delayMs = backoffDelayMs(payload.attempt);
      logger.info(
        {
          tenantId: payload.tenantId,
          scenarioRunId: payload.scenarioRunId,
          attempt: payload.attempt,
          delayMs,
          details: error.message,
        },
        "Trace data not there yet, scenario evaluations queued again",
      );
      await deps.reschedule({
        payload: {
          ...payload,
          attempt: payload.attempt + 1,
          occurredAt: nowInstant().epochMilliseconds,
        },
        delayMs,
      });
    }
  };
}
