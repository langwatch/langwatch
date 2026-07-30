import { checkOrderInvariance } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { mintManualRunId, mintScheduledRunId } from "../runIdentity";
import type {
  RequestedData,
  RunCompletedData,
  RunFailedData,
  RunStartedData,
} from "../schema";
import {
  deriveRunStatusView,
  handleRequested,
  handleRunCompleted,
  handleRunFailed,
  handleRunStarted,
  initRunStatusState,
  type RunStatusState,
} from "./runStatus";

const PROJECT_ID = "project-1";

type Event =
  | { type: "requested"; data: RequestedData }
  | { type: "runStarted"; data: RunStartedData }
  | { type: "runCompleted"; data: RunCompletedData }
  | { type: "runFailed"; data: RunFailedData };

function apply(state: RunStatusState, event: Event): RunStatusState {
  switch (event.type) {
    case "requested":
      return handleRequested(state, event.data);
    case "runStarted":
      return handleRunStarted(state, event.data);
    case "runCompleted":
      return handleRunCompleted(state, event.data);
    case "runFailed":
      return handleRunFailed(state, event.data);
  }
}

const requested = (
  overrides: Partial<Pick<RequestedData, "trigger" | "occurredAt">> = {},
): Event => ({
  type: "requested",
  data: {
    projectId: PROJECT_ID,
    trigger: "manual",
    occurredAt: 1_700_000_000_000,
    ...overrides,
  },
});

const runStarted = (runId: string, page = 1): Event => ({
  type: "runStarted",
  data: { projectId: PROJECT_ID, runId, page, occurredAt: 1_700_000_000_000 },
});

const runCompleted = (
  runId: string,
  overrides: Partial<Omit<RunCompletedData, "runId" | "projectId">> = {},
): Event => ({
  type: "runCompleted",
  data: {
    projectId: PROJECT_ID,
    runId,
    page: 1,
    mode: "batch",
    tracesProcessed: 10,
    topicsCount: 3,
    subtopicsCount: 5,
    occurredAt: 1_700_000_100_000,
    ...overrides,
  },
});

const runFailed = (
  runId: string,
  overrides: Partial<Omit<RunFailedData, "runId" | "projectId">> = {},
): Event => ({
  type: "runFailed",
  data: {
    projectId: PROJECT_ID,
    runId,
    page: 1,
    error: "boom",
    occurredAt: 1_700_000_100_000,
    ...overrides,
  },
});

describe("topicClusteringRunStatus fold", () => {
  describe("given a request event", () => {
    it("records the last requested time and trigger", () => {
      const state = apply(
        initRunStatusState(),
        requested({ trigger: "manual" }),
      );
      expect(state.lastRequestedAt).toBe(1_700_000_000_000);
      expect(state.lastRequestTrigger).toBe("manual");
    });

    it("ignores a request whose occurredAt is not newer than what is already recorded", () => {
      const afterNewer = apply(
        apply(initRunStatusState(), requested({ occurredAt: 2_000 })),
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
      const view = deriveRunStatusView(
        apply(initRunStatusState(), runStarted(runId)),
      );
      expect(view.isRunInProgress).toBe(true);
      expect(view.inProgressRunId).toBe(runId);
      expect(view.lastRun).toBeNull();
    });

    /** @scenario A large backlog is processed page by page through durable cursors */
    it("keeps the run in progress and records each page's traces under its own page", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      let state = initRunStatusState();
      state = apply(state, runStarted(runId));
      state = apply(
        state,
        runCompleted(runId, {
          page: 1,
          tracesProcessed: 4,
          nextSearchAfter: [1, "t1"],
        }),
      );
      state = apply(
        state,
        runCompleted(runId, {
          page: 2,
          tracesProcessed: 6,
          nextSearchAfter: [2, "t2"],
        }),
      );

      expect(deriveRunStatusView(state).isRunInProgress).toBe(true);
      expect(state.currentRunPages).toEqual({ 1: 4, 2: 6 });
    });

    it("settles as completed once the final page (no continuation cursor) lands", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      let state = initRunStatusState();
      state = apply(state, runStarted(runId));
      state = apply(state, runCompleted(runId, { tracesProcessed: 10 }));

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
      const state = apply(
        initRunStatusState(),
        runCompleted(runId, {
          tracesProcessed: 0,
          skippedReason: "not_enough_traces",
        }),
      );
      expect(deriveRunStatusView(state).lastRun?.outcome).toBe("skipped");
    });

    /** @scenario A failing clustering effect retries then records a visible failure */
    it("settles as failed and zeroes the counts, keeping the raw error only in state", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      let state = initRunStatusState();
      state = apply(state, runStarted(runId));
      state = apply(
        state,
        runCompleted(runId, { tracesProcessed: 5, nextSearchAfter: [1, "t1"] }),
      );
      state = apply(
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
      expect(state.currentRunTerminal?.errorMessage).toContain("stack trace");
      expect(view.lastRun).not.toHaveProperty("errorMessage");
    });

    /** @scenario A failure the user can fix shows guidance, not a stack trace */
    it("marks a user-actionable failure so the settings page can show guidance", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      const view = deriveRunStatusView(
        apply(
          initRunStatusState(),
          runFailed(runId, {
            error: "no default model configured",
            errorCode: "model_provider_not_configured",
            isUserActionable: true,
          }),
        ),
      );
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
      state = apply(state, runStarted(older));
      state = apply(
        state,
        runCompleted(older, {
          page: 1,
          tracesProcessed: 999,
          nextSearchAfter: [1, "t1"],
        }),
      );
      // The newer run starts before the older one's stale continuation page is
      // (re)delivered — legal under best-effort ordering.
      state = apply(state, runStarted(newer));
      state = apply(
        state,
        runCompleted(older, {
          page: 2,
          tracesProcessed: 111,
          nextSearchAfter: [2, "t2"],
        }),
      );

      expect(state.currentRunId).toBe(newer);
      expect(state.currentRunPages).toEqual({});
    });
  });

  describe("order invariance (ADR-098 decision 4)", () => {
    /** @scenario A large backlog is processed page by page through durable cursors */
    it("reaches the same state under every order and every re-delivery of a run's pages", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      const events: Event[] = [
        runStarted(runId),
        runCompleted(runId, {
          page: 1,
          tracesProcessed: 4,
          nextSearchAfter: [1, "t1"],
        }),
        runCompleted(runId, {
          page: 2,
          tracesProcessed: 6,
          nextSearchAfter: [2, "t2"],
        }),
        runCompleted(runId, { page: 3, tracesProcessed: 2 }),
      ];

      const report = checkOrderInvariance({
        init: initRunStatusState,
        apply,
        events,
      });

      expect(report.invariant).toBe(true);
      expect(report.duplicatesChecked).toBe(events.length);
    });

    it("reaches the same state regardless of the order two competing requests are delivered in", () => {
      const events: Event[] = [
        requested({ trigger: "bootstrap", occurredAt: 1_000 }),
        requested({ trigger: "manual", occurredAt: 2_000 }),
        requested({ trigger: "manual", occurredAt: 1_500 }),
      ];

      const report = checkOrderInvariance({
        init: initRunStatusState,
        apply,
        events,
      });
      expect(report.invariant).toBe(true);
    });

    it("reaches the same state regardless of the order a superseded run's stragglers arrive in", () => {
      const older = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      const newer = mintScheduledRunId(Date.UTC(2026, 6, 18, 9, 30, 0));
      const events: Event[] = [
        runStarted(older),
        runCompleted(older, {
          page: 1,
          tracesProcessed: 999,
          nextSearchAfter: [1, "t1"],
        }),
        runStarted(newer),
        runCompleted(older, {
          page: 2,
          tracesProcessed: 111,
          nextSearchAfter: [2, "t2"],
        }),
        runCompleted(newer, { page: 1, tracesProcessed: 7 }),
      ];

      const report = checkOrderInvariance({
        init: initRunStatusState,
        apply,
        events,
      });
      expect(report.invariant).toBe(true);
    });

    /**
     * A pinned boundary, not a passing property. The terminal outcome is
     * frozen on first write, so a run reporting BOTH a completion and a
     * failure would settle differently depending on which arrived first.
     * Nothing inside `apply` can rule that out; the process manager's mutual
     * exclusion does. This fails loudly here first if that ever stops holding.
     */
    it("is order-dependent ONLY for the operationally-impossible case of a run reporting both outcomes", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      const events: Event[] = [
        runStarted(runId),
        runCompleted(runId, { tracesProcessed: 5 }),
        runFailed(runId, { errorCode: "x" }),
      ];

      const report = checkOrderInvariance({
        init: initRunStatusState,
        apply,
        events,
      });
      expect(report.invariant).toBe(false);
      expect(report.cause).toBe("order");
    });
  });
});
