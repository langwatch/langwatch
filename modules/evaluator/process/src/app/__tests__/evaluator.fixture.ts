/**
 * Evaluator application with memory persistence and stub collaborators;
 * repository is real but in-memory.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { ModelProviderResolution, ModelProviderApi } from "@langwatch/model-provider-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { vi } from "vitest";

import { MemoryEvaluatorRepository } from "../../repositories/memory/memory.evaluator.repository.ts";
import { EvaluatorModule, type EvaluatorGraph } from "../evaluator.app.ts";

/** The workflow rows, as recording doubles. */
export function testEvaluatorGraph(overrides: Partial<EvaluatorGraph> = {}): EvaluatorGraph {
  return {
    findLinkedWorkflow: vi.fn(async () => ({ id: "workflow-1", name: "Judge" })),
    archiveLinkedWorkflow: vi.fn(async () => ({ id: "workflow-1" })),
    replicateEvaluatorWorkflow: vi.fn(async () => "workflow-2"),
    deleteReplicatedWorkflow: vi.fn(async () => void 0),
    ...overrides,
  };
}

/** One resolved model, in the shape the provider gateway answers with. */
export function testModelResolution(featureKey: string, model: string): ModelProviderResolution {
  return {
    model,
    source: "role_default",
    scope: "project",
    feature: {
      key: featureKey,
      role: featureKey === "analytics.topic_clustering_embeddings" ? "EMBEDDINGS" : "DEFAULT",
      displayName: featureKey,
      description: "",
    },
  };
}

/** Permits every project unless the case says which ones it permits. */
export function testEvaluatorPermissions(permits: (projectId: string) => boolean): AuthzApi {
  return createApiFixture<AuthzApi>({
    hasPermission: vi.fn(async (check: { projectId?: string }) => permits(check.projectId ?? "")),
  });
}

/** A plan in the resolved shape; no creation cap unless the case sets one. */
export function testPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    planSource: "free",
    type: "FREE",
    name: "Free",
    free: true,
    maxMembers: 2,
    maxMembersLite: 0,
    maxMessagesPerMonth: 50_000,
    canPublish: true,
    prices: { USD: 0, EUR: 0 },
    ...overrides,
  };
}

export function createEvaluatorTestApp(
  input: Readonly<{
    repository?: MemoryEvaluatorRepository;
    modelProviders?: Partial<ModelProviderApi>;
    permissions?: AuthzApi;
    graph?: EvaluatorGraph;
    /** The organization's plan; uncapped unless the case says otherwise. */
    plan?: Partial<Plan>;
    workflows?: Partial<WorkflowApi>;
  }> = {},
): Readonly<{
  app: EvaluatorModule;
  repository: MemoryEvaluatorRepository;
  modelProviders: ModelProviderApi;
  permissions: AuthzApi;
  graph: EvaluatorGraph;
}> {
  const graph = input.graph ?? testEvaluatorGraph();
  const permissions = input.permissions ?? testEvaluatorPermissions(() => true);
  const repository = input.repository ?? MemoryEvaluatorRepository.create();
  const modelProviders = createApiFixture<ModelProviderApi>({
    resolveModelForFeature: vi.fn(async ({ featureKey }: { featureKey: string }) =>
      testModelResolution(
        featureKey,
        featureKey === "evaluator.create_default"
          ? "anthropic/claude-sonnet-4-5"
          : "openai/text-embedding-3-large",
      ),
    ),
    ...input.modelProviders,
  });

  const app = EvaluatorModule.createWithGraph(
    {
      repositories: { evaluators: repository },
      dependencies: {
        permissions,
        auditLog: createApiFixture<AuditLogApi>({ listEntityHistory: async () => [] }),
        users: createApiFixture<UserApi>({ getProfiles: async () => [] }),
        workflows: createApiFixture<WorkflowApi>({
          assertInProject: async () => void 0,
          ...input.workflows,
        }),
        modelProviders,
        projects: createApiFixture<ProjectApi>({
          getOrganizationId: async () => "organization-1",
          listIdsByOrganization: async () => ["project-1", "project-2"],
        }),
        plans: createApiFixture<EntitlementApi>({
          getActivePlan: async () => testPlan(input.plan),
        }),
      },
      config: { publicBaseUrl: "https://langwatch.test" },
      resources: new ResourceScope(),
      secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    },
    graph,
  );

  return { app, repository, modelProviders, permissions, graph };
}
