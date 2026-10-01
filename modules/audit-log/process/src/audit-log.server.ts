import { defineServerModule } from "@langwatch/process";

import { AuditLogApp } from "./app/audit-log.app.ts";
import { auditLogRepositories } from "./repositories/audit-log-repositories.registry.ts";
import { AgentAuditLogIdsService } from "./services/agent-audit-log-ids.service.ts";
import { AgentAuditLogIdsTask } from "./tasks/agent-audit-log-ids.task.ts";
import { homeTrpcTransport } from "./transport/home.trpc.ts";

export const auditLogServer = defineServerModule("audit-log")
  .withRepositories(auditLogRepositories)
  .withApp(AuditLogApp)
  .withTransports(homeTrpcTransport)
  .withTasks(({ repositories, dependencies }) => [
    AgentAuditLogIdsTask.create({
      repair: () =>
        AgentAuditLogIdsService.create({
          logs: repositories.agentAuditLogIds,
          agents: dependencies.agents,
        }),
    }),
  ]);
