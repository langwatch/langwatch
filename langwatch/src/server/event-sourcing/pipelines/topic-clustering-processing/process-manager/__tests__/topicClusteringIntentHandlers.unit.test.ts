import { register } from "prom-client";
import { describe, expect, it, vi } from "vitest";

async function metricValue(
  name: string,
  labels: Record<string, string>,
): Promise<number> {
  const metric = register.getSingleMetric(name);
  if (!metric) return 0;
  const { values } = await metric.get();
  return (
    values.find((v) =>
      Object.entries(labels).every(([k, val]) => v.labels[k] === val),
    )?.value ?? 0
  );
}

import type { IntentContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import { ModelNotConfiguredError } from "~/server/modelProviders/modelNotConfiguredError";
import {
  CLUSTERING_ERROR_CODES,
  ClusteringError,
} from "~/server/app-layer/topic-clustering/clustering-error";
import type { TopicClusteringRunIntent } from "../topicClusteringProcess.types";
import { createTopicClusteringRunHandler } from "../topicClusteringIntentHandlers";

function makePayload(
  overrides: Partial<TopicClusteringRunIntent> = {},
): TopicClusteringRunIntent {
  return { runId: "20260717", page: 1, searchAfter: null, ...overrides };
}

function makeContext(overrides: Partial<IntentContext> = {}): IntentContext {
  return {
    processName: "topicClustering",
    projectId: "project-1",
    processKey: "project-1",
    tenantId: "project-1",
    messageKey: "process:project-1:run:20260717:page-1",
    attempt: 1,
    ...overrides,
  };
}

function makeCommands() {
  return {
    recordClusteringRunStarted: vi.fn().mockResolvedValue(undefined),
    recordClusteringRunCompleted: vi.fn().mockResolvedValue(undefined),
    recordClusteringRunFailed: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createTopicClusteringRunHandler", () => {
  describe("when a page begins", () => {
    it("announces the run before doing the work", async () => {
      const commands = makeCommands();
      const order: string[] = [];
      commands.recordClusteringRunStarted.mockImplementation(async () => {
        order.push("started");
      });
      const run = createTopicClusteringRunHandler({
        runPort: {
          runClusteringPage: vi.fn().mockImplementation(async () => {
            order.push("clustered");
            return {
              mode: "incremental",
              tracesProcessed: 10,
              topicsCount: 1,
              subtopicsCount: 1,
            };
          }),
        },
        commands: () => commands,
        clock: () => 999,
      });

      await run(makePayload(), makeContext());

      expect(commands.recordClusteringRunStarted).toHaveBeenCalledWith({
        tenantId: "project-1",
        occurredAt: 999,
        runId: "20260717",
        page: 1,
      });
      // Announcing after the fact would leave the whole page — minutes of
      // clustering — invisible, which is the window the badge exists for.
      expect(order).toEqual(["started", "clustered"]);
    });

    it("still clusters when the announcement cannot be recorded", async () => {
      const commands = makeCommands();
      commands.recordClusteringRunStarted.mockRejectedValue(
        new Error("event store unavailable"),
      );
      const runClusteringPage = vi.fn().mockResolvedValue({
        mode: "incremental",
        tracesProcessed: 10,
        topicsCount: 1,
        subtopicsCount: 1,
      });
      const run = createTopicClusteringRunHandler({
        runPort: { runClusteringPage },
        commands: () => commands,
        clock: () => 999,
      });

      await run(makePayload(), makeContext());

      // A status announcement must never cost the run it announces.
      expect(runClusteringPage).toHaveBeenCalledTimes(1);
      expect(commands.recordClusteringRunCompleted).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a clustering page succeeds", () => {
    it("records the completed outcome with the page facts", async () => {
      const commands = makeCommands();
      const run = createTopicClusteringRunHandler({
        runPort: {
          runClusteringPage: vi.fn().mockResolvedValue({
            mode: "incremental",
            tracesProcessed: 250,
            topicsCount: 8,
            subtopicsCount: 20,
            nextSearchAfter: [123, "trace-a"],
          }),
        },
        commands: () => commands,
        clock: () => 999,
      });

      await run(makePayload(), makeContext());

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
      const run = createTopicClusteringRunHandler({
        runPort: {
          runClusteringPage: vi.fn().mockResolvedValue({
            mode: "batch",
            tracesProcessed: 0,
            topicsCount: 0,
            subtopicsCount: 0,
            skippedReason: "recently_clustered",
          }),
        },
        commands: () => commands,
        clock: () => 999,
      });

      await run(makePayload(), makeContext());

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
      const run = createTopicClusteringRunHandler({
        runPort: { runClusteringPage },
        commands: () => commands,
        clock: () => 999,
      });

      await expect(
        run(makePayload(), makeContext()),
      ).resolves.toBeUndefined();

      expect(runClusteringPage).toHaveBeenCalledTimes(1);
      // Recording the run as failed would be a lie — the clustering worked.
      expect(commands.recordClusteringRunFailed).not.toHaveBeenCalled();
    });
  });

  describe("when clustering fails below the attempt cap", () => {
    it("rethrows so the outbox retries and records nothing", async () => {
      const commands = makeCommands();
      const run = createTopicClusteringRunHandler({
        runPort: {
          runClusteringPage: vi
            .fn()
            .mockRejectedValue(new Error("langevals unavailable")),
        },
        commands: () => commands,
      });

      await expect(
        run(makePayload(), makeContext({ attempt: 2 })),
      ).rejects.toThrow("langevals unavailable");

      expect(commands.recordClusteringRunFailed).not.toHaveBeenCalled();
      expect(commands.recordClusteringRunCompleted).not.toHaveBeenCalled();
    });
  });

  describe("when clustering fails on the final attempt", () => {
    it("records a durable run_failed instead of dying silently", async () => {
      const commands = makeCommands();
      const run = createTopicClusteringRunHandler({
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
        commands: () => commands,
        clock: () => 999,
      });

      await run(makePayload(), makeContext({ attempt: 3 }));

      expect(commands.recordClusteringRunFailed).toHaveBeenCalledWith({
        tenantId: "project-1",
        occurredAt: 999,
        runId: "20260717",
        page: 1,
        error: "langevals unavailable",
        errorCode: "clustering_service",
        isUserActionable: false,
      });
    });

    it("marks a missing model configuration as the customer's to fix", async () => {
      const commands = makeCommands();
      const run = createTopicClusteringRunHandler({
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
        commands: () => commands,
        clock: () => 999,
      });

      await run(makePayload(), makeContext({ attempt: 3 }));

      expect(commands.recordClusteringRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "model_not_configured",
          isUserActionable: true,
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
      const run = createTopicClusteringRunHandler({
        runPort: {
          runClusteringPage: vi
            .fn()
            .mockRejectedValue(
              new Error("Code: 499. DB::Exception: 403 Forbidden (S3Error)"),
            ),
        },
        commands: () => commands,
        clock: () => 999,
      });

      await run(makePayload(), makeContext({ attempt: 3 }));

      expect(commands.recordClusteringRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "internal",
          isUserActionable: false,
        }),
      );
    });

    /**
     * The failure path used to let a failing outcome-write propagate while the
     * success path swallowed it. That asymmetry meant the WORST case — the page
     * failed AND we could not say so — was the one that lost the record: the
     * outbox marked the message dead and no run_failed was ever written.
     */
    describe("when recording the failure itself fails", () => {
      it("does not rethrow, so the outbox cannot retire the message without a recorded outcome", async () => {
        const commands = makeCommands();
        commands.recordClusteringRunFailed.mockRejectedValue(
          new Error("clickhouse append failed"),
        );
        const runClusteringPage = vi
          .fn()
          .mockRejectedValue(
            new ClusteringError(
              CLUSTERING_ERROR_CODES.CLUSTERING_SERVICE,
              "langevals unavailable",
            ),
          );
        const run = createTopicClusteringRunHandler({
          runPort: { runClusteringPage },
          commands: () => commands,
          clock: () => 999,
        });

        await expect(
          run(makePayload(), makeContext({ attempt: 3 })),
        ).resolves.toBeUndefined();
      });

      it("does not retry the page that already exhausted every attempt", async () => {
        const commands = makeCommands();
        commands.recordClusteringRunFailed.mockRejectedValue(
          new Error("clickhouse append failed"),
        );
        const runClusteringPage = vi
          .fn()
          .mockRejectedValue(new Error("langevals unavailable"));
        const run = createTopicClusteringRunHandler({
          runPort: { runClusteringPage },
          commands: () => commands,
          clock: () => 999,
        });

        await run(makePayload(), makeContext({ attempt: 3 }));

        expect(runClusteringPage).toHaveBeenCalledTimes(1);
        expect(commands.recordClusteringRunCompleted).not.toHaveBeenCalled();
      });
    });
  });
});

describe("run outcome metrics (ADR-054)", () => {
  describe("when the final attempt fails", () => {
    it("counts a failed_final page so the alert rule has a signal", async () => {
      const before = await metricValue("topic_clustering_page_total", {
        outcome: "failed_final",
      });
      const commands = makeCommands();
      const run = createTopicClusteringRunHandler({
        runPort: {
          runClusteringPage: vi.fn().mockRejectedValue(new Error("down")),
        },
        commands: () => commands,
        clock: () => 999,
      });

      await run(makePayload(), makeContext({ attempt: 3 }));

      const after = await metricValue("topic_clustering_page_total", {
        outcome: "failed_final",
      });
      expect(after).toBe(before + 1);
    });
  });

  describe("when a gate skips the page", () => {
    it("counts it as skipped, never as a failure", async () => {
      const beforeSkipped = await metricValue("topic_clustering_page_total", {
        outcome: "skipped",
      });
      const beforeFailed = await metricValue("topic_clustering_page_total", {
        outcome: "failed_final",
      });
      const commands = makeCommands();
      const run = createTopicClusteringRunHandler({
        runPort: {
          runClusteringPage: vi.fn().mockResolvedValue({
            mode: "batch",
            tracesProcessed: 0,
            topicsCount: 0,
            subtopicsCount: 0,
            skippedReason: "recently_clustered",
          }),
        },
        commands: () => commands,
        clock: () => 999,
      });

      await run(makePayload(), makeContext());

      expect(
        await metricValue("topic_clustering_page_total", {
          outcome: "skipped",
        }),
      ).toBe(beforeSkipped + 1);
      expect(
        await metricValue("topic_clustering_page_total", {
          outcome: "failed_final",
        }),
      ).toBe(beforeFailed);
    });
  });
});
