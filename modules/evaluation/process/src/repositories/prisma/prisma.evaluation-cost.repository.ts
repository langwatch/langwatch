import { PrismaRepository } from "@langwatch/prisma-client";
import { isUniqueConstraintError } from "@langwatch/prisma-client/errors";

import {
  EvaluationCostAlreadyRecordedError,
  type EvaluationCostReference,
  type EvaluationCostRepository,
  type EvaluationCostRow,
} from "../evaluation-cost.repository.ts";

const costIdSelect = { id: true } as const;

export class PrismaEvaluationCostRepository
  extends PrismaRepository.for("Cost")
  implements EvaluationCostRepository
{
  static readonly create = this.factory((prisma) => new PrismaEvaluationCostRepository(prisma));

  async create(input: EvaluationCostRow): Promise<void> {
    try {
      await this.prisma.cost.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          // Spelled rather than imported: a value import of the generated enum
          // puts the Prisma client's own module on this package's graph.
          costType: input.isGuardrail ? "GUARDRAIL" : "TRACE_CHECK",
          costName: input.evaluatorName,
          referenceType: "CHECK",
          referenceId: input.evaluatorId,
          amount: input.amount,
          currency: input.currency,
          extraInfo: { trace_id: input.traceId },
        },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;

      throw new EvaluationCostAlreadyRecordedError(input.id);
    }
  }

  async findById(input: {
    id: string;
    projectId: string;
  }): Promise<EvaluationCostReference | undefined> {
    const row = await this.prisma.cost.findFirst({
      where: { id: input.id, projectId: input.projectId },
      select: costIdSelect,
    });

    return row ?? undefined;
  }
}
