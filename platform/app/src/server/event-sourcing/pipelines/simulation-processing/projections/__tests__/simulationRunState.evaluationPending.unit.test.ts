import { describe, expect, it } from "vitest";
import type { EvaluatorAttachment } from "~/server/scenarios/evaluator-attachments";
import type { ScenarioEvaluationResult } from "~/server/scenarios/schemas/event-schemas";
import { createTenantId } from "../../../../domain/tenantId";
import type { FoldProjectionStore } from "../../../../projections/foldProjection.types";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import type {
  SimulationProcessingEvent,
  SimulationRunEvaluatedEvent,
  SimulationRunFinishedEvent,
  SimulationRunQueuedEvent,
} from "../../schemas/events";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "../simulationRunState.foldProjection";

const noopStore: FoldProjectionStore<SimulationRunStateData> = {
  store: async () => {},
  get: async () => null,
};
const foldProjection = new SimulationRunStateFoldProjection({
  store: noopStore,
});

const TENANT_ID = createTenantId("tenant-1");

const ATTACHMENT: EvaluatorAttachment = {
  id: "att-1",
  evaluatorId: "eval-1",
  required: true,
  mappings: {},
};

const EVALUATORS = {
  suiteId: "suite-1",
  planId: "plan-1",
  attachments: [ATTACHMENT, { ...ATTACHMENT, id: "att-2" }],
};

const RESULT: ScenarioEvaluationResult = {
  evaluatorId: "eval-1",
  name: "Exact match",
  status: "passed",
  required: true,
  passed: true,
};

function queuedEvent(): SimulationRunQueuedEvent {
  return {
    id: "event-0",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: 500,
    occurredAt: 500,
    type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
    version: SIMULATION_EVENT_VERSIONS.QUEUED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
    },
  };
}

function finishedEvent(
  overrides: Partial<SimulationRunFinishedEvent["data"]> = {},
): SimulationRunFinishedEvent {
  return {
    id: "event-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: 2000,
    occurredAt: 2000,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
    data: {
      scenarioRunId: "run-1",
      results: {
        verdict: "success",
        metCriteria: [],
        unmetCriteria: [],
      },
      evaluators: EVALUATORS,
      ...overrides,
    },
  };
}

function evaluatedEvent(): SimulationRunEvaluatedEvent {
  return {
    id: "event-2",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: 3000,
    occurredAt: 3000,
    type: SIMULATION_RUN_EVENT_TYPES.EVALUATED,
    version: SIMULATION_EVENT_VERSIONS.EVALUATED,
    data: {
      scenarioRunId: "run-1",
      evaluations: [RESULT],
      verdict: "success",
      status: "SUCCESS",
      previousVerdict: "success",
      previousStatus: "SUCCESS",
    },
  };
}

function foldEvents(events: SimulationProcessingEvent[]) {
  let state = foldProjection.init();
  for (const event of events) {
    state = foldProjection.apply(state, event);
  }
  return state;
}

describe("simulationRunState fold projection, evaluations pending", () => {
  describe("when a run finishes carrying evaluator attachments", () => {
    /** @scenario "A finished run whose suite attaches evaluators is pending evaluation" */
    it("records that the run awaits evaluation", () => {
      const state = foldEvents([queuedEvent(), finishedEvent()]);

      expect(state.EvaluationsPending).toBe(true);
      expect(state.Status).toBe("SUCCESS");
    });
  });

  describe("when a run finishes carrying no attachments", () => {
    /** @scenario "A finished run with no attachments is not pending evaluation" */
    it("records that the run awaits nothing", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent({ evaluators: undefined }),
      ]);

      expect(state.EvaluationsPending).toBe(false);
    });

    it("records that the run awaits nothing when the list is empty", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent({ evaluators: { ...EVALUATORS, attachments: [] } }),
      ]);

      expect(state.EvaluationsPending).toBe(false);
    });
  });

  describe("when the run sent its own evaluations", () => {
    /** @scenario "A run that sent its own evaluations is not pending evaluation" */
    it("records that the run awaits nothing", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent({
          results: {
            verdict: "success",
            metCriteria: [],
            unmetCriteria: [],
            evaluations: [RESULT],
          },
        }),
      ]);

      expect(state.EvaluationsPending).toBe(false);
    });
  });

  describe("when the run errored or was cancelled", () => {
    /** @scenario "A run that errored or was cancelled is not pending evaluation" */
    it("records that the run awaits nothing", () => {
      const errored = foldEvents([
        queuedEvent(),
        finishedEvent({ status: "ERROR" }),
      ]);
      const cancelled = foldEvents([
        queuedEvent(),
        finishedEvent({ status: "CANCELLED" }),
      ]);

      expect(errored.EvaluationsPending).toBe(false);
      expect(cancelled.EvaluationsPending).toBe(false);
    });
  });

  describe("when the evaluations are recorded", () => {
    /** @scenario "Recording the evaluations clears the pending state" */
    it("the run no longer awaits evaluation", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent(),
        evaluatedEvent(),
      ]);

      expect(state.EvaluationsPending).toBe(false);
      expect(state.Evaluations).toEqual([RESULT]);
    });

    it("stays settled when the evaluated event folds before the finished one", () => {
      const state = foldEvents([
        queuedEvent(),
        evaluatedEvent(),
        finishedEvent(),
      ]);

      expect(state.EvaluationsPending).toBe(false);
    });
  });
});
