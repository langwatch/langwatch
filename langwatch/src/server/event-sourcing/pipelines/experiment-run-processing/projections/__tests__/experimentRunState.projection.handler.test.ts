import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../library/domain/tenantId";
import { EventStream } from "../../../../library/streams/eventStream";
import {
  EXPERIMENT_RUN_COMPLETED_EVENT_TYPE,
  EXPERIMENT_RUN_COMPLETED_EVENT_VERSION_LATEST,
  EXPERIMENT_RUN_STATE_PROJECTION_VERSION_LATEST,
  EXPERIMENT_RUN_STARTED_EVENT_TYPE,
  EXPERIMENT_RUN_STARTED_EVENT_VERSION_LATEST,
  EVALUATOR_RESULT_EVENT_TYPE,
  EVALUATOR_RESULT_EVENT_VERSION_LATEST,
  TARGET_RESULT_EVENT_TYPE,
  TARGET_RESULT_EVENT_VERSION_LATEST,
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
    type: EXPERIMENT_RUN_STARTED_EVENT_TYPE,
    version: EXPERIMENT_RUN_STARTED_EVENT_VERSION_LATEST,
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
    type: TARGET_RESULT_EVENT_TYPE,
    version: TARGET_RESULT_EVENT_VERSION_LATEST,
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
    type: EVALUATOR_RESULT_EVENT_TYPE,
    version: EVALUATOR_RESULT_EVENT_VERSION_LATEST,
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
    type: EXPERIMENT_RUN_COMPLETED_EVENT_TYPE,
    version: EXPERIMENT_RUN_COMPLETED_EVENT_VERSION_LATEST,
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
      EXPERIMENT_RUN_STATE_PROJECTION_VERSION_LATEST,
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
