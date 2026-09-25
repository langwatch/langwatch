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
import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
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

/** The in-memory Redis, plus the one compare-and-set script session ownership runs. */
function claimingRedisDouble(): ReturnType<typeof memoryRedisDouble> {
  const store = memoryRedisStore();
  const plain = memoryRedisDouble({ store });
  return memoryRedisDouble({
    store,
    script: {
      eval: async (_script, _keys, ...args) => {
        const [key = "", value = "", ttl = "0"] = args.map(String);
        const current = await plain.get(key);
        if (current && current !== value) return 0;
        await plain.set(key, value, "EX", Number(ttl));
        return 1;
      },
    },
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
    members: {
      redis: claimingRedisDouble(),
      publicBaseUrl: "https://langwatch.test",
      ...options.members,
    },
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
