import { agentSchema, type Agent, type AgentServerConfig } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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
import { AgentModule } from "../agent.app.ts";

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

/** Project secrets kept in memory, for agents whose typed tokens become secrets on save. */
export function secretStoreFixture(initial: Record<string, string> = {}) {
  const values: Record<string, string> = { ...initial };
  const rowOf = (input: { projectId: string; name: string }) => ({
    id: input.name,
    projectId: input.projectId,
    name: input.name,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    createdBy: { name: null },
    updatedBy: { name: null },
  });
  const secrets = createApiFixture<SecretApi>({
    getValuesByName: async ({ names }) =>
      Object.fromEntries(Object.entries(values).filter(([name]) => names.includes(name))),
    list: async ({ projectId }) => Object.keys(values).map((name) => rowOf({ projectId, name })),
    create: async (input) => {
      values[input.name] = input.value;

      return rowOf(input);
    },
  });

  return { secrets, values };
}

export function createAgentAppFixture(
  options: {
    apiKeys?: ApiKeyApi;
    auditLog?: AuditLogApi;
    featureFlags?: FeatureFlagApi;
    permissions?: AuthzApi;
    projects?: ProjectApi;
    scenarios?: ScenarioApi;
    secrets?: SecretApi;
    traces?: TraceApi;
    users?: UserApi;
    workflows?: WorkflowApi;
    repositories?: AgentRepositories;
    config?: AgentServerConfig;
  } = {},
) {
  const repositories = options.repositories ?? MemoryAgentRepositories.create();
  const resources = new ResourceScope();
  const app = AgentModule.create({
    dependencies: {
      apiKeys: options.apiKeys ?? createApiFixture<ApiKeyApi>(),
      auditLog: options.auditLog ?? createApiFixture<AuditLogApi>(),
      featureFlags: options.featureFlags ?? createApiFixture<FeatureFlagApi>(),
      permissions: options.permissions ?? createApiFixture<AuthzApi>(),
      projects: options.projects ?? createApiFixture<ProjectApi>(),
      scenarios: options.scenarios ?? createApiFixture<ScenarioApi>(),
      secrets: options.secrets ?? secretStoreFixture().secrets,
      traces: options.traces ?? createApiFixture<TraceApi>(),
      users: options.users ?? createApiFixture<UserApi>(),
      workflows: options.workflows ?? createApiFixture<WorkflowApi>(),
    },
    config: options.config ?? {
      replicaCount: 1,
      relayMaxPayloadMb: void 0,
      publicBaseUrl: "https://langwatch.test",
    },
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
