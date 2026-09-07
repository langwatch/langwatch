import { createLogger } from "@langwatch/observability";
import type { EvaluatorWithFields } from "~/server/evaluators/evaluator.service";
import type { IntentExecutor } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import { toScenarioEvaluationResult } from "~/server/scenarios/evaluations/runScenarioEvaluations";
import type { ExecutionJobData } from "~/server/scenarios/execution/execution-pool";
import type { ScenarioEvaluationResult } from "~/server/scenarios/schemas/event-schemas";

import type {
  CancelExecutionIntent,
  ExecuteRunIntent,
  FinishRunIntent,
  RecordEvaluationsIntent,
} from "./simulationRunExecutionProcess.types";

const logger = createLogger(
  "langwatch:simulation-processing:run-execution-effects",
);

/**
 * The subset of the scenario execution pool the execute intent needs. The
 * submit param IS `ExecutionJobData` (execution-pool.ts) so the payload maps
 * onto it without adaptation.
 */
export interface SimulationRunExecutionPoolPort {
  submit(job: ExecutionJobData): void;
}

/**
 * The pipeline commands the finish and record evaluations intents report
 * their outcome through.
 */
export interface SimulationRunExecutionCommands {
  finishRun(data: {
    tenantId: string;
    scenarioRunId: string;
    status: string;
    error?: string;
    occurredAt: number;
  }): Promise<void>;
  recordEvaluations(data: {
    tenantId: string;
    scenarioRunId: string;
    evaluations: ScenarioEvaluationResult[];
    occurredAt: number;
  }): Promise<void>;
}

export interface SimulationRunExecutionDispatchDeps {
  /**
   * The saved evaluators behind a run's attachments, by id, so a lost-job
   * result carries the evaluator's name the way a graded one does.
   */
  getAttachedEvaluators: (params: {
    projectId: string;
    attachments: readonly { evaluatorId: string }[];
  }) => Promise<Map<string, Pick<EvaluatorWithFields, "name">>>;
  /**
   * This pod's execution pool, or null when the pod is not a worker (e.g. a
   * web-only replica). Deferred because the pool is wired after the pipeline
   * is built.
   */
  getPool: () => SimulationRunExecutionPoolPort | null;
  /**
   * The Redis pub/sub cancellation broadcast (cancellation-channel.ts).
   * Pub/sub stays the cross-pod transport; durability now comes from outbox
   * retries plus the cancel-grace wake, not from the message itself.
   */
  publishCancellation: (params: {
    projectId: string;
    scenarioRunId: string;
  }) => Promise<void>;
  /**
   * Late-bound on purpose: the executor is declared while the pipeline is
   * being built, and these are the SAME pipeline's commands — they only
   * exist after `.build()`. The registry supplies a getter it resolves
   * post-build; dispatch happens long after that.
   */
  commands: () => SimulationRunExecutionCommands;
}

/**
 * The `execute` intent executor: submit the run to this pod's pool.
 *
 * A null pool THROWS instead of dropping the run silently (the old
 * subscriber's failure mode): the outbox retries with backoff, so a run queued
 * while no worker is up is dispatched when one is, rather than vanishing.
 * If the pod genuinely never executes, the stall wake is the backstop.
 */
export function createExecuteRunHandler(
  deps: SimulationRunExecutionDispatchDeps,
): IntentExecutor<ExecuteRunIntent> {
  return async (payload) => {
    const pool = deps.getPool();
    if (pool === null) {
      throw new Error(
        `No execution pool on this pod; outbox will retry execute for scenarioRunId=${payload.scenarioRunId}`,
      );
    }
    pool.submit({
      projectId: payload.projectId,
      scenarioId: payload.scenarioId,
      scenarioRunId: payload.scenarioRunId,
      batchRunId: payload.batchRunId,
      setId: payload.scenarioSetId,
      ...(payload.name !== undefined ? { scenarioName: payload.name } : {}),
      target: payload.target,
      ...(payload.parameters !== undefined
        ? { parameters: payload.parameters }
        : {}),
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
  deps: SimulationRunExecutionDispatchDeps,
): IntentExecutor<CancelExecutionIntent> {
  return async (payload) => {
    await deps.publishCancellation({
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
  deps: SimulationRunExecutionDispatchDeps,
): IntentExecutor<FinishRunIntent> {
  return async (payload) => {
    await deps.commands().finishRun({
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
 */
export function createRecordEvaluationsHandler(
  deps: SimulationRunExecutionDispatchDeps,
): IntentExecutor<RecordEvaluationsIntent> {
  return async (payload) => {
    const evaluatorsById = await deps.getAttachedEvaluators({
      projectId: payload.projectId,
      attachments: payload.evaluators,
    });
    const evaluations = payload.evaluators.map((attachment) =>
      toScenarioEvaluationResult({
        attachment,
        name:
          evaluatorsById.get(attachment.evaluatorId)?.name ??
          attachment.evaluatorId,
        result: {
          status: "error",
          error_type: "INTERNAL_ERROR",
          details: payload.details,
          traceback: [],
        },
        inputs: {},
      }),
    );
    await deps.commands().recordEvaluations({
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
