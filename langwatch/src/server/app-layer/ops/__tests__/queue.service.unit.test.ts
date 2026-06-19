import { describe, expect, it, vi } from "vitest";
import { QueueService } from "../queue.service";
import type { QueueRepository, DlqGroupInfo } from "../repositories/queue.repository";
import type { GroupInfo, QueueInfo } from "../types";

function createGroup(overrides: Partial<GroupInfo> = {}): GroupInfo {
  return {
    groupId: "g1",
    pendingJobs: 0,
    score: 0,
    hasActiveJob: false,
    activeJobId: null,
    isBlocked: false,
    oldestJobMs: null,
    newestJobMs: null,
    isStaleBlock: false,
    pipelineName: null,
    jobType: null,
    jobName: null,
    errorMessage: null,
    errorStack: null,
    errorTimestamp: null,
    retryCount: 0,
    activeKeyTtlSec: null,
    processingDurationMs: null,
    ...overrides,
  };
}

function createMockRepo(overrides: Partial<QueueRepository> = {}): QueueRepository {
  return {
    discoverQueueNames: vi.fn().mockResolvedValue([]),
    scanQueues: vi.fn().mockResolvedValue([]),
    getGroupJobs: vi.fn().mockResolvedValue({ jobs: [], total: 0 }),
    getBlockedSummary: vi.fn().mockResolvedValue({ totalBlocked: 0, clusters: [] }),
    unblockGroup: vi.fn().mockResolvedValue({ wasBlocked: false }),
    unblockAll: vi.fn().mockResolvedValue({ unblockedCount: 0 }),
    drainGroup: vi.fn().mockResolvedValue({ jobsRemoved: 0 }),
    pausePipeline: vi.fn().mockResolvedValue(undefined),
    unpausePipeline: vi.fn().mockResolvedValue(undefined),
    retryBlocked: vi.fn().mockResolvedValue({ wasBlocked: false }),
    listPausedKeys: vi.fn().mockResolvedValue([]),
    moveToDlq: vi.fn().mockResolvedValue({ jobsMoved: 0 }),
    moveAllBlockedToDlq: vi.fn().mockResolvedValue({ movedCount: 0, jobsMoved: 0 }),
    replayFromDlq: vi.fn().mockResolvedValue({ jobsReplayed: 0 }),
    replayAllFromDlq: vi.fn().mockResolvedValue({ replayedCount: 0, jobsReplayed: 0 }),
    canaryRedrive: vi.fn().mockResolvedValue({ redrivenCount: 0, groupIds: [] }),
    canaryUnblock: vi.fn().mockResolvedValue({ unblockedCount: 0, groupIds: [] }),
    listDlqGroups: vi.fn().mockResolvedValue([]),
    drainAllBlockedPreview: vi.fn().mockResolvedValue({ totalAffected: 0, byPipeline: [], byError: [] }),
    pauseTenant: vi.fn().mockResolvedValue(undefined),
    unpauseTenant: vi.fn().mockResolvedValue(undefined),
    listPausedTenants: vi.fn().mockResolvedValue([]),
    drainTenant: vi.fn().mockResolvedValue({ groupsDrained: 0, jobsDrained: 0 }),
    reconcileTotalPending: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("QueueService", () => {
  describe("getGroups()", () => {
    const groups = Array.from({ length: 25 }, (_, i) =>
      createGroup({ groupId: `g${i}` }),
    );
    const queue: QueueInfo = {
      name: "q1",
      displayName: "q1",
      pendingGroupCount: 25,
      blockedGroupCount: 0,
      activeGroupCount: 0,
      totalPendingJobs: 0,
      dlqCount: 0,
      parkedGroupCount: 0,
      groups,
    };

    describe("when page 1, pageSize 10, 25 groups", () => {
      it("returns first 10 groups with total 25", async () => {
        const repo = createMockRepo({
          scanQueues: vi.fn().mockResolvedValue([queue]),
        });
        const service = new QueueService(repo);

        const result = await service.getGroups({ queueName: "q1", page: 1, pageSize: 10 });

        expect(result.groups).toHaveLength(10);
        expect(result.groups[0]!.groupId).toBe("g0");
        expect(result.total).toBe(25);
        expect(result.page).toBe(1);
      });
    });

    describe("when page 3, pageSize 10, 25 groups", () => {
      it("returns last 5 groups", async () => {
        const repo = createMockRepo({
          scanQueues: vi.fn().mockResolvedValue([queue]),
        });
        const service = new QueueService(repo);

        const result = await service.getGroups({ queueName: "q1", page: 3, pageSize: 10 });

        expect(result.groups).toHaveLength(5);
        expect(result.groups[0]!.groupId).toBe("g20");
      });
    });

    describe("when page beyond range", () => {
      it("returns empty groups", async () => {
        const repo = createMockRepo({
          scanQueues: vi.fn().mockResolvedValue([queue]),
        });
        const service = new QueueService(repo);

        const result = await service.getGroups({ queueName: "q1", page: 10, pageSize: 10 });

        expect(result.groups).toHaveLength(0);
        expect(result.total).toBe(25);
      });
    });

    describe("when queue not found", () => {
      it("returns empty result", async () => {
        const repo = createMockRepo({
          scanQueues: vi.fn().mockResolvedValue([]),
        });
        const service = new QueueService(repo);

        const result = await service.getGroups({ queueName: "missing", page: 1, pageSize: 10 });

        expect(result.groups).toHaveLength(0);
        expect(result.total).toBe(0);
      });
    });
  });

  describe("getGroupDetail()", () => {
    describe("when group exists", () => {
      it("returns the matching group", async () => {
        const group = createGroup({ groupId: "target" });
        const queue: QueueInfo = {
          name: "q1",
          displayName: "q1",
          pendingGroupCount: 2,
          blockedGroupCount: 0,
          activeGroupCount: 0,
          totalPendingJobs: 0,
          dlqCount: 0,
          parkedGroupCount: 0,
          groups: [createGroup({ groupId: "other" }), group],
        };
        const repo = createMockRepo({
          scanQueues: vi.fn().mockResolvedValue([queue]),
        });
        const service = new QueueService(repo);

        const result = await service.getGroupDetail({ queueName: "q1", groupId: "target" });

        expect(result).toEqual(group);
      });
    });

    describe("when group not found", () => {
      it("returns null", async () => {
        const queue: QueueInfo = {
          name: "q1",
          displayName: "q1",
          pendingGroupCount: 1,
          blockedGroupCount: 0,
          activeGroupCount: 0,
          totalPendingJobs: 0,
          dlqCount: 0,
          parkedGroupCount: 0,
          groups: [createGroup({ groupId: "other" })],
        };
        const repo = createMockRepo({
          scanQueues: vi.fn().mockResolvedValue([queue]),
        });
        const service = new QueueService(repo);

        const result = await service.getGroupDetail({ queueName: "q1", groupId: "missing" });

        expect(result).toBeNull();
      });
    });

    describe("when queue not found", () => {
      it("returns null", async () => {
        const repo = createMockRepo({
          scanQueues: vi.fn().mockResolvedValue([]),
        });
        const service = new QueueService(repo);

        const result = await service.getGroupDetail({ queueName: "missing", groupId: "g1" });

        expect(result).toBeNull();
      });
    });
  });

  describe("getAllDlqGroups()", () => {
    describe("when multiple queues have DLQ groups", () => {
      it("merges and sorts by movedAt desc", async () => {
        const dlq1: DlqGroupInfo[] = [
          { groupId: "a", error: null, errorStack: null, pipelineName: null, jobCount: 1, movedAt: 1000 },
        ];
        const dlq2: DlqGroupInfo[] = [
          { groupId: "b", error: null, errorStack: null, pipelineName: null, jobCount: 2, movedAt: 3000 },
        ];
        const repo = createMockRepo({
          discoverQueueNames: vi.fn().mockResolvedValue(["q1:gq", "q2:gq"]),
          listDlqGroups: vi.fn()
            .mockResolvedValueOnce(dlq1)
            .mockResolvedValueOnce(dlq2),
        });
        const service = new QueueService(repo);

        const result = await service.getAllDlqGroups();

        expect(result).toHaveLength(2);
        expect(result[0]!.groupId).toBe("b"); // movedAt 3000 first
        expect(result[1]!.groupId).toBe("a"); // movedAt 1000 second
      });
    });

    describe("when queue name has hash tags and suffix", () => {
      it("strips them for display name", async () => {
        const repo = createMockRepo({
          discoverQueueNames: vi.fn().mockResolvedValue(["{prefix}:events:gq"]),
          listDlqGroups: vi.fn().mockResolvedValue([
            { groupId: "g1", error: null, errorStack: null, pipelineName: null, jobCount: 1, movedAt: null },
          ]),
        });
        const service = new QueueService(repo);

        const result = await service.getAllDlqGroups();

        // "{prefix}:events:gq" → strip ":gq" → "{prefix}:events" → strip prefix before ":" → "events"
        expect(result[0]!.queueDisplayName).toBe("events");
      });
    });

    describe("when movedAt is null", () => {
      it("sorts to end", async () => {
        const dlq: DlqGroupInfo[] = [
          { groupId: "a", error: null, errorStack: null, pipelineName: null, jobCount: 1, movedAt: null },
          { groupId: "b", error: null, errorStack: null, pipelineName: null, jobCount: 1, movedAt: 5000 },
        ];
        const repo = createMockRepo({
          discoverQueueNames: vi.fn().mockResolvedValue(["q:gq"]),
          listDlqGroups: vi.fn().mockResolvedValue(dlq),
        });
        const service = new QueueService(repo);

        const result = await service.getAllDlqGroups();

        expect(result[0]!.groupId).toBe("b"); // movedAt 5000
        expect(result[1]!.groupId).toBe("a"); // movedAt null (treated as 0)
      });
    });
  });

  describe("unblockGroup()", () => {
    describe("when group is blocked", () => {
      it("delegates to repo and returns result", async () => {
        const repo = createMockRepo({
          unblockGroup: vi.fn().mockResolvedValue({ wasBlocked: true }),
        });
        const service = new QueueService(repo);

        const result = await service.unblockGroup({ queueName: "q1", groupId: "g1" });

        expect(result).toEqual({ wasBlocked: true });
        expect(repo.unblockGroup).toHaveBeenCalledWith({ queueName: "q1", groupId: "g1" });
      });
    });

    describe("when group is not blocked", () => {
      it("returns wasBlocked false", async () => {
        const repo = createMockRepo({
          unblockGroup: vi.fn().mockResolvedValue({ wasBlocked: false }),
        });
        const service = new QueueService(repo);

        const result = await service.unblockGroup({ queueName: "q1", groupId: "g1" });

        expect(result.wasBlocked).toBe(false);
      });
    });
  });

  describe("drainGroup()", () => {
    describe("when group has jobs", () => {
      it("delegates to repo and returns removed count", async () => {
        const repo = createMockRepo({
          drainGroup: vi.fn().mockResolvedValue({ jobsRemoved: 5 }),
        });
        const service = new QueueService(repo);

        const result = await service.drainGroup({ queueName: "q1", groupId: "g1" });

        expect(result).toEqual({ jobsRemoved: 5 });
        expect(repo.drainGroup).toHaveBeenCalledWith({ queueName: "q1", groupId: "g1" });
      });
    });
  });

  describe("moveToDlq()", () => {
    describe("when group exists", () => {
      it("delegates to repo and returns moved count", async () => {
        const repo = createMockRepo({
          moveToDlq: vi.fn().mockResolvedValue({ jobsMoved: 3 }),
        });
        const service = new QueueService(repo);

        const result = await service.moveToDlq({ queueName: "q1", groupId: "g1" });

        expect(result).toEqual({ jobsMoved: 3 });
        expect(repo.moveToDlq).toHaveBeenCalledWith({ queueName: "q1", groupId: "g1" });
      });
    });
  });

  describe("unblockAll()", () => {
    describe("when multiple groups are blocked", () => {
      it("delegates to repo and returns unblocked count", async () => {
        const repo = createMockRepo({
          unblockAll: vi.fn().mockResolvedValue({ unblockedCount: 7 }),
        });
        const service = new QueueService(repo);

        const result = await service.unblockAll({ queueName: "q1" });

        expect(result).toEqual({ unblockedCount: 7 });
        expect(repo.unblockAll).toHaveBeenCalledWith({ queueName: "q1" });
      });
    });
  });

  describe("canaryRedrive()", () => {
    describe("when DLQ groups exist", () => {
      it("delegates to repo with count and filter", async () => {
        const repo = createMockRepo({
          canaryRedrive: vi.fn().mockResolvedValue({ redrivenCount: 3, groupIds: ["g1", "g2", "g3"] }),
        });
        const service = new QueueService(repo);

        const result = await service.canaryRedrive({ queueName: "q1", count: 3, pipelineFilter: "trace" });

        expect(result).toEqual({ redrivenCount: 3, groupIds: ["g1", "g2", "g3"] });
        expect(repo.canaryRedrive).toHaveBeenCalledWith({ queueName: "q1", count: 3, pipelineFilter: "trace" });
      });
    });
  });

  describe("canaryUnblock()", () => {
    describe("when blocked groups exist", () => {
      it("delegates to repo with count and filter", async () => {
        const repo = createMockRepo({
          canaryUnblock: vi.fn().mockResolvedValue({ unblockedCount: 2, groupIds: ["g1", "g2"] }),
        });
        const service = new QueueService(repo);

        const result = await service.canaryUnblock({ queueName: "q1", count: 5 });

        expect(result).toEqual({ unblockedCount: 2, groupIds: ["g1", "g2"] });
        expect(repo.canaryUnblock).toHaveBeenCalledWith({ queueName: "q1", count: 5 });
      });
    });
  });

  describe("tenant pause + bulk drain", () => {
    describe("when pauseTenant is called", () => {
      /** @scenario Pausing a tenant halts dispatch for that tenant only */
      it("delegates to the repository with tenantId", async () => {
        const repo = createMockRepo();
        const service = new QueueService(repo);

        await service.pauseTenant({ queueName: "q1", tenantId: "project_X" });

        expect(repo.pauseTenant).toHaveBeenCalledWith({
          queueName: "q1",
          tenantId: "project_X",
        });
      });
    });

    describe("when unpauseTenant is called", () => {
      /** @scenario Unpausing a tenant resumes dispatch immediately */
      it("delegates to the repository (which signals the dispatcher)", async () => {
        const repo = createMockRepo();
        const service = new QueueService(repo);

        await service.unpauseTenant({ queueName: "q1", tenantId: "project_X" });

        expect(repo.unpauseTenant).toHaveBeenCalledWith({
          queueName: "q1",
          tenantId: "project_X",
        });
      });
    });

    describe("when listPausedTenants is called", () => {
      it("returns the repository's list of paused tenant ids", async () => {
        const repo = createMockRepo({
          listPausedTenants: vi
            .fn()
            .mockResolvedValue(["project_A", "project_B"]),
        });
        const service = new QueueService(repo);

        const result = await service.listPausedTenants({ queueName: "q1" });

        expect(result).toEqual(["project_A", "project_B"]);
      });
    });

    describe("when drainTenant is called", () => {
      /** @scenario drainTenant bulk-drains all groups for a tenantId */
      it("returns groupsDrained and jobsDrained from the repository", async () => {
        const repo = createMockRepo({
          drainTenant: vi
            .fn()
            .mockResolvedValue({ groupsDrained: 1234, jobsDrained: 5678 }),
        });
        const service = new QueueService(repo);

        const result = await service.drainTenant({
          queueName: "q1",
          tenantId: "project_X",
        });

        expect(result).toEqual({ groupsDrained: 1234, jobsDrained: 5678 });
        expect(repo.drainTenant).toHaveBeenCalledWith({
          queueName: "q1",
          tenantId: "project_X",
        });
      });

      /** @scenario drainTenant decrements stats:total-pending atomically per group */
      it("returns counts in the shape the UI expects (groupsDrained + jobsDrained)", async () => {
        // Decrement semantics are tested at the Lua level (see
        // scripts.integration.test.ts "decrements stats:total-pending");
        // here we just verify the service surfaces the repo's totals
        // through to the caller without re-shaping them.
        const repo = createMockRepo({
          drainTenant: vi
            .fn()
            .mockResolvedValue({ groupsDrained: 3, jobsDrained: 12 }),
        });
        const service = new QueueService(repo);

        const result = await service.drainTenant({
          queueName: "q1",
          tenantId: "project_X",
        });

        expect(result).toEqual({ groupsDrained: 3, jobsDrained: 12 });
      });

      /** @scenario drainTenant supports an optional groupIdContains substring filter */
      it("forwards groupIdContains substring filter to the repository", async () => {
        const repo = createMockRepo();
        const service = new QueueService(repo);

        await service.drainTenant({
          queueName: "q1",
          tenantId: "project_X",
          groupIdContains: "/fold/projectDailySdkUsage/",
        });

        expect(repo.drainTenant).toHaveBeenCalledWith({
          queueName: "q1",
          tenantId: "project_X",
          groupIdContains: "/fold/projectDailySdkUsage/",
        });
      });
    });
  });
});
