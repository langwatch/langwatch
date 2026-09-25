import type { EventHandler, IntentSpec, ProcessManagerApplier } from "@langwatch/eventing";
import {
  backoffDelayMs,
  isSimulationRunFinishedEvent,
  SCENARIO_EVALUATIONS_JOB,
  SIMULATION_RUN_EVENT_TYPES,
  UNGRADED_RUN_STATUSES,
  type SimulationProcessingEvent,
} from "@langwatch/scenario-contract";
import { extractSuiteId } from "@langwatch/suite-contract";
import { z } from "zod";

import {
  createGradeRunHandler,
  gradeRunIntentSchema,
  type ScenarioGradingDeps,
} from "./scenario-evaluations.intent.ts";

export const SCENARIO_EVALUATIONS_PROCESS_NAME = "scenario_evaluations" as const;

type ScenarioEvaluationsIntents = { grade: IntentSpec<typeof gradeRunIntentSchema> };

/** Persisted per run; ids and flags only. */
interface ScenarioEvaluationsProcessState {
  gradingQueued: boolean;
}

export const INITIAL_SCENARIO_EVALUATIONS_STATE: ScenarioEvaluationsProcessState = {
  gradingQueued: false,
};

/** What the process keeps of a finished event: no conversation, no evaluator settings. */
const finishedRunViewSchema = z.object({
  scenarioId: z.string().nullable(),
  scenarioSetId: z.string().nullable(),
  status: z.string().nullable(),
  hasOwnEvaluations: z.boolean(),
  /** Null when the event pinned no evaluators, so they are read when grading runs. */
  attachmentCount: z.number().int().nullable(),
});
type FinishedRunView = z.infer<typeof finishedRunViewSchema>;

export function finishedRunViewOf(event: SimulationProcessingEvent): FinishedRunView {
  if (!isSimulationRunFinishedEvent(event)) {
    return {
      scenarioId: null,
      scenarioSetId: null,
      status: null,
      hasOwnEvaluations: false,
      attachmentCount: 0,
    };
  }
  const { scenarioId, scenarioSetId, status, results, evaluators } = event.data;
  return {
    scenarioId: scenarioId ?? null,
    scenarioSetId: scenarioSetId ?? null,
    status: status ?? null,
    hasOwnEvaluations: Boolean(results?.evaluations),
    attachmentCount: evaluators ? evaluators.attachments.length : null,
  };
}

/** Graded unless it graded itself, has no conversation, names no scenario or attaches nothing. */
function gradesFinishedRun(
  view: FinishedRunView,
): view is FinishedRunView & { scenarioId: string } {
  if (view.hasOwnEvaluations || !view.scenarioId) return false;
  if (view.status && UNGRADED_RUN_STATUSES.has(view.status)) return false;
  return view.attachmentCount !== 0;
}

/** FINISHED: queue the run's grading once; a redelivered finished event queues nothing. */
export const handleRunFinishedForGrading: EventHandler<
  ScenarioEvaluationsProcessState,
  unknown,
  ScenarioEvaluationsIntents
> = (state, payload, ctx) => {
  if (state.gradingQueued) return { state };
  const view = finishedRunViewSchema.parse(payload);
  if (!gradesFinishedRun(view)) return { state };
  return {
    state: { gradingQueued: true },
    intents: [
      ctx.intents.grade("grade", {
        tenantId: ctx.projectId,
        scenarioRunId: ctx.key,
        scenarioId: view.scenarioId,
        planId: view.scenarioSetId ? extractSuiteId(view.scenarioSetId) : null,
      }),
    ],
  };
};

/**
 * One grading per finished run (record §9): the outbox retries a grading whose
 * trace is still arriving with main's growing delay, and the last attempt
 * records what it could not read as failed.
 */
export function scenarioEvaluationsPM(
  deps: ScenarioGradingDeps,
): ProcessManagerApplier<SimulationProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_SCENARIO_EVALUATIONS_STATE)
      .intent("grade", gradeRunIntentSchema, createGradeRunHandler(deps))
      .on(SIMULATION_RUN_EVENT_TYPES.FINISHED, handleRunFinishedForGrading)
      .toPayload(finishedRunViewOf)
      .outbox({
        maxAttempts: SCENARIO_EVALUATIONS_JOB.MAX_ATTEMPTS,
        retryDelayMs: ({ attempt }) => backoffDelayMs(attempt),
        leaseDurationMs: SCENARIO_EVALUATIONS_JOB.LEASE_MS,
        // As simulation_run_execution: slow dispatches, so lease no more than run at once.
        concurrency: 3,
        batchSize: 3,
      });
}
