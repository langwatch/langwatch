import { generate } from "@langwatch/ksuid";
import { CostReferenceType, CostType, type PrismaClient } from "@prisma/client";
import { KSUID_RESOURCES } from "../../../utils/constants";

/**
 * Interface for recording evaluation costs.
 * Consumers (command handlers) depend on this interface; the Prisma
 * implementation lives alongside it in the app-layer.
 */
export interface EvaluationCostRecorder {
  recordCost(params: {
    projectId: string;
    isGuardrail: boolean;
    evaluatorName: string;
    evaluatorId: string;
    traceId: string;
    amount: number;
    currency: string;
  }): Promise<string>;
}

/**
 * Records evaluation costs in the database via Prisma.
 */
export class PrismaEvaluationCostRecorder implements EvaluationCostRecorder {
  constructor(private readonly prisma: PrismaClient) {}

  async recordCost(params: {
    projectId: string;
    isGuardrail: boolean;
    evaluatorName: string;
    evaluatorId: string;
    traceId: string;
    amount: number;
    currency: string;
  }): Promise<string> {
    const costId = generate(KSUID_RESOURCES.COST).toString();
    await this.prisma.cost.create({
      data: {
        id: costId,
        projectId: params.projectId,
        costType: params.isGuardrail ? CostType.GUARDRAIL : CostType.TRACE_CHECK,
        costName: params.evaluatorName,
        referenceType: CostReferenceType.CHECK,
        referenceId: params.evaluatorId,
        amount: params.amount,
        currency: params.currency,
        extraInfo: { trace_id: params.traceId },
      },
    });
    return costId;
  }
}
