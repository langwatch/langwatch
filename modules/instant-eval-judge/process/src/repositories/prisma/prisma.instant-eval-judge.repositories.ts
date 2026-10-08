import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaInstantEvalJudgeProjectRepository } from "./prisma.instant-eval-judge-placement.repository.ts";
import { PrismaInstantEvalJudgeSpendRepository } from "./prisma.instant-eval-judge-spend.repository.ts";
import { PrismaInstantEvalJudgeUsageBillingRepository } from "./prisma.instant-eval-judge-usage-billing.repository.ts";

/** The judge's two tables (ADR-174 Schema) and its placement read through shares (R40). */
export const PostgresInstantEvalJudgeRepositories = prismaRepositories({
  projects: PrismaInstantEvalJudgeProjectRepository,
  usageBilling: PrismaInstantEvalJudgeUsageBillingRepository,
  spend: PrismaInstantEvalJudgeSpendRepository,
});
