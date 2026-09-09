import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaDataRetentionRepository } from "./prisma.data-retention.repository.ts";
import { PrismaPinnedTraceRepository } from "./prisma.pinned-trace.repository.ts";

export const PostgresDataRetentionRepositories = prismaRepositories({
  policies: PrismaDataRetentionRepository,
  pins: PrismaPinnedTraceRepository,
});
