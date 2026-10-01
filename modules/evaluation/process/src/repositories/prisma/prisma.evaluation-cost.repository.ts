import type { EvaluationCostRecord } from "@langwatch/evaluation-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import { isUniqueConstraintError } from "@langwatch/prisma-client/errors";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { z } from "zod";

import {
  EvaluationCostAlreadyRecordedError,
  type EvaluationCostReference,
  type EvaluationCostRepository,
  type EvaluationCostRow,
} from "../evaluation-cost.repository.ts";

const costIdSelect = { id: true } as const;

const prismaJsonInputSchema = z.custom<Prisma.InputJsonValue>((value) => value !== null);

function jsonInput(value: Record<string, unknown>): Prisma.InputJsonValue {
  return prismaJsonInputSchema.parse(z.json().parse(value));
}

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

  async createEntry(input: EvaluationCostRecord): Promise<void> {
    await this.prisma.cost.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        costType: input.costType,
        costName: input.costName,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        amount: input.amount,
        currency: input.currency,
        extraInfo: input.extraInfo === undefined ? undefined : jsonInput(input.extraInfo),
      },
    });
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
