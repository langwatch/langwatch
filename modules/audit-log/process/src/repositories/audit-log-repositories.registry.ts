import { defineRepositories } from "@langwatch/kernel";

import { MemoryAuditLogRepositories } from "./memory/memory.audit-log.repositories.ts";
import { PostgresAuditLogRepositories } from "./prisma/prisma.audit-log.repositories.ts";

export const auditLogRepositories = defineRepositories({
  live: PostgresAuditLogRepositories,
  memory: MemoryAuditLogRepositories,
});
