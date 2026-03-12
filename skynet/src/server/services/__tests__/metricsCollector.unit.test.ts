import { describe, expect, it } from "vitest";
import { buildPipelineTree } from "../metricsCollector.ts";
import type { QueueInfo, GroupInfo } from "../../../shared/types.ts";

function makeGroup(overrides: Partial<GroupInfo> = {}): GroupInfo {
  return {
    groupId: "g1",
    pendingJobs: 0,
    score: 1,
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
    retryCount: null,
    activeKeyTtlSec: null,
    processingDurationMs: null,
    ...overrides,
  };
}

function makeQueue(overrides: Partial<QueueInfo> = {}): QueueInfo {
  return {
    name: "test-queue",
    displayName: "test",
    pendingGroupCount: 0,
    blockedGroupCount: 0,
    activeGroupCount: 0,
    totalPendingJobs: 0,
    dlqCount: 0,
    groups: [],
    ...overrides,
  };
}

describe("buildPipelineTree", () => {
  describe("when queues have groups", () => {
    it("builds 3-level tree: pipeline > jobType > jobName", () => {
      const queues = [
        makeQueue({
          groups: [
            makeGroup({ pipelineName: "ingestion", jobType: "projection", jobName: "traceProjection", pendingJobs: 5 }),
          ],
        }),
      ];

      const tree = buildPipelineTree({ queues });

      expect(tree).toHaveLength(1);
      expect(tree[0]!.name).toBe("ingestion");
      expect(tree[0]!.children).toHaveLength(1);
      expect(tree[0]!.children[0]!.name).toBe("projection");
      expect(tree[0]!.children[0]!.children).toHaveLength(1);
      expect(tree[0]!.children[0]!.children[0]!.name).toBe("traceProjection");
    });

    it("aggregates counts at each level", () => {
      const queues = [
        makeQueue({
          groups: [
            makeGroup({ pipelineName: "ingestion", jobType: "projection", jobName: "trace", pendingJobs: 3, hasActiveJob: true }),
            makeGroup({ pipelineName: "ingestion", jobType: "projection", jobName: "span", pendingJobs: 2, isBlocked: true }),
          ],
        }),
      ];

      const tree = buildPipelineTree({ queues });

      // Pipeline level
      expect(tree[0]!.pending).toBe(5);
      expect(tree[0]!.active).toBe(1);
      expect(tree[0]!.blocked).toBe(1);

      // JobType level
      expect(tree[0]!.children[0]!.pending).toBe(5);
      expect(tree[0]!.children[0]!.active).toBe(1);
      expect(tree[0]!.children[0]!.blocked).toBe(1);

      // JobName level
      const jobNames = tree[0]!.children[0]!.children;
      expect(jobNames).toHaveLength(2);

      const trace = jobNames.find((n) => n.name === "trace")!;
      expect(trace.pending).toBe(3);
      expect(trace.active).toBe(1);
      expect(trace.blocked).toBe(0);

      const span = jobNames.find((n) => n.name === "span")!;
      expect(span.pending).toBe(2);
      expect(span.active).toBe(0);
      expect(span.blocked).toBe(1);
    });

    it("sorts pipelines alphabetically", () => {
      const queues = [
        makeQueue({
          groups: [
            makeGroup({ pipelineName: "zeta", jobType: "cmd", jobName: "a" }),
            makeGroup({ pipelineName: "alpha", jobType: "cmd", jobName: "b" }),
          ],
        }),
      ];

      const tree = buildPipelineTree({ queues });

      expect(tree[0]!.name).toBe("alpha");
      expect(tree[1]!.name).toBe("zeta");
    });
  });

  describe("when seedKeys provided", () => {
    it("creates nodes for paused keys even with zero counts", () => {
      const tree = buildPipelineTree({
        queues: [],
        seedKeys: ["ingestion/projection/traceProjection"],
      });

      expect(tree).toHaveLength(1);
      expect(tree[0]!.name).toBe("ingestion");
      expect(tree[0]!.pending).toBe(0);
      expect(tree[0]!.children[0]!.name).toBe("projection");
      expect(tree[0]!.children[0]!.children[0]!.name).toBe("traceProjection");
    });

    it("handles partial seed keys (1 or 2 segments)", () => {
      const tree = buildPipelineTree({
        queues: [],
        seedKeys: ["ingestion", "evaluation/reactor"],
      });

      expect(tree).toHaveLength(2);
      // ingestion has no children (1 segment)
      expect(tree[0]!.name).toBe("evaluation");
      expect(tree[0]!.children).toHaveLength(1);
      expect(tree[0]!.children[0]!.name).toBe("reactor");

      expect(tree[1]!.name).toBe("ingestion");
      expect(tree[1]!.children).toHaveLength(0);
    });
  });

  describe("when no groups", () => {
    it("returns empty tree", () => {
      const tree = buildPipelineTree({ queues: [] });
      expect(tree).toEqual([]);
    });

    it("returns empty tree with empty queues", () => {
      const tree = buildPipelineTree({ queues: [makeQueue()] });
      expect(tree).toEqual([]);
    });
  });
});
