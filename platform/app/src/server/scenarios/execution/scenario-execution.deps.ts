/**
 * The three adapters the `scenarioExecution` process manager dispatches
 * through, assembled from parts that already exist.
 *
 * The process manager decides *whether* a queued run should be executed and
 * *what* to record when it cannot be; none of that needs to know a child
 * process exists. This module is the other side of that seam, and it owns
 * nothing of its own — execution is the dispatcher's, the run's stored status
 * is the run store's, and the terminal write is the failure handler's.
 *
 * @see specs/scenarios/queued-run-dispatch.feature
 * @see specs/scenarios/scenario-execution-process-manager.feature
 */

import { createLogger } from "@langwatch/observability";

import type { ScenarioExecutionDispatchDeps } from "~/server/event-sourcing/simulation-processing/scenarioExecution.process";
import { scenarioFailureOutcomeSchema } from "~/server/scenarios/scenario-failure-outcome";
import type { ScenarioExecutionDispatcherHandle } from "./execution-dispatcher";
import type { ExecutionJobData } from "./execution-pool";

const logger = createLogger("langwatch:scenarios:execution-deps");

/** Answers "has anything already reached this run?" from durable storage. */
export interface ScenarioRunStatusReader {
  getRunStatus(params: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<string | null>;
}

/** Looks up what a run is, for the terminal record's display fields. */
export interface ScenarioDescriptorLookup {
  getById(params: { projectId: string; id: string }): Promise<{
    name: string;
    situation: string;
  } | null>;
}

/** Writes a run's terminal event. Idempotent by contract. */
export interface ScenarioTerminalWriter {
  ensureFailureEventsEmitted(params: {
    projectId: string;
    scenarioId: string;
    setId: string;
    batchRunId: string;
    scenarioRunId?: string;
    error?: string;
    name?: string;
    description?: string;
    outcome?: "error" | "cancelled" | "stalled";
  }): Promise<void>;
}

export interface ScenarioExecutionDispatchDepsInput {
  /** The late-bound seam onto this process's execution pool. */
  readonly dispatcher: ScenarioExecutionDispatcherHandle;
  /** The run store, read straight through — never a fold cache. */
  readonly runStatus: ScenarioRunStatusReader;
  readonly scenarios: ScenarioDescriptorLookup;
  readonly terminalWriter: ScenarioTerminalWriter;
}

/**
 * The run's name and description, or nothing at all.
 *
 * They are decoration on a result, not what identifies a run, so a lookup that
 * fails — or a run whose events never named the scenario — must not stop the
 * run from reaching a terminal state. The alternative is a run that stays
 * non-terminal forever because we could not read a label for it.
 */
async function describeScenario({
  scenarios,
  projectId,
  scenarioId,
}: {
  scenarios: ScenarioDescriptorLookup;
  projectId: string;
  scenarioId: string;
}): Promise<{ name?: string; description?: string }> {
  if (!scenarioId) return {};
  try {
    const scenario = await scenarios.getById({ projectId, id: scenarioId });
    if (!scenario) return {};
    return { name: scenario.name, description: scenario.situation };
  } catch (error) {
    logger.warn(
      { error, projectId, scenarioId },
      "Could not read the scenario for a terminal record — writing it unnamed",
    );
    return {};
  }
}

export function createScenarioExecutionDispatchDeps({
  dispatcher,
  runStatus,
  scenarios,
  terminalWriter,
}: ScenarioExecutionDispatchDepsInput): ScenarioExecutionDispatchDeps {
  return {
    executeRun: (job: ExecutionJobData) => dispatcher.execute(job),

    // Straight through to the run store, with nothing in front of it. A cache
    // is allowed to be behind, and behind here means answering "still queued"
    // for a run that is already spending the customer's model budget — which
    // is what makes a redelivery execute the scenario a second time.
    //
    // A read that throws propagates: the dispatch is left pending and retried,
    // because "I cannot tell whether this already ran" is never a reason to
    // run it.
    readRunStatus: ({ projectId, scenarioRunId }) =>
      runStatus.getRunStatus({ projectId, scenarioRunId }),

    emitFailure: async ({
      projectId,
      scenarioId,
      setId,
      batchRunId,
      scenarioRunId,
      error,
      outcome,
    }) => {
      const parsed = scenarioFailureOutcomeSchema.safeParse(outcome);
      await terminalWriter.ensureFailureEventsEmitted({
        projectId,
        scenarioId,
        setId,
        batchRunId,
        scenarioRunId,
        error,
        // An outcome this end of the seam does not recognise still ends the
        // run: an unterminated run is worse than one recorded under the
        // default outcome.
        outcome: parsed.success ? parsed.data : "error",
        ...(await describeScenario({ scenarios, projectId, scenarioId })),
      });
    },
  };
}
