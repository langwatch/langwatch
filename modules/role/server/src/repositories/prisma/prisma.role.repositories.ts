import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaRoleRepository } from "./prisma.role.repository.ts";

export const PostgresRoleRepositories = prismaRepositories({
  roles: PrismaRoleRepository,
});
