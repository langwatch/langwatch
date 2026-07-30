import { checkOrderInvariance } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import { experimentRun, parseExperimentRunAggregateId } from "./aggregate";
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
    it("derives the dotted type strings already in the event log", () => {
      expect([...experimentRun.eventTypes].sort()).toEqual([
        "lw.experiment_run.completed",
        "lw.experiment_run.evaluator_result",
        "lw.experiment_run.started",
        "lw.experiment_run.target_result",
      ]);
    });

    it("extracts the composite aggregate id from any event's payload", () => {
      expect(experimentRun.id(baseStarted)).toBe("exp-1:run-1");
      expect(experimentRun.id(targetResult())).toBe("exp-1:run-1");
    });

    it("parses the composite back for the store's two-column read", () => {
      expect(parseExperimentRunAggregateId("exp-1:run-1")).toEqual({
        experimentId: "exp-1",
        runId: "run-1",
      });
      expect(parseExperimentRunAggregateId("run-1")).toEqual({
        experimentId: "",
        runId: "run-1",
      });
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

    it("takes the larger total across a redelivered started event", () => {
      const higherLast = [4, 10].reduce(
        (state, total) =>
          experimentRun.apply(
            state,
            experimentRun.events.started({ ...baseStarted, total }),
          ),
        experimentRun.init(),
      );
      const higherFirst = [10, 4].reduce(
        (state, total) =>
          experimentRun.apply(
            state,
            experimentRun.events.started({ ...baseStarted, total }),
          ),
        experimentRun.init(),
      );

      expect(higherLast.total).toBe(10);
      expect(higherFirst.total).toBe(10);
    });

    it("keeps the earliest started timestamp rather than the last one seen", () => {
      const state = [999, 500].reduce(
        (acc, occurredAt) =>
          experimentRun.apply(
            acc,
            experimentRun.events.started({ ...baseStarted, occurredAt }),
          ),
        experimentRun.init(),
      );
      expect(state.startedAt).toBe(500);
    });

    it("keeps the first declaration of a target rather than a later rewrite", () => {
      const first = experimentRun.apply(
        experimentRun.init(),
        experimentRun.events.started({
          ...baseStarted,
          targets: [{ id: "t1", name: "First", type: "prompt" }],
        }),
      );
      const next = experimentRun.apply(
        first,
        experimentRun.events.started({
          ...baseStarted,
          targets: [
            { id: "t1", name: "Second", type: "prompt" },
            { id: "t0", name: "Other", type: "prompt" },
          ],
        }),
      );

      expect(next.targets).toEqual([
        { id: "t0", name: "Other", type: "prompt" },
        { id: "t1", name: "First", type: "prompt" },
      ]);
    });
  });

  describe("when a result is recorded", () => {
    it("moves no state at all — every count is a read-time query", () => {
      const started = experimentRun.apply(
        experimentRun.init(),
        experimentRun.events.started(baseStarted),
      );

      expect(
        experimentRun.apply(
          started,
          experimentRun.events.targetResult(targetResult()),
        ),
      ).toEqual(started);
      expect(
        experimentRun.apply(
          started,
          experimentRun.events.evaluatorResult({
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
        ),
      ).toEqual(started);
    });

    it("has no counter field to increment", () => {
      expect(Object.keys(experimentRun.init()).sort()).toEqual(
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

    it("does not blank a known finish time when a later completed omits it", () => {
      const finished = experimentRun.apply(
        experimentRun.init(),
        experimentRun.events.completed({
          runId: "run-1",
          experimentId: "exp-1",
          finishedAt: 5_000,
        }),
      );
      const afterRedelivery = experimentRun.apply(
        finished,
        experimentRun.events.completed({
          runId: "run-1",
          experimentId: "exp-1",
        }),
      );

      expect(afterRedelivery.finishedAt).toBe(5_000);
    });

    /** @scenario "Run-level facts survive with no items" */
    it("reports the experiment, targets, expected total and stopped status with no item recorded", () => {
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
    it("reaches the same state under every ordering and every re-delivery", () => {
      const report = checkOrderInvariance({
        init: experimentRun.init,
        apply: experimentRun.apply,
        events: [
          experimentRun.events.started({
            ...baseStarted,
            targets: [
              { id: "t1", name: "T1", type: "prompt" },
              { id: "t2", name: "T2", type: "prompt" },
            ],
          }),
          experimentRun.events.started({ ...baseStarted, total: 10 }),
          experimentRun.events.targetResult(targetResult({ targetId: "t1" })),
          experimentRun.events.targetResult(
            targetResult({ targetId: "t2", index: 1 }),
          ),
          experimentRun.events.evaluatorResult({
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
          experimentRun.events.completed({
            runId: "run-1",
            experimentId: "exp-1",
            finishedAt: 9_000,
            stoppedAt: null,
          }),
        ],
      });

      expect(report.counterexample).toBeUndefined();
      expect(report.invariant).toBe(true);
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
        type: "lw.experiment_run.started",
        data: baseStarted,
      });
    });

    it("recordTargetResult emits a targetResult event", () => {
      const input = targetResult();
      const [event] = experimentRun.commands.recordTargetResult.handle(
        experimentRun.init(),
        input,
        experimentRun.events,
      );
      expect(event).toEqual({
        type: "lw.experiment_run.target_result",
        data: input,
      });
    });
  });
});
