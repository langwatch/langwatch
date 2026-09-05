import type {
  EvaluationExecutionResult,
  ExecuteEvaluationCommand,
} from "@langwatch/evaluation-contract";
import { createLogger } from "@langwatch/observability";
import {
  EvaluationCostRecorderPort,
  EvaluationExecutionPort,
  EvaluationExecutionReceiptPort,
} from "../ports/evaluation.port";

const logger = createLogger("langwatch:evaluation:execution-receipt");

/**
 * Runs the evaluator and writes its cost row, with the cost — and only the cost — protected
 * against a redelivery.
 */
export class DirectEvaluationExecutionReceiptAdapter extends EvaluationExecutionReceiptPort {
  static create(input: {
    execution: EvaluationExecutionPort;
    costs: EvaluationCostRecorderPort;
  }): DirectEvaluationExecutionReceiptAdapter {
    return new DirectEvaluationExecutionReceiptAdapter(input.execution, input.costs);
  }

  private constructor(
    private readonly execution: EvaluationExecutionPort,
    private readonly costs: EvaluationCostRecorderPort,
  ) {
    super();
  }

  async execute(input: {
    tenantId: string;
    evaluationId: string;
    operationKey: string;
    command: ExecuteEvaluationCommand;
    cost: {
      isGuardrail: boolean;
      evaluatorName: string;
      evaluatorId: string;
      traceId: string;
    };
  }): Promise<{ result: EvaluationExecutionResult; costId: string | null }> {
    const result = await this.execution.execute(input.command);
    const costId = await this.tryRecordCost(input, result);

    return { result, costId };
  }

  private async tryRecordCost(
    input: {
      tenantId: string;
      operationKey: string;
      cost: {
        isGuardrail: boolean;
        evaluatorName: string;
        evaluatorId: string;
        traceId: string;
      };
    },
    result: EvaluationExecutionResult,
  ): Promise<string | null> {
    if (!result.cost) return null;

    try {
      return await this.costs.recordCost({
        projectId: input.tenantId,
        isGuardrail: input.cost.isGuardrail,
        evaluatorName: input.cost.evaluatorName,
        evaluatorId: input.cost.evaluatorId,
        traceId: input.cost.traceId,
        idempotencyKey: input.operationKey,
        amount: result.cost.amount,
        currency: result.cost.currency,
      });
    } catch (error) {
      // A cost row that could not be written must not lose the evaluation the
      // customer already paid the provider for. The run is reported; the spend
      // is reported as unattributed and logged here.
      logger.error(
        {
          tenantId: input.tenantId,
          evaluatorId: input.cost.evaluatorId,
          traceId: input.cost.traceId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Evaluation cost row could not be written",
      );

      return null;
    }
  }
}
