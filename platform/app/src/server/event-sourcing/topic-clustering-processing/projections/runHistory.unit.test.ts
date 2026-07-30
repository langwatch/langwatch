import { checkOrderInvariance } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { mintManualRunId, mintScheduledRunId } from "../runIdentity";
import type { RunCompletedData, RunFailedData, RunStartedData } from "../schema";
import {
  deriveRunHistoryView,
  handleRunCompleted,
  handleRunFailed,
  handleRunStarted,
  initRunHistoryState,
  RUN_HISTORY_LIMIT,
  type RunHistoryState,
} from "./runHistory";

const PROJECT_ID = "project-1";

type Event =
  | { type: "runStarted"; data: RunStartedData }
  | { type: "runCompleted"; data: RunCompletedData }
  | { type: "runFailed"; data: RunFailedData };

function apply(state: RunHistoryState, event: Event): RunHistoryState {
  switch (event.type) {
    case "runStarted":
      return handleRunStarted(state, event.data);
    case "runCompleted":
      return handleRunCompleted(state, event.data);
    case "runFailed":
      return handleRunFailed(state, event.data);
  }
}

const runStarted = (runId: string): Event => ({
  type: "runStarted",
  data: { projectId: PROJECT_ID, runId, page: 1, occurredAt: 1_700_000_000_000 },
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
  data: { projectId: PROJECT_ID, runId, page: 1, error: "boom", occurredAt: 1_700_000_100_000, ...overrides },
});

describe("topicClusteringRunHistory fold", () => {
  /** @scenario Each finished run appears once in the run history */
  it("shows one entry for a run, carrying when it ran and its outcome", () => {
    const runId = mintManualRunId(1_700_000_000_000);
    let state = initRunHistoryState();
    state = apply(state, runStarted(runId));
    state = apply(state, runCompleted(runId, { tracesProcessed: 12, topicsCount: 4 }));

    const view = deriveRunHistoryView(state);
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ runId, outcome: "completed", tracesProcessed: 12, topicsCount: 4 });
  });

  /** @scenario A multi-page run is one history entry */
  it("totals a multi-page run's per-page traces into a single entry", () => {
    const runId = mintManualRunId(1_700_000_000_000);
    let state = initRunHistoryState();
    state = apply(state, runStarted(runId));
    state = apply(state, runCompleted(runId, { page: 1, tracesProcessed: 4, nextSearchAfter: [1, "t1"] }));
    state = apply(state, runCompleted(runId, { page: 2, tracesProcessed: 6, nextSearchAfter: [2, "t2"] }));
    state = apply(state, runCompleted(runId, { page: 3, tracesProcessed: 2 }));

    const view = deriveRunHistoryView(state);
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ tracesProcessed: 12, pages: 3, outcome: "completed" });
  });

  /** @scenario A failed run keeps its guidance without raw error detail */
  it("carries an errorCode but never a raw error message", () => {
    const runId = mintManualRunId(1_700_000_000_000);
    const view = deriveRunHistoryView(
      apply(initRunHistoryState(), runFailed(runId, { errorCode: "model_provider_not_configured", isUserActionable: true })),
    );
    expect(view[0]).toMatchObject({
      outcome: "failed",
      errorCode: "model_provider_not_configured",
      isErrorUserActionable: true,
      tracesProcessed: 0,
    });
    expect(view[0]).not.toHaveProperty("error");
    expect(view[0]).not.toHaveProperty("errorMessage");
  });

  /** @scenario A run that is still working appears as running */
  it("shows the newest entry as running while it has no terminal event", () => {
    const runId = mintManualRunId(1_700_000_000_000);
    const state = apply(initRunHistoryState(), runStarted(runId));
    expect(deriveRunHistoryView(state)[0]?.outcome).toBe("running");
  });

  describe("given a run abandoned by the scheduler", () => {
    /** @scenario A run abandoned by the scheduler is not shown as running forever */
    it("stops reading as running once a later run starts", () => {
      const older = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      const newer = mintScheduledRunId(Date.UTC(2026, 6, 18, 9, 30, 0));

      let state = initRunHistoryState();
      state = apply(state, runStarted(older));
      // The older run never gets a terminal event — the abandonment case.
      state = apply(state, runStarted(newer));

      const view = deriveRunHistoryView(state);
      expect(view.find((entry) => entry.runId === older)?.outcome).toBe("abandoned");
      expect(view.find((entry) => entry.runId === newer)?.outcome).toBe("running");
    });

    it("does not abandon the newest run relative to itself", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      const state = apply(initRunHistoryState(), runStarted(runId));
      expect(deriveRunHistoryView(state)[0]?.outcome).toBe("running");
    });
  });

  /** @scenario History is bounded */
  it("keeps only the most recent RUN_HISTORY_LIMIT runs", () => {
    let state = initRunHistoryState();
    for (let i = 0; i < RUN_HISTORY_LIMIT + 10; i++) {
      const runId = mintScheduledRunId(Date.UTC(2026, 0, 1 + i, 9, 0, 0));
      state = apply(state, runCompleted(runId, { tracesProcessed: i }));
    }
    const view = deriveRunHistoryView(state);
    expect(view).toHaveLength(RUN_HISTORY_LIMIT);
    expect(view[0]?.tracesProcessed).toBe(RUN_HISTORY_LIMIT + 9);
    expect(view.at(-1)?.tracesProcessed).toBe(10);
  });

  describe("trigger labelling", () => {
    it("labels a manual-* run id as manual and everything else as scheduled", () => {
      const manual = mintManualRunId(1_700_000_000_000);
      const scheduled = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      let state = initRunHistoryState();
      state = apply(state, runStarted(manual));
      state = apply(state, runStarted(scheduled));
      const view = deriveRunHistoryView(state);
      expect(view.find((entry) => entry.runId === manual)?.trigger).toBe("manual");
      expect(view.find((entry) => entry.runId === scheduled)?.trigger).toBe("scheduled");
    });
  });

  describe("order invariance (ADR-098 decision 4)", () => {
    /** @scenario A multi-page run is one history entry */
    it("reaches the same state under every order and every re-delivery of a run's pages", () => {
      const runId = mintManualRunId(1_700_000_000_000);
      const events: Event[] = [
        runStarted(runId),
        runCompleted(runId, { page: 1, tracesProcessed: 4, nextSearchAfter: [1, "t1"] }),
        runCompleted(runId, { page: 2, tracesProcessed: 6, nextSearchAfter: [2, "t2"] }),
        runCompleted(runId, { page: 3, tracesProcessed: 2 }),
      ];
      const report = checkOrderInvariance({ init: initRunHistoryState, apply, events });
      expect(report.invariant).toBe(true);
      expect(report.duplicatesChecked).toBe(events.length);
    });

    /** @scenario A run abandoned by the scheduler is not shown as running forever */
    it("reaches the same abandonment verdict regardless of which run's events arrive first", () => {
      const older = mintScheduledRunId(Date.UTC(2026, 6, 17, 9, 30, 0));
      const newer = mintScheduledRunId(Date.UTC(2026, 6, 18, 9, 30, 0));
      const events: Event[] = [runStarted(older), runStarted(newer), runCompleted(newer, { tracesProcessed: 3 })];
      const report = checkOrderInvariance({ init: initRunHistoryState, apply, events });
      expect(report.invariant).toBe(true);

      const forward = events.reduce(apply, initRunHistoryState());
      const backward = [...events].reverse().reduce(apply, initRunHistoryState());
      expect(deriveRunHistoryView(forward)).toEqual(deriveRunHistoryView(backward));
    });

    it("reaches the same bounded population regardless of arrival order", () => {
      const events: Event[] = Array.from({ length: 8 }, (_unused, i) =>
        runCompleted(mintScheduledRunId(Date.UTC(2026, 0, 1 + i, 9, 0, 0)), { tracesProcessed: i }),
      );
      const report = checkOrderInvariance({ init: initRunHistoryState, apply, events, maxPermutations: 40 });
      expect(report.invariant).toBe(true);
    });
  });
});
