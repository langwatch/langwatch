import { TraceApi } from "@langwatch/trace-contract";
import { agentServer, type AgentAppConfig } from "@langwatch/agent-server";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp, membersFrom } from "@langwatch/runtime-composition";
import type { RedisConnection } from "@langwatch/redis-client";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { UserApi } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";

export async function installWorkerAgent(options: {
  connection: PrismaConnection;
  redis: RedisConnection;
  config: AgentAppConfig;
  peers: {
    apiKeys: ApiKeyApi;
    auditLog: AuditLogApi;
    permissions: AuthzApi;
    projects: ProjectApi;
    scenarios: ScenarioApi;
    traces: TraceApi;
    users: UserApi;
    workflows: WorkflowApi;
  };
}) {
  const { peers } = options;
  const runtime = await createApp({
    role: "worker",
    config: { agent: options.config },
    members: membersFrom({
      prisma: options.connection.client,
      redis: options.redis,
    }),
  })
    .withProvided(ApiKeyApi, peers.apiKeys)
    .withProvided(AuditLogApi, peers.auditLog)
    .withProvided(AuthzApi, peers.permissions)
    .withProvided(ProjectApi, peers.projects)
    .withProvided(ScenarioApi, peers.scenarios)
    .withProvided(TraceApi, peers.traces)
    .withProvided(UserApi, peers.users)
    .withProvided(WorkflowApi, peers.workflows)
    .withModules([agentServer])
    .boot();
  return { agents: runtime.module(agentServer).provided, runtime };
}
