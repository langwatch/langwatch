import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../../domain/tenantId";
import {
	EXPERIMENT_RUN_EVENT_TYPES,
	EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../constants";
import type { ExperimentRunProcessingEvent } from "../events";
import {
	isEvaluatorResultEvent,
	isExperimentRunCompletedEvent,
	isExperimentRunStartedEvent,
	isTargetResultEvent,
} from "../typeGuards";

const TEST_TENANT_ID = createTenantId("tenant-1");

const baseEvent = {
  id: "event-1",
  aggregateId: "run-123",
  aggregateType: "experiment_run" as const,
  tenantId: TEST_TENANT_ID,
  timestamp: 1000,
  occurredAt: 1000,
};

describe("typeGuards", () => {
  describe("isExperimentRunStartedEvent", () => {
    it("returns true for ExperimentRunStartedEvent", () => {
      const event: ExperimentRunProcessingEvent = {
        ...baseEvent,
        type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
        version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
        data: {
          runId: "run-123",
          experimentId: "exp-1",
          total: 10,
          targets: [],
        },
      };

      expect(isExperimentRunStartedEvent(event)).toBe(true);
    });

    it("returns false for other event types", () => {
      const event: ExperimentRunProcessingEvent = {
        ...baseEvent,
        type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
        version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
        data: {
          runId: "run-123",
          experimentId: "exp-1",
          index: 0,
          targetId: "target-1",
          entry: {},
        },
      };

      expect(isExperimentRunStartedEvent(event)).toBe(false);
    });
  });

  describe("isTargetResultEvent", () => {
    it("returns true for TargetResultEvent", () => {
      const event: ExperimentRunProcessingEvent = {
        ...baseEvent,
        type: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
        version: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
        data: {
          runId: "run-123",
          experimentId: "exp-1",
          index: 0,
          targetId: "target-1",
          entry: {},
        },
      };

      expect(isTargetResultEvent(event)).toBe(true);
    });

    it("returns false for other event types", () => {
      const event: ExperimentRunProcessingEvent = {
        ...baseEvent,
        type: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
        version: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
        data: {
          runId: "run-123",
          experimentId: "exp-1",
          total: 10,
          targets: [],
        },
      };

      expect(isTargetResultEvent(event)).toBe(false);
    });
  });

  describe("isEvaluatorResultEvent", () => {
    it("returns true for EvaluatorResultEvent", () => {
      const event: ExperimentRunProcessingEvent = {
        ...baseEvent,
        type: EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
        version: EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT,
        data: {
          runId: "run-123",
          experimentId: "exp-1",
          index: 0,
          targetId: "target-1",
          evaluatorId: "eval-1",
          status: "processed",
        },
      };

      expect(isEvaluatorResultEvent(event)).toBe(true);
    });

    it("returns false for other event types", () => {
      const event: ExperimentRunProcessingEvent = {
        ...baseEvent,
        type: EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
        version: EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED,
        data: {
          runId: "run-123",
          experimentId: "exp-1",
          finishedAt: 1000,
        },
      };

      expect(isEvaluatorResultEvent(event)).toBe(false);
    });
  });

  describe("isExperimentRunCompletedEvent", () => {
    it("returns true for ExperimentRunCompletedEvent", () => {
      const event: ExperimentRunProcessingEvent = {
        ...baseEvent,
        type: EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
        version: EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED,
        data: {
          runId: "run-123",
          experimentId: "exp-1",
          finishedAt: 1000,
        },
      };

      expect(isExperimentRunCompletedEvent(event)).toBe(true);
    });

    it("returns false for other event types", () => {
      const event: ExperimentRunProcessingEvent = {
        ...baseEvent,
        type: EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
        version: EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT,
        data: {
          runId: "run-123",
          experimentId: "exp-1",
          index: 0,
          targetId: "target-1",
          evaluatorId: "eval-1",
          status: "processed",
        },
      };

      expect(isExperimentRunCompletedEvent(event)).toBe(false);
    });
  });
});
