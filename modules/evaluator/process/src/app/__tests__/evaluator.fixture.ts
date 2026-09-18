/**
 * Evaluator application with memory persistence and stub collaborators;
 * repository is real but in-memory.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { ModelProviderResolution, ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { vi } from "vitest";

import { MemoryEvaluatorRepository } from "../../repositories/memory/memory.evaluator.repository.ts";
import { EvaluatorApp, type EvaluatorGraph } from "../evaluator.app.ts";

/** The workflow and monitor rows, as recording doubles. */
export function testEvaluatorGraph(overrides: Partial<EvaluatorGraph> = {}): EvaluatorGraph {
  return {
    findLinkedWorkflow: vi.fn(async () => ({ id: "workflow-1", name: "Judge" })),
    findMonitorsUsingEvaluator: vi.fn(async () => []),
    deleteMonitorsUsingEvaluator: vi.fn(async () => ({ count: 0 })),
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

export function createEvaluatorTestApp(
  input: Readonly<{
    repository?: MemoryEvaluatorRepository;
    modelProviders?: Partial<ModelProviderApi>;
    permissions?: AuthzApi;
    graph?: EvaluatorGraph;
  }> = {},
): Readonly<{
  app: EvaluatorApp;
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

  const app = EvaluatorApp.createWithGraph(
    {
      repositories: { evaluators: repository },
      dependencies: {
        permissions,
        auditLog: createApiFixture<AuditLogApi>({ listEntityHistory: async () => [] }),
        users: createApiFixture<UserApi>({ getProfiles: async () => [] }),
        workflows: createApiFixture<WorkflowApi>({ assertInProject: async () => void 0 }),
        modelProviders,
      },
      members: {
        prisma: createApiFixture<PrismaClient>(),
        publicBaseUrl: "https://langwatch.test",
      },
      config: undefined,
      resources: new ResourceScope(),
    },
    graph,
  );

  return { app, repository, modelProviders, permissions, graph };
}
