import { prismaRepositories } from "@langwatch/prisma-client";

import type { DataPrivacyRepositories } from "../data-privacy.repositories.ts";
import { PrismaDataPrivacyDirectoryRepository } from "./prisma.data-privacy-directory.repository.ts";
import { PrismaDataPrivacyPolicyRepository } from "./prisma.data-privacy.repository.ts";

const policyRepositories = prismaRepositories({
  policies: PrismaDataPrivacyPolicyRepository,
});

/**
 * The policy rows data-privacy owns, plus the directory it reads over the same Prisma store: the
 * directory claims no tables, as it did when the process built it (Alex, 2026-09-28).
 */
export const PostgresDataPrivacyRepositories = {
  ...policyRepositories,
  create: (input: Parameters<typeof policyRepositories.create>[0]): DataPrivacyRepositories => ({
    ...policyRepositories.create(input),
    directory: PrismaDataPrivacyDirectoryRepository.create(input.prisma),
  }),
};
