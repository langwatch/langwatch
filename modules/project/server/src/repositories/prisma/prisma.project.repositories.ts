import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaProjectRepository } from "./prisma.project.repository.ts";

export const PostgresProjectRepositories = prismaRepositories({
  projects: PrismaProjectRepository,
});
