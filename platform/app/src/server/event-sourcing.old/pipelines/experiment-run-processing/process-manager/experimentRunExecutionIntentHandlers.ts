import { createLogger } from "@langwatch/observability";

import type { IntentExecutor } from "~/server/event-sourcing.old/pipeline/processManagerDefinition";

import type { ExperimentRunExecutionFailRunIntent } from "./experimentRunExecutionProcess.types";

const logger = createLogger(
  "langwatch:experiment-run-processing:experiment-run-execution-process",
);

/** What the terminal write needs from the experiment-run domain. */
export interface ExperimentRunExecutionDispatchDeps {
  /**
   * Records the run's terminal event. Idempotent — `completeExperimentRun`
   * carries a fixed `${tenantId}:${runId}:complete` idempotency key, so a
   * repeat, or a race with the run's own completion, collapses to one folded
   * event — which is what makes retrying this intent safe.
   */
  completeRun: (params: {
    tenantId: string;
    runId: string;
    experimentId: string;
    finishedAt: number | null;
    stoppedAt: number | null;
    occurredAt: number;
  }) => Promise<void>;
  /**
   * Raises the run's abort flag. If the deadline was wrong and something is in
   * fact still executing this run, this is what makes the terminal state we
   * just wrote true rather than merely recorded — and stops it spending the
   * customer's money against a run the platform has already ended.
   */
  signalStop: (params: { runId: string }) => Promise<void>;
  /**
   * Marks the cached run-state record failed, with the failure code. This is the
   * only surface that models a *failed* run at all — the stored terminal state
   * has room for "finished" and "stopped" and nothing else — so it is where
   * the polling API learns the run stalled rather than was stopped.
   *
   * Best-effort by construction: the record lives in Redis on a 24-hour TTL
   * and the interactive path never creates one, so it is routinely absent.
   */
  markRunFailed: (params: { runId: string; code: string }) => Promise<void>;
}

/**
 * Executes the `failRun` intent: records that a run nobody is executing any
 * more has ended.
 *
 * Ordering is deliberate. The abort flag is raised first, because it is the
 * one step that changes what a still-live generator does; the durable write
 * follows and is the only step allowed to fail the intent; the cached record
 * is updated last and never blocks either.
 *
 * Throwing is the right response to an infrastructure fault on the durable
 * write — the outbox retries, and the alternative is a run that stays
 * non-terminal forever, which is the failure this process exists to remove.
 */
export function createExperimentRunExecutionFailRunHandler(
  deps: ExperimentRunExecutionDispatchDeps,
): IntentExecutor<ExperimentRunExecutionFailRunIntent> {
  return async (payload) => {
    logger.info(
      {
        projectId: payload.projectId,
        runId: payload.runId,
        experimentId: payload.experimentId,
      },
      "Deadline fired for an experiment run with no live process — writing terminal state",
    );

    await deps.signalStop({ runId: payload.runId }).catch((err: unknown) => {
      logger.warn(
        { err, runId: payload.runId },
        "Could not raise the abort flag for a stalled experiment run",
      );
    });

    // `stoppedAt` rather than `finishedAt`: a run the platform ended is not a
    // run that finished, and claiming otherwise would show a partial result
    // set as a complete one. The stored terminal state has no third option —
    // see ADR-103, which documents this as known debt rather than fixing it.
    await deps.completeRun({
      tenantId: payload.projectId,
      runId: payload.runId,
      experimentId: payload.experimentId,
      finishedAt: null,
      stoppedAt: payload.stalledAt,
      occurredAt: payload.stalledAt,
    });

    // Deliberately after the durable write, and deliberately swallowed: the
    // guarantee is the event, not the cache. A run whose cached record expired
    // hours ago still reaches a terminal state.
    await deps
      .markRunFailed({ runId: payload.runId, code: payload.code })
      .catch((err: unknown) => {
        logger.warn(
          { err, runId: payload.runId },
          "Could not mark the cached run-state record failed for a stalled experiment run",
        );
      });
  };
}
