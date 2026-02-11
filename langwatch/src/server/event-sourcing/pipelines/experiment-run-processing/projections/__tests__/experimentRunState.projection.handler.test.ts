import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../library/domain/tenantId";
import { EventStream } from "../../../../library/streams/eventStream";
import {
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
  EXPERIMENT_RUN_PROJECTION_VERSIONS,
} from "../../schemas/constants";
import type {
  ExperimentRunCompletedEvent,
  ExperimentRunProcessingEvent,
  ExperimentRunStartedEvent,
  EvaluatorResultEvent,
  TargetResultEvent,
} from "../../schemas/events";
import { ExperimentRunStateProjectionHandler } from "../experimentRunState.projection.handler";

const TEST_TENANT_ID = createTenantId("tenant-1");

function createStartedEvent(
  overrides: Partial<ExperimentRunStartedEvent["data"]> = {},
): ExperimentRunStartedEvent {
  return {
    id: "event-1",
    aggregateId: "run-123",
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    timestamp: 1000,
    type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
    data: {
      runId: "run-123",
      experimentId: "exp-1",
      total: 10,
      targets: [{ id: "target-1", name: "Target 1", type: "llm" }],
      ...overrides,
    },
  };
}

function createTargetResultEvent(
  overrides: Partial<TargetResultEvent["data"]> = {},
  eventOverrides: Partial<TargetResultEvent> = {},
): TargetResultEvent {
  return {
    id: "event-2",
    aggregateId: "run-123",
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    timestamp: 2000,
    type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
    data: {
      runId: "run-123",
      experimentId: "exp-1",
      index: 0,
      targetId: "target-1",
      entry: { input: "test" },
      predicted: { output: "result" },
      ...overrides,
    },
    ...eventOverrides,
  };
}

function createEvaluatorResultEvent(
  overrides: Partial<EvaluatorResultEvent["data"]> = {},
  eventOverrides: Partial<EvaluatorResultEvent> = {},
): EvaluatorResultEvent {
  return {
    id: "event-3",
    aggregateId: "run-123",
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    timestamp: 3000,
    type: EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT,
    data: {
      runId: "run-123",
      experimentId: "exp-1",
      index: 0,
      targetId: "target-1",
      evaluatorId: "eval-1",
      status: "processed",
      score: 0.8,
      ...overrides,
    },
    ...eventOverrides,
  };
}

function createCompletedEvent(
  overrides: Partial<ExperimentRunCompletedEvent["data"]> = {},
): ExperimentRunCompletedEvent {
  return {
    id: "event-4",
    aggregateId: "run-123",
    aggregateType: "experiment_run",
    tenantId: TEST_TENANT_ID,
    timestamp: 4000,
    type: EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
    version: EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED,
    data: {
      runId: "run-123",
      finishedAt: 4000,
      ...overrides,
    },
  };
}

describe("ExperimentRunStateProjectionHandler", () => {
  const handler = new ExperimentRunStateProjectionHandler();

  it("initializes run state from ExperimentRunStartedEvent", () => {
    const events: ExperimentRunProcessingEvent[] = [createStartedEvent()];
    const stream = new EventStream("run-123", TEST_TENANT_ID, events);

    const projection = handler.handle(stream);

    expect(projection.data.RunId).toBe("run-123");
    expect(projection.data.ExperimentId).toBe("exp-1");
    expect(projection.data.Total).toBe(10);
    expect(projection.data.Progress).toBe(0);
    expect(projection.data.CompletedCount).toBe(0);
    expect(projection.data.FailedCount).toBe(0);
    expect(projection.version).toBe(
      EXPERIMENT_RUN_PROJECTION_VERSIONS.RUN_STATE,
    );
  });

  it("tracks progress from TargetResultEvent", () => {
    const events: ExperimentRunProcessingEvent[] = [
      createStartedEvent(),
      createTargetResultEvent({ index: 0 }),
      createTargetResultEvent({ index: 1 }, { id: "event-2b", timestamp: 2100 }),
    ];
    const stream = new EventStream("run-123", TEST_TENANT_ID, events);

    const projection = handler.handle(stream);

    expect(projection.data.Progress).toBe(2);
    expect(projection.data.CompletedCount).toBe(2);
    expect(projection.data.FailedCount).toBe(0);
  });

  it("tracks failed results separately", () => {
    const events: ExperimentRunProcessingEvent[] = [
      createStartedEvent(),
      createTargetResultEvent({ index: 0 }),
      createTargetResultEvent(
        { index: 1, error: "Something went wrong" },
        { id: "event-2b", timestamp: 2100 },
      ),
    ];
    const stream = new EventStream("run-123", TEST_TENANT_ID, events);

    const projection = handler.handle(stream);

    expect(projection.data.Progress).toBe(2);
    expect(projection.data.CompletedCount).toBe(1);
    expect(projection.data.FailedCount).toBe(1);
  });

  it("computes average score from EvaluatorResultEvents", () => {
    const events: ExperimentRunProcessingEvent[] = [
      createStartedEvent(),
      createTargetResultEvent(),
      createEvaluatorResultEvent({ score: 0.6 }),
      createEvaluatorResultEvent(
        { score: 0.8, evaluatorId: "eval-2" },
        { id: "event-3b", timestamp: 3100 },
      ),
      createEvaluatorResultEvent(
        { score: 1.0, evaluatorId: "eval-3" },
        { id: "event-3c", timestamp: 3200 },
      ),
    ];
    const stream = new EventStream("run-123", TEST_TENANT_ID, events);

    const projection = handler.handle(stream);

    expect(projection.data.AvgScore).toBeCloseTo(0.8, 5);
  });

  it("computes pass rate from evaluator results", () => {
    const events: ExperimentRunProcessingEvent[] = [
      createStartedEvent(),
      createTargetResultEvent(),
      createEvaluatorResultEvent({ passed: true }),
      createEvaluatorResultEvent(
        { passed: false, evaluatorId: "eval-2" },
        { id: "event-3b", timestamp: 3100 },
      ),
      createEvaluatorResultEvent(
        { passed: true, evaluatorId: "eval-3" },
        { id: "event-3c", timestamp: 3200 },
      ),
    ];
    const stream = new EventStream("run-123", TEST_TENANT_ID, events);

    const projection = handler.handle(stream);

    expect(projection.data.PassRate).toBeCloseTo(2 / 3, 5);
  });

  it("marks completion from ExperimentRunCompletedEvent", () => {
    const events: ExperimentRunProcessingEvent[] = [
      createStartedEvent(),
      createTargetResultEvent(),
      createCompletedEvent({ finishedAt: 5000 }),
    ];
    const stream = new EventStream("run-123", TEST_TENANT_ID, events);

    const projection = handler.handle(stream);

    expect(projection.data.FinishedAt).toBe(5000);
    expect(projection.data.StoppedAt).toBeNull();
  });

  it("marks stopped when stoppedAt is provided", () => {
    const events: ExperimentRunProcessingEvent[] = [
      createStartedEvent(),
      createCompletedEvent({ finishedAt: null, stoppedAt: 5000 }),
    ];
    const stream = new EventStream("run-123", TEST_TENANT_ID, events);

    const projection = handler.handle(stream);

    expect(projection.data.FinishedAt).toBeNull();
    expect(projection.data.StoppedAt).toBe(5000);
  });

  it("excludes skipped and error evaluator results from pass rate", () => {
    const events: ExperimentRunProcessingEvent[] = [
      createStartedEvent(),
      createTargetResultEvent(),
      createEvaluatorResultEvent({ passed: true }),
      createEvaluatorResultEvent(
        { passed: false, evaluatorId: "eval-2" },
        { id: "event-3b", timestamp: 3100 },
      ),
      createEvaluatorResultEvent(
        { status: "skipped", evaluatorId: "eval-3", score: undefined, passed: undefined },
        { id: "event-3c", timestamp: 3200 },
      ),
      createEvaluatorResultEvent(
        { status: "error", evaluatorId: "eval-4", score: undefined, passed: undefined },
        { id: "event-3d", timestamp: 3300 },
      ),
    ];
    const stream = new EventStream("run-123", TEST_TENANT_ID, events);

    const projection = handler.handle(stream);

    // Only 2 processed evaluators (1 passed, 1 failed), skipped/error excluded
    expect(projection.data.PassRate).toBeCloseTo(1 / 2, 5);
  });

  it("excludes score-only evaluators from pass rate denominator", () => {
    const events: ExperimentRunProcessingEvent[] = [
      createStartedEvent(),
      createTargetResultEvent(),
      createEvaluatorResultEvent({ passed: true }),
      createEvaluatorResultEvent(
        { passed: false, evaluatorId: "eval-2" },
        { id: "event-3b", timestamp: 3100 },
      ),
      // Score-only evaluator with no passed value
      createEvaluatorResultEvent(
        { score: 0.9, passed: undefined, evaluatorId: "eval-3" },
        { id: "event-3c", timestamp: 3200 },
      ),
    ];
    const stream = new EventStream("run-123", TEST_TENANT_ID, events);

    const projection = handler.handle(stream);

    // pass rate: 1/2 (score-only eval excluded from denominator)
    expect(projection.data.PassRate).toBeCloseTo(1 / 2, 5);
    // avg score still includes all 3
    expect(projection.data.AvgScore).toBeCloseTo((0.8 + 0.8 + 0.9) / 3, 5);
  });

  it("accumulates costs from target and evaluator results", () => {
    const events: ExperimentRunProcessingEvent[] = [
      createStartedEvent(),
      createTargetResultEvent({ cost: 0.01 }),
      createEvaluatorResultEvent({ cost: 0.005 }),
    ];
    const stream = new EventStream("run-123", TEST_TENANT_ID, events);

    const projection = handler.handle(stream);

    expect(projection.data.TotalCost).toBeCloseTo(0.015, 5);
  });
});
