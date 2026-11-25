import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { AuditLogModule } from "./app/audit-log.app.ts";
import { auditLogEventing } from "./eventing/audit-log.pipeline.ts";
import { auditLogRepositories } from "./repositories/audit-log-repositories.registry.ts";
import { homeTrpcTransport } from "./transport/home.trpc.ts";

export const auditLogProcessModule: PublishedProcessModule<"audit-log", AuditLogApi> =
  defineProcessModule("audit-log")
    .withRepositories(auditLogRepositories)
    .withApi(AuditLogModule)
    .withTransports(homeTrpcTransport)
    .withEventing(auditLogEventing);
