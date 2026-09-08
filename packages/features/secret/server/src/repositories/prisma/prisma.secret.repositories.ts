import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaSecretRepository } from "./prisma.secret.repository.ts";

export const PostgresSecretRepositories = prismaRepositories({
  secrets: PrismaSecretRepository,
});
