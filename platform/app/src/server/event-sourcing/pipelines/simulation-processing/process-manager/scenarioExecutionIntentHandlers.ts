import { createLogger } from "@langwatch/observability";

import type { IntentExecutor } from "~/server/event-sourcing/pipeline/processManagerDefinition";
// The error is declared beside the dispatcher that throws it, so the thrower
// does not depend on this module — its catcher.
import { ScenarioExecutorUnavailableError } from "~/server/scenarios/execution/execution-dispatcher";
import type { ScenarioFailureOutcome } from "~/server/scenarios/scenario-failure-outcome";

import type {
  ScenarioExecutionExecuteRunIntent,
  ScenarioExecutionFailRunIntent,
  ScenarioExecutionTarget,
} from "./scenarioExecutionProcess.types";

const logger = createLogger(
  "langwatch:simulation-processing:scenario-execution-process",
);

/** What a run has to execute. */
interface ScenarioExecutionJob {
  projectId: string;
  scenarioId: string;
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
  target: ScenarioExecutionTarget;
}

/** What the terminal write and the dispatch need from the scenario domain. */
export interface ScenarioExecutionDispatchDeps {
  /**
   * Runs the scenario and resolves when its child process is done. Rejects
   * only for faults that happened before anything was spawned.
   */
  executeRun: (job: ScenarioExecutionJob) => Promise<void>;
  /**
   * The run's currently stored status, or null when nothing has been folded
   * for it yet.
   *
   * Read immediately before spawning, because the outbox's at-most-once
   * property is weaker than it looks: a lease that lapses because its worker
   * was hard-killed is re-leased with the attempt counter unchanged, so
   * `maxAttempts` never sees it. The run's own status is the durable record of
   * whether it has already been dispatched, and it is a property of the work
   * rather than of the attempt.
   *
   * Read from the DURABLE tier, never a fold cache: a cached `QUEUED` from
   * another process is precisely the stale answer that would let a redelivery
   * dispatch twice. See the residual window on
   * {@link createScenarioExecutionExecuteRunHandler}.
   */
  readRunStatus: (params: {
    projectId: string;
    scenarioRunId: string;
  }) => Promise<string | null>;
  /**
   * Writes the run's terminal event. Idempotent — `finishRun` collapses a
   * repeat — which is what makes retrying this intent safe.
   */
  emitFailure: (params: {
    projectId: string;
    scenarioId: string;
    setId: string;
    batchRunId: string;
    scenarioRunId: string;
    error: string;
    name?: string;
    description?: string;
    outcome?: ScenarioFailureOutcome;
  }) => Promise<void>;
  /** Scenario display fields, so a reaped run reads like any other in the UI. */
  lookupScenario: (params: {
    projectId: string;
    scenarioId: string;
  }) => Promise<{ name: string; situation: string } | null>;
}

/**
 * The statuses that mean "this run is still waiting to be executed".
 *
 * Anything else — IN_PROGRESS, or any terminal status — means a previous
 * dispatch already reached the run, and re-executing would bill the customer
 * for a second run over a conversation that may already have recorded
 * messages.
 */
const AWAITING_DISPATCH_STATUSES = new Set(["QUEUED", "PENDING"]);

/**
 * Executes the `executeRun` intent: runs a queued scenario.
 *
 * **The status read is the guard, and it is check-then-act.** `maxAttempts` is
 * shared with `failRun`, which must retry, so it cannot also express "never run
 * this twice"; and it would not express it anyway, because a hard-killed
 * worker's lease lapses without incrementing the attempt count. The run's own
 * stored status is the durable record of whether the work has already been
 * dispatched, and it survives redelivery, lease lapse and restart alike.
 *
 * What it does NOT do is close the window. The read and `executeRun` are two
 * steps with no atomic claim between them, so a worker that was partitioned
 * rather than dead can still be holding a child while a re-leased delivery
 * reads a stale `QUEUED` and spawns a second one. That window is the interval
 * between this read and the child's first status write. Closing it needs the
 * claim to BE a write — a conditional `QUEUED`/`PENDING` -> `IN_PROGRESS`
 * transition on the run store, or a fence token compared at spawn time — which
 * is a store-level capability this handler does not have today. Until then the
 * guard narrows the double-run window; it does not remove it.
 *
 * Once the run has been handed to the executor the handler never throws.
 * A rejection after that point would re-lease a message whose scenario has
 * already spent money, so an executor fault is recorded as a terminal failure;
 * and if even that write fails, the process's own deadline is still armed and
 * finalises the run. Losing the record is recoverable. Running it twice is not.
 */
export function createScenarioExecutionExecuteRunHandler(
  deps: ScenarioExecutionDispatchDeps,
): IntentExecutor<ScenarioExecutionExecuteRunIntent> {
  return async (payload, context) => {
    const identity = {
      projectId: payload.projectId,
      scenarioRunId: payload.scenarioRunId,
      batchRunId: payload.batchRunId,
      attempt: context.attempt,
    };

    const status = await deps.readRunStatus({
      projectId: payload.projectId,
      scenarioRunId: payload.scenarioRunId,
    });

    // Null means nothing has been folded for this run yet, which is the
    // ordinary case: the dispatch is racing its own `queued` projection.
    if (status !== null && !AWAITING_DISPATCH_STATUSES.has(status)) {
      logger.info(
        { ...identity, status },
        "Skipping scenario dispatch — the run has already left the queue",
      );
      return;
    }

    logger.info(identity, "Dispatching scenario run from the process outbox");

    try {
      await deps.executeRun({
        projectId: payload.projectId,
        scenarioId: payload.scenarioId,
        scenarioRunId: payload.scenarioRunId,
        batchRunId: payload.batchRunId,
        setId: payload.setId,
        target: payload.target,
      });
    } catch (err) {
      if (err instanceof ScenarioExecutorUnavailableError) {
        // Nothing was spawned, so retrying is free and correct. This is the
        // boot window between the pipeline registering and the worker wiring
        // its pool, and it used to be a silent drop.
        throw err;
      }

      logger.error(
        { err, ...identity },
        "Scenario execution faulted after dispatch — recording it as failed rather than re-running it",
      );
      await recordExecutionFault({ deps, payload, err });
    }
  };
}

/**
 * Reads the scenario's display fields for a run that is about to be written as
 * failed.
 *
 * Best-effort on purpose, and shared by BOTH terminal paths: a run that died to
 * a post-dispatch fault and a run reaped by its deadline are the same thing to
 * whoever is looking at the list, so they must not read differently. Failing to
 * read cosmetics never stops the terminal event being written.
 *
 * An empty scenario id is answered without a lookup rather than with one that
 * cannot match: since the wake stopped requiring a scenario id to terminalise a
 * run (only `queued` and `started` ever carry one), a reaped run may legitimately
 * arrive here without it, and it is the run that has to end — not a query.
 */
async function readScenarioDisplayFields({
  deps,
  projectId,
  scenarioId,
  scenarioRunId,
}: {
  deps: ScenarioExecutionDispatchDeps;
  projectId: string;
  scenarioId: string;
  scenarioRunId: string;
}): Promise<{ name: string; situation: string } | null> {
  if (!scenarioId) return null;

  return await deps
    .lookupScenario({ projectId, scenarioId })
    .catch((err: unknown) => {
      logger.warn(
        { err, scenarioRunId },
        "Could not read scenario display fields for a failed run",
      );
      return null;
    });
}

/**
 * Records a post-dispatch fault as the run's terminal state. Best-effort on
 * purpose: if this write fails too, the process's armed deadline still
 * finalises the run, and throwing here would re-run the scenario.
 */
async function recordExecutionFault({
  deps,
  payload,
  err,
}: {
  deps: ScenarioExecutionDispatchDeps;
  payload: ScenarioExecutionExecuteRunIntent;
  err: unknown;
}): Promise<void> {
  try {
    const scenario = await readScenarioDisplayFields({
      deps,
      projectId: payload.projectId,
      scenarioId: payload.scenarioId,
      scenarioRunId: payload.scenarioRunId,
    });
    await deps.emitFailure({
      projectId: payload.projectId,
      scenarioId: payload.scenarioId,
      setId: payload.setId,
      batchRunId: payload.batchRunId,
      scenarioRunId: payload.scenarioRunId,
      error: err instanceof Error ? err.message : String(err),
      name: scenario?.name,
      description: scenario?.situation,
      outcome: "error",
    });
  } catch (writeErr) {
    logger.warn(
      { err: writeErr, scenarioRunId: payload.scenarioRunId },
      "Could not record a faulted scenario run — leaving it to its deadline",
    );
  }
}

/**
 * Executes the `failRun` intent: records that a run nobody is executing any
 * more has ended.
 *
 * Throwing is the right response to an infrastructure fault here — the outbox
 * retries, and the alternative is a run that stays non-terminal forever, which
 * is the failure this process exists to remove. That is the opposite of the
 * scenario's own execution contract, which must never retry; nothing is
 * re-executed here, only the record of the run's death is written.
 */
export function createScenarioExecutionFailRunHandler(
  deps: ScenarioExecutionDispatchDeps,
): IntentExecutor<ScenarioExecutionFailRunIntent> {
  return async (payload) => {
    const scenario = await readScenarioDisplayFields({
      deps,
      projectId: payload.projectId,
      scenarioId: payload.scenarioId,
      scenarioRunId: payload.scenarioRunId,
    });

    logger.info(
      {
        projectId: payload.projectId,
        scenarioRunId: payload.scenarioRunId,
        batchRunId: payload.batchRunId,
        outcome: payload.outcome,
      },
      "Deadline fired for a scenario run with no live worker — writing terminal state",
    );

    await deps.emitFailure({
      projectId: payload.projectId,
      scenarioId: payload.scenarioId,
      setId: payload.setId,
      batchRunId: payload.batchRunId,
      scenarioRunId: payload.scenarioRunId,
      error: payload.reason,
      name: scenario?.name,
      description: scenario?.situation,
      outcome: payload.outcome,
    });
  };
}
