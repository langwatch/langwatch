import type { IntentExecutor } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ScenarioExecutionService } from "@langwatch/scenario-contract";
import type { SimulationService } from "@langwatch/scenario-contract";
import type { ScenarioEvaluationResult } from "@langwatch/scenario-contract";

import type {
  CancelExecutionIntent,
  ExecuteRunIntent,
  FinishRunIntent,
  RecordEvaluationsIntent,
} from "../processes/simulation-run-execution-data.process.ts";

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

/**
 * The `record_evaluations` intent executor: record one errored result per
 * evaluator the run still owes, through the pipeline's own record evaluations
 * command, so the fold applies the same gate a graded run gets. The results
 * carry the evaluator's name when it still exists and its id otherwise, the
 * way the evaluation job records an evaluator it cannot find.
 *
 * `resolveEvaluatorNames` is optional: neither process-manager wiring site
 * carries an evaluator lookup today (scenario must not grow a value
 * dependency on the evaluator module for this), so until one is wired every
 * result's name degrades to the evaluator id, which is exactly the original's
 * own fallback branch.
 *
 * Builds the errored result inline rather than through
 * `toScenarioEvaluationResult` (`@langwatch/scenario-contract`,
 * `evaluations/runScenarioEvaluations.ts`): that module still carries several
 * unrelated dangling `~/` imports, and re-exporting a value from it loads the
 * whole module at runtime, which broke ~87 of this package's 97 test files
 * when tried. This inlines exactly its `"error"` branch (`{ ...base, status:
 * "error", details }` with `base` carrying `evaluatorId`, `name`, `required`
 * and `inputs` only when non-empty) for the one call shape this handler ever
 * makes, with no branching this handler does not need.
 */
export function createRecordEvaluationsHandler(
  simulations: SimulationService,
  resolveEvaluatorNames?: (params: {
    projectId: string;
    attachments: readonly { evaluatorId: string }[];
  }) => Promise<Map<string, string>>,
): IntentExecutor<RecordEvaluationsIntent> {
  return async (payload) => {
    const namesById = await resolveEvaluatorNames?.({
      projectId: payload.projectId,
      attachments: payload.evaluators,
    });
    const evaluations: ScenarioEvaluationResult[] = payload.evaluators.map((attachment) => ({
      evaluatorId: attachment.evaluatorId,
      name: namesById?.get(attachment.evaluatorId) ?? attachment.evaluatorId,
      required: attachment.required,
      status: "error",
      details: payload.details,
    }));
    await simulations.recordEvaluations({
      tenantId: payload.projectId,
      scenarioRunId: payload.scenarioRunId,
      evaluations,
      occurredAt: Date.now(),
    });
    logger.warn(
      {
        scenarioRunId: payload.scenarioRunId,
        evaluatorCount: evaluations.length,
      },
      "Scenario run evaluations recorded as errored, the grading job was lost",
    );
  };
}
