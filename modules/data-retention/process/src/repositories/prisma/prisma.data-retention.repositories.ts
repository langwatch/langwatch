import { prismaRepositories } from "@langwatch/prisma-client";

import type { DataRetentionRepositories } from "../data-retention.repositories.ts";
import { PrismaDataRetentionDirectoryRepository } from "./prisma.data-retention-directory.repository.ts";
import { PrismaDataRetentionRepository } from "./prisma.data-retention.repository.ts";
import { PrismaPinnedTraceRepository } from "./prisma.pinned-trace.repository.ts";

const ownedRepositories = prismaRepositories({
  policies: PrismaDataRetentionRepository,
  pins: PrismaPinnedTraceRepository,
});

/**
 * The rows data-retention owns, plus the directory it reads over the same Prisma store: the
 * directory claims no tables, as data-privacy's does (record §6, Alex 2026-09-28).
 */
export const PostgresDataRetentionRepositories = {
  ...ownedRepositories,
  create: (
    input: Parameters<typeof ownedRepositories.create>[0],
  ): Pick<DataRetentionRepositories, "policies" | "pins" | "directory"> => ({
    ...ownedRepositories.create(input),
    directory: PrismaDataRetentionDirectoryRepository.create(input.prisma),
  }),
};
