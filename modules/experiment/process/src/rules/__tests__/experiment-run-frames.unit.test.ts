import { createTenantId, EventUtils } from "@langwatch/eventing";
import { ExperimentCellLostError, UNNAMED_FAILURE } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import type {
  AbortRequestedEvent,
  CellFinishedEvent,
  EvaluatorResultEvent,
  EvaluatorResultEventData,
  ExperimentRunCompletedEvent,
  ExperimentRunCompletedEventData,
  ExperimentRunStartedEvent,
  TargetResultEvent,
  TargetResultEventData,
} from "../../eventing/experiment-run-events.process.ts";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../experiment-run-event-types.rules.ts";
import {
  appendRunFrames,
  findRunEventFrames,
  framesOfEvent,
  type RunFrameContext,
} from "../experiment-run-frames.rules.ts";

const tenantId = createTenantId("project_alpha");
const aggregateId = "experiment_1:run_1";
const run = { runId: "run_1", experimentId: "experiment_1" };
const summary = {
  runId: "run_1",
  totalCells: 6,
  completedCells: 5,
  failedCells: 1,
  duration: 2_000,
  timestamps: { startedAt: 1_000, finishedAt: 3_000 },
};
const context: RunFrameContext = {
  progress: 4,
  total: 6,
  cellNewlyFinished: true,
  summary,
  evaluators: { saved: { recordNamed: true }, node: { recordNamed: false } },
};

function started(): ExperimentRunStartedEvent {
  return EventUtils.createEvent<ExperimentRunStartedEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
    data: { ...run, total: 6, targets: [] },
    occurredAt: 1_000,
  });
}

function targetResult(data: Partial<TargetResultEventData>): TargetResultEvent {
  return EventUtils.createEvent<TargetResultEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
    data: { ...run, index: 2, targetId: "target_a", entry: {}, ...data },
    occurredAt: 2_000,
  });
}

function completed(
  data: Pick<ExperimentRunCompletedEventData, "outcome" | "error">,
): ExperimentRunCompletedEvent {
  return EventUtils.createEvent<ExperimentRunCompletedEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED,
    data: { ...run, finishedAt: 3_000, ...data },
    occurredAt: 3_000,
  });
}

function abortRequested(): AbortRequestedEvent {
  return EventUtils.createEvent<AbortRequestedEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.ABORT_REQUESTED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.ABORT_REQUESTED,
    data: { ...run, requestedBy: "user_1" },
    occurredAt: 2_500,
  });
}

function evaluatorResult(data: Partial<EvaluatorResultEventData>): EvaluatorResultEvent {
  return EventUtils.createEvent<EvaluatorResultEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT,
    data: {
      ...run,
      index: 2,
      targetId: "target_a",
      evaluatorId: "node",
      status: "processed",
      ...data,
    },
    occurredAt: 2_000,
  });
}

function cellFinished(): CellFinishedEvent {
  return EventUtils.createEvent<CellFinishedEvent>({
    aggregateType: "experiment_run",
    aggregateId,
    tenantId,
    type: EXPERIMENT_RUN_EVENT_TYPES.CELL_FINISHED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.CELL_FINISHED,
    data: { ...run, ordinal: 3, phase: 1, outcome: "succeeded" },
    occurredAt: 2_500,
  });
}

describe("findRunEventFrames", () => {
  describe("when a run starts", () => {
    /** @scenario "A run's recorded events stream as main's SSE frames" */
    it("streams main's execution_started frame with the run's total", () => {
      expect(findRunEventFrames({ event: started(), run: context })).toEqual([
        { type: "execution_started", runId: "run_1", total: 6 },
      ]);
    });
  });

  describe("when a target answers", () => {
    it("streams its output, cost, duration and trace as main's target_result frame", () => {
      const frames = findRunEventFrames({
        run: context,
        event: targetResult({
          predicted: { output: "4" },
          cost: 0.002,
          duration: 120,
          traceId: "trace_1",
        }),
      });

      expect(frames).toEqual([
        {
          type: "target_result",
          rowIndex: 2,
          targetId: "target_a",
          output: "4",
          cost: 0.002,
          duration: 120,
          traceId: "trace_1",
        },
      ]);
    });

    it("keeps a falsy output rather than dropping it", () => {
      const [frame] = findRunEventFrames({
        event: targetResult({ predicted: { output: 0 } }),
        run: context,
      });

      expect(frame).toMatchObject({ type: "target_result", output: 0 });
    });

    it("streams a failed target with its coded failure and no output", () => {
      const domainError = new ExperimentCellLostError().serialize();
      const [frame] = findRunEventFrames({
        event: targetResult({ predicted: null, error: "experiment_cell_lost", domainError }),
        run: context,
      });

      expect(frame).toEqual({
        type: "target_result",
        rowIndex: 2,
        targetId: "target_a",
        output: undefined,
        error: "experiment_cell_lost",
        domainError,
      });
    });
  });

  describe("when a board cell is carried into the run", () => {
    /** @scenario "A board cell carried into a run is not streamed" */
    it("streams nothing, as main never did", () => {
      const event = targetResult({ predicted: { output: "kept" }, carriedOver: true });

      expect(findRunEventFrames({ event, run: context })).toEqual([]);
    });
  });

  describe("when a run completes", () => {
    /** @scenario "A stopped run's stream ends stopped, and a failed run's with main's error frame" */
    it("ends a stopped run with main's stopped frame", () => {
      expect(
        findRunEventFrames({ event: completed({ outcome: "stopped" }), run: context }),
      ).toEqual([{ type: "stopped", reason: "user" }]);
    });

    it("sends a failed run's code and handled error as main's error frame", () => {
      const error = new ExperimentCellLostError().serialize();

      const frames = findRunEventFrames({
        event: completed({ outcome: "failed", error }),
        run: context,
      });

      expect(frames).toEqual([
        { type: "error", message: "experiment_cell_lost", domainError: error },
      ]);
    });

    it("sends the unnamed-failure marker for a failed run with no handled error", () => {
      expect(findRunEventFrames({ event: completed({ outcome: "failed" }), run: context })).toEqual(
        [{ type: "error", message: UNNAMED_FAILURE }],
      );
    });

    it("ends a finished run with main's done frame and its summary", () => {
      const frames = findRunEventFrames({
        event: completed({ outcome: "finished" }),
        run: context,
      });

      expect(frames).toEqual([{ type: "done", summary }]);
    });
  });

  describe("when a stop is requested", () => {
    it("streams nothing until the run completes stopped", () => {
      expect(findRunEventFrames({ event: abortRequested(), run: context })).toEqual([]);
    });
  });
});

describe("findRunEventFrames, with the run's fold", () => {
  describe("when a cell finishes", () => {
    /** @scenario "A run's live frames are published from its progress fold with their seq" */
    it("streams main's progress frame with the run's counts", () => {
      expect(findRunEventFrames({ event: cellFinished(), run: context })).toEqual([
        { type: "progress", completed: 4, total: 6 },
      ]);
    });

    it("streams nothing for a redelivered finish", () => {
      const redelivered = { ...context, cellNewlyFinished: false };

      expect(findRunEventFrames({ event: cellFinished(), run: redelivered })).toEqual([]);
    });
  });

  describe("when an evaluator answers", () => {
    it("rebuilds main's result with its cost in its currency and the raw response", () => {
      const [frame] = findRunEventFrames({
        event: evaluatorResult({
          evaluatorName: "Node judge",
          score: 0.8,
          passed: true,
          cost: 0.001,
          costCurrency: "USD",
          rawResponse: { verdict: "yes" },
          duration: 40,
          inputs: { output: "4" },
        }),
        run: context,
      });

      expect(frame).toEqual({
        type: "evaluator_result",
        rowIndex: 2,
        targetId: "target_a",
        evaluatorId: "node",
        evaluatorName: "Node judge",
        result: {
          status: "processed",
          score: 0.8,
          passed: true,
          raw_response: { verdict: "yes" },
          cost: { currency: "USD", amount: 0.001 },
        },
        duration: 40,
        inputs: { output: "4" },
      });
    });

    it("never streams a saved evaluator's record name, as main named it at storage", () => {
      const [frame] = findRunEventFrames({
        event: evaluatorResult({ evaluatorId: "saved", evaluatorName: "Is polite" }),
        run: context,
      });

      expect(frame).not.toHaveProperty("evaluatorName");
    });

    it("streams a failed evaluator with its error type, details and traceback", () => {
      const [frame] = findRunEventFrames({
        event: evaluatorResult({
          status: "error",
          errorType: "TimeoutError",
          details: "timed out",
          traceback: ["line 1"],
        }),
        run: context,
      });

      expect(frame).toMatchObject({
        result: {
          status: "error",
          error_type: "TimeoutError",
          details: "timed out",
          traceback: ["line 1"],
        },
      });
    });

    it("streams nothing for a verdict carried over from the board", () => {
      const event = evaluatorResult({ carriedOver: true });

      expect(findRunEventFrames({ event, run: context })).toEqual([]);
    });
  });
});

describe("appendRunFrames", () => {
  it("numbers each frame after the run's last seq and keeps main's last 50", () => {
    const frames = Array.from({ length: 60 }, () => ({
      type: "progress" as const,
      completed: 1,
      total: 6,
    }));

    const appended = appendRunFrames({ run: { seq: 3, recentEvents: [] }, eventId: "e1", frames });

    expect(appended.seq).toBe(63);
    expect(appended.recentEvents).toHaveLength(50);
    expect(appended.recentEvents[0]?.seq).toBe(14);
    expect(framesOfEvent({ run: appended, eventId: "e1" })).toHaveLength(50);
    expect(framesOfEvent({ run: appended, eventId: "e2" })).toEqual([]);
  });
});
