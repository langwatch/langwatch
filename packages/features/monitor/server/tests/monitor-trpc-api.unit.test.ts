/**
 * @vitest-environment node
 *
 * The tRPC surface itself: the nine procedure names the clients call, the
 * settings validation a monitor write goes through, the not-found mapping both
 * reads share, and the two-stage rollback a failed copy performs.
 *
 * It also pins the rule the whole shape exists for: the policy is applied
 * AFTER `.input()`, so the process's authorization middleware sees the parsed
 * input rather than `undefined`.
 */
import type { EvaluationService } from "@langwatch/evaluation-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { MonitorNotFoundError, type MonitorService } from "@langwatch/monitor-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MonitorTrpcApi } from "../src/api/app-trpc/monitor.api";
import { MonitorApp } from "../src/app/monitor.app";

type TestContext = {
  app: { monitors: MonitorApp };
  can(permission: string, target: { projectId: string }): Promise<boolean>;
};

const preconditionsSchema = z.array(
  z.object({ field: z.string(), rule: z.string(), value: z.string() }),
);

function harness({
  monitors = {},
  evaluations = {},
  evaluators = {},
  can = async () => true,
  copyEvaluatorToProject = vi.fn(async () => ({ id: "evaluator-2", workflowId: null })),
  deleteReplicatedWorkflow = vi.fn(async () => {}),
}: {
  monitors?: Partial<MonitorService>;
  evaluations?: Partial<EvaluationService>;
  evaluators?: Partial<EvaluatorService>;
  can?: (permission: string, target: { projectId: string }) => Promise<boolean>;
  copyEvaluatorToProject?: ReturnType<typeof vi.fn>;
  deleteReplicatedWorkflow?: ReturnType<typeof vi.fn>;
} = {}) {
  const trpc = initTRPC.context<TestContext>().create();
  /** Every input the policy chain observed, in the order the procedures ran. */
  const policySawInput: unknown[] = [];
  const decorate =
    () =>
    <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as any).use((options: { input: unknown; next: () => unknown }) => {
        policySawInput.push(options.input);
        return options.next();
      }) as TProcedure;

  const router = MonitorTrpcApi.create(
    trpc,
    { protected: trpc.procedure, policy: decorate, alsoRequire: decorate },
    {
      preconditionsSchema,
      resolvePreviousPeriodStartMs: () => 1_000,
      copyEvaluatorToProject: copyEvaluatorToProject as never,
      deleteReplicatedWorkflow: deleteReplicatedWorkflow as never,
    },
  );

  return {
    policySawInput,
    copyEvaluatorToProject,
    deleteReplicatedWorkflow,
    caller: router.createCaller({
      app: {
        monitors: MonitorApp.create({
          monitors: monitors as MonitorService,
          evaluations: evaluations as EvaluationService,
          evaluators: evaluators as EvaluatorService,
        }),
      },
      can: can as never,
    }),
  };
}

describe("MonitorTrpcApi", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const trpc = initTRPC.context<TestContext>().create();
      const router = MonitorTrpcApi.create(
        trpc,
        {
          protected: trpc.procedure,
          policy: () => (procedure) => procedure,
          alsoRequire: () => (procedure) => procedure,
        },
        {
          preconditionsSchema,
          resolvePreviousPeriodStartMs: () => 0,
          copyEvaluatorToProject: async () => ({ id: "e", workflowId: null }),
          deleteReplicatedWorkflow: async () => {},
        },
      );

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "copy",
        "create",
        "delete",
        "getAllForProject",
        "getById",
        "getPerformanceForProject",
        "isNameAvailable",
        "toggle",
        "update",
      ]);
    });
  });

  describe("when a procedure runs", () => {
    it("hands the policy the parsed input, not undefined", async () => {
      const { caller, policySawInput } = harness({
        monitors: { getAllForProject: async () => [] },
      });

      await caller.getAllForProject({ projectId: "project-1" });

      expect(policySawInput).toEqual([{ projectId: "project-1" }]);
    });

    it("hands the second stacked check the parsed input too", async () => {
      const { caller, policySawInput } = harness({
        monitors: { getAllForProject: async () => [] },
      });

      await caller.getPerformanceForProject({ projectId: "project-1" });

      expect(policySawInput).toEqual([{ projectId: "project-1" }, { projectId: "project-1" }]);
    });
  });

  describe("when a monitor names an evaluator we cannot run", () => {
    it("refuses the create before anything is written", async () => {
      const create = vi.fn();
      const { caller } = harness({ monitors: { create } });

      await expect(
        caller.create({
          projectId: "project-1",
          name: "Nope",
          checkType: "not/an-evaluator",
          preconditions: [],
          settings: {},
          sample: 1,
          executionMode: "ON_MESSAGE",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(create).not.toHaveBeenCalled();
    });

    it("accepts a workflow evaluator, whose settings live elsewhere", async () => {
      const create = vi.fn(async () => ({ id: "monitor-1" }));
      const { caller } = harness({ monitors: { create: create as never } });

      await caller.create({
        projectId: "project-1",
        name: "Workflow check",
        checkType: "workflow",
        preconditions: [],
        settings: {},
        sample: 1,
        executionMode: "ON_MESSAGE",
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ checkType: "workflow", parameters: {} }),
      );
    });
  });

  describe("when the monitor does not exist", () => {
    it("answers NOT_FOUND on the read", async () => {
      const { caller } = harness({
        monitors: {
          getById: async () => {
            throw new MonitorNotFoundError("monitor-1");
          },
        },
      });

      await expect(
        caller.getById({ id: "monitor-1", projectId: "project-1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("when copying a monitor out of a project the caller cannot manage", () => {
    it("refuses before the source monitor is read", async () => {
      const getById = vi.fn();
      const { caller } = harness({ monitors: { getById }, can: async () => false });

      await expect(
        caller.copy({
          monitorId: "monitor-1",
          projectId: "target",
          sourceProjectId: "source",
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(getById).not.toHaveBeenCalled();
    });
  });

  describe("when replicating the monitor fails after its evaluator was copied", () => {
    it("rolls the copied evaluator and its workflow back", async () => {
      const archive = vi.fn(async () => ({}) as never);
      const { caller, deleteReplicatedWorkflow } = harness({
        monitors: {
          getById: async () => ({ evaluatorId: "evaluator-1" }) as never,
          replicate: async () => {
            throw new Error("insert failed");
          },
        },
        evaluators: { archive: archive as never },
        copyEvaluatorToProject: vi.fn(async () => ({
          id: "evaluator-2",
          workflowId: "workflow-2",
        })),
      });

      await expect(
        caller.copy({
          monitorId: "monitor-1",
          projectId: "target",
          sourceProjectId: "source",
        }),
      ).rejects.toThrow("insert failed");

      expect(archive).toHaveBeenCalledWith({ id: "evaluator-2", projectId: "target" });
      expect(deleteReplicatedWorkflow).toHaveBeenCalledWith(expect.anything(), {
        workflowId: "workflow-2",
        projectId: "target",
      });
    });
  });

  describe("when the project has no monitors", () => {
    it("answers with no performance rows rather than querying evaluations", async () => {
      const getMonitorPerformance = vi.fn();
      const { caller } = harness({
        monitors: { getAllForProject: async () => [] },
        evaluations: { getMonitorPerformance },
      });

      await expect(caller.getPerformanceForProject({ projectId: "project-1" })).resolves.toEqual(
        [],
      );
      expect(getMonitorPerformance).not.toHaveBeenCalled();
    });

    it("compares against the window the process resolves", async () => {
      const getMonitorPerformance = vi.fn(async () => []);
      const { caller } = harness({
        monitors: {
          getAllForProject: async () => [{ id: "monitor-1", checkType: "workflow" }] as never,
        },
        evaluations: { getMonitorPerformance: getMonitorPerformance as never },
      });

      await caller.getPerformanceForProject({ projectId: "project-1" });

      expect(getMonitorPerformance).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "project-1",
          previousStartMs: 1_000,
          timeZone: "UTC",
        }),
      );
    });
  });

  describe("when a handler raises a transport error", () => {
    it("keeps its code", async () => {
      const { caller } = harness({
        monitors: {
          toggle: async () => {
            throw new TRPCError({ code: "CONFLICT" });
          },
        },
      });

      await expect(
        caller.toggle({ id: "monitor-1", projectId: "project-1", enabled: true }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });
});
