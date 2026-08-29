/**
 * @vitest-environment node
 *
 * The tRPC surface itself: the fourteen procedure names the clients call, the
 * config validation a code evaluator goes through, the cascade the archive
 * confirmation performs, and the per-project filtering every replication path
 * applies.
 *
 * It also pins the rule the whole shape exists for: the policy is applied
 * AFTER `.input()`, so the process's authorization middleware sees the parsed
 * input rather than `undefined`.
 */
import type { Evaluator, EvaluatorService } from "@langwatch/evaluator-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { EvaluatorApp } from "../src/app/evaluator.app";
import { EvaluatorTrpcApi, type EvaluatorTrpcPorts } from "../src/api/app-trpc/evaluator.api";

type TestContext = {
  app: { evaluatorApp: EvaluatorApp };
  can(permission: string, target: { projectId: string }): Promise<boolean>;
};

/**
 * The application the surface answers from. The tRPC door reaches no model
 * provider, so the stub is the empty one the type demands and nothing calls.
 */
function anApp(evaluators: Partial<EvaluatorService>): EvaluatorApp {
  return EvaluatorApp.create({
    evaluators: evaluators as EvaluatorService,
    modelProviders: {} as ModelProviderService,
  });
}

const anEvaluator: Evaluator = {
  id: "evaluator-1",
  projectId: "project-1",
  name: "Exact match",
  slug: "exact-match",
  type: "evaluator",
  config: { evaluatorType: "langevals/exact_match" },
  workflowId: null,
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function ports(overrides: Partial<EvaluatorTrpcPorts> = {}): EvaluatorTrpcPorts {
  return {
    findLinkedWorkflow: vi.fn(async () => ({ id: "workflow-1", name: "Judge" })),
    findMonitorsUsingEvaluator: vi.fn(async () => []),
    deleteMonitorsUsingEvaluator: vi.fn(async () => ({ count: 0 })),
    archiveLinkedWorkflow: vi.fn(async () => ({ id: "workflow-1" })),
    replicateEvaluatorWorkflow: vi.fn(async () => "workflow-2"),
    deleteReplicatedWorkflow: vi.fn(async () => {}),
    ...overrides,
  };
}

function harness({
  evaluators = {},
  can = async () => true,
  featurePorts = ports(),
}: {
  evaluators?: Partial<EvaluatorService>;
  can?: (permission: string, target: { projectId: string }) => Promise<boolean>;
  featurePorts?: EvaluatorTrpcPorts;
} = {}) {
  const trpc = initTRPC.context<TestContext>().create();
  /** Every input the policy chain observed, in the order the procedures ran. */
  const policySawInput: unknown[] = [];
  const policy =
    () =>
    <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as any).use((options: { input: unknown; next: () => unknown }) => {
        policySawInput.push(options.input);
        return options.next();
      }) as TProcedure;

  const router = EvaluatorTrpcApi.create(trpc, { protected: trpc.procedure, policy }, featurePorts);

  return {
    policySawInput,
    ports: featurePorts,
    caller: router.createCaller({
      app: { evaluatorApp: anApp(evaluators) },
      can: can as never,
    }),
  };
}

describe("EvaluatorTrpcApi", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const trpc = initTRPC.context<TestContext>().create();
      const router = EvaluatorTrpcApi.create(
        trpc,
        { protected: trpc.procedure, policy: () => (procedure) => procedure },
        ports(),
      );

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "cascadeArchive",
        "copy",
        "create",
        "delete",
        "getAll",
        "getById",
        "getBySlug",
        "getCopies",
        "getHistory",
        "getRelatedEntities",
        "getWorkflowFields",
        "pushToCopies",
        "syncFromSource",
        "update",
      ]);
    });
  });

  describe("when a procedure runs", () => {
    it("hands the policy the parsed input, not undefined", async () => {
      const { caller, policySawInput } = harness({
        evaluators: { getAllWithFields: async () => [] },
      });

      await caller.getAll({ projectId: "project-1" });

      expect(policySawInput).toEqual([{ projectId: "project-1" }]);
    });
  });

  describe("when a code evaluator arrives without its program", () => {
    it("refuses the create before anything is written", async () => {
      const create = vi.fn();
      const { caller } = harness({ evaluators: { create } });

      await expect(
        caller.create({
          projectId: "project-1",
          name: "Broken code",
          type: "code",
          config: {},
        }),
        // The refusal is the application's now, so the assertion is on its
        // stable code rather than on the transport code a process boundary
        // this bare harness does not install would derive from it.
      ).rejects.toMatchObject({ cause: { code: "evaluator_config_invalid" } });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when a workflow already backs an evaluator", () => {
    it("refuses a second one against the same workflow", async () => {
      const create = vi.fn();
      const { caller } = harness({
        evaluators: {
          create,
          tryGetByWorkflow: async () => ({ ...anEvaluator, name: "Existing" }),
        },
      });

      await expect(
        caller.create({
          projectId: "project-1",
          name: "Duplicate",
          type: "workflow",
          config: {},
          workflowId: "workflow-1",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when the archive confirmation is opened", () => {
    it("names the linked workflow and the monitors that go with it", async () => {
      const featurePorts = ports({
        findMonitorsUsingEvaluator: vi.fn(async () => [{ id: "monitor-1", name: "Guard" }]),
      });
      const { caller } = harness({
        evaluators: { tryGetById: async () => ({ ...anEvaluator, workflowId: "workflow-1" }) },
        featurePorts,
      });

      await expect(
        caller.getRelatedEntities({ id: "evaluator-1", projectId: "project-1" }),
      ).resolves.toEqual({
        workflow: { id: "workflow-1", name: "Judge" },
        monitors: [{ id: "monitor-1", name: "Guard" }],
      });
    });

    it("reads no workflow for an evaluator that has none", async () => {
      const featurePorts = ports();
      const { caller } = harness({
        evaluators: { tryGetById: async () => anEvaluator },
        featurePorts,
      });

      const result = await caller.getRelatedEntities({
        id: "evaluator-1",
        projectId: "project-1",
      });

      expect(result.workflow).toBeNull();
      expect(featurePorts.findLinkedWorkflow).not.toHaveBeenCalled();
    });
  });

  describe("when an evaluator is cascade archived", () => {
    it("deletes its monitors, archives it, and archives its workflow", async () => {
      const featurePorts = ports({
        deleteMonitorsUsingEvaluator: vi.fn(async () => ({ count: 2 })),
      });
      const { caller } = harness({
        evaluators: {
          getById: async () => ({ ...anEvaluator, workflowId: "workflow-1" }),
          archive: async () => ({ ...anEvaluator, archivedAt: new Date() }),
        },
        featurePorts,
      });

      const result = await caller.cascadeArchive({
        id: "evaluator-1",
        projectId: "project-1",
      });

      expect(result.deletedMonitorsCount).toBe(2);
      expect(result.archivedWorkflow).toEqual({ id: "workflow-1" });
      expect(result.evaluator.archivedAt).not.toBeNull();
    });
  });

  describe("when replicas live in projects the caller cannot see", () => {
    it("lists only the ones they may view", async () => {
      const { caller } = harness({
        evaluators: {
          getCopies: async () => [
            { id: "copy-1", name: "Mine", projectId: "project-2", fullPath: "a" },
            { id: "copy-2", name: "Theirs", projectId: "project-3", fullPath: "b" },
          ],
        },
        can: async (_permission, target) => target.projectId === "project-2",
      });

      await expect(
        caller.getCopies({ projectId: "project-1", evaluatorId: "evaluator-1" }),
      ).resolves.toEqual([{ id: "copy-1", name: "Mine", projectId: "project-2", fullPath: "a" }]);
    });

    it("pushes only into the ones they may manage", async () => {
      const pushToCopies = vi.fn(async () => ({ pushedTo: 1, selectedCopies: 2 }));
      const { caller } = harness({
        evaluators: {
          getCopies: async () => [
            { id: "copy-1", name: "Mine", projectId: "project-2", fullPath: "a" },
            { id: "copy-2", name: "Theirs", projectId: "project-3", fullPath: "b" },
          ],
          pushToCopies,
        },
        can: async (_permission, target) => target.projectId === "project-2",
      });

      await caller.pushToCopies({ projectId: "project-1", evaluatorId: "evaluator-1" });

      expect(pushToCopies).toHaveBeenCalledWith(
        expect.objectContaining({ allowedProjectIds: ["project-2"] }),
      );
    });
  });

  describe("when copying out of a project the caller cannot manage", () => {
    it("refuses before the source evaluator is read", async () => {
      const tryGetById = vi.fn();
      const { caller } = harness({ evaluators: { tryGetById }, can: async () => false });

      await expect(
        caller.copy({
          evaluatorId: "evaluator-1",
          projectId: "target",
          sourceProjectId: "source",
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(tryGetById).not.toHaveBeenCalled();
    });

    it("refuses to sync from a source it cannot read", async () => {
      const syncFromSource = vi.fn();
      const { caller } = harness({
        evaluators: {
          getCopySource: async () => ({
            copy: anEvaluator,
            source: { ...anEvaluator, projectId: "source" },
          }),
          syncFromSource,
        },
        can: async () => false,
      });

      await expect(
        caller.syncFromSource({ projectId: "project-1", evaluatorId: "evaluator-1" }),
      ).rejects.toMatchObject({ cause: { code: "permission_denied" } });
      expect(syncFromSource).not.toHaveBeenCalled();
    });
  });

  describe("when copying an evaluator into another project", () => {
    it("names the missing source rather than failing anonymously", async () => {
      const { caller } = harness({ evaluators: { tryGetById: async () => null } });

      await expect(
        caller.copy({
          evaluatorId: "evaluator-1",
          projectId: "target",
          sourceProjectId: "source",
        }),
      ).rejects.toMatchObject({ cause: { code: "evaluator_not_found" } });
    });

    it("refuses a workflow evaluator that names no workflow", async () => {
      const { caller } = harness({
        evaluators: {
          tryGetById: async () => ({ ...anEvaluator, type: "workflow", workflowId: null }),
        },
      });

      await expect(
        caller.copy({
          evaluatorId: "evaluator-1",
          projectId: "target",
          sourceProjectId: "source",
        }),
      ).rejects.toMatchObject({ cause: { code: "evaluator_workflow_version_required" } });
    });

    it("clones the backing workflow and points the replica at it", async () => {
      const create = vi.fn(async () => anEvaluator);
      const featurePorts = ports();
      const { caller } = harness({
        evaluators: {
          tryGetById: async () => ({
            ...anEvaluator,
            type: "workflow",
            workflowId: "workflow-1",
          }),
          create,
        },
        featurePorts,
      });

      await caller.copy({
        evaluatorId: "evaluator-1",
        projectId: "target",
        sourceProjectId: "source",
        newEvaluatorId: "evaluator-9",
      });

      expect(featurePorts.replicateEvaluatorWorkflow).toHaveBeenCalledWith(expect.anything(), {
        workflowId: "workflow-1",
        sourceProjectId: "source",
        targetProjectId: "target",
      });
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "evaluator-9",
          projectId: "target",
          workflowId: "workflow-2",
          copiedFromEvaluatorId: "evaluator-1",
        }),
      );
    });

    it("removes the cloned workflow when the replica cannot be written", async () => {
      const featurePorts = ports();
      const { caller } = harness({
        evaluators: {
          tryGetById: async () => ({
            ...anEvaluator,
            type: "workflow",
            workflowId: "workflow-1",
          }),
          create: async () => {
            throw new Error("insert failed");
          },
        },
        featurePorts,
      });

      await expect(
        caller.copy({
          evaluatorId: "evaluator-1",
          projectId: "target",
          sourceProjectId: "source",
        }),
      ).rejects.toThrow("insert failed");

      expect(featurePorts.deleteReplicatedWorkflow).toHaveBeenCalledWith(expect.anything(), {
        workflowId: "workflow-2",
        projectId: "target",
      });
    });
  });
});
