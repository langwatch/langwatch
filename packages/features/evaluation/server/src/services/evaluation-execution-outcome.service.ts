import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type {
  EvaluationProcessingEvent,
  ExecuteEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import { verdictPassedOf, verdictScoreOf } from "@langwatch/evaluation-contract";
import { EvaluationExecutionReceiptPort } from "../ports/evaluation.port";
import type { PreparedEvaluation } from "./evaluation-execution-preparation.service";
import {
  EvaluationReportedEventService,
  type EvaluationReportedResult,
} from "./evaluation-reported-event.service";

const logger = createLogger("langwatch:evaluation-processing:execute-evaluation");

function isCustomerFixable(error: unknown): error is HandledError {
  return HandledError.isHandled(error) && error.fault === "customer" && !error.retryable;
}

export class EvaluationExecutionOutcomeService {
  static create(input: {
    executionReceipt: EvaluationExecutionReceiptPort;
    reportedEvents: EvaluationReportedEventService;
  }): EvaluationExecutionOutcomeService {
    return new EvaluationExecutionOutcomeService(input);
  }

  private constructor(
    private readonly deps: {
      executionReceipt: EvaluationExecutionReceiptPort;
      reportedEvents: EvaluationReportedEventService;
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

    const score = verdictScoreOf(result) ?? void 0;
    const passed = verdictPassedOf(result) ?? void 0;
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

  private handleFailure(
    data: ExecuteEvaluationCommandData,
    error: unknown,
  ): Promise<EvaluationProcessingEvent[]> {
    if (HandledError.isHandled(error) && error.retryable) {
      throw error;
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
}
