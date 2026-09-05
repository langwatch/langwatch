import { describe, expect, it } from "vitest";
import type { EvaluatorAttachment } from "~/server/scenarios/evaluator-attachments";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
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

const PASSED: ScenarioEvaluationResult = {
  evaluatorId: "eval-1",
  name: "Exact match",
  status: "passed",
  required: true,
  passed: true,
};

const FAILED_REQUIRED: ScenarioEvaluationResult = {
  evaluatorId: "eval-1",
  name: "Exact match",
  status: "failed",
  required: true,
  passed: false,
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

/**
 * The evaluated event as the record evaluations command writes it: the
 * verdict after the gate, which is the judge's unless a required evaluator
 * failed.
 */
function evaluatedEvent(
  evaluations: ScenarioEvaluationResult[] = [PASSED],
  judgeVerdict: "success" | "failure" = "success",
): SimulationRunEvaluatedEvent {
  const failed =
    judgeVerdict === "failure" ||
    evaluations.some(
      (evaluation) => evaluation.required && evaluation.status !== "passed",
    );
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
      evaluations,
      verdict: failed ? "failure" : "success",
      status: failed ? "FAILURE" : "SUCCESS",
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
    /** @scenario "A finished run whose suite attaches evaluators is stored pending evaluation" */
    it("stores the run PENDING_EVALUATION with the judge's verdict", () => {
      const state = foldEvents([queuedEvent(), finishedEvent()]);

      expect(state.Status).toBe(ScenarioRunStatus.PENDING_EVALUATION);
      expect(state.Verdict).toBe("success");
      expect(state.FinishedAt).toBe(2000);
    });
  });

  describe("when a run finishes carrying no attachments", () => {
    /** @scenario "A finished run with no attachments is stored with the judge's status" */
    it("stores the judge's status", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent({ evaluators: undefined }),
      ]);

      expect(state.Status).toBe("SUCCESS");
    });

    it("stores the judge's status when the list is empty", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent({ evaluators: { ...EVALUATORS, attachments: [] } }),
      ]);

      expect(state.Status).toBe("SUCCESS");
    });
  });

  describe("when the run sent its own evaluations", () => {
    /** @scenario "A run that sent its own evaluations is stored with the judge's status" */
    it("stores the judge's status", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent({
          results: {
            verdict: "success",
            metCriteria: [],
            unmetCriteria: [],
            evaluations: [PASSED],
          },
        }),
      ]);

      expect(state.Status).toBe("SUCCESS");
      expect(state.Evaluations).toEqual([PASSED]);
    });
  });

  describe("when the run errored or was cancelled", () => {
    /** @scenario "A run that errored or was cancelled is never pending evaluation" */
    it("stores that status", () => {
      const errored = foldEvents([
        queuedEvent(),
        finishedEvent({ status: "ERROR" }),
      ]);
      const cancelled = foldEvents([
        queuedEvent(),
        finishedEvent({ status: "CANCELLED" }),
      ]);

      expect(errored.Status).toBe("ERROR");
      expect(cancelled.Status).toBe("CANCELLED");
    });
  });

  describe("when the evaluations are recorded", () => {
    /** @scenario "Recording the evaluations writes the gated terminal status" */
    it("writes the judge's status when every evaluator passed", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent(),
        evaluatedEvent([PASSED]),
      ]);

      expect(state.Status).toBe("SUCCESS");
      expect(state.Verdict).toBe("success");
      expect(state.Evaluations).toEqual([PASSED]);
    });

    it("fails the run when a required evaluator failed", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent(),
        evaluatedEvent([FAILED_REQUIRED]),
      ]);

      expect(state.Status).toBe("FAILURE");
      expect(state.Verdict).toBe("failure");
    });

    it("recomputes the judge's status from a failed verdict", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent({
          results: { verdict: "failure", metCriteria: [], unmetCriteria: [] },
        }),
        evaluatedEvent([PASSED], "failure"),
      ]);

      expect(state.Status).toBe("FAILURE");
    });

    /** @scenario "An evaluated event that lands before the finished event settles the run" */
    it("stores the judge's status when the evaluated event folds before the finished one", () => {
      const state = foldEvents([
        queuedEvent(),
        evaluatedEvent([PASSED]),
        finishedEvent(),
      ]);

      expect(state.Status).toBe("SUCCESS");
      expect(state.Evaluations).toEqual([PASSED]);
    });
  });
});
