import { describe, expect, it, vi } from "vitest";

import type { DispatchableMessage } from "~/server/event-sourcing/process-manager";

import { createTopicClusteringIntentHandlers } from "../topicClusteringEffects";

function makeMessage(overrides: Partial<DispatchableMessage> = {}): DispatchableMessage {
  return {
    processName: "topicClustering",
    projectId: "project-1",
    processKey: "project-1",
    tenantId: "project-1",
    messageKey: "run:20260717:page-1",
    intentType: "topic_clustering.run",
    payload: { runId: "20260717", page: 1, searchAfter: null },
    sourceEventId: null,
    attempt: 1,
    ...overrides,
  };
}

function makeCommands() {
  return {
    recordClusteringRunCompleted: vi.fn().mockResolvedValue(undefined),
    recordClusteringRunFailed: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createTopicClusteringIntentHandlers", () => {
  describe("when a clustering page succeeds", () => {
    it("records the completed outcome with the page facts", async () => {
      const commands = makeCommands();
      const handlers = createTopicClusteringIntentHandlers({
        runPort: {
          runClusteringPage: vi.fn().mockResolvedValue({
            mode: "incremental",
            tracesProcessed: 250,
            topicsCount: 8,
            subtopicsCount: 20,
            nextSearchAfter: [123, "trace-a"],
          }),
        },
        commands,
        clock: () => 999,
      });

      await handlers["topic_clustering.run"]!({ message: makeMessage() });

      expect(commands.recordClusteringRunCompleted).toHaveBeenCalledWith({
        tenantId: "project-1",
        occurredAt: 999,
        runId: "20260717",
        page: 1,
        mode: "incremental",
        tracesProcessed: 250,
        topicsCount: 8,
        subtopicsCount: 20,
        nextSearchAfter: [123, "trace-a"],
      });
      expect(commands.recordClusteringRunFailed).not.toHaveBeenCalled();
    });
  });

  describe("when a page is skipped by a gate", () => {
    it("forwards the skip reason on the completed outcome", async () => {
      const commands = makeCommands();
      const handlers = createTopicClusteringIntentHandlers({
        runPort: {
          runClusteringPage: vi.fn().mockResolvedValue({
            mode: "batch",
            tracesProcessed: 0,
            topicsCount: 0,
            subtopicsCount: 0,
            skippedReason: "recently_clustered",
          }),
        },
        commands,
        clock: () => 999,
      });

      await handlers["topic_clustering.run"]!({ message: makeMessage() });

      expect(commands.recordClusteringRunCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ skippedReason: "recently_clustered" }),
      );
    });
  });

  describe("when clustering fails below the attempt cap", () => {
    it("rethrows so the outbox retries and records nothing", async () => {
      const commands = makeCommands();
      const handlers = createTopicClusteringIntentHandlers({
        runPort: {
          runClusteringPage: vi
            .fn()
            .mockRejectedValue(new Error("langevals unavailable")),
        },
        commands,
      });

      await expect(
        handlers["topic_clustering.run"]!({
          message: makeMessage({ attempt: 2 }),
        }),
      ).rejects.toThrow("langevals unavailable");

      expect(commands.recordClusteringRunFailed).not.toHaveBeenCalled();
      expect(commands.recordClusteringRunCompleted).not.toHaveBeenCalled();
    });
  });

  describe("when clustering fails on the final attempt", () => {
    it("records a durable run_failed instead of dying silently", async () => {
      const commands = makeCommands();
      const handlers = createTopicClusteringIntentHandlers({
        runPort: {
          runClusteringPage: vi
            .fn()
            .mockRejectedValue(new Error("langevals unavailable")),
        },
        commands,
        clock: () => 999,
      });

      await handlers["topic_clustering.run"]!({
        message: makeMessage({ attempt: 3 }),
      });

      expect(commands.recordClusteringRunFailed).toHaveBeenCalledWith({
        tenantId: "project-1",
        occurredAt: 999,
        runId: "20260717",
        page: 1,
        error: "langevals unavailable",
      });
    });
  });
});
