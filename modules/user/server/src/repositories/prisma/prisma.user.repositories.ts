import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaUserRepository } from "./prisma.user.repository.ts";
import { PrismaUserCredentialRepository } from "./prisma.user-signin-credential.repository.ts";

export const PostgresUserRepositories = prismaRepositories({
  users: PrismaUserRepository,
  credentials: PrismaUserCredentialRepository,
});
