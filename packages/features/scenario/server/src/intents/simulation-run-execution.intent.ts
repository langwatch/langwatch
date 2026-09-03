import type { IntentExecutor } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ScenarioExecutionService } from "@langwatch/scenario-contract";
import type { SimulationService } from "@langwatch/scenario-contract";

import type {
  CancelExecutionIntent,
  ExecuteRunIntent,
  FinishRunIntent,
} from "../processes/simulation-run-execution-data.process";

const logger = createLogger("langwatch:simulation-processing:run-execution-effects");

/**
 * The `execute` intent executor: submit the run to this pod's pool.
 *
 * A null pool THROWS instead of dropping the run silently (the old
 * subscriber's failure mode): the outbox retries with backoff, so a run queued
 * while no worker is up is dispatched when one is, rather than vanishing.
 * If the pod genuinely never executes, the stall wake is the backstop.
 */
export function createExecuteRunHandler(
  execution: ScenarioExecutionService,
): IntentExecutor<ExecuteRunIntent> {
  return async (payload) => {
    await execution.submit({
      projectId: payload.projectId,
      scenarioId: payload.scenarioId,
      scenarioRunId: payload.scenarioRunId,
      batchRunId: payload.batchRunId,
      setId: payload.scenarioSetId,
      ...(payload.name !== undefined ? { scenarioName: payload.name } : {}),
      target: payload.target,
      ...(payload.parameters !== undefined ? { parameters: payload.parameters } : {}),
      ...(payload.secretParameters !== undefined
        ? { secretParameters: payload.secretParameters }
        : {}),
    });
    logger.info(
      { scenarioRunId: payload.scenarioRunId },
      "Scenario run submitted to execution pool",
    );
  };
}

/**
 * The `cancel` intent executor: broadcast the cancellation. Every worker pod
 * subscribed to the channel checks whether it owns the child and kills it.
 * A throw hands the message back to the outbox for retry; the cancel-grace
 * wake force-terminates the run if no pod ever confirms.
 */
export function createCancelExecutionHandler(
  execution: ScenarioExecutionService,
): IntentExecutor<CancelExecutionIntent> {
  return async (payload) => {
    await execution.cancel({
      projectId: payload.projectId,
      scenarioRunId: payload.scenarioRunId,
    });
  };
}

/**
 * The `finish` intent executor: write the terminal finished event through
 * the pipeline's own commands so the fold projection and downstream
 * subscribers see exactly the same fact as any other completion path.
 */
export function createFinishRunHandler(
  simulations: SimulationService,
): IntentExecutor<FinishRunIntent> {
  return async (payload) => {
    await simulations.finishRun({
      tenantId: payload.projectId,
      scenarioRunId: payload.scenarioRunId,
      status: payload.status,
      ...(payload.error !== undefined ? { error: payload.error } : {}),
      occurredAt: Date.now(),
    });
  };
}
