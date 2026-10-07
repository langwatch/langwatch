import { defineProcessModule } from "@langwatch/process";

import { AuditLogModule } from "./app/audit-log.app.ts";
import { auditLogEventing } from "./eventing/audit-log.pipeline.ts";
import { auditLogRepositories } from "./repositories/audit-log-repositories.registry.ts";
import { AgentAuditLogIdsService } from "./services/agent-audit-log-ids.service.ts";
import { AgentAuditLogIdsTask } from "./tasks/agent-audit-log-ids.task.ts";
import { homeTrpcTransport } from "./transport/home.trpc.ts";

export const auditLogProcessModule = defineProcessModule("audit-log")
  .withRepositories(auditLogRepositories)
  .withApi(AuditLogModule)
  .withTransports(homeTrpcTransport)
  .withEventing(auditLogEventing)
  .withTasks(({ repositories, dependencies }) => [
    AgentAuditLogIdsTask.create({
      repair: () =>
        AgentAuditLogIdsService.create({
          logs: repositories.agentAuditLogIds,
          agents: dependencies.agents,
        }),
    }),
  ]);
