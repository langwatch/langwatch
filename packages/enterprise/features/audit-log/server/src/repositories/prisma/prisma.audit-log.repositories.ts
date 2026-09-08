import { prismaRepositories } from "@langwatch/prisma-client";
import { PrismaAuditLogRepository } from "./prisma.audit-log.repository.ts";

export const PostgresAuditLogRepositories = prismaRepositories({
  entries: PrismaAuditLogRepository,
});
