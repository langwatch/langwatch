import { agentSchema, type Agent, type AgentServerConfig } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { Temporal, toDate } from "@langwatch/time";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import {
  workflowSchema,
  workflowVersionSchema,
  type WorkflowApi,
} from "@langwatch/workflow-contract";

import type { AgentRepositories } from "../../repositories/agent.repositories.ts";
import { MemoryAgentRepositories } from "../../repositories/memory/memory.agent.repositories.ts";
import { AgentApp } from "../agent.app.ts";
import { memoryRedis } from "./memory-redis.ts";

type AgentAppMembers = Readonly<{ redis: RedisConnection; publicBaseUrl: string | undefined }>;

export function agentFixture(overrides: Partial<Agent> = {}): Agent {
  return agentSchema.parse({
    id: "agent_test",
    projectId: "project_test",
    name: "Test agent",
    type: "signature",
    config: { prompt: "Help the user" },
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: toDate(Temporal.Instant.fromEpochMilliseconds(0)),
    updatedAt: toDate(Temporal.Instant.fromEpochMilliseconds(0)),
    ...overrides,
  });
}

export function createAgentAppFixture(
  options: {
    apiKeys?: ApiKeyApi;
    auditLog?: AuditLogApi;
    permissions?: AuthzApi;
    projects?: ProjectApi;
    scenarios?: ScenarioApi;
    traces?: TraceApi;
    users?: UserApi;
    workflows?: WorkflowApi;
    repositories?: AgentRepositories;
    members?: Partial<AgentAppMembers>;
    config?: AgentServerConfig;
  } = {},
) {
  const repositories = options.repositories ?? MemoryAgentRepositories.create();
  const resources = new ResourceScope();
  const app = AgentApp.create({
    dependencies: {
      apiKeys: options.apiKeys ?? createApiFixture<ApiKeyApi>(),
      auditLog: options.auditLog ?? createApiFixture<AuditLogApi>(),
      permissions: options.permissions ?? createApiFixture<AuthzApi>(),
      projects: options.projects ?? createApiFixture<ProjectApi>(),
      scenarios: options.scenarios ?? createApiFixture<ScenarioApi>(),
      traces: options.traces ?? createApiFixture<TraceApi>(),
      users: options.users ?? createApiFixture<UserApi>(),
      workflows: options.workflows ?? createApiFixture<WorkflowApi>(),
    },
    members: { redis: memoryRedis(), publicBaseUrl: "https://langwatch.test", ...options.members },
    config: options.config ?? { replicaCount: 1, relayMaxPayloadMb: void 0 },
    resources,
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories,
  });

  return { app, repositories, resources };
}

export function agentWorkflowCopyFixture(workflowId = "workflow_copy", projectId = "project_2") {
  const timestamp = toDate(Temporal.Instant.fromEpochMilliseconds(0));
  const version = workflowVersionSchema.parse({
    id: "version_copy",
    workflowId,
    projectId,
    version: "1",
    autoSaved: false,
    commitMessage: "Copied",
    authorId: "user_1",
    parentId: null,
    dsl: { name: "Copied workflow", version: "1", nodes: [], edges: [] },
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const workflow = workflowSchema.parse({
    id: workflowId,
    projectId,
    name: "Copied workflow",
    icon: null,
    description: null,
    latestVersionId: version.id,
    currentVersionId: version.id,
    publishedId: null,
    publishedById: null,
    copiedFromWorkflowId: "workflow_1",
    isEvaluator: false,
    isComponent: false,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return { workflow, version };
}
