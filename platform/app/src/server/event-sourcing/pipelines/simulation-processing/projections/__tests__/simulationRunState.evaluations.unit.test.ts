import { describe, expect, it } from "vitest";
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

const SQL_CHECK: ScenarioEvaluationResult = {
  evaluatorId: "ragas/sql_query_equivalence",
  name: "SQL Query Equivalence",
  status: "failed",
  required: true,
  passed: false,
  details: "The generated query filters on the wrong column.",
  inputs: { output: "SELECT 1", expected_output: "SELECT 2" },
};

const QUALITY_SCORE: ScenarioEvaluationResult = {
  evaluatorId: "eval_quality",
  name: "Answer quality",
  status: "scored",
  required: false,
  score: 0.8,
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
        reasoning: "Every criterion was met.",
        metCriteria: ["Answers politely"],
        unmetCriteria: [],
      },
      ...overrides,
    },
  };
}

function evaluatedEvent(
  overrides: Partial<SimulationRunEvaluatedEvent["data"]> = {},
): SimulationRunEvaluatedEvent {
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
      evaluations: [SQL_CHECK],
      verdict: "failure",
      status: "FAILURE",
      previousVerdict: "success",
      previousStatus: "SUCCESS",
      ...overrides,
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

describe("simulationRunState fold projection, evaluations", () => {
  describe("when a finished event carries evaluations", () => {
    /** @scenario "Finished results carry evaluations" */
    it("stores them in order", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent({
          results: {
            verdict: "failure",
            metCriteria: [],
            unmetCriteria: [],
            evaluations: [SQL_CHECK, QUALITY_SCORE],
          },
        }),
      ]);

      expect(state.Evaluations).toEqual([SQL_CHECK, QUALITY_SCORE]);
      expect(state.Verdict).toBe("failure");
    });

    it("stores none when the finished event carries none", () => {
      const state = foldEvents([queuedEvent(), finishedEvent()]);

      expect(state.Evaluations).toEqual([]);
    });
  });

  describe("when an evaluated event with a required failure follows a successful run", () => {
    /** @scenario "A required evaluator that failed turns the verdict to failure" */
    it("turns the verdict to failure and the status to FAILURE, keeping the judge's words", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent(),
        evaluatedEvent(),
      ]);

      expect(state.Verdict).toBe("failure");
      expect(state.Status).toBe("FAILURE");
      expect(state.Reasoning).toBe("Every criterion was met.");
      expect(state.MetCriteria).toEqual(["Answers politely"]);
      expect(state.UnmetCriteria).toEqual([]);
      expect(state.FinishedAt).toBe(2000);
      expect(state.Evaluations).toEqual([SQL_CHECK]);
    });
  });

  describe("when an evaluated event carries only evaluations that do not gate", () => {
    /** @scenario "An evaluator that is not required never changes the verdict" */
    it("keeps the verdict and status and stores the evaluation", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent(),
        evaluatedEvent({
          evaluations: [{ ...SQL_CHECK, required: false }],
          verdict: "success",
          status: "SUCCESS",
        }),
      ]);

      expect(state.Verdict).toBe("success");
      expect(state.Status).toBe("SUCCESS");
      expect(state.Evaluations).toEqual([{ ...SQL_CHECK, required: false }]);
    });
  });

  describe("when the run errored before any judgement", () => {
    it("keeps the error status whatever the evaluators said", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent({
          status: "ERROR",
          results: {
            verdict: "failure",
            metCriteria: [],
            unmetCriteria: [],
            error: "boom",
          },
        }),
        evaluatedEvent({
          evaluations: [{ ...SQL_CHECK, status: "passed", passed: true }],
          verdict: "success",
        }),
      ]);

      expect(state.Status).toBe("ERROR");
      expect(state.Error).toBe("boom");
    });
  });

  describe("when evaluations are recorded twice", () => {
    it("keeps the second set only", () => {
      const state = foldEvents([
        queuedEvent(),
        finishedEvent(),
        evaluatedEvent(),
        evaluatedEvent({
          evaluations: [{ ...SQL_CHECK, status: "passed", passed: true }],
          verdict: "success",
          status: "SUCCESS",
          previousVerdict: "failure",
          previousStatus: "FAILURE",
        }),
      ]);

      expect(state.Evaluations).toEqual([
        { ...SQL_CHECK, status: "passed", passed: true },
      ]);
      expect(state.Verdict).toBe("success");
      expect(state.Status).toBe("SUCCESS");
    });
  });

  describe("when the evaluated event folds before the finished event", () => {
    it("keeps the evaluations once the finished event lands without its own", () => {
      const state = foldEvents([
        queuedEvent(),
        evaluatedEvent(),
        finishedEvent(),
      ]);

      expect(state.Evaluations).toEqual([SQL_CHECK]);
      expect(state.FinishedAt).toBe(2000);
    });
  });
});
