import type { DatasetUsageCount } from "@langwatch/dataset-contract";
import { PrismaRepository } from "@langwatch/prisma-client";

import type { DatasetCountRepository } from "../dataset-count.repository.ts";

/** Project-scoped reads; the caller never passes an empty project list. */
export class PrismaDatasetCountRepository
  extends PrismaRepository.for("Dataset", "DatasetRecord", "BatchEvaluation")
  implements DatasetCountRepository
{
  static readonly create = this.factory((prisma) => new PrismaDatasetCountRepository(prisma));

  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<DatasetUsageCount> {
    const scope = { projectId: { in: [...projectIds] } };
    const where = since === undefined ? scope : { ...scope, createdAt: { gte: new Date(since) } };
    const first = {
      where: scope,
      orderBy: { createdAt: "asc" as const },
      select: { createdAt: true },
    };
    const [datasets, datasetRecords, batchEvaluations, firstDataset, firstBatchEvaluation] =
      await Promise.all([
        this.prisma.dataset.count({ where }),
        this.prisma.datasetRecord.count({ where }),
        this.prisma.batchEvaluation.count({ where }),
        this.prisma.dataset.findFirst(first),
        this.prisma.batchEvaluation.findFirst(first),
      ]);
    return {
      datasets,
      datasetRecords,
      batchEvaluations,
      ...(firstDataset ? { firstDatasetAt: firstDataset.createdAt.getTime() } : {}),
      ...(firstBatchEvaluation
        ? { firstBatchEvaluationAt: firstBatchEvaluation.createdAt.getTime() }
        : {}),
    };
  }
}
