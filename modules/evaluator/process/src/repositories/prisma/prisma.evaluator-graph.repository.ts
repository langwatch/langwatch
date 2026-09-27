import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { EvaluatorMonitorRows } from "../../services/evaluator-linked-rows.service.ts";

/**
 * The monitor rows an evaluator's cascade reads and removes. Monitor owns the
 * table and depends on evaluator, so a peer call back would be a boot cycle.
 */
export class EvaluatorGraphAdapter implements EvaluatorMonitorRows {
  static create(options: { prisma: PrismaClient }): EvaluatorGraphAdapter {
    return new EvaluatorGraphAdapter(options.prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {}

  findMonitorsUsingEvaluator(
    input: Readonly<{ evaluatorId: string; projectId: string }>,
  ): Promise<{ id: string; name: string }[]> {
    return this.prisma.monitor.findMany({
      where: { evaluatorId: input.evaluatorId, projectId: input.projectId },
      select: { id: true, name: true },
    });
  }

  deleteMonitorsUsingEvaluator(
    input: Readonly<{ evaluatorId: string; projectId: string }>,
  ): Promise<{ count: number }> {
    return this.prisma.monitor.deleteMany({
      where: { evaluatorId: input.evaluatorId, projectId: input.projectId },
    });
  }
}
