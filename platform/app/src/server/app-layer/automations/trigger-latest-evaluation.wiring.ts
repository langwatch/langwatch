import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaTriggerLatestEvaluationRepository } from "./repositories/trigger-latest-evaluation.prisma.repository";
import { TriggerLatestEvaluationService } from "./trigger-latest-evaluation.service";

/**
 * Composition seam: the service depends on the repository INTERFACE only, so
 * choosing the Prisma implementation happens here, not inside the service.
 */
export function createTriggerLatestEvaluationService(
  prisma: PrismaClient,
): TriggerLatestEvaluationService {
  return new TriggerLatestEvaluationService(
    new PrismaTriggerLatestEvaluationRepository(prisma),
  );
}
