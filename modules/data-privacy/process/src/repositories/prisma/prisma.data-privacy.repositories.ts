import { prismaRepositories } from "@langwatch/prisma-client";

import type { DataPrivacyRepositories } from "../data-privacy.repositories.ts";
import { PrismaDataPrivacyDirectoryRepository } from "./prisma.data-privacy-directory.repository.ts";
import { PrismaDataPrivacyProjectScopeRepository } from "./prisma.data-privacy-project-scope.repository.ts";
import { PrismaDataPrivacyPolicyRepository } from "./prisma.data-privacy.repository.ts";

const policyRepositories = prismaRepositories({
  policies: PrismaDataPrivacyPolicyRepository,
});

/**
 * The policy rows data-privacy owns, plus the directory and project placement it reads over the
 * same Prisma store: neither claims a table (Alex, 2026-09-28; placement through shares, R40).
 */
export const PostgresDataPrivacyRepositories = {
  ...policyRepositories,
  create: (input: Parameters<typeof policyRepositories.create>[0]): DataPrivacyRepositories => ({
    ...policyRepositories.create(input),
    directory: PrismaDataPrivacyDirectoryRepository.create(input.prisma),
    projectScopes: PrismaDataPrivacyProjectScopeRepository.create(input.prisma),
  }),
};
