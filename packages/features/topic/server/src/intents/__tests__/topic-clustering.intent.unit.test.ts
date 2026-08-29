import type { IntentContext } from "@langwatch/eventing";
import { ModelNotConfiguredError } from "@langwatch/model-provider-contract";
import { describe, expect, it, vi } from "vitest";
import {
  createTopicClusteringRunHandler,
  type TopicClusteringDispatchDeps,
  type TopicClusteringRunIntent,
} from "../topic-clustering.intent";

function makePayload(overrides: Partial<TopicClusteringRunIntent> = {}): TopicClusteringRunIntent {
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

function makeMetrics() {
  return {
    incrementPageTotal: vi.fn(),
    observePageDuration: vi.fn(),
  };
}

/**
 * The classifier is an injected port (the taxonomy lives with the clustering
 * execution). These stubs stand in for the production classifier's verdicts;
 * that classifier has its own unit tests where it lives.
 */
const classifyAsInternal: TopicClusteringDispatchDeps["classifyError"] = () => ({
  code: "internal",
  isUserActionable: false,
});

function makeDeps(overrides: {
  runClusteringPage: TopicClusteringDispatchDeps["runPort"]["runClusteringPage"];
  commands: ReturnType<typeof makeCommands>;
  classifyError?: TopicClusteringDispatchDeps["classifyError"];
  metrics?: ReturnType<typeof makeMetrics>;
  clock?: () => number;
}): TopicClusteringDispatchDeps {
  return {
    runPort: { runClusteringPage: overrides.runClusteringPage },
    commands: overrides.commands,
    classifyError: overrides.classifyError ?? classifyAsInternal,
    metrics: overrides.metrics ?? makeMetrics(),
    ...(overrides.clock ? { clock: overrides.clock } : {}),
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
      const run = createTopicClusteringRunHandler(
        makeDeps({
          runClusteringPage: vi.fn().mockImplementation(async () => {
            order.push("clustered");
            return {
              mode: "incremental" as const,
              tracesProcessed: 10,
              topicsCount: 1,
              subtopicsCount: 1,
            };
          }),
          commands,
          clock: () => 999,
        }),
      );

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
      commands.recordClusteringRunStarted.mockRejectedValue(new Error("event store unavailable"));
      const runClusteringPage = vi.fn().mockResolvedValue({
        mode: "incremental",
        tracesProcessed: 10,
        topicsCount: 1,
        subtopicsCount: 1,
      });
      const run = createTopicClusteringRunHandler(
        makeDeps({ runClusteringPage, commands, clock: () => 999 }),
      );

      await run(makePayload(), makeContext());

      // A status announcement must never cost the run it announces.
      expect(runClusteringPage).toHaveBeenCalledTimes(1);
      expect(commands.recordClusteringRunCompleted).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a clustering page succeeds", () => {
    it("records the completed outcome with the page facts", async () => {
      const commands = makeCommands();
      const run = createTopicClusteringRunHandler(
        makeDeps({
          runClusteringPage: vi.fn().mockResolvedValue({
            mode: "incremental",
            tracesProcessed: 250,
            topicsCount: 8,
            subtopicsCount: 20,
            nextSearchAfter: [123, "trace-a"],
          }),
          commands,
          clock: () => 999,
        }),
      );

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
      const run = createTopicClusteringRunHandler(
        makeDeps({
          runClusteringPage: vi.fn().mockResolvedValue({
            mode: "batch",
            tracesProcessed: 0,
            topicsCount: 0,
            subtopicsCount: 0,
            skippedReason: "recently_clustered",
          }),
          commands,
          clock: () => 999,
        }),
      );

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
      const run = createTopicClusteringRunHandler(
        makeDeps({ runClusteringPage, commands, clock: () => 999 }),
      );

      await expect(run(makePayload(), makeContext())).resolves.toBeUndefined();

      expect(runClusteringPage).toHaveBeenCalledTimes(1);
      // Recording the run as failed would be a lie — the clustering worked.
      expect(commands.recordClusteringRunFailed).not.toHaveBeenCalled();
    });
  });

  describe("when clustering fails below the attempt cap", () => {
    it("rethrows so the outbox retries and records nothing", async () => {
      const commands = makeCommands();
      const run = createTopicClusteringRunHandler(
        makeDeps({
          runClusteringPage: vi.fn().mockRejectedValue(new Error("langevals unavailable")),
          commands,
        }),
      );

      await expect(run(makePayload(), makeContext({ attempt: 2 }))).rejects.toThrow(
        "langevals unavailable",
      );

      expect(commands.recordClusteringRunFailed).not.toHaveBeenCalled();
      expect(commands.recordClusteringRunCompleted).not.toHaveBeenCalled();
    });
  });

  describe("when clustering fails for a reason only the customer can fix", () => {
    /** @scenario A failure only the customer can fix is recorded without burning retries */
    it("records run_failed on the first attempt instead of retrying", async () => {
      const commands = makeCommands();
      const runClusteringPage = vi
        .fn()
        .mockRejectedValue(
          new ModelNotConfiguredError(
            "analytics.topic_clustering_llm",
            "FAST",
            "Topic clustering",
            "project-1",
          ),
        );
      const run = createTopicClusteringRunHandler(
        makeDeps({
          runClusteringPage,
          commands,
          classifyError: () => ({
            code: "model_not_configured",
            isUserActionable: true,
          }),
          clock: () => 999,
        }),
      );

      // Resolving rather than throwing is what tells the outbox the intent is
      // finished: a throw here is what would buy the two extra attempts.
      await expect(run(makePayload(), makeContext({ attempt: 1 }))).resolves.toBeUndefined();

      expect(runClusteringPage).toHaveBeenCalledTimes(1);
      expect(commands.recordClusteringRunFailed).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "model_not_configured",
          isUserActionable: true,
        }),
      );
    });
  });

  describe("when clustering fails on the final attempt", () => {
    /** @scenario A failing clustering effect retries then records a visible failure */
    it("records a durable run_failed with the classifier's verdict", async () => {
      const commands = makeCommands();
      const run = createTopicClusteringRunHandler(
        makeDeps({
          runClusteringPage: vi.fn().mockRejectedValue(new Error("langevals unavailable")),
          commands,
          classifyError: () => ({
            code: "clustering_service",
            isUserActionable: false,
          }),
          clock: () => 999,
        }),
      );

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

    it("forwards a user-actionable classification to the failure record", async () => {
      const commands = makeCommands();
      const misconfigured = new Error("no model configured for topic clustering");
      const classifyError = vi.fn().mockReturnValue({
        code: "model_not_configured",
        isUserActionable: true,
      });
      const run = createTopicClusteringRunHandler(
        makeDeps({
          runClusteringPage: vi.fn().mockRejectedValue(misconfigured),
          commands,
          classifyError,
          clock: () => 999,
        }),
      );

      await run(makePayload(), makeContext({ attempt: 3 }));

      expect(classifyError).toHaveBeenCalledWith(misconfigured);
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
     * configuration being wrong, however much its text reads like it. The
     * handler must take the classifier's "internal" verdict as-is.
     */
    it("never blames the customer for an error the classifier cannot attribute", async () => {
      const commands = makeCommands();
      const run = createTopicClusteringRunHandler(
        makeDeps({
          runClusteringPage: vi
            .fn()
            .mockRejectedValue(new Error("Code: 499. DB::Exception: 403 Forbidden (S3Error)")),
          commands,
          clock: () => 999,
        }),
      );

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
        commands.recordClusteringRunFailed.mockRejectedValue(new Error("clickhouse append failed"));
        const runClusteringPage = vi.fn().mockRejectedValue(new Error("langevals unavailable"));
        const run = createTopicClusteringRunHandler(
          makeDeps({ runClusteringPage, commands, clock: () => 999 }),
        );

        await expect(run(makePayload(), makeContext({ attempt: 3 }))).resolves.toBeUndefined();
      });

      it("does not retry the page that already exhausted every attempt", async () => {
        const commands = makeCommands();
        commands.recordClusteringRunFailed.mockRejectedValue(new Error("clickhouse append failed"));
        const runClusteringPage = vi.fn().mockRejectedValue(new Error("langevals unavailable"));
        const run = createTopicClusteringRunHandler(
          makeDeps({ runClusteringPage, commands, clock: () => 999 }),
        );

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
      const metrics = makeMetrics();
      const run = createTopicClusteringRunHandler(
        makeDeps({
          runClusteringPage: vi.fn().mockRejectedValue(new Error("down")),
          commands: makeCommands(),
          metrics,
          clock: () => 999,
        }),
      );

      await run(makePayload(), makeContext({ attempt: 3 }));

      expect(metrics.incrementPageTotal).toHaveBeenCalledWith({
        outcome: "failed_final",
      });
    });

    it("counts a retryable failure as failed_retryable, never failed_final", async () => {
      const metrics = makeMetrics();
      const run = createTopicClusteringRunHandler(
        makeDeps({
          runClusteringPage: vi.fn().mockRejectedValue(new Error("down")),
          commands: makeCommands(),
          metrics,
        }),
      );

      await expect(run(makePayload(), makeContext({ attempt: 1 }))).rejects.toThrow("down");

      expect(metrics.incrementPageTotal).toHaveBeenCalledWith({
        outcome: "failed_retryable",
      });
      expect(metrics.incrementPageTotal).not.toHaveBeenCalledWith({
        outcome: "failed_final",
      });
    });
  });

  describe("when the failure is the customer's to fix", () => {
    it("counts a failed_customer page, keeping failed_final an internal-fault signal", async () => {
      const metrics = makeMetrics();
      const commands = makeCommands();
      const run = createTopicClusteringRunHandler(
        makeDeps({
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
          commands,
          classifyError: () => ({
            code: "model_not_configured",
            isUserActionable: true,
          }),
          metrics,
          clock: () => 999,
        }),
      );

      await run(makePayload(), makeContext({ attempt: 1 }));

      expect(metrics.incrementPageTotal).toHaveBeenCalledWith({
        outcome: "failed_customer",
      });
      expect(metrics.incrementPageTotal).not.toHaveBeenCalledWith({
        outcome: "failed_final",
      });
    });
  });

  describe("when a gate skips the page", () => {
    it("counts it as skipped, never as a failure", async () => {
      const metrics = makeMetrics();
      const run = createTopicClusteringRunHandler(
        makeDeps({
          runClusteringPage: vi.fn().mockResolvedValue({
            mode: "batch",
            tracesProcessed: 0,
            topicsCount: 0,
            subtopicsCount: 0,
            skippedReason: "recently_clustered",
          }),
          commands: makeCommands(),
          metrics,
          clock: () => 999,
        }),
      );

      await run(makePayload(), makeContext());

      expect(metrics.incrementPageTotal).toHaveBeenCalledWith({ outcome: "skipped" });
      expect(metrics.incrementPageTotal).not.toHaveBeenCalledWith({
        outcome: "failed_final",
      });
      expect(metrics.observePageDuration).toHaveBeenCalledWith({
        mode: "batch",
        durationMs: 0,
      });
    });
  });
});
