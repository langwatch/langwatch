import { defineModule } from "@langwatch/runtime-composition";
import { AuditLogApp } from "./app/audit-log.app.ts";
import { auditLogRepositories } from "./repositories/audit-log-repositories.registry.ts";

export const auditLogServer = defineModule("audit-log")
  .withRepositories(auditLogRepositories)
  .withApp(AuditLogApp)
  .build();
