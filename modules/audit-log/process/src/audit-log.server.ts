import { defineServerModule } from "@langwatch/kernel";

import { AuditLogApp } from "./app/audit-log.app.ts";
import { auditLogRepositories } from "./repositories/audit-log-repositories.registry.ts";
import { homeTrpcTransport } from "./transport/home.trpc.ts";

export const auditLogServer = defineServerModule("audit-log")
  .withRepositories(auditLogRepositories)
  .withApp(AuditLogApp)
  .withTransports(homeTrpcTransport);
