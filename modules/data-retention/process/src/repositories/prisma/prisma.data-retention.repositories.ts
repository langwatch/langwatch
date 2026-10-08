import { prismaRepositories } from "@langwatch/prisma-client";

import type { DataRetentionRepositories } from "../data-retention.repositories.ts";
import { PrismaDataRetentionDirectoryRepository } from "./prisma.data-retention-directory.repository.ts";
import { PrismaDataRetentionProjectScopeRepository } from "./prisma.data-retention-project-scope.repository.ts";
import { PrismaDataRetentionRepository } from "./prisma.data-retention.repository.ts";
import { PrismaPinnedTraceRepository } from "./prisma.pinned-trace.repository.ts";

const ownedRepositories = prismaRepositories({
  policies: PrismaDataRetentionRepository,
  pins: PrismaPinnedTraceRepository,
});

/**
 * The rows data-retention owns, plus the directory and project placement it reads over the same
 * Prisma store: neither claims a table (record §6, Alex 2026-09-28; placement through shares, R40).
 */
export const PostgresDataRetentionRepositories = {
  ...ownedRepositories,
  create: (
    input: Parameters<typeof ownedRepositories.create>[0],
  ): Pick<DataRetentionRepositories, "policies" | "pins" | "projectScopes" | "directory"> => ({
    ...ownedRepositories.create(input),
    directory: PrismaDataRetentionDirectoryRepository.create(input.prisma),
    projectScopes: PrismaDataRetentionProjectScopeRepository.create(input.prisma),
  }),
};
