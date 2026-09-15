import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaMonitorRepository } from "./prisma.monitor.repository.ts";

export const PostgresMonitorRepositories = prismaRepositories({
  monitors: PrismaMonitorRepository,
});
