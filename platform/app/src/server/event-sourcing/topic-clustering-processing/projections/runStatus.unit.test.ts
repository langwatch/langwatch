import {
  type AggregateEvent,
  checkOrderInvariance,
} from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { topicClustering } from "../aggregate";
import { mintManualRunId, mintScheduledRunId } from "../runIdentity";
import type { RequestedData, RunCompletedData, RunFailedData } from "../schema";
import {
  applyRunStatusEvent,
  deriveRunStatusView,
  initRunStatusState,
} from "./runStatus";

// Built through `topicClustering.events.*`, the aggregate's own derived
// creators — never a hand-typed `{ type: "topic_clustering/...", data }`
// literal, so a rename in `aggregate.ts` fails these fixtures at the
// compiler rather than at a mismatched string silently never dispatching.
const requested = (
  overrides: Partial<Pick<RequestedData, "trigger" | "occurredAt">> = {},
) =>
  topicClustering.events.requested({
    trigger: "manual",
    occurredAt: 1_700_000_000_000,
    ...overrides,
  });

const runStarted = (runId: string) =>
  topicClustering.events.runStarted({
    runId,
    page: 1,
    occurredAt: 1_700_000_000_000,
  });

const runCompleted = (
  runId: string,
  overrides: Partial<Omit<RunCompletedData, "runId">> = {},
) =>
  topicClustering.events.runCompleted({
    runId,
    page: 1,
    mode: "batch",
    tracesProcessed: 10,
    topicsCount: 3,
    subtopicsCount: 5,
    occurredAt: 1_700_000_100_000,
    ...overrides,
  });

const runFailed = (
  runId: string,
  overrides: Partial<Omit<RunFailedData, "runId">> = {},
) =>
  topicClustering.events.runFailed({
    runId,
    page: 1,
    error: "boom",
    occurredAt: 1_700_000_100_000,
    ...overrides,
  });

describe("topicClusteringRunStatus fold", () => {
  describe("given a request event", () => {
    it("records the last requested time and trigger", () => {
      const state = applyRunStatusEvent(
        initRunStatusState(),
        requested({ trigger: "manual" }),
      );
      expect(state.lastRequestedAt).toBe(1_700_000_000_000);
      expect(state.lastRequestTrigger).toBe("manual");
    });

    it("ignores a request whose occurredAt is not newer than what is already recorded", () => {
      const afterNewer = applyRunStatusEvent(
        applyRunStatusEvent(
          initRunStatusState(),
          requested({ occurredAt: 2_000 }),
        ),
        requested({ occurredAt: 1_000, trigger: "bootstrap" }),
      );
      expect(afterNewer.lastRequestedAt).toBe(2_000);
      expect(afterNewer.lastRequestTrigger).toBe("manual");
    });
  });

  describe("given a run's lifecycle", () => {
    /** @scenario A run in progress is visible while it is still working */
    it("shows the run in progress once it has started but not finished", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      const state = applyRunStatusEvent(
        initRunStatusState(),
        runStarted(runId),
      );
      const view = deriveRunStatusView(state);
      expect(view.isRunInProgress).toBe(true);
      expect(view.inProgressRunId).toBe(runId);
      expect(view.lastRun).toBeNull();
    });

    /** @scenario A large backlog is processed page by page through durable cursors */
    it("keeps the run in progress and accumulates counts across continuation pages", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      let state = initRunStatusState();
      state = applyRunStatusEvent(state, runStarted(runId));
      state = applyRunStatusEvent(
        state,
        runCompleted(runId, { tracesProcessed: 4, nextSearchAfter: [1, "t1"] }),
      );
      state = applyRunStatusEvent(
        state,
        runCompleted(runId, { tracesProcessed: 6, nextSearchAfter: [2, "t2"] }),
      );

      const view = deriveRunStatusView(state);
      expect(view.isRunInProgress).toBe(true);
      expect(state.currentRunTracesSeen).toBe(10);
      expect(state.currentRunPagesSeen).toBe(2);
    });

    it("settles as completed once the final page (no continuation cursor) lands", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      let state = initRunStatusState();
      state = applyRunStatusEvent(state, runStarted(runId));
      state = applyRunStatusEvent(
        state,
        runCompleted(runId, { tracesProcessed: 10 }),
      );

      const view = deriveRunStatusView(state);
      expect(view.isRunInProgress).toBe(false);
      expect(view.lastRun).toMatchObject({
        runId,
        outcome: "completed",
        tracesProcessed: 10,
        topicsCount: 3,
        subtopicsCount: 5,
      });
    });

    it("settles as skipped when the gate declined and no traces were processed", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      const state = applyRunStatusEvent(
        initRunStatusState(),
        runCompleted(runId, {
          tracesProcessed: 0,
          skippedReason: "not_enough_traces",
        }),
      );
      expect(deriveRunStatusView(state).lastRun?.outcome).toBe("skipped");
    });

    /** @scenario A failing clustering effect retries then records a visible failure */
    /** @scenario Internal failures never expose raw error detail to the user */
    it("settles as failed and zeroes the counts, keeping the raw error only in state", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      let state = initRunStatusState();
      state = applyRunStatusEvent(state, runStarted(runId));
      state = applyRunStatusEvent(
        state,
        runCompleted(runId, { tracesProcessed: 5, nextSearchAfter: [1, "t1"] }),
      );
      state = applyRunStatusEvent(
        state,
        runFailed(runId, {
          error: "internal stack trace, never shown to a customer",
          errorCode: "internal",
        }),
      );

      const view = deriveRunStatusView(state);
      expect(view.isRunInProgress).toBe(false);
      expect(view.lastRun).toMatchObject({
        outcome: "failed",
        tracesProcessed: 0,
        topicsCount: 0,
        subtopicsCount: 0,
      });
      // The raw message is in state (operator-facing) but the view never
      // surfaces it — only errorCode/isErrorUserActionable are customer-safe.
      expect(state.currentRunTerminal?.errorMessage).toContain("stack trace");
      expect(view.lastRun).not.toHaveProperty("errorMessage");
    });

    /** @scenario A failure the user can fix shows guidance, not a stack trace */
    it("marks a user-actionable failure so the settings page can show guidance", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      const state = applyRunStatusEvent(
        initRunStatusState(),
        runFailed(runId, {
          error: "no default model configured",
          errorCode: "model_provider_not_configured",
          isUserActionable: true,
        }),
      );
      const view = deriveRunStatusView(state);
      expect(view.lastRun?.errorCode).toBe("model_provider_not_configured");
      expect(view.lastRun?.isErrorUserActionable).toBe(true);
    });
  });

  describe("given a newer run supersedes an older, still-open one", () => {
    /** @scenario A crash mid-backlog resumes from the last committed page */
    it("does not let a stale page from the older run corrupt the newer run's tracking", () => {
      const older = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      const newer = mintScheduledRunId(Date.UTC(2026, 6, 18, 9, 30, 0));

      let state = initRunStatusState();
      state = applyRunStatusEvent(state, runStarted(older));
      state = applyRunStatusEvent(
        state,
        runCompleted(older, {
          tracesProcessed: 999,
          nextSearchAfter: [1, "t1"],
        }),
      );
      // The newer run starts before the older one's stale continuation page
      // is (re)delivered — legal under best-effort ordering.
      state = applyRunStatusEvent(state, runStarted(newer));
      // A stale straggler from the superseded older run arrives late.
      state = applyRunStatusEvent(
        state,
        runCompleted(older, {
          tracesProcessed: 111,
          nextSearchAfter: [2, "t2"],
        }),
      );

      expect(state.currentRunId).toBe(newer);
      // The stale page's 111 traces must never land on the newer run.
      expect(state.currentRunTracesSeen).toBe(0);
    });
  });

  describe("order invariance (ADR-098 decision 4)", () => {
    /** @scenario A large backlog is processed page by page through durable cursors */
    it("reaches the same state regardless of the order a run's pages are delivered in", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      const events: AggregateEvent[] = [
        runStarted(runId),
        runCompleted(runId, { tracesProcessed: 4, nextSearchAfter: [1, "t1"] }),
        runCompleted(runId, { tracesProcessed: 6, nextSearchAfter: [2, "t2"] }),
        runCompleted(runId, { tracesProcessed: 2 }),
      ];

      const report = checkOrderInvariance({
        init: initRunStatusState,
        apply: applyRunStatusEvent,
        events,
      });

      expect(report.invariant).toBe(true);
    });

    it("reaches the same state regardless of the order two competing requests are delivered in", () => {
      const events: AggregateEvent[] = [
        requested({ trigger: "bootstrap", occurredAt: 1_000 }),
        requested({ trigger: "manual", occurredAt: 2_000 }),
        requested({ trigger: "manual", occurredAt: 1_500 }),
      ];

      const report = checkOrderInvariance({
        init: initRunStatusState,
        apply: applyRunStatusEvent,
        events,
      });
      expect(report.invariant).toBe(true);
    });

    it("reaches the same state regardless of the order a superseded run's stragglers arrive in", () => {
      const older = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      const newer = mintScheduledRunId(Date.UTC(2026, 6, 18, 9, 30, 0));
      const events: AggregateEvent[] = [
        runStarted(older),
        runCompleted(older, {
          tracesProcessed: 999,
          nextSearchAfter: [1, "t1"],
        }),
        runStarted(newer),
        runCompleted(older, {
          tracesProcessed: 111,
          nextSearchAfter: [2, "t2"],
        }),
        runCompleted(newer, { tracesProcessed: 7 }),
      ];

      const report = checkOrderInvariance({
        init: initRunStatusState,
        apply: applyRunStatusEvent,
        events,
      });
      expect(report.invariant).toBe(true);
    });

    /**
     * A documented BOUNDARY, not a passing property. `currentRunTerminal`
     * is "sticky-once": whichever terminal event a run's row sees FIRST
     * wins, so if a single run somehow produced both a completion and a
     * failure, which one sticks would genuinely depend on delivery order.
     * The fold does not — and cannot, from inside `apply` alone — rule
     * this out; what rules it out is an operational invariant one layer up
     * (the process manager only ever calls ONE of
     * recordClusteringRunCompleted/recordClusteringRunFailed for a given
     * page — `process-manager/schedule.ts`'s `evolveRunCompleted`/
     * `evolveRunFailed` are mutually exclusive per intent). This test
     * exists so that boundary is visible and pinned, rather than silently
     * assumed: it asserts the harness DOES find a counterexample here, so
     * a future change that removes the process manager's mutual-exclusion
     * guarantee fails loudly here first, not in production.
     */
    it("is order-dependent ONLY for the operationally-impossible case of a run reporting both outcomes", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      const events: AggregateEvent[] = [
        runStarted(runId),
        runCompleted(runId, { tracesProcessed: 5 }),
        runFailed(runId, { errorCode: "x" }),
      ];

      const report = checkOrderInvariance({
        init: initRunStatusState,
        apply: applyRunStatusEvent,
        events,
      });
      expect(report.invariant).toBe(false);
      expect(report.cause).toBe("order");
    });
  });
});
