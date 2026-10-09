/**
 * Where the filter-validation service meets Prisma, so the service depends only
 * on its repository interface. Callers that hold a `PrismaClient` import this.
 */
import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaEvaluatorReferenceRepository } from "./repositories/evaluator-reference.prisma.repository";
import { TriggerFilterValidationService } from "./trigger-filter-validation.service";

export function createTriggerFilterValidationService({
  prisma,
}: {
  prisma: PrismaClient;
}): TriggerFilterValidationService {
  return new TriggerFilterValidationService(
    new PrismaEvaluatorReferenceRepository(prisma),
  );
}
