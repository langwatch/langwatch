import { describe, expect, it, vi } from "vitest";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { SIMULATION_RUN_EVENT_TYPES } from "../../schemas/constants";
import type { SimulationProcessingEvent } from "../../schemas/events";
import {
  createScenarioEvaluationsSubscriber,
  type ScenarioEvaluationsSubscriberDeps,
} from "../scenarioEvaluations.subscriber";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const attachment = {
  id: "att-1",
  evaluatorId: "eval-1",
  required: true,
  mappings: {},
};

const CONTEXT = {
  tenantId: "project-1",
  aggregateId: "run-1",
  state: undefined,
};

function finishedEvent(
  data: Record<string, unknown> = {},
): SimulationProcessingEvent {
  return {
    id: "evt-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: "project-1",
    createdAt: 5_000,
    occurredAt: 5_000,
    version: "2026-08-06",
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      scenarioSetId: getSuiteSetId("plan-1"),
      traceIds: ["trace-1"],
      results: {
        verdict: "success",
        metCriteria: [],
        unmetCriteria: [],
      },
      ...data,
    },
  } as unknown as SimulationProcessingEvent;
}

function makeDeps(attachments = [attachment]) {
  const deps: ScenarioEvaluationsSubscriberDeps = {
    loadRunAttachments: vi.fn(async () => ({
      suiteId: "suite-1",
      planId: "plan-1",
      attachments,
    })),
    enqueue: vi.fn(async () => {}),
  };
  return deps;
}

describe("scenario evaluations subscriber", () => {
  describe("when a run finishes and its suite or plan attaches evaluators", () => {
    /** @scenario "A finished run with attached evaluators is graded on the platform" */
    it("queues one evaluation job for the run", async () => {
      const deps = makeDeps();
      const subscriber = createScenarioEvaluationsSubscriber(deps);

      await subscriber.handler(finishedEvent(), CONTEXT);

      expect(deps.loadRunAttachments).toHaveBeenCalledWith({
        projectId: "project-1",
        scenarioId: "scenario-1",
        planId: "plan-1",
      });
      expect(deps.enqueue).toHaveBeenCalledTimes(1);
      expect(deps.enqueue).toHaveBeenCalledWith({
        tenantId: "project-1",
        scenarioRunId: "run-1",
        scenarioId: "scenario-1",
        suiteId: "suite-1",
        planId: "plan-1",
        attachments: [attachment],
        traceIds: ["trace-1"],
        attempt: 1,
        occurredAt: expect.any(Number),
      });
    });

    it("reads no plan off a set id that is not a suite set", async () => {
      const deps = makeDeps();

      await createScenarioEvaluationsSubscriber(deps).handler(
        finishedEvent({ scenarioSetId: "my-set" }),
        CONTEXT,
      );

      expect(deps.loadRunAttachments).toHaveBeenCalledWith(
        expect.objectContaining({ planId: null }),
      );
    });
  });

  describe("when the finished event carries the run's own attachments", () => {
    /** @scenario "The evaluation job is queued with the attachments the run carries" */
    it("queues them without reading the suite or the plan again", async () => {
      const deps = makeDeps();
      const queued = { ...attachment, id: "att-queued" };

      await createScenarioEvaluationsSubscriber(deps).handler(
        finishedEvent({
          evaluators: {
            suiteId: "suite-queued",
            planId: "plan-queued",
            attachments: [queued],
          },
        }),
        CONTEXT,
      );

      expect(deps.loadRunAttachments).not.toHaveBeenCalled();
      expect(deps.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          suiteId: "suite-queued",
          planId: "plan-queued",
          attachments: [queued],
        }),
      );
    });

    /** @scenario "The evaluation job is queued with the field values and the definitions the run carries" */
    it("queues the field values and the evaluator definitions the event carries", async () => {
      const deps = makeDeps();
      const definition = {
        id: "eval-1",
        name: "Exact match",
        type: "evaluator",
        evaluatorType: "langevals/exact_match",
        workflowId: null,
        settings: { case_sensitive: true },
        fields: [{ identifier: "output", type: "str" }],
      };

      await createScenarioEvaluationsSubscriber(deps).handler(
        finishedEvent({
          evaluators: {
            suiteId: "suite-queued",
            planId: "plan-queued",
            attachments: [attachment],
            fieldValues: { golden_sql: "SELECT 1" },
            definitions: [definition],
          },
        }),
        CONTEXT,
      );

      expect(deps.loadRunAttachments).not.toHaveBeenCalled();
      expect(deps.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          fieldValues: { golden_sql: "SELECT 1" },
          definitions: [definition],
        }),
      );
    });

    it("queues neither when the event was written before they were carried", async () => {
      const deps = makeDeps();

      await createScenarioEvaluationsSubscriber(deps).handler(
        finishedEvent({
          evaluators: {
            suiteId: "suite-queued",
            planId: "plan-queued",
            attachments: [attachment],
          },
        }),
        CONTEXT,
      );

      const queued = vi.mocked(deps.enqueue).mock.calls[0]?.[0];
      expect(queued).not.toHaveProperty("fieldValues");
      expect(queued).not.toHaveProperty("definitions");
    });
  });

  describe("when the finished results already carry evaluations", () => {
    /** @scenario "A run that carries its own evaluations is not evaluated again" */
    it("queues nothing", async () => {
      const deps = makeDeps();

      await createScenarioEvaluationsSubscriber(deps).handler(
        finishedEvent({
          results: {
            verdict: "success",
            metCriteria: [],
            unmetCriteria: [],
            evaluations: [],
          },
        }),
        CONTEXT,
      );

      expect(deps.loadRunAttachments).not.toHaveBeenCalled();
      expect(deps.enqueue).not.toHaveBeenCalled();
    });
  });

  describe("when the suite and the plan attach no evaluator", () => {
    /** @scenario "A run whose suite and plan attach no evaluator queues no job" */
    it("queues nothing", async () => {
      const deps = makeDeps([]);

      await createScenarioEvaluationsSubscriber(deps).handler(
        finishedEvent(),
        CONTEXT,
      );

      expect(deps.enqueue).not.toHaveBeenCalled();
    });
  });

  describe("when the run ended in an error or a cancellation", () => {
    /** @scenario "A run that ended in an error or a cancellation is not evaluated" */
    it("queues nothing", async () => {
      const deps = makeDeps();
      const subscriber = createScenarioEvaluationsSubscriber(deps);

      await subscriber.handler(finishedEvent({ status: "ERROR" }), CONTEXT);
      await subscriber.handler(finishedEvent({ status: "CANCELLED" }), CONTEXT);

      expect(deps.enqueue).not.toHaveBeenCalled();
    });
  });

  describe("when the event is not a finished event", () => {
    it("ignores it", async () => {
      const deps = makeDeps();

      await createScenarioEvaluationsSubscriber(deps).handler(
        {
          ...finishedEvent(),
          type: SIMULATION_RUN_EVENT_TYPES.STARTED,
        } as SimulationProcessingEvent,
        CONTEXT,
      );

      expect(deps.enqueue).not.toHaveBeenCalled();
    });
  });
});
