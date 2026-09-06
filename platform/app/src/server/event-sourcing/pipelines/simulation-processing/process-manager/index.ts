import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";

import { SIMULATION_RUN_EVENT_TYPES } from "../schemas/constants";
import type { SimulationProcessingEvent } from "../schemas/events";
import {
  buildSimulationRunEventView,
  handleCancelRequested,
  handleRunActivity,
  handleRunQueued,
  handleTerminal,
  simulationRunExecutionWake,
} from "./simulationRunExecution.process";
import {
  createCancelExecutionHandler,
  createExecuteRunHandler,
  createFinishRunHandler,
  type SimulationRunExecutionDispatchDeps,
} from "./simulationRunExecutionIntentHandlers";
import {
  cancelExecutionIntentSchema,
  executeRunIntentSchema,
  finishRunIntentSchema,
  INITIAL_SIMULATION_RUN_EXECUTION_STATE,
  SIMULATION_RUN_EXECUTION_INTENT_TYPES,
} from "./simulationRunExecutionProcess.types";

export {
  buildSimulationRunEventView,
  handleCancelRequested,
  handleRunActivity,
  handleRunQueued,
  handleTerminal,
  simulationRunExecutionWake,
} from "./simulationRunExecution.process";
export {
  createCancelExecutionHandler,
  createExecuteRunHandler,
  createFinishRunHandler,
  type SimulationRunExecutionCommands,
  type SimulationRunExecutionDispatchDeps,
  type SimulationRunExecutionPoolPort,
} from "./simulationRunExecutionIntentHandlers";
export {
  CANCEL_GRACE_MS,
  type CancelExecutionIntent,
  cancelExecutionIntentSchema,
  type ExecuteRunIntent,
  executeRunIntentSchema,
  type FinishRunIntent,
  finishRunIntentSchema,
  INITIAL_SIMULATION_RUN_EXECUTION_STATE,
  SIMULATION_RUN_EXECUTION_INTENT_TYPES,
  SIMULATION_RUN_EXECUTION_PROCESS_NAME,
  type SimulationRunExecutionIntents,
  type SimulationRunExecutionPhase,
  type SimulationRunExecutionProcessState,
  type SimulationRunProcessEventView,
  simulationRunProcessEventViewSchema,
} from "./simulationRunExecutionProcess.types";

/**
 * The `simulation_run_execution` process-manager topology, exported
 * standalone so tests can build the exact definition the runtime mounts via
 * `buildProcessManager` — mirroring `topicClusteringPM`.
 *
 * One process per scenario run (process key = scenarioRunId). Owns:
 * - dispatch: queued -> execute intent -> this pod's execution pool;
 * - cancellation: cancel_requested -> cancel intent (Redis pub/sub stays the
 *   cross-pod transport) with a CANCEL_GRACE_MS force-terminal backstop;
 * - stalls: the wake finishes the run ERROR/"stalled" after
 *   STALL_THRESHOLD_MS without activity, replacing read-time derivation.
 *
 * `message_snapshot`, `text_message_start` and `text_message_end` count as
 * activity only — their content never crosses `toPayload`.
 */
export function simulationRunExecutionPM(
  deps: SimulationRunExecutionDispatchDeps,
): ProcessManagerApplier<SimulationProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_SIMULATION_RUN_EXECUTION_STATE)
      .intent(
        SIMULATION_RUN_EXECUTION_INTENT_TYPES.EXECUTE,
        executeRunIntentSchema,
        createExecuteRunHandler(deps),
      )
      .intent(
        SIMULATION_RUN_EXECUTION_INTENT_TYPES.CANCEL,
        cancelExecutionIntentSchema,
        createCancelExecutionHandler(deps),
      )
      .intent(
        SIMULATION_RUN_EXECUTION_INTENT_TYPES.FINISH,
        finishRunIntentSchema,
        createFinishRunHandler(deps),
      )
      .on(SIMULATION_RUN_EVENT_TYPES.QUEUED, handleRunQueued)
      .on(SIMULATION_RUN_EVENT_TYPES.STARTED, handleRunActivity)
      .on(SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT, handleRunActivity)
      .on(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START, handleRunActivity)
      .on(SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END, handleRunActivity)
      .on(SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED, handleCancelRequested)
      .on(SIMULATION_RUN_EVENT_TYPES.FINISHED, handleTerminal)
      .on(SIMULATION_RUN_EVENT_TYPES.DELETED, handleTerminal)
      .onWake(simulationRunExecutionWake)
      .toPayload(buildSimulationRunEventView)
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
