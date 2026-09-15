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
} from "./simulation-run-execution-data.process.ts";

const logger = createLogger("langwatch:simulation-processing:run-execution-effects");

/**
 * The `execute` intent executor: submit the run to this pod's pool. A null
 * pool THROWS rather than dropping the run silently, so the outbox retries
 * it when a worker comes up; the stall wake backstops a pod that never does.
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
 * The `cancel` intent executor: broadcasts the cancellation so every
 * subscribed pod checks whether it owns the child and kills it. A throw
 * retries via the outbox; the cancel-grace wake backstops an unconfirmed pod.
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
 * Records evaluations intent: one errored result per evaluator through
 * pipeline command; carries evaluator name/id; builds result inline to avoid imports.
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
