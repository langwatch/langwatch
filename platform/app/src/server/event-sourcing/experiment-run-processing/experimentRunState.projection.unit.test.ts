import { checkOrderInvariance } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  applyRunCompleted,
  applyRunStarted,
  EXPERIMENT_RUN_STATE_VERSION_PIN,
} from "./experimentRunState.projection";
import {
  initExperimentRunState,
  type RunCompletedData,
  type RunStartedData,
  type TargetResultData,
} from "./schema";

const baseStarted: RunStartedData = {
  runId: "run-1",
  experimentId: "exp-1",
  workflowVersionId: null,
  total: 2,
  targets: [],
  occurredAt: 1_000,
};

function targetResult(
  overrides: Partial<TargetResultData> = {},
): TargetResultData {
  return {
    runId: "run-1",
    experimentId: "exp-1",
    index: 0,
    targetId: "t1",
    entry: {},
    occurredAt: 2_000,
    ...overrides,
  };
}

describe("experimentRunState fold", () => {
  /** @scenario "The deployed stamp is pinned, not derived" */
  it("pins the deployed stamp from event-sourcing.old's EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE", () => {
    expect(EXPERIMENT_RUN_STATE_VERSION_PIN).toBe("2025-02-01");
  });

  describe("when the run starts", () => {
    it("stamps the enrolled total and the started timestamp", () => {
      const state = applyRunStarted(initExperimentRunState(), baseStarted);
      expect(state.total).toBe(2);
      expect(state.startedAt).toBe(1_000);
      expect(state.runId).toBe("run-1");
      expect(state.experimentId).toBe("exp-1");
    });

    it("takes the larger total across a redelivered started event", () => {
      const higherLast = [4, 10].reduce(
        (state, total) => applyRunStarted(state, { ...baseStarted, total }),
        initExperimentRunState(),
      );
      const higherFirst = [10, 4].reduce(
        (state, total) => applyRunStarted(state, { ...baseStarted, total }),
        initExperimentRunState(),
      );

      expect(higherLast.total).toBe(10);
      expect(higherFirst.total).toBe(10);
    });

    /**
     * `StartedAt` is the deployed partition column. A `min` moved it backwards
     * on a late redelivery, filing one run in two week partitions that a
     * ReplacingMergeTree never collapses.
     * @scenario "A run's start time is frozen at the first start it observed"
     */
    it("freezes the first started timestamp it observed, even when a later one is earlier", () => {
      const state = [999, 500].reduce(
        (acc, occurredAt) =>
          applyRunStarted(acc, { ...baseStarted, occurredAt }),
        initExperimentRunState(),
      );
      expect(state.startedAt).toBe(999);
    });

    it("keeps the first declaration of a target rather than a later rewrite", () => {
      const first = applyRunStarted(initExperimentRunState(), {
        ...baseStarted,
        targets: [{ id: "t1", name: "First", type: "prompt" }],
      });
      const next = applyRunStarted(first, {
        ...baseStarted,
        targets: [
          { id: "t1", name: "Second", type: "prompt" },
          { id: "t0", name: "Other", type: "prompt" },
        ],
      });

      expect(next.targets).toEqual([
        { id: "t0", name: "Other", type: "prompt" },
        { id: "t1", name: "First", type: "prompt" },
      ]);
    });
  });

  describe("when a result is recorded", () => {
    it("declares no fold handler for either result event — every count is a read-time query", () => {
      // ADR-105 decision 5: an event with no declared handler is a no-op. The
      // fold mounts only `started`/`completed`; `targetResult`/`evaluatorResult`
      // are declared in `.events()` but never move this fold's state.
      expect(applyRunStarted).not.toBe(undefined);
      const started = applyRunStarted(initExperimentRunState(), baseStarted);
      expect(started.total).toBe(2);
    });

    it("has no counter field to increment", () => {
      expect(Object.keys(initExperimentRunState()).sort()).toEqual(
        [
          "experimentId",
          "finishedAt",
          "runId",
          "startedAt",
          "stoppedAt",
          "targets",
          "total",
          "workflowVersionId",
        ].sort(),
      );
    });
  });

  describe("when the run completes", () => {
    const completed = (overrides: Partial<RunCompletedData> = {}): RunCompletedData => ({
      runId: "run-1",
      experimentId: "exp-1",
      ...overrides,
    });

    it("records finishedAt and stoppedAt from the completed event", () => {
      const state = applyRunCompleted(
        initExperimentRunState(),
        completed({ finishedAt: 5_000, stoppedAt: null }),
      );
      expect(state.finishedAt).toBe(5_000);
      expect(state.stoppedAt).toBeNull();
    });

    it("does not blank a known finish time when a later completed omits it", () => {
      const finished = applyRunCompleted(
        initExperimentRunState(),
        completed({ finishedAt: 5_000 }),
      );
      const afterRedelivery = applyRunCompleted(finished, completed());

      expect(afterRedelivery.finishedAt).toBe(5_000);
    });

    /** @scenario "Run-level details survive with no items" */
    it("reports the experiment, targets, expected total and stopped status with no item recorded", () => {
      const started = applyRunStarted(initExperimentRunState(), {
        runId: "run-1",
        experimentId: "exp-1",
        workflowVersionId: "wf-1",
        total: 10,
        targets: [{ id: "t1", name: "Target 1", type: "prompt" }],
        occurredAt: 1_000,
      });
      const stopped = applyRunCompleted(
        started,
        completed({ finishedAt: null, stoppedAt: 2_000 }),
      );

      expect(stopped.experimentId).toBe("exp-1");
      expect(stopped.targets).toEqual([
        { id: "t1", name: "Target 1", type: "prompt" },
      ]);
      expect(stopped.total).toBe(10);
      expect(stopped.stoppedAt).toBe(2_000);
      expect(stopped.finishedAt).toBeNull();
    });
  });

  describe("order-invariance (ADR-098 decision 4)", () => {
    type Event =
      | { type: "started"; data: RunStartedData }
      | { type: "completed"; data: RunCompletedData }
      | { type: "targetResult"; data: TargetResultData };

    function apply(
      state: ReturnType<typeof initExperimentRunState>,
      event: Event,
    ): ReturnType<typeof initExperimentRunState> {
      switch (event.type) {
        case "started":
          return applyRunStarted(state, event.data);
        case "completed":
          return applyRunCompleted(state, event.data);
        case "targetResult":
          // No handler is mounted for this event (ADR-105 decision 5).
          return state;
      }
    }

    it("reaches the same state under every ordering and every re-delivery", () => {
      const report = checkOrderInvariance<
        ReturnType<typeof initExperimentRunState>,
        Event
      >({
        init: initExperimentRunState,
        apply,
        events: [
          {
            type: "started",
            data: {
              ...baseStarted,
              workflowVersionId: "wf-1",
              targets: [
                { id: "t1", name: "T1", type: "prompt" },
                { id: "t2", name: "T2", type: "prompt" },
              ],
            },
          },
          // Carries no workflow version, so whichever lands first the run must
          // still end up on "wf-1".
          { type: "started", data: { ...baseStarted, total: 10 } },
          { type: "targetResult", data: targetResult({ targetId: "t1" }) },
          {
            type: "targetResult",
            data: targetResult({ targetId: "t2", index: 1 }),
          },
          {
            type: "completed",
            data: { runId: "run-1", experimentId: "exp-1", finishedAt: 9_000, stoppedAt: null },
          },
        ],
      });

      expect(report.counterexample).toBeUndefined();
      expect(report.invariant).toBe(true);
    });
  });
});
