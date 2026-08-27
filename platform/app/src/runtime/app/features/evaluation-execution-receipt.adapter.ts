import {
  evaluationExecutionResultSchema,
  type EvaluationExecutionResult,
  type EvaluationService,
  type ExecuteEvaluationCommand,
} from "@langwatch/evaluation-contract";
import {
  EvaluationCostRecorderPort,
  EvaluationExecutionReceiptPort,
} from "@langwatch/evaluation-server";
import { type IdempotencyReceiptPersistence, withIdempotency } from "~/server/api/idempotency";
import { z } from "zod";

const evaluationReceiptSchema = z.object({
  result: evaluationExecutionResultSchema,
  costId: z.string().nullable(),
});

/**
 * App-owned durable receipt boundary for Evaluation's external work. The
 * receipt is committed only after the evaluator result and its cost row are
 * both known, so a queue redelivery reuses that outcome. The evaluator call
 * remains at-least-once if a process dies after the provider accepts it but
 * before this receipt is finalized; the operation key is forwarded where the
 * evaluator transport accepts an idempotency header.
 */
export class AppEvaluationExecutionReceiptPort extends EvaluationExecutionReceiptPort {
  static create(input: {
    prisma: IdempotencyReceiptPersistence;
    evaluations: EvaluationService;
    costs: EvaluationCostRecorderPort;
  }): AppEvaluationExecutionReceiptPort {
    return new AppEvaluationExecutionReceiptPort(input);
  }

  private constructor(
    private readonly deps: {
      prisma: IdempotencyReceiptPersistence;
      evaluations: EvaluationService;
      costs: EvaluationCostRecorderPort;
    },
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
  }): Promise<{
    result: EvaluationExecutionResult;
    costId: string | null;
  }> {
    const outcome = await withIdempotency({
      prisma: this.deps.prisma,
      operation: "evaluation.execution",
      scopeId: input.tenantId,
      key: `evaluation:${input.evaluationId}:execution`,
      validatedBody: { evaluationId: input.evaluationId },
      handler: async () => {
        const result = await this.deps.evaluations.executeForTrace(input.command);
        const costId = await this.recordCost(result, input);
        return { status: 200, body: { result, costId } };
      },
    });

    const body = outcome.isReplayed ? JSON.parse(outcome.serializedBody) : outcome.body;
    return evaluationReceiptSchema.parse(body);
  }

  private async recordCost(
    result: z.infer<typeof evaluationExecutionResultSchema>,
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
  ): Promise<string | null> {
    if (result.status !== "processed" || !result.cost) return null;

    return this.deps.costs.recordCost({
      projectId: input.tenantId,
      isGuardrail: input.cost.isGuardrail,
      evaluatorName: input.cost.evaluatorName,
      evaluatorId: input.cost.evaluatorId,
      traceId: input.cost.traceId,
      idempotencyKey: `${input.operationKey}:cost`,
      amount: result.cost.amount,
      currency: result.cost.currency,
    });
  }
}
