import { defineRepositories } from "@langwatch/process";

import { MemoryAuditLogRepositories } from "./memory/memory.audit-log.repositories.ts";
import { PostgresAuditLogRepositories } from "./prisma/prisma.audit-log.repositories.ts";

export const auditLogRepositories = defineRepositories({
  live: PostgresAuditLogRepositories,
  memory: MemoryAuditLogRepositories,
});
