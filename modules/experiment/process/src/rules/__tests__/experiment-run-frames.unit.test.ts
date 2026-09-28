import { createTenantId, EventUtils } from "@langwatch/eventing";
import { ExperimentCellLostError, UNNAMED_FAILURE } from "@langwatch/experiment-contract";
import { describe, expect, it } from "vitest";

import type {
  AbortRequestedEvent,
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
import { findRunEventFrames } from "../experiment-run-frames.rules.ts";

const tenantId = createTenantId("project_alpha");
const aggregateId = "experiment_1:run_1";
const run = { runId: "run_1", experimentId: "experiment_1" };

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

describe("findRunEventFrames", () => {
  describe("when a run starts", () => {
    /** @scenario "A run's recorded events stream as main's SSE frames" */
    it("streams main's execution_started frame with the run's total", () => {
      expect(findRunEventFrames({ event: started() })).toEqual([
        { type: "execution_started", runId: "run_1", total: 6 },
      ]);
    });
  });

  describe("when a target answers", () => {
    it("streams its output, cost, duration and trace as main's target_result frame", () => {
      const frames = findRunEventFrames({
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
      const [frame] = findRunEventFrames({ event: targetResult({ predicted: { output: 0 } }) });

      expect(frame).toMatchObject({ type: "target_result", output: 0 });
    });

    it("streams a failed target with its coded failure and no output", () => {
      const domainError = new ExperimentCellLostError().serialize();
      const [frame] = findRunEventFrames({
        event: targetResult({ predicted: null, error: "experiment_cell_lost", domainError }),
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

      expect(findRunEventFrames({ event })).toEqual([]);
    });
  });

  describe("when a run completes", () => {
    /** @scenario "A stopped run's stream ends stopped, and a failed run's with main's error frame" */
    it("ends a stopped run with main's stopped frame", () => {
      expect(findRunEventFrames({ event: completed({ outcome: "stopped" }) })).toEqual([
        { type: "stopped", reason: "user" },
      ]);
    });

    it("sends a failed run's code and handled error as main's error frame", () => {
      const error = new ExperimentCellLostError().serialize();

      const frames = findRunEventFrames({ event: completed({ outcome: "failed", error }) });

      expect(frames).toEqual([
        { type: "error", message: "experiment_cell_lost", domainError: error },
      ]);
    });

    it("sends the unnamed-failure marker for a failed run with no handled error", () => {
      expect(findRunEventFrames({ event: completed({ outcome: "failed" }) })).toEqual([
        { type: "error", message: UNNAMED_FAILURE },
      ]);
    });

    it("streams nothing for a run completed before runs recorded an outcome", () => {
      expect(findRunEventFrames({ event: completed({}) })).toEqual([]);
    });
  });

  describe("when a stop is requested", () => {
    it("streams nothing until the run completes stopped", () => {
      expect(findRunEventFrames({ event: abortRequested() })).toEqual([]);
    });
  });
});
