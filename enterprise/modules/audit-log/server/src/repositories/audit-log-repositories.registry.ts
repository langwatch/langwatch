import { defineRepositories } from "@langwatch/runtime-composition";
import { PostgresAuditLogRepositories } from "./prisma/prisma.audit-log.repositories.ts";
import { MemoryAuditLogRepositories } from "./memory/memory.audit-log.repositories.ts";

export const auditLogRepositories = defineRepositories({
  postgres: PostgresAuditLogRepositories,
  memory: MemoryAuditLogRepositories,
});
