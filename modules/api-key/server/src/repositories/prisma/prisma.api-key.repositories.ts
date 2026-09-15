import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaApiKeyRepository } from "./prisma.api-key.repository.ts";

/**
 * The API-key aggregate over Postgres. It claims the one table the repository
 * reads: the key rows. Team and project ownership belongs to the Project
 * module, and this module asks its API for it.
 */
export const PostgresApiKeyRepositories = prismaRepositories({
  apiKeys: PrismaApiKeyRepository,
});
