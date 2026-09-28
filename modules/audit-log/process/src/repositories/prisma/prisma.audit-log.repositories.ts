import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaAgentAuditLogMigrationRepository } from "./prisma.agent-audit-log-migration.repository.ts";
import { PrismaAuditLogRepository } from "./prisma.audit-log.repository.ts";
import { PrismaRecentTouchRepository } from "./prisma.recent-touch.repository.ts";

export const PostgresAuditLogRepositories = prismaRepositories({
  entries: PrismaAuditLogRepository,
  recentTouches: PrismaRecentTouchRepository,
  agentAuditLogIds: PrismaAgentAuditLogMigrationRepository,
});
