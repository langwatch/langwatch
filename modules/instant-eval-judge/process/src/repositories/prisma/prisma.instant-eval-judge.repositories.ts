import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaInstantEvalJudgeProjectRepository } from "./prisma.instant-eval-judge-project.repository.ts";
import { PrismaInstantEvalJudgeSpendRepository } from "./prisma.instant-eval-judge-spend.repository.ts";
import { PrismaInstantEvalJudgeUsageBillingRepository } from "./prisma.instant-eval-judge-usage-billing.repository.ts";

/** The three tables the judge owns (ADR-174 Schema), each claimed by one repository. */
export const PostgresInstantEvalJudgeRepositories = prismaRepositories({
  projects: PrismaInstantEvalJudgeProjectRepository,
  usageBilling: PrismaInstantEvalJudgeUsageBillingRepository,
  spend: PrismaInstantEvalJudgeSpendRepository,
});
