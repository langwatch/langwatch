import {
  EVALUATION_ATTEMPT_FAILED_EVENT_TYPE,
  EVALUATION_ATTEMPT_FAILED_EVENT_VERSION_LATEST,
  evaluationAttemptFailedEventDataSchema,
  type EvaluationAttemptFailedEvent,
  type EvaluationProcessingEvent,
  type ExecuteEvaluationCommandData,
  deriveVerdictPassed,
  deriveVerdictScore,
} from "@langwatch/evaluation-contract";
import { createTenantId, EventUtils } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";

import {
  evaluationRetryDelayMs,
  isWithinEvaluationRetryWindow,
} from "../../../rules/evaluation-retry-window.rules.ts";
import type { EvaluationCommandDispatcherService } from "../../../services/evaluation-command-dispatcher.service.ts";
import {
  type EvaluationReportedEventService,
  type EvaluationReportedResult,
} from "../../../services/evaluation-reported-event.service.ts";
import type { PreparedEvaluation } from "./evaluation-execution-preparation.service.ts";
import type { EvaluationExecutionReceiptService } from "./evaluation-execution-receipt.service.ts";

const logger = createLogger("langwatch:evaluation-processing:execute-evaluation");

/** The next attempt of an evaluation whose evaluator service was not up. */
type PlannedRetry = { attempt: number; delayMs: number; nextAttemptAt: number };

/** An evaluator service that is not up (retryable `evaluator_execution_error`). */
function isEvaluatorNotUp(error: HandledError): boolean {
  return error.code === "evaluator_execution_error" && error.retryable;
}

function isCustomerFixable(error: unknown): error is HandledError {
  return HandledError.isHandled(error) && error.fault === "customer" && !error.retryable;
}

export class EvaluationExecutionOutcomeService {
  static create(input: {
    executionReceipt: Pick<EvaluationExecutionReceiptService, "execute">;
    reportedEvents: EvaluationReportedEventService;
    retries: Pick<EvaluationCommandDispatcherService, "retryEvaluation">;
    retryWindowMs: number;
  }): EvaluationExecutionOutcomeService {
    return new EvaluationExecutionOutcomeService(input);
  }

  private constructor(
    private readonly deps: {
      executionReceipt: Pick<EvaluationExecutionReceiptService, "execute">;
      reportedEvents: EvaluationReportedEventService;
      retries: Pick<EvaluationCommandDispatcherService, "retryEvaluation">;
      retryWindowMs: number;
    },
  ) {}

  async execute(
    data: ExecuteEvaluationCommandData,
    prepared: PreparedEvaluation,
  ): Promise<EvaluationProcessingEvent[]> {
    try {
      return await this.executePrepared(data, prepared);
    } catch (error) {
      return this.handleFailure(data, error);
    }
  }

  private async executePrepared(
    data: ExecuteEvaluationCommandData,
    prepared: PreparedEvaluation,
  ): Promise<EvaluationProcessingEvent[]> {
    const operationKey = `${data.tenantId}:${data.evaluationId}:execution`;
    const execution = await this.deps.executionReceipt.execute({
      tenantId: data.tenantId,
      evaluationId: data.evaluationId,
      operationKey,
      command: {
        projectId: data.tenantId,
        traceId: data.traceId,
        evaluatorType: data.evaluatorType,
        settings: prepared.settings ?? null,
        mappings: prepared.monitor.mappings ?? null,
        level: prepared.monitor.level === "thread" ? "thread" : "trace",
        workflowId:
          prepared.monitor.evaluator?.type === "workflow"
            ? prepared.monitor.evaluator.workflowId
            : undefined,
        idempotencyKey: operationKey,
      },
      cost: {
        isGuardrail: !!data.isGuardrail,
        evaluatorName: data.evaluatorName ?? data.evaluatorType,
        evaluatorId: data.evaluatorId,
        traceId: data.traceId,
      },
    });
    const { result, costId } = execution;
    if (result.status === "skipped") {
      return [];
    }

    const score = deriveVerdictScore(result) ?? void 0;
    const passed = deriveVerdictPassed(result) ?? void 0;
    const label = result.status === "processed" ? result.label : void 0;
    const details = result.status === "error" ? void 0 : result.details;
    const resultError =
      result.status === "error"
        ? (result.error ?? result.details ?? "Evaluator failed")
        : result.error;
    const reported: EvaluationReportedResult = {
      status: result.status,
      score,
      passed,
      label,
      details,
      error: resultError,
      errorDetails: result.errorDetails ?? null,
      inputs: result.inputs ?? null,
      costId,
    };

    return this.deps.reportedEvents.emit(data, reported);
  }

  private async handleFailure(
    data: ExecuteEvaluationCommandData,
    error: unknown,
  ): Promise<EvaluationProcessingEvent[]> {
    if (HandledError.isHandled(error) && error.retryable) {
      if (!isEvaluatorNotUp(error)) throw error;
      const retry = this.planRetry({ data, error });
      if (retry) return this.retryLater({ data, error, retry });
    }

    if (isCustomerFixable(error)) {
      logger.info(
        {
          ...error.meta,
          code: error.code,
          tenantId: data.tenantId,
          evaluationId: data.evaluationId,
          evaluatorId: data.evaluatorId,
          traceId: data.traceId,
          error: error.message,
        },
        "Customer-fixable evaluator failure — skipping evaluation",
      );

      return this.deps.reportedEvents.emit(data, {
        status: "skipped",
        details: error.message,
      });
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      {
        tenantId: data.tenantId,
        evaluationId: data.evaluationId,
        evaluatorId: data.evaluatorId,
        traceId: data.traceId,
        error: message,
      },
      "Evaluation execution failed",
    );

    return this.deps.reportedEvents.emit(data, {
      status: "error",
      error: message,
      errorDetails: error instanceof Error ? (error.stack ?? null) : null,
    });
  }

  /** The next attempt, unless it would start after the retry window, measured from the first. */
  private planRetry({
    data,
    error,
  }: {
    data: ExecuteEvaluationCommandData;
    error: HandledError;
  }): PlannedRetry | undefined {
    const attempt = data.attempt ?? 1;
    const asked = error.meta.retryAfterMs;
    const retryAfterMs = typeof asked === "number" && asked > 0 ? asked : undefined;
    const delayMs = evaluationRetryDelayMs({ attempt, retryAfterMs });
    const nextAttemptAt = nowInstant().epochMilliseconds + delayMs;
    const inWindow = isWithinEvaluationRetryWindow({
      occurredAt: data.occurredAt,
      now: nextAttemptAt,
      windowMs: this.deps.retryWindowMs,
    });
    return inWindow ? { attempt, delayMs, nextAttemptAt } : undefined;
  }

  /** Sends the next attempt, delayed, and records this one as failed; no result yet. */
  private async retryLater({
    data,
    error,
    retry,
  }: {
    data: ExecuteEvaluationCommandData;
    error: HandledError;
    retry: PlannedRetry;
  }): Promise<EvaluationProcessingEvent[]> {
    logger.warn(
      {
        tenantId: data.tenantId,
        evaluationId: data.evaluationId,
        evaluatorId: data.evaluatorId,
        attempt: retry.attempt,
        nextAttemptAt: retry.nextAttemptAt,
        error: error.message,
      },
      "Evaluator service not up; the evaluation is retried",
    );
    await this.deps.retries.retryEvaluation({
      data: { ...data, attempt: retry.attempt + 1 },
      delayMs: retry.delayMs,
    });

    const event = EventUtils.createEvent<EvaluationAttemptFailedEvent>({
      aggregateType: "evaluation",
      aggregateId: data.evaluationId,
      tenantId: createTenantId(data.tenantId),
      type: EVALUATION_ATTEMPT_FAILED_EVENT_TYPE,
      version: EVALUATION_ATTEMPT_FAILED_EVENT_VERSION_LATEST,
      data: evaluationAttemptFailedEventDataSchema.parse({
        evaluationId: data.evaluationId,
        evaluatorId: data.evaluatorId,
        evaluatorType: data.evaluatorType,
        evaluatorName: data.evaluatorName,
        traceId: data.traceId,
        isGuardrail: data.isGuardrail,
        attempt: retry.attempt,
        error: error.message,
        nextAttemptAt: retry.nextAttemptAt,
      }),
      idempotencyKey: `${data.tenantId}:${data.evaluationId}:attempt_failed:${retry.attempt}`,
    });
    return [event];
  }
}
