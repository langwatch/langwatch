import { prismaRepositories } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { InstantEvalJudgeRepositories } from "../instant-eval-judge.repositories.ts";
import { PrismaInstantEvalJudgeProjectRepository } from "./prisma.instant-eval-judge-placement.repository.ts";
import { PrismaInstantEvalJudgeSpendRepository } from "./prisma.instant-eval-judge-spend.repository.ts";
import { PrismaInstantEvalJudgeUsageBillingRepository } from "./prisma.instant-eval-judge-usage-billing.repository.ts";

/** The judge's two tables (ADR-174 Schema): the only ones it claims. */
const ownedRepositories = prismaRepositories({
  usageBilling: PrismaInstantEvalJudgeUsageBillingRepository,
  spend: PrismaInstantEvalJudgeSpendRepository,
});

/** The judge's own tables, and its placement read through shares without a claim (R40). */
export class PostgresInstantEvalJudgeRepositories {
  static readonly requires = ownedRepositories.requires;
  static readonly repositories = ownedRepositories.repositories;

  static create({
    prisma,
  }: Readonly<{ prisma: PrismaClient }>): Omit<InstantEvalJudgeRepositories, "rateLimits"> {
    return {
      ...ownedRepositories.create({ prisma }),
      projects: PrismaInstantEvalJudgeProjectRepository.create({ prisma }),
    };
  }
}
