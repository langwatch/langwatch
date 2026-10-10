import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaUserCredentialRepository } from "./prisma.user-signin-credential.repository.ts";
import { PrismaUserRepository } from "./prisma.user.repository.ts";

export const PostgresUserRepositories = prismaRepositories({
  users: PrismaUserRepository,
  credentials: PrismaUserCredentialRepository,
});
