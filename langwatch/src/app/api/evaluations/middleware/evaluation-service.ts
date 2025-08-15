import { type Context, type Next } from "hono";
import { EvaluationService } from "~/server/evaluations/evaluation.service";
import { BatchEvaluationService } from "~/server/evaluations/batch-evaluation.service";
import { PrismaEvaluationRepository } from "~/server/evaluations/repositories/evaluation.repository";
import { ElasticsearchBatchEvaluationRepository } from "~/server/evaluations/repositories/batch-evaluation.repository";
import { PrismaExperimentRepository } from "~/server/evaluations/repositories/experiment.repository";

export interface EvaluationServiceMiddlewareVariables {
  evaluationService: EvaluationService;
  batchEvaluationService: BatchEvaluationService;
}

export const evaluationServiceMiddleware = async (
  c: Context<{ Variables: EvaluationServiceMiddlewareVariables }>,
  next: Next
) => {
  // Create repositories
  const evaluationRepository = new PrismaEvaluationRepository();
  const experimentRepository = new PrismaExperimentRepository();
  const batchEvaluationRepository = new ElasticsearchBatchEvaluationRepository(experimentRepository);

  // Create services
  const evaluationService = new EvaluationService(evaluationRepository);
  const batchEvaluationService = new BatchEvaluationService(batchEvaluationRepository);

  // Set in context
  c.set("evaluationService", evaluationService);
  c.set("batchEvaluationService", batchEvaluationService);

  await next();
};
