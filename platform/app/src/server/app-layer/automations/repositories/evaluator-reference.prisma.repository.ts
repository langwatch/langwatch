import type { PrismaClient } from "~/generated/prisma/client";
import type {
  EvaluatorReference,
  EvaluatorReferenceRepository,
} from "./evaluator-reference.repository";

export class PrismaEvaluatorReferenceRepository
  implements EvaluatorReferenceRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findAllByIds({
    projectId,
    ids,
  }: {
    projectId: string;
    ids: string[];
  }): Promise<EvaluatorReference[]> {
    const rows = await this.prisma.evaluator.findMany({
      where: { projectId, id: { in: ids } },
      select: {
        id: true,
        monitors: {
          where: { projectId },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return rows.map((row) => ({
      evaluatorId: row.id,
      monitorIds: row.monitors.map((monitor) => monitor.id),
    }));
  }
}
