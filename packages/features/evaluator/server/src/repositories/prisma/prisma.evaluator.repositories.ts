import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaEvaluatorRepository } from "./prisma.evaluator.repository.ts";

export const PostgresEvaluatorRepositories = prismaRepositories({
  evaluators: PrismaEvaluatorRepository,
});
