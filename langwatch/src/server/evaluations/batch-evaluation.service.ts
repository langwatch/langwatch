import type { PrismaClient } from "@prisma/client";
import { BatchEvaluationRepository } from "./batch-evaluation.repository";

/**
 * Service for the legacy Postgres `BatchEvaluation` model. Currently only
 * exposes recent-runs lookups; expand as more callers move off direct
 * `prisma.batchEvaluation.*` access.
 *
 * See `batch-evaluation.repository.ts` for the v3 stack distinction.
 */
export class BatchEvaluationService {
  constructor(private readonly repository: BatchEvaluationRepository) {}

  static create(prisma: PrismaClient): BatchEvaluationService {
    return new BatchEvaluationService(new BatchEvaluationRepository(prisma));
  }

  async getRecentByExperiment(params: {
    projectId: string;
    experimentId?: string;
    limit: number;
  }) {
    return await this.repository.findRecentByExperiment(params);
  }
}
