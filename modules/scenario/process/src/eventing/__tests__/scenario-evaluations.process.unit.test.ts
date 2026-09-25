import { createApiFixture } from "@langwatch/api-fixture";
import { buildIntentFactories, createTenantId, type IntentContext } from "@langwatch/eventing";
import {
  SCENARIO_EVALUATIONS_JOB,
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  TraceDataPendingError,
  type EvaluatorAttachment,
  type RunScenarioEvaluationsDeps,
  type SimulationProcessingEvent,
  type SimulationRunFinishedEventData,
} from "@langwatch/scenario-contract";
import { getSuiteSetId } from "@langwatch/suite-contract";
import { describe, expect, it } from "vitest";

import { createGradeRunHandler, gradeRunIntentSchema } from "../scenario-evaluations.intent.ts";
import {
  finishedRunViewOf,
  handleRunFinishedForGrading,
  INITIAL_SCENARIO_EVALUATIONS_STATE,
} from "../scenario-evaluations.process.ts";

const projectId = "project-1";

type EvaluatorWithFields = NonNullable<
  ReturnType<
    Awaited<ReturnType<RunScenarioEvaluationsDeps["suites"]["getAttachedEvaluators"]>>["get"]
  >
>;
type SingleEvaluationResult = Awaited<ReturnType<RunScenarioEvaluationsDeps["runEvaluation"]>>;

const conversationAttachment: EvaluatorAttachment = {
  id: "att-1",
  evaluatorId: "eval-exact",
  required: true,
  mappings: {
    output: { type: "source", sourceId: "conversation", path: ["last_agent_message"] },
  },
};

const toolAttachment: EvaluatorAttachment = {
  id: "att-tool",
  evaluatorId: "eval-exact",
  required: true,
  mappings: {
    output: { type: "source", sourceId: "trace", path: ["tool_calls", "run_sql", "input"] },
  },
};

const savedEvaluator: EvaluatorWithFields = {
  id: "eval-exact",
  projectId,
  name: "Exact match",
  slug: "exact-match",
  type: "evaluator",
  config: { evaluatorType: "langevals/exact_match", settings: {} },
  workflowId: null,
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  fields: [{ identifier: "output", type: "str" }],
  outputFields: [],
};

function finishedEvent(
  data: Partial<SimulationRunFinishedEventData> = {},
): SimulationProcessingEvent {
  return {
    id: "evt-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: createTenantId(projectId),
    createdAt: 5_000,
    occurredAt: 5_000,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      scenarioSetId: getSuiteSetId("plan-1"),
      traceIds: ["trace-1"],
      results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
      ...data,
    },
  };
}

const context = {
  at: 5_000,
  now: 5_000,
  key: "run-1",
  projectId,
  intents: buildIntentFactories({
    grade: { schema: gradeRunIntentSchema, run: async () => {} },
  }),
};

function finish(event: SimulationProcessingEvent, state = INITIAL_SCENARIO_EVALUATIONS_STATE) {
  return handleRunFinishedForGrading(state, finishedRunViewOf(event), context);
}

describe("the scenario evaluations process", () => {
  describe("when a run finishes with evaluators pinned", () => {
    /** @scenario "A finished run with attached evaluators is graded on the platform" */
    it("queues the run's grading once, carrying ids only", () => {
      const evolution = finish(
        finishedEvent({
          evaluators: {
            suiteId: "suite-1",
            planId: "plan-1",
            attachments: [conversationAttachment],
          },
        }),
      );

      expect(evolution.intents?.map((intent) => intent.payload)).toEqual([
        { tenantId: projectId, scenarioRunId: "run-1", scenarioId: "scenario-1", planId: "plan-1" },
      ]);
    });

    it("queues nothing again when the finished event is redelivered", () => {
      const event = finishedEvent();
      const first = finish(event);

      expect(finish(event, first.state).intents ?? []).toEqual([]);
    });

    it("keeps nothing of the conversation or the evaluator settings", () => {
      expect(Object.keys(finishedRunViewOf(finishedEvent()))).toEqual([
        "scenarioId",
        "scenarioSetId",
        "status",
        "hasOwnEvaluations",
        "attachmentCount",
      ]);
    });
  });

  describe("when a run finishes with no evaluators pinned", () => {
    it("queues its grading, which reads them when it runs", () => {
      expect(finish(finishedEvent()).intents).toHaveLength(1);
    });
  });

  describe("when a run's results already carry evaluations", () => {
    /** @scenario "A run that carries its own evaluations is not evaluated again" */
    it("queues no grading", () => {
      const results = {
        verdict: "success" as const,
        metCriteria: [],
        unmetCriteria: [],
        evaluations: [],
      };

      expect(finish(finishedEvent({ results })).intents ?? []).toEqual([]);
    });
  });

  describe("when the run's suite and plan pinned no evaluator", () => {
    /** @scenario "A run whose suite and plan attach no evaluator queues no job" */
    it("queues no grading", () => {
      const evaluators = { suiteId: "suite-1", planId: "plan-1", attachments: [] };

      expect(finish(finishedEvent({ evaluators })).intents ?? []).toEqual([]);
    });
  });

  describe("when a run ended in an error", () => {
    /** @scenario "A run that ended in an error or a cancellation is not evaluated" */
    it("queues no grading", () => {
      expect(finish(finishedEvent({ status: "ERROR" })).intents ?? []).toEqual([]);
    });
  });
});

function gradingDeps({
  attachments,
  priorEvents,
}: {
  attachments: EvaluatorAttachment[];
  priorEvents: SimulationProcessingEvent[];
}) {
  const recorded: Parameters<RunScenarioEvaluationsDeps["recordEvaluations"]>[0][] = [];
  const attachmentReads: unknown[] = [];
  const result: SingleEvaluationResult = { status: "processed", passed: true, score: 1 };
  const evaluations = createApiFixture<RunScenarioEvaluationsDeps>({
    scenarios: {
      getById: async () => ({
        id: "scenario-1",
        situation: "A customer asks for a refund count",
        criteria: ["The agent answers"],
        fields: {},
        testSuiteId: "suite-1",
      }),
    },
    suites: {
      getRunAttachments: async (params) => {
        attachmentReads.push(params);
        return attachments;
      },
      getAttachedEvaluators: async () => new Map([[savedEvaluator.id, savedEvaluator]]),
    },
    runs: {
      getRunState: async () => ({
        messages: [{ role: "assistant", content: "SELECT 1" }],
        traceIds: ["trace-1"],
      }),
    },
    spans: { getSpansByTraceId: async () => [] },
    runEvaluation: async () => result,
    reportEvaluation: async () => {},
    recordEvaluations: async (data) => {
      recorded.push(data);
    },
  });
  return {
    recorded,
    attachmentReads,
    deps: { evaluations, loadPriorEvents: async () => priorEvents },
  };
}

const intent = {
  tenantId: projectId,
  scenarioRunId: "run-1",
  scenarioId: "scenario-1",
  planId: "plan-1",
};

function attempt(number: number): IntentContext {
  return {
    processName: "scenario_evaluations",
    projectId,
    processKey: "run-1",
    tenantId: projectId,
    messageKey: "grade",
    attempt: number,
  };
}

describe("grading a finished run", () => {
  describe("when its finished event pinned the evaluators", () => {
    /** @scenario "A finished run with attached evaluators is graded on the platform" */
    it("grades against them and records one result per evaluator", async () => {
      const pinned = {
        suiteId: "suite-1",
        planId: "plan-1",
        attachments: [conversationAttachment],
      };
      const { deps, recorded, attachmentReads } = gradingDeps({
        attachments: [],
        priorEvents: [finishedEvent({ evaluators: pinned })],
      });

      await createGradeRunHandler(deps)(intent, attempt(1));

      expect(attachmentReads).toEqual([]);
      expect(recorded[0]?.evaluations).toEqual([
        expect.objectContaining({ evaluatorId: "eval-exact", status: "passed" }),
      ]);
    });
  });

  describe("when its finished event pinned none", () => {
    it("reads what the suite and plan attach now", async () => {
      const { deps, recorded, attachmentReads } = gradingDeps({
        attachments: [conversationAttachment],
        priorEvents: [finishedEvent()],
      });

      await createGradeRunHandler(deps)(intent, attempt(1));

      expect(attachmentReads).toEqual([{ projectId, suiteId: "suite-1", planId: "plan-1" }]);
      expect(recorded).toHaveLength(1);
    });

    it("records nothing when nothing is attached", async () => {
      const { deps, recorded } = gradingDeps({ attachments: [], priorEvents: [finishedEvent()] });

      await createGradeRunHandler(deps)(intent, attempt(1));

      expect(recorded).toEqual([]);
    });
  });

  describe("when the run's spans have not arrived", () => {
    const pinned = { suiteId: "suite-1", planId: "plan-1", attachments: [toolAttachment] };

    /** @scenario "Trace data that has not arrived yet is retried with a growing delay" */
    it("throws for the outbox to retry and records nothing before the last attempt", async () => {
      const { deps, recorded } = gradingDeps({
        attachments: [],
        priorEvents: [finishedEvent({ evaluators: pinned })],
      });

      await expect(createGradeRunHandler(deps)(intent, attempt(1))).rejects.toBeInstanceOf(
        TraceDataPendingError,
      );
      expect(recorded).toEqual([]);
    });

    /** @scenario "Trace data that has not arrived yet is retried with a growing delay" */
    it("records a failed result on the last attempt", async () => {
      const { deps, recorded } = gradingDeps({
        attachments: [],
        priorEvents: [finishedEvent({ evaluators: pinned })],
      });

      await createGradeRunHandler(deps)(intent, attempt(SCENARIO_EVALUATIONS_JOB.MAX_ATTEMPTS));

      expect(recorded[0]?.evaluations).toEqual([expect.objectContaining({ status: "failed" })]);
    });
  });
});
