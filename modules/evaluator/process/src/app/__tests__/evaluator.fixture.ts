/**
 * Evaluator application with memory persistence and stub collaborators;
 * repository is real but in-memory.
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type {
  ModelProviderApi,
  ModelProviderResolution,
  ModelProviderSummary,
} from "@langwatch/model-provider-contract";
import { ResourceScope } from "@langwatch/process";
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

/** Saved project providers, complete, that differ only in key and switch. */
export function testProviderSummaries(
  providers: readonly Pick<ModelProviderSummary, "provider" | "enabled">[],
): ModelProviderSummary[] {
  return providers.map(({ provider, enabled }, index) => ({
    id: `provider-${index}`,
    organizationId: "organization-1",
    provider,
    name: provider,
    enabled,
    routingHandle: null,
    scopes: [],
    customKeys: null,
    customModels: [],
    customEmbeddingsModels: [],
    extraHeaders: [],
    rateLimitRpm: null,
    rateLimitTpm: null,
    rateLimitRpd: null,
    fallbackPriorityGlobal: null,
    providerConfig: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    isSystem: false,
    embeddingsUnsupported: false,
  }));
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
    instantEvals?: Partial<InstantEvalApi>;
    permissions?: AuthzApi;
    graph?: EvaluatorGraph;
  }> = {},
): Readonly<{
  app: EvaluatorModule;
  repository: MemoryEvaluatorRepository;
  modelProviders: ModelProviderApi;
  instantEvals: InstantEvalApi;
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
    listForProject: vi.fn(async () => []),
    ...input.modelProviders,
  });
  const instantEvals = createApiFixture<InstantEvalApi>({
    isReleased: vi.fn(async () => false),
    ...input.instantEvals,
  });

  const app = EvaluatorModule.createWithGraph(
    {
      repositories: { evaluators: repository },
      dependencies: {
        permissions,
        auditLog: createApiFixture<AuditLogApi>({ listEntityHistory: async () => [] }),
        users: createApiFixture<UserApi>({ getProfiles: async () => [] }),
        workflows: createApiFixture<WorkflowApi>({ assertInProject: async () => void 0 }),
        modelProviders,
        instantEvals,
      },
      config: { publicBaseUrl: "https://langwatch.test" },
      resources: new ResourceScope(),
      secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    },
    graph,
  );

  return { app, repository, modelProviders, instantEvals, permissions, graph };
}
