import { prismaRepositories } from "@langwatch/prisma-client";

import { PrismaAuditLogRepository } from "./prisma.audit-log.repository.ts";
import { PrismaRecentTouchRepository } from "./prisma.recent-touch.repository.ts";

export const PostgresAuditLogRepositories = prismaRepositories({
  entries: PrismaAuditLogRepository,
  recentTouches: PrismaRecentTouchRepository,
});
