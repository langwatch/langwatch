import { EvaluationCostRecorderPort } from "../ports/evaluation.port";
import { CostReferenceType, CostType, Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";

export type EvaluationCostWrite = {
  id: string;
  projectId: string;
  isGuardrail: boolean;
  evaluatorName: string;
  evaluatorId: string;
  traceId: string;
  amount: number;
  currency: string;
};

/** Named persistence seam for the Cost table's create-or-reuse protocol. */
export abstract class EvaluationCostPersistence {
  abstract create(input: EvaluationCostWrite): Promise<void>;

  abstract tryGetId(input: { id: string }): Promise<string | null>;
}

class PrismaEvaluationCostPersistence extends EvaluationCostPersistence {
  static create(prisma: PrismaClient): PrismaEvaluationCostPersistence {
    return new PrismaEvaluationCostPersistence(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async create(input: EvaluationCostWrite): Promise<void> {
    await this.prisma.cost.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        costType: input.isGuardrail ? CostType.GUARDRAIL : CostType.TRACE_CHECK,
        costName: input.evaluatorName,
        referenceType: CostReferenceType.CHECK,
        referenceId: input.evaluatorId,
        amount: input.amount,
        currency: input.currency,
        extraInfo: { trace_id: input.traceId },
      },
    });
  }

  async tryGetId(input: { id: string }): Promise<string | null> {
    const existing = await this.prisma.cost.findUnique({
      where: { id: input.id },
      select: { id: true },
    });
    return existing?.id ?? null;
  }
}

/**
 * Records evaluation costs in the database via Prisma.
 */
export class PrismaEvaluationCostRecorder extends EvaluationCostRecorderPort {
  static create(prisma: PrismaClient): PrismaEvaluationCostRecorder {
    return new PrismaEvaluationCostRecorder(PrismaEvaluationCostPersistence.create(prisma));
  }

  static createWithPersistence(
    persistence: EvaluationCostPersistence,
  ): PrismaEvaluationCostRecorder {
    return new PrismaEvaluationCostRecorder(persistence);
  }

  private constructor(private readonly persistence: EvaluationCostPersistence) {
    super();
  }

  async recordCost(params: {
    projectId: string;
    isGuardrail: boolean;
    evaluatorName: string;
    evaluatorId: string;
    traceId: string;
    idempotencyKey: string;
    amount: number;
    currency: string;
  }): Promise<string> {
    const costId = `evaluation-cost:${params.idempotencyKey}`;
    try {
      await this.persistence.create({
        id: costId,
        projectId: params.projectId,
        isGuardrail: params.isGuardrail,
        evaluatorName: params.evaluatorName,
        evaluatorId: params.evaluatorId,
        traceId: params.traceId,
        amount: params.amount,
        currency: params.currency,
      });
      return costId;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      const existingCostId = await this.persistence.tryGetId({ id: costId });
      if (!existingCostId) throw error;
      return existingCostId;
    }
  }
}
