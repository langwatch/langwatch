/**
 * The seam between the `scenarioExecution` process outbox and the worker that
 * actually spawns children.
 *
 * The pool is created during worker startup, after the pipeline registry has
 * been built, so something has to be late-bound. What changed in ADR-073 step 2
 * is what happens in the window before it is: the retired reactor logged
 * "Execution pool not yet wired, skipping" and dropped the job, orphaning the
 * run at QUEUED. This throws instead, which leaves the outbox row pending and
 * the dispatch retried a moment later once the pool exists.
 *
 * @see specs/scenarios/scenario-execution-process-manager.feature
 */

import { createLogger } from "@langwatch/observability";

import { ScenarioExecutorUnavailableError } from "~/server/event-sourcing/pipelines/simulation-processing/process-manager/scenarioExecutionIntentHandlers";

import type { ExecutionJobData, ScenarioExecutionPool } from "./execution-pool";

const logger = createLogger("langwatch:scenarios:execution-dispatcher");

/** What a worker binds its pool into, and what the outbox handler calls. */
export interface ScenarioExecutionDispatcherHandle {
  /** Wire the execution pool. Called once by worker startup. */
  setPool: (pool: ScenarioExecutionPool) => void;
  /**
   * Run the scenario, resolving when its child process is done.
   *
   * Throws {@link ScenarioExecutorUnavailableError} — and only that — when no
   * pool has been wired, so the outbox can tell "retry me" apart from "this
   * run already spent money".
   */
  execute: (job: ExecutionJobData) => Promise<void>;
}

export interface ScenarioExecutionDispatcherDeps {
  /** Runs one scenario to completion against a pool. */
  run: (params: {
    job: ExecutionJobData;
    pool: ScenarioExecutionPool;
  }) => Promise<void>;
}

export function createScenarioExecutionDispatcher(
  deps: ScenarioExecutionDispatcherDeps,
): ScenarioExecutionDispatcherHandle {
  let pool: ScenarioExecutionPool | null = null;

  return {
    setPool: (next) => {
      pool = next;
    },
    execute: async (job) => {
      if (!pool) {
        logger.warn(
          { scenarioRunId: job.scenarioRunId },
          "No execution pool wired yet — leaving the dispatch pending for retry",
        );
        throw new ScenarioExecutorUnavailableError();
      }
      await deps.run({ job, pool });
    },
  };
}
