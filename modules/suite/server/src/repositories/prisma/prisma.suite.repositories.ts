import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SuiteRepositories } from "../suite.repositories.ts";
import { PrismaSuiteRepository } from "./prisma.suite.repository.ts";

/**
 * The Postgres backend. It takes the process's own client and hands the
 * repository the four members it names — the two tables a run plan is
 * resolved over, plus the transaction and the raw statement its two locks
 * are taken with.
 */
export const PostgresSuiteRepositories = {
  requires: ["prisma"] as const,

  create({ prisma }: Readonly<{ prisma: PrismaClient }>): SuiteRepositories {
    return { suites: PrismaSuiteRepository.create(prisma) };
  },
};
