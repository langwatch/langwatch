import type { BatchEvaluation, PrismaClient } from "@prisma/client";

/**
 * Repository for the legacy Postgres `BatchEvaluation` model.
 *
 * NOTE: this is the pre-evaluations-v3 batch-evaluation row stored in
 * Postgres alongside `Experiment`. The v3 stack persists run records to
 * Elasticsearch / ClickHouse via separate repositories; do not confuse
 * the two.
 */
export class BatchEvaluationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findRecentByExperiment(input: {
    projectId: string;
    experimentId?: string;
    limit: number;
  }): Promise<
    Array<
      Pick<
        BatchEvaluation,
        | "id"
        | "experimentId"
        | "createdAt"
        | "status"
        | "score"
        | "passed"
        | "evaluation"
      >
    >
  > {
    return await this.prisma.batchEvaluation.findMany({
      where: {
        projectId: input.projectId,
        ...(input.experimentId ? { experimentId: input.experimentId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
      select: {
        id: true,
        experimentId: true,
        createdAt: true,
        status: true,
        score: true,
        passed: true,
        evaluation: true,
      },
    });
  }
}
