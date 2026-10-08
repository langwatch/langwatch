import { prismaRepositories } from "@langwatch/prisma-client";

import type { InstantEvalJudgeRepositories } from "../instant-eval-judge.repositories.ts";
import { PrismaInstantEvalJudgeProjectRepository } from "./prisma.instant-eval-judge-placement.repository.ts";
import { PrismaInstantEvalJudgeSpendRepository } from "./prisma.instant-eval-judge-spend.repository.ts";
import { PrismaInstantEvalJudgeUsageBillingRepository } from "./prisma.instant-eval-judge-usage-billing.repository.ts";

const ownedRepositories = prismaRepositories({
  usageBilling: PrismaInstantEvalJudgeUsageBillingRepository,
  spend: PrismaInstantEvalJudgeSpendRepository,
});

/**
 * The judge's two tables (ADR-174 Schema), plus its placement read through shares (R40),
 * which claims no table.
 */
export const PostgresInstantEvalJudgeRepositories = {
  ...ownedRepositories,
  create: (
    input: Parameters<typeof ownedRepositories.create>[0],
  ): Omit<InstantEvalJudgeRepositories, "rateLimits"> => ({
    ...ownedRepositories.create(input),
    projects: PrismaInstantEvalJudgeProjectRepository.create(input),
  }),
};
