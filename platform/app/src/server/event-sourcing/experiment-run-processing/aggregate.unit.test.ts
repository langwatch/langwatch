import { checkOrderInvariance } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  experimentRun,
  experimentRunAggregateId,
  parseExperimentRunAggregateId,
} from "./aggregate";
import type { RunStartedData, TargetResultData } from "./schema";

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

describe("experimentRun aggregate", () => {
  describe("given events are declared", () => {
    it("derives one type string per event, qualified by the aggregate name", () => {
      expect([...experimentRun.eventTypes].sort()).toEqual([
        "experiment_run/completed",
        "experiment_run/evaluatorResultRecorded",
        "experiment_run/started",
        "experiment_run/targetResultRecorded",
      ]);
    });
  });

  describe("when the run starts", () => {
    it("stamps the enrolled total and the started timestamp", () => {
      const state = experimentRun.apply(
        experimentRun.init(),
        experimentRun.events.started(baseStarted),
      );
      expect(state.total).toBe(2);
      expect(state.startedAt).toBe(1_000);
      expect(state.runId).toBe("run-1");
      expect(state.experimentId).toBe("exp-1");
    });

    it("takes the larger total across a redelivered/duplicated started event (ADR-103 decision 3)", () => {
      let state = experimentRun.init();
      state = experimentRun.apply(
        state,
        experimentRun.events.started({ ...baseStarted, total: 4 }),
      );
      state = experimentRun.apply(
        state,
        experimentRun.events.started({ ...baseStarted, total: 10 }),
      );
      expect(state.total).toBe(10);

      // Order does not matter — max is commutative.
      let reordered = experimentRun.init();
      reordered = experimentRun.apply(
        reordered,
        experimentRun.events.started({ ...baseStarted, total: 10 }),
      );
      reordered = experimentRun.apply(
        reordered,
        experimentRun.events.started({ ...baseStarted, total: 4 }),
      );
      expect(reordered.total).toBe(10);
    });

    it("keeps the first started timestamp rather than a later one", () => {
      let state = experimentRun.init();
      state = experimentRun.apply(
        state,
        experimentRun.events.started({ ...baseStarted, occurredAt: 500 }),
      );
      state = experimentRun.apply(
        state,
        experimentRun.events.started({ ...baseStarted, occurredAt: 999 }),
      );
      expect(state.startedAt).toBe(500);
    });
  });

  describe("when a target result is recorded", () => {
    it("merges its targets and leaves every other field alone", () => {
      const started = experimentRun.apply(
        experimentRun.init(),
        experimentRun.events.started(baseStarted),
      );
      const next = experimentRun.apply(
        started,
        experimentRun.events.targetResultRecorded(
          targetResult({
            targets: [{ id: "t1", name: "Target 1", type: "prompt" }],
          }),
        ),
      );
      expect(next.targets).toEqual([
        { id: "t1", name: "Target 1", type: "prompt" },
      ]);
      expect(next.total).toBe(started.total);
      expect(next.startedAt).toBe(started.startedAt);
    });

    it("has no counter field to increment — ADR-103 decision 1 moved every count to a read-time query", () => {
      // The old fold's `ExperimentRunStateData` carried `CompletedCount`,
      // `FailedCount`, `Progress` and seven more incremented fields. None of
      // them exist on this state's schema at all, so there is nothing here
      // for a redelivery to double-count or a dropped update to under-count.
      const state = experimentRun.init();
      expect(Object.keys(state).sort()).toEqual(
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

  describe("when an evaluator result is recorded", () => {
    it("leaves state unchanged — every old effect of this event is now a read-time query (totals.ts)", () => {
      const state = experimentRun.apply(
        experimentRun.init(),
        experimentRun.events.started(baseStarted),
      );
      const next = experimentRun.apply(
        state,
        experimentRun.events.evaluatorResultRecorded({
          runId: "run-1",
          experimentId: "exp-1",
          index: 0,
          targetId: "t1",
          evaluatorId: "ev1",
          status: "processed",
          score: 0.9,
          passed: true,
          occurredAt: 3_000,
        }),
      );
      expect(next).toEqual(state);
    });
  });

  describe("when the run completes", () => {
    it("records finishedAt and stoppedAt from the completed event", () => {
      const state = experimentRun.apply(
        experimentRun.init(),
        experimentRun.events.completed({
          runId: "run-1",
          experimentId: "exp-1",
          finishedAt: 5_000,
          stoppedAt: null,
        }),
      );
      expect(state.finishedAt).toBe(5_000);
      expect(state.stoppedAt).toBeNull();
    });

    /** @scenario "Run-level facts survive with no items" */
    it("reports the experiment, the targets, the expected total and stopped status with no item ever recorded", () => {
      const started = experimentRun.apply(
        experimentRun.init(),
        experimentRun.events.started({
          runId: "run-1",
          experimentId: "exp-1",
          workflowVersionId: "wf-1",
          total: 10,
          targets: [{ id: "t1", name: "Target 1", type: "prompt" }],
          occurredAt: 1_000,
        }),
      );
      // No targetResultRecorded / evaluatorResultRecorded event is ever
      // applied — the run is stopped before any item completes.
      const stopped = experimentRun.apply(
        started,
        experimentRun.events.completed({
          runId: "run-1",
          experimentId: "exp-1",
          finishedAt: null,
          stoppedAt: 2_000,
        }),
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
    it("reaches the same state in any order for started, completed, and distinct-target results", () => {
      const events = [
        experimentRun.events.started(baseStarted),
        experimentRun.events.targetResultRecorded(
          targetResult({
            targetId: "t1",
            targets: [{ id: "t1", name: "T1", type: "prompt" }],
          }),
        ),
        experimentRun.events.targetResultRecorded(
          targetResult({
            targetId: "t2",
            index: 1,
            targets: [{ id: "t2", name: "T2", type: "prompt" }],
          }),
        ),
        experimentRun.events.completed({
          runId: "run-1",
          experimentId: "exp-1",
          finishedAt: 9_000,
          stoppedAt: null,
        }),
      ];

      const report = checkOrderInvariance({
        init: experimentRun.init,
        apply: experimentRun.apply,
        events,
      });

      expect(report.invariant).toBe(true);
    });

    it("is NOT order-invariant when two events disagree about the same target id — a documented, inherited limitation", () => {
      // `aggregate.ts`'s module docblock names this gap rather than claiming
      // full order-invariance: `mergeTargets` is last-write-wins keyed by
      // delivery order, not by a per-field stamp (ADR-099's `asOf`), because
      // the domain guarantee — one `targetResult` per dataset row — is what
      // makes it safe in the cases that actually occur. This test proves the
      // boundary of that guarantee rather than leaving it unverified.
      const events = [
        experimentRun.events.targetResultRecorded(
          targetResult({
            targets: [{ id: "t1", name: "First", type: "prompt" }],
          }),
        ),
        experimentRun.events.targetResultRecorded(
          targetResult({
            targets: [{ id: "t1", name: "Second", type: "prompt" }],
          }),
        ),
      ];

      const report = checkOrderInvariance({
        init: experimentRun.init,
        apply: experimentRun.apply,
        events,
      });

      expect(report.invariant).toBe(false);
      expect(report.cause).toBe("order");
    });
  });

  describe("aggregate id", () => {
    it("round-trips through the experimentId:runId composite key", () => {
      const id = experimentRunAggregateId({
        experimentId: "exp-1",
        runId: "run-1",
      });
      expect(id).toBe("exp-1:run-1");
      expect(parseExperimentRunAggregateId(id)).toEqual({
        experimentId: "exp-1",
        runId: "run-1",
      });
    });

    it("parses a key with no separator as a bare runId, mirroring the old parser", () => {
      expect(parseExperimentRunAggregateId("run-1")).toEqual({
        experimentId: "",
        runId: "run-1",
      });
    });
  });

  describe("commands", () => {
    it("start emits a started event carrying its input verbatim", () => {
      const [event] = experimentRun.commands.start.handle(
        experimentRun.init(),
        baseStarted,
        experimentRun.events,
      );
      expect(event).toEqual({
        type: "experiment_run/started",
        data: baseStarted,
      });
    });

    it("recordTargetResult emits a targetResultRecorded event", () => {
      const input = targetResult();
      const [event] = experimentRun.commands.recordTargetResult.handle(
        experimentRun.init(),
        input,
        experimentRun.events,
      );
      expect(event).toEqual({
        type: "experiment_run/targetResultRecorded",
        data: input,
      });
    });
  });
});
