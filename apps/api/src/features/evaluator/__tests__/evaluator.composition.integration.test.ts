/**
 * The evaluators a project defines, served by the API process.
 *
 * Booted over the memory repositories rather than a Prisma double: the point
 * of the installer is that persistence is chosen once, at boot, so the graph
 * this test drives is the one `installApiEvaluator` builds over Postgres.
 * @vitest-environment node
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuditLogApi as AuditLogApiToken } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { newEvaluatorId } from "@langwatch/evaluator-contract";
import { evaluatorServer, type EvaluatorGraph } from "@langwatch/evaluator-server";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApp } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";

import type { WorkflowApp, WorkflowNlpRuntime, WorkflowService,} from "@langwatch/workflow-server";
import { describe, expect, it, vi } from "vitest";

import type { AuthzService } from "@langwatch/authz-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { ApiTrpcInfrastructure } from "../../../platform/infrastructure/api-trpc.infrastructure.ts";
import { installApiEvaluator } from "../evaluator.composition.ts";

/** The process infrastructure an evaluator install reads, and nothing more. */
function testInfrastructure(prisma: PrismaClient): ApiTrpcInfrastructure {
  return {
    prisma,
    authz: createApiFixture<AuthzService>(),
    plans: { getActivePlan: async () => ({ type: "FREE" }) as never },
    featureFlags: createApiFixture<FeatureFlagApi>(),
    saasBilling: false,
    audit: undefined,
    auditLog: createApiFixture<AuditLogApi>({
      record: async () => void 0,
      listEntityHistory: async () => [],
    }),
  };
}


const PROJECT_ID = "project-1";
const ACTOR_ID = "user-1";

/** The one resolution an evaluator create asks for, in the gateway's shape. */
function resolution(featureKey: string, model: string) {
  return {
    model,
    source: "role_default" as const,
    scope: "project" as const,
    feature: {
      key: featureKey,
      role: featureKey === "analytics.topic_clustering_embeddings" ? ("EMBEDDINGS" as const) : ("DEFAULT" as const),
      displayName: featureKey,
      description: "",
    },
  };
}

/**
 * The same install `installApiEvaluator` performs, over the memory backend and
 * with every collaborator the cases below do not exercise refusing by name.
 */
async function bootEvaluator(overrides: { graph?: EvaluatorGraph } = {}) {
  const auditLog = createApiFixture<AuditLogApi>({
    record: async () => void 0,
    listEntityHistory: async () => [],
  });

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withProvided(AuthzApi, createApiFixture<AuthzApi>({ hasPermission: async () => true }))
    .withProvided(AuditLogApiToken, auditLog)
    .withModule(evaluatorServer, {
      infrastructure: {
        workflows: createApiFixture<WorkflowService>({ assertInProject: async () => void 0 }),
        actors: { findByIds: async () => [] },
        graph:
          overrides.graph ??
          createApiFixture<EvaluatorGraph>({
            findLinkedWorkflow: async () => null,
            findMonitorsUsingEvaluator: async () => [],
          }),
        nlp: createApiFixture<{
          dispatch: () => Promise<never>;
        }>(),
        modelProviders: createApiFixture<ModelProviderApi>({
          resolveModelForFeature: vi.fn(async ({ featureKey }: { featureKey: string }) =>
            resolution(
              featureKey,
              featureKey === "evaluator.create_default"
                ? "anthropic/claude-sonnet-4-5"
                : "openai/text-embedding-3-large",
            ),
          ),
        }),
        generateId: () => "evaluator-boot-test",
      },
    })
    .boot({ role: "api" });

  return runtime.module(evaluatorServer).provided;
}

describe("given the API process installs the evaluator module", () => {
  describe("when the project has defined nothing yet", () => {
    it("answers an empty list rather than refusing", async () => {
      const evaluators = await bootEvaluator();

      await expect(evaluators.getAllWithFields({ projectId: PROJECT_ID })).resolves.toEqual([]);
    });
  });

  describe("when an evaluator is created through the module's own application", () => {
    it("reads it back by id, by slug and through the public id-or-slug address", async () => {
      const evaluators = await bootEvaluator();
      const id = newEvaluatorId();

      await evaluators.create({
        id,
        projectId: PROJECT_ID,
        name: "Exact match",
        type: "evaluator",
        config: { evaluatorType: "langevals/exact_match" },
      });

      await expect(evaluators.getById({ id, projectId: PROJECT_ID })).resolves.toMatchObject({
        id,
        name: "Exact match",
        slug: "exact-match",
      });
      await expect(
        evaluators.findBySlug({ slug: "exact-match", projectId: PROJECT_ID }),
      ).resolves.toMatchObject({ id });
      await expect(
        evaluators.findByIdOrSlugWithFields({ idOrSlug: "exact-match", projectId: PROJECT_ID }),
      ).resolves.toMatchObject({ id });
    });

    it("fills the chat model from the project's resolved default", async () => {
      const evaluators = await bootEvaluator();

      const created = await evaluators.createWithResolvedDefaults({
        projectId: PROJECT_ID,
        name: "Faithfulness",
        config: { evaluatorType: "ragas/faithfulness" },
      });

      const settings = (created.config as { settings?: Record<string, unknown> }).settings;
      expect(settings?.model).toBe("anthropic/claude-sonnet-4-5");
    });
  });

  describe("when an evaluator is archived with everything that only exists to run it", () => {
    it("deletes its monitors and reports how many went", async () => {
      const deleteMonitorsUsingEvaluator = vi.fn(async () => ({ count: 2 }));
      const evaluators = await bootEvaluator({
        graph: createApiFixture<EvaluatorGraph>({
          deleteMonitorsUsingEvaluator,
          findLinkedWorkflow: async () => null,
        }),
      });
      const id = newEvaluatorId();
      await evaluators.create({
        id,
        projectId: PROJECT_ID,
        name: "Guarded",
        type: "evaluator",
        config: { evaluatorType: "langevals/exact_match" },
      });

      const archived = await evaluators.cascadeArchive({ id, projectId: PROJECT_ID });

      expect(archived.deletedMonitorsCount).toBe(2);
      expect(archived.archivedWorkflow).toBeNull();
      expect(deleteMonitorsUsingEvaluator).toHaveBeenCalledWith({
        evaluatorId: id,
        projectId: PROJECT_ID,
      });
    });
  });

  describe("when the change history is read", () => {
    it("answers the trail this deployment composed, with no actor to name", async () => {
      const evaluators = await bootEvaluator();

      await expect(
        evaluators.getHistory({ evaluatorId: "evaluator_1", projectId: PROJECT_ID }),
      ).resolves.toEqual([]);
    });
  });

  describe("when a replica in another project is listed", () => {
    it("reads the lineage through the module's own rows", async () => {
      const evaluators = await bootEvaluator();
      const id = newEvaluatorId();
      await evaluators.create({
        id,
        projectId: PROJECT_ID,
        name: "Source",
        type: "evaluator",
        config: { evaluatorType: "langevals/exact_match" },
      });

      await expect(
        evaluators.getCopies({ evaluatorId: id, projectId: PROJECT_ID, actorId: ACTOR_ID }),
      ).resolves.toEqual([]);
    });
  });
});

/**
 * The replication refusal, over the process's own graph rather than the memory
 * one: a workflow evaluator whose backing graph has never been saved. Ported
 * from the role half's suite, where it asserted a signature the installer no
 * longer has.
 * @see specs/monitors/replicate-monitor-to-project.feature
 */
describe("given a workflow evaluator whose graph has never been saved", () => {
  const SOURCE_ROW = {
    id: "evaluator_source",
    projectId: PROJECT_ID,
    name: "Judge",
    slug: "judge",
    type: "workflow",
    config: {},
    workflowId: "workflow-1",
    copiedFromEvaluatorId: null,
    archivedAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
  };

  it("refuses the replication rather than writing a structurally broken replica", async () => {
    const prisma = {
      evaluator: { findFirst: vi.fn(async () => SOURCE_ROW) },
      workflow: { findFirst: vi.fn(async () => null) },
    };
    const installed = await installApiEvaluator({
      infrastructure: testInfrastructure(prisma as unknown as PrismaClient),
      peers: {
        workflows: createApiFixture<WorkflowService>(),
        nlpRuntime: createApiFixture<WorkflowNlpRuntime>(),
        workflowApp: () => createApiFixture<WorkflowApp>(),
        modelProviders: createApiFixture<ModelProviderApi>(),
        permissions: createApiFixture<AuthzApi>({ hasPermission: async () => true }),
        users: createApiFixture<UserApi>(),
      },
    });

    await expect(
      installed.app.copy({
        evaluatorId: SOURCE_ROW.id,
        projectId: "project-2",
        sourceProjectId: PROJECT_ID,
        newEvaluatorId: newEvaluatorId(),
        actorId: ACTOR_ID,
      }),
    ).rejects.toMatchObject({ code: "evaluator_workflow_version_required" });
    expect(prisma.workflow.findFirst).toHaveBeenCalled();
  });
});
