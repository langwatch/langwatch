import { TraceApi } from "@langwatch/trace-contract";
import { AgentApi } from "@langwatch/agent-contract";
import {
  agentServer,
  type AgentAppConfig,
  type AgentInfrastructure,
} from "@langwatch/agent-server";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { ScenarioApi } from "@langwatch/scenario-contract";
import { UserApi } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";

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
  const runtime = await createApp({ name: "langwatch-worker-agent" })
    .withPersistence("postgres", { prisma: options.connection.client })
    .withInfrastructure(options.infrastructure)
    .withProvided(ApiKeyApi, peers.apiKeys)
    .withProvided(AuditLogApi, peers.auditLog)
    .withProvided(AuthzApi, peers.permissions)
    .withProvided(ProjectApi, peers.projects)
    .withProvided(ScenarioApi, peers.scenarios)
    .withProvided(TraceApi, peers.traces)
    .withProvided(UserApi, peers.users)
    .withProvided(WorkflowApi, peers.workflows)
    .withFeature(agentServer)
    .boot({ role: "worker", config: { agent: options.config } });
  return { agents: runtime.service(AgentApi), runtime };
}
