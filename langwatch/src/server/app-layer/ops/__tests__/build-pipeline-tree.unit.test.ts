import { describe, expect, it } from "vitest";
import { buildPipelineTree } from "../metrics-collector";
import type { QueueInfo, GroupInfo } from "../types";

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

function createQueue(overrides: Partial<QueueInfo> = {}): QueueInfo {
  return {
    name: "test-queue",
    displayName: "test-queue",
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
  describe("when given empty queues and no seed keys", () => {
    it("returns empty array", () => {
      expect(buildPipelineTree({ queues: [] })).toEqual([]);
    });
  });

  describe("when given queues with groups", () => {
    it("builds tree with pipeline > type > name hierarchy", () => {
      const queue = createQueue({
        groups: [
          createGroup({
            groupId: "g1",
            pipelineName: "ingest",
            jobType: "handler",
            jobName: "processTrace",
            pendingJobs: 5,
          }),
        ],
      });

      const tree = buildPipelineTree({ queues: [queue] });

      expect(tree).toHaveLength(1);
      expect(tree[0]!.name).toBe("ingest");
      expect(tree[0]!.pending).toBe(5);
      expect(tree[0]!.children).toHaveLength(1);
      expect(tree[0]!.children[0]!.name).toBe("fold"); // "handler" normalizes to "fold"
      expect(tree[0]!.children[0]!.children[0]!.name).toBe("processTrace");
    });
  });

  describe("when given groups without pipeline info", () => {
    it("uses queue displayName as pipeline name", () => {
      const queue = createQueue({
        displayName: "my-queue",
        groups: [createGroup({ pendingJobs: 1 })],
      });

      const tree = buildPipelineTree({ queues: [queue] });

      expect(tree[0]!.name).toBe("my-queue");
    });
  });

  describe("when given seed keys from Redis", () => {
    it("creates nodes for known pipelines even without active groups", () => {
      const tree = buildPipelineTree({
        queues: [],
        seedKeys: ["analytics/fold/traceMetrics"],
      });

      expect(tree).toHaveLength(1);
      expect(tree[0]!.name).toBe("analytics");
      expect(tree[0]!.pending).toBe(0);
      expect(tree[0]!.children[0]!.name).toBe("fold");
      expect(tree[0]!.children[0]!.children[0]!.name).toBe("traceMetrics");
    });
  });

  describe("when given multiple queues", () => {
    it("aggregates counts across queues", () => {
      const q1 = createQueue({
        groups: [
          createGroup({
            pipelineName: "ingest",
            jobType: "command",
            jobName: "cmd1",
            pendingJobs: 3,
          }),
        ],
      });
      const q2 = createQueue({
        groups: [
          createGroup({
            pipelineName: "ingest",
            jobType: "command",
            jobName: "cmd1",
            pendingJobs: 7,
          }),
        ],
      });

      const tree = buildPipelineTree({ queues: [q1, q2] });

      expect(tree[0]!.pending).toBe(10);
    });
  });

  describe("when groups have active and blocked counts", () => {
    it("propagates counts up to parent nodes", () => {
      const queue = createQueue({
        groups: [
          createGroup({
            pipelineName: "p1",
            jobType: "fold",
            jobName: "proj1",
            pendingJobs: 2,
            hasActiveJob: true,
            isBlocked: false,
          }),
          createGroup({
            groupId: "g2",
            pipelineName: "p1",
            jobType: "fold",
            jobName: "proj2",
            pendingJobs: 1,
            hasActiveJob: false,
            isBlocked: true,
          }),
        ],
      });

      const tree = buildPipelineTree({ queues: [queue] });
      const pipeline = tree[0]!;

      expect(pipeline.pending).toBe(3);
      expect(pipeline.active).toBe(1);
      expect(pipeline.blocked).toBe(1);
    });
  });

  describe("when pipeline names are unsorted", () => {
    it("sorts tree nodes alphabetically", () => {
      const queue = createQueue({
        groups: [
          createGroup({ pipelineName: "zebra", jobType: "command", jobName: "a" }),
          createGroup({ groupId: "g2", pipelineName: "alpha", jobType: "command", jobName: "a" }),
        ],
      });

      const tree = buildPipelineTree({ queues: [queue] });

      expect(tree[0]!.name).toBe("alpha");
      expect(tree[1]!.name).toBe("zebra");
    });
  });

  describe("when job types need normalization", () => {
    it("normalizes 'handler' to 'fold'", () => {
      const queue = createQueue({
        groups: [createGroup({ pipelineName: "p", jobType: "handler", jobName: "n" })],
      });

      const tree = buildPipelineTree({ queues: [queue] });
      expect(tree[0]!.children[0]!.name).toBe("fold");
    });

    it("normalizes 'projection' to 'fold'", () => {
      const queue = createQueue({
        groups: [createGroup({ pipelineName: "p", jobType: "projection", jobName: "n" })],
      });

      const tree = buildPipelineTree({ queues: [queue] });
      expect(tree[0]!.children[0]!.name).toBe("fold");
    });

    it("normalizes 'reaction' to 'reactor'", () => {
      const queue = createQueue({
        groups: [createGroup({ pipelineName: "p", jobType: "reaction", jobName: "n" })],
      });

      const tree = buildPipelineTree({ queues: [queue] });
      expect(tree[0]!.children[0]!.name).toBe("reactor");
    });
  });
});
