import type {
  BatchEvaluationRecord,
  BatchEvaluationSummary,
} from "@langwatch/dataset-contract";
import { PrismaRepository } from "@langwatch/prisma-client";

import type { BatchEvaluationRepository } from "../batch-evaluation.repository.ts";

export class PrismaBatchEvaluationRepository
  extends PrismaRepository.for("BatchEvaluation")
  implements BatchEvaluationRepository
{
  static readonly create = this.factory((prisma) => new PrismaBatchEvaluationRepository(prisma));

  async summariseByExperiment(input: { projectId: string }): Promise<BatchEvaluationSummary[]> {
    const grouped = await this.prisma.batchEvaluation.groupBy({
      by: ["experimentId", "datasetSlug"] as const,
      where: { projectId: input.projectId },
      _count: { experimentId: true },
      _sum: { cost: true },
      _avg: { score: true },
    });

    return grouped.map((row) => ({
      experimentId: row.experimentId,
      datasetSlug: row.datasetSlug,
      _count: { experimentId: row._count.experimentId },
      _sum: { cost: row._sum.cost },
      _avg: { score: row._avg.score },
    }));
  }

  async findAllByExperiment(input: {
    projectId: string;
    experimentId: string;
  }): Promise<BatchEvaluationRecord[]> {
    return await this.prisma.batchEvaluation.findMany({
      where: { projectId: input.projectId, experimentId: input.experimentId },
      include: { dataset: true },
    });
  }
}
