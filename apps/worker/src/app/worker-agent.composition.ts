import { TraceApi } from "@langwatch/trace-contract";
import { AgentApi } from "@langwatch/agent-contract";
import { agentServer, type AgentAppConfig } from "@langwatch/agent-server";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { createApp, membersFrom, withMemoryRepositories } from "@langwatch/runtime-composition";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { UserApi } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";

/** The one process member the agent App reads (`AgentApp.reads = reads("redis")`). */
export type AgentInfrastructure = Readonly<{ redis: RedisConnection }>;

export async function installWorkerAgent(options: {
  connection: PrismaConnection;
  infrastructure: AgentInfrastructure;
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
    role: "api",
    config: { agent: options.config },
    members: membersFrom(options.infrastructure),
  })
    .withProvided(ApiKeyApi, peers.apiKeys)
    .withProvided(AuditLogApi, peers.auditLog)
    .withProvided(AuthzApi, peers.permissions)
    .withProvided(ProjectApi, peers.projects)
    .withProvided(ScenarioApi, peers.scenarios)
    .withProvided(TraceApi, peers.traces)
    .withProvided(UserApi, peers.users)
    .withProvided(WorkflowApi, peers.workflows)
    .withModules([withMemoryRepositories(agentServer)])
    .boot();
  return { agents: runtime.service(AgentApi), runtime };
}
