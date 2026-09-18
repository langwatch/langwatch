import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaShareGrantRepository } from "./prisma.share-grant.repository.ts";
import { PrismaShareRepository } from "./prisma.share.repository.ts";

export const PostgresShareRepositories = prismaRepositories({
  shares: PrismaShareRepository,
  grants: PrismaShareGrantRepository,
});
