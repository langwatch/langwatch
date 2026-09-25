import type { ProcessManagerApplier } from "@langwatch/eventing";
import {
  type ScenarioExecutionService,
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationService,
  type SimulationProcessingEvent,
} from "@langwatch/scenario-contract";

import {
  cancelExecutionIntentSchema,
  executeRunIntentSchema,
  finishRunIntentSchema,
  INITIAL_SIMULATION_RUN_EXECUTION_STATE,
  recordEvaluationsIntentSchema,
  SIMULATION_RUN_EXECUTION_INTENT_TYPES,
} from "./simulation-run-execution-data.process.ts";
import {
  handleCancelRequested,
  handleRunActivity,
  handleRunEvaluated,
  handleRunFinished,
  handleRunQueued,
  handleTerminal,
  SimulationRunExecutionEvolution,
  simulationRunExecutionWake,
} from "./simulation-run-execution-evolution.process.ts";
import {
  createCancelExecutionHandler,
  createExecuteRunHandler,
  createFinishRunHandler,
  createRecordEvaluationsHandler,
} from "./simulation-run-execution.intent.ts";

export {
  handleCancelRequested,
  handleRunActivity,
  handleRunEvaluated,
  handleRunFinished,
  handleRunQueued,
  handleTerminal,
  SimulationRunExecutionEvolution,
  simulationRunExecutionWake,
} from "./simulation-run-execution-evolution.process.ts";
export {
  createCancelExecutionHandler,
  createExecuteRunHandler,
  createFinishRunHandler,
  createRecordEvaluationsHandler,
} from "./simulation-run-execution.intent.ts";
export {
  CANCEL_GRACE_MS,
  type CancelExecutionIntent,
  cancelExecutionIntentSchema,
  EVALUATION_DEADLINE_MS,
  EVALUATION_LOST_DETAILS,
  type ExecuteRunIntent,
  executeRunIntentSchema,
  type FinishRunIntent,
  finishRunIntentSchema,
  INITIAL_SIMULATION_RUN_EXECUTION_STATE,
  type PendingEvaluator,
  pendingEvaluatorSchema,
  type RecordEvaluationsIntent,
  recordEvaluationsIntentSchema,
  SIMULATION_RUN_EXECUTION_INTENT_TYPES,
  SIMULATION_RUN_EXECUTION_PROCESS_NAME,
  type SimulationRunExecutionIntents,
  type SimulationRunExecutionPhase,
  type SimulationRunExecutionProcessState,
  type SimulationRunProcessEventView,
  simulationRunProcessEventViewSchema,
} from "./simulation-run-execution-data.process.ts";

/**
 * Simulation run execution process-manager topology (one per run): dispatch, cancellation,
 * stall detection, lost grading job handling. Messages count as activity only.
 */
export function simulationRunExecutionPM(
  execution: ScenarioExecutionService,
  simulations: SimulationService,
  resolveEvaluatorNames?: Parameters<typeof createRecordEvaluationsHandler>[1],
): ProcessManagerApplier<SimulationProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_SIMULATION_RUN_EXECUTION_STATE)
      .intent(
        SIMULATION_RUN_EXECUTION_INTENT_TYPES.EXECUTE,
        executeRunIntentSchema,
        createExecuteRunHandler(execution),
      )
      .intent(
        SIMULATION_RUN_EXECUTION_INTENT_TYPES.CANCEL,
        cancelExecutionIntentSchema,
        createCancelExecutionHandler(execution),
      )
      .intent(
        SIMULATION_RUN_EXECUTION_INTENT_TYPES.FINISH,
        finishRunIntentSchema,
        createFinishRunHandler(simulations),
      )
      .intent(
        SIMULATION_RUN_EXECUTION_INTENT_TYPES.RECORD_EVALUATIONS,
        recordEvaluationsIntentSchema,
        createRecordEvaluationsHandler(simulations, resolveEvaluatorNames),
      )
      .on(SIMULATION_RUN_EVENT_TYPES.QUEUED, handleRunQueued)
      .on(SIMULATION_RUN_EVENT_TYPES.STARTED, handleRunActivity)
      .on(SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT, handleRunActivity)
      .on(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START, handleRunActivity)
      .on(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END, handleRunActivity)
      .on(SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED, handleCancelRequested)
      .on(SIMULATION_RUN_EVENT_TYPES.FINISHED, handleRunFinished)
      .on(SIMULATION_RUN_EVENT_TYPES.EVALUATED, handleRunEvaluated)
      .on(SIMULATION_RUN_EVENT_TYPES.DELETED, handleTerminal)
      .onWake(simulationRunExecutionWake)
      .toPayload((...args) => SimulationRunExecutionEvolution.buildSimulationRunEventView(...args))
      .outbox({
        // The execute intent is the run's only dispatch path: give it more
        // attempts than the generic default so a pod without a pool (or a
        // brief Redis outage on cancel) retries instead of dying.
        maxAttempts: 5,
        // Dispatches are fast (a pool submit, a publish, one command), so
        // the generic 30s lease safely outlives the slowest healthy one.
        leaseDurationMs: 30_000,
        concurrency: 3,
        batchSize: 3,
      });
}
