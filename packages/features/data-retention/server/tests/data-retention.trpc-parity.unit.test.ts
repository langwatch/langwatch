import type {
  DataRetentionService,
  RetroactiveMutationProgress,
} from "@langwatch/data-retention-contract";
import { TrpcRootDefinition } from "@langwatch/trpc";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DataRetentionTrpcApi,
  type DataRetentionTrpcContext,
  type DataRetentionTrpcPolicy,
} from "../src/api/app-trpc/data-retention.api";

const getResolvedForProject = vi.fn();
const triggerRetroactiveUpdate = vi.fn();
const getRetroactiveMutationProgress = vi.fn();

type Snapshot = { projectId: string };
type StorageUsage = { totalBytes: number; projectCount: number };

function createCaller() {
  const actor = vi.fn(() => ({ id: "user-1" }));
  const authorize = vi.fn(async () => undefined);
  const assertPlanForProject = vi.fn(async () => undefined);

  // Only the three retroactive methods are exercised here; the abstract service
  // declares twenty, and stubbing the rest would say nothing about this router.
  const dataRetention = {
    getResolvedForProject,
    triggerRetroactiveUpdate,
    getRetroactiveMutationProgress,
  } as unknown as DataRetentionService;

  const policy: DataRetentionTrpcPolicy<Snapshot, StorageUsage> = {
    assertCanWriteScope: vi.fn(async () => undefined),
    assertWriteAllowed: vi.fn(async () => undefined),
    assertCanDisableRetention: vi.fn(),
    assertPlanForScope: vi.fn(async () => undefined),
    assertPlanForProject,
    getPolicySnapshot: vi.fn(async () => ({ projectId: "project-1" })),
    getScopeStorageUsage: vi.fn(async () => ({ totalBytes: 0, projectCount: 0 })),
  };

  const root = TrpcRootDefinition.forContext<DataRetentionTrpcContext>().create({});
  const router = DataRetentionTrpcApi.create(root, { protected: root.procedure, policy });

  return {
    actor,
    authorize,
    assertPlanForProject,
    caller: router.createCaller({ app: { dataRetention }, actor, authorize }),
  };
}

describe("data-retention retroactive tRPC parity", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when a retroactive update is triggered", () => {
    it("returns the legacy tables and applied retention fields", async () => {
      getResolvedForProject.mockResolvedValue({
        traces: 49,
        scenarios: 63,
        experiments: 91,
      });
      triggerRetroactiveUpdate.mockResolvedValue({
        tables: ["trace_summaries", "trace_analytics", "trace_analytics_rollup"],
      });
      const { authorize, assertPlanForProject, caller } = createCaller();

      await expect(
        caller.triggerRetroactiveUpdate({
          projectId: "project-1",
          category: "traces",
        }),
      ).resolves.toEqual({
        tables: ["trace_summaries", "trace_analytics", "trace_analytics_rollup"],
        appliedRetentionDays: 49,
      });

      expect(triggerRetroactiveUpdate).toHaveBeenCalledWith({
        projectId: "project-1",
        category: "traces",
        newRetentionDays: 49,
      });
      expect(authorize).toHaveBeenCalledWith("project:update", { projectId: "project-1" });
      expect(assertPlanForProject).toHaveBeenCalledWith(expect.anything(), "project-1");
    });

    it("refuses a category with no resolvable retention rather than rewriting rows", async () => {
      getResolvedForProject.mockResolvedValue({ scenarios: 63, experiments: 91 });
      const { caller } = createCaller();

      await expect(
        caller.triggerRetroactiveUpdate({
          projectId: "project-1",
          category: "traces",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(triggerRetroactiveUpdate).not.toHaveBeenCalled();
    });
  });

  describe("when mutation progress is read", () => {
    it("forwards the legacy progress shape unchanged", async () => {
      const progress: RetroactiveMutationProgress[] = [
        {
          mutationId: "mutation-1",
          table: "trace_analytics",
          isDone: false,
          partsToDo: 3,
          createTime: "2026-08-26T20:00:00",
          category: "traces",
        },
      ];
      getRetroactiveMutationProgress.mockResolvedValue(progress);
      const { authorize, caller } = createCaller();

      await expect(caller.getMutationProgress({ projectId: "project-1" })).resolves.toEqual(
        progress,
      );
      expect(authorize).toHaveBeenCalledWith("traces:view", { projectId: "project-1" });
    });
  });
});
