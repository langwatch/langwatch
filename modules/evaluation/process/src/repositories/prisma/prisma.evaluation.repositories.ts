import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaEvaluationCostRepository } from "./prisma.evaluation-cost.repository.ts";

export const PostgresEvaluationRepositories = prismaRepositories({
  costs: PrismaEvaluationCostRepository,
});
