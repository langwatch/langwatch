/**
 * The evaluator application over memory persistence and stub collaborators,
 * for cases about the application's own rules.
 *
 * The repository is real (in-memory): a case seeds the rows its precondition
 * needs and spies on the repository's own methods to watch what the app
 * wrote, rather than replacing methods on a runtime the app builds itself and
 * keeps private. Everything the case does not name refuses by name rather
 * than answering undefined.
 */
import type { WorkflowService } from "@langwatch/workflow-server";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type {
  ModelProviderResolution,
  ModelProviderApi,
} from "@langwatch/model-provider-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";

import { vi } from "vitest";

import { MemoryEvaluatorRepository } from "../../repositories/memory/memory.evaluator.repository.ts";
import type { EvaluatorNlpDispatcher } from "../../services/evaluator-code-execution.service.ts";
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

  const app = EvaluatorApp.create({
    repositories: { evaluators: repository },
    dependencies: {
      permissions,
      auditLog: createApiFixture<AuditLogApi>({ listEntityHistory: async () => [] }),
      users: createApiFixture<UserApi>({ getProfiles: async () => [] }),
    },
    infrastructure: {
      workflows: createApiFixture<WorkflowService>({ assertInProject: async () => void 0 }),
      graph,
      nlp: createApiFixture<EvaluatorNlpDispatcher>(),
      modelProviders,
      generateId: () => "evaluator-test",
    },
    config: void 0,
    resources: new ResourceScope(),
  });

  return { app, repository, modelProviders, permissions, graph };
}
