import { describe, expect, it, vi } from "vitest";

import type { DispatchableMessage } from "~/server/event-sourcing/process-manager";

import { ModelNotConfiguredError } from "~/server/modelProviders/modelNotConfiguredError";
import {
  CLUSTERING_ERROR_CODES,
  ClusteringError,
} from "../../clustering-error";
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

  describe("when the page succeeds but recording its outcome fails", () => {
    it("does not rethrow, so the outbox cannot re-run the expensive page", async () => {
      const commands = makeCommands();
      commands.recordClusteringRunCompleted.mockRejectedValue(
        new Error("clickhouse append failed"),
      );
      const runClusteringPage = vi.fn().mockResolvedValue({
        mode: "batch",
        tracesProcessed: 2_000,
        topicsCount: 8,
        subtopicsCount: 20,
        nextSearchAfter: [123, "trace-a"],
      });
      const handlers = createTopicClusteringIntentHandlers({
        runPort: { runClusteringPage },
        commands,
        clock: () => 999,
      });

      await expect(
        handlers["topic_clustering.run"]!({ message: makeMessage() }),
      ).resolves.toBeUndefined();

      expect(runClusteringPage).toHaveBeenCalledTimes(1);
      // Recording the run as failed would be a lie — the clustering worked.
      expect(commands.recordClusteringRunFailed).not.toHaveBeenCalled();
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
            .mockRejectedValue(
              new ClusteringError(
                CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE,
                "langevals unavailable",
              ),
            ),
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
        errorCode: "clustering_service",
        userActionable: false,
      });
    });

    it("marks a missing model configuration as the customer's to fix", async () => {
      const commands = makeCommands();
      const handlers = createTopicClusteringIntentHandlers({
        runPort: {
          runClusteringPage: vi
            .fn()
            .mockRejectedValue(
              new ModelNotConfiguredError(
                "analytics.topic_clustering_llm",
                "FAST",
                "Topic clustering",
                "project-1",
              ),
            ),
        },
        commands,
        clock: () => 999,
      });

      await handlers["topic_clustering.run"]!({
        message: makeMessage({ attempt: 3 }),
      });

      expect(commands.recordClusteringRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "model_not_configured",
          userActionable: true,
        }),
      );
    });

    /**
     * The regression that motivated moving classification to the throw site: an
     * error we did not raise ourselves must never be reported as the customer's
     * configuration being wrong, however much its text reads like it.
     */
    it("never blames the customer for an error it cannot attribute", async () => {
      const commands = makeCommands();
      const handlers = createTopicClusteringIntentHandlers({
        runPort: {
          runClusteringPage: vi
            .fn()
            .mockRejectedValue(
              new Error("Code: 499. DB::Exception: 403 Forbidden (S3Error)"),
            ),
        },
        commands,
        clock: () => 999,
      });

      await handlers["topic_clustering.run"]!({
        message: makeMessage({ attempt: 3 }),
      });

      expect(commands.recordClusteringRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "internal",
          userActionable: false,
        }),
      );
    });
  });
});
