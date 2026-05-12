/**
 * Reactor that triggers scenario execution when a queued event is processed.
 *
 * Fires on `lw.simulation_run.queued` events and submits the job to the
 * in-process execution pool. The pool manages concurrency and spawns
 * child processes.
 *
 * This reactor is fire-and-forget — it does NOT await execution.
 * The GroupQueue must continue processing subsequent events (message_snapshot,
 * finished, cancel_requested, etc.) for the same aggregate.
 *
 * The pool is late-bound via `setPool()` because the pool is created during
 * worker startup, after the pipeline registry is initialized.
 *
 * @see specs/scenarios/event-driven-execution-prep.feature
 */

import { createLogger } from "../../../../../utils/logger";
import type { ScenarioExecutionPool } from "../../../../scenarios/execution/execution-pool";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";
import { isSimulationRunQueuedEvent } from "../schemas/typeGuards";

const logger = createLogger(
  "langwatch:simulation-processing:scenario-execution",
);

export interface ScenarioExecutionReactorHandle {
  reactor: ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData>;
  /** Wire the execution pool after the reactor is created. Called by worker startup. */
  setPool: (pool: ScenarioExecutionPool) => void;
}

/**
 * Creates a reactor that submits queued scenarios to the execution pool.
 *
 * Only runs on worker pods (not on the web server). The pool must be
 * wired via `setPool()` before the reactor can process events.
 */
export function createScenarioExecutionReactor(): ScenarioExecutionReactorHandle {
  let pool: ScenarioExecutionPool | null = null;

  const reactor: ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData> = {
    name: "scenarioExecution",
    options: {
      runIn: ["worker"],
    },

    async handle(
      event: SimulationProcessingEvent,
      context: ReactorContext<SimulationRunStateData>,
    ): Promise<void> {
      if (!isSimulationRunQueuedEvent(event)) return;

      if (!pool) {
        logger.warn(
          { scenarioRunId: context.foldState.ScenarioRunId },
          "Execution pool not yet wired, skipping",
        );
        return;
      }

      const { foldState } = context;

      // Skip if already cancelled before execution starts
      if (foldState.CancellationRequestedAt != null) {
        logger.info(
          { scenarioRunId: foldState.ScenarioRunId },
          "Skipping execution — cancellation already requested",
        );
        return;
      }

      // Target info is in the event data (added when queueRun was dispatched)
      const target = event.data.target;
      if (!target) {
        logger.warn(
          { scenarioRunId: foldState.ScenarioRunId },
          "Skipping execution — no target in queued event (pre-migration event?)",
        );
        return;
      }

      pool.submit({
        projectId: String(event.tenantId),
        scenarioId: foldState.ScenarioId,
        scenarioRunId: foldState.ScenarioRunId,
        batchRunId: foldState.BatchRunId,
        setId: foldState.ScenarioSetId,
        scenarioName: foldState.Name ?? undefined,
        target,
      });

      logger.debug(
        { scenarioRunId: foldState.ScenarioRunId, batchRunId: foldState.BatchRunId },
        "Submitted scenario to execution pool",
      );
    },
  };

  return {
    reactor,
    setPool: (p) => { pool = p; },
  };
}
