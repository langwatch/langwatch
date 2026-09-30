/**
 * Subscriber and worker together, over real Prisma rows: a test suite with a
 * field and an attached evaluator, a scenario carrying the field, a finished
 * event. The evaluation runner, the run state and the span store are stubbed;
 * what is recorded and reported is captured.
 *
 * @see specs/scenarios/scenario-evaluators.feature
 */

import { nanoid } from "nanoid";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SuiteRunService } from "~/server/app-layer/suites/suite-run.service";
import { prisma } from "~/server/db";
import { SIMULATION_RUN_EVENT_TYPES } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/constants";
import type { SimulationProcessingEvent } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/events";
import { createScenarioEvaluationsSubscriber } from "~/server/event-sourcing/pipelines/simulation-processing/subscribers/scenarioEvaluations.subscriber";
import { SuiteService } from "~/server/suites/suite.service";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import { getTestUser } from "../../../../utils/testUtils";
import { ScenarioService } from "../../scenario.service";
import {
  loadRunAttachments,
  type RunScenarioEvaluationsDeps,
  runScenarioEvaluations,
} from "../runScenarioEvaluations";
import { createScenarioEvaluationsJobHandler } from "../scenarioEvaluations.job";
import type { ScenarioEvaluationsJobPayload } from "../types";

const projectId = `test-scenario-evaluations-${nanoid(8)}`;
const scenarioService = ScenarioService.create(prisma);
let suiteService: SuiteService;

const CONTEXT = {
  tenantId: projectId,
  aggregateId: "run-1",
  state: undefined,
};

beforeAll(async () => {
  await getTestUser();
  const organization = await prisma.organization.findUnique({
    where: { slug: "test-organization" },
  });
  const team = await prisma.team.findFirst({
    where: { slug: "test-team", organizationId: organization!.id },
  });
  await prisma.project.upsert({
    where: { id: projectId },
    update: {},
    create: {
      id: projectId,
      name: projectId,
      slug: projectId,
      apiKey: `sk-lw-${projectId}`,
      teamId: team!.id,
      language: "en",
      framework: "test",
    },
  });
});

beforeEach(async () => {
  await prisma.scenario.deleteMany({ where: { projectId } });
  await prisma.simulationSuite.deleteMany({ where: { projectId } });
  await prisma.evaluator.deleteMany({ where: { projectId } });
  suiteService = SuiteService.create({
    prisma,
    suiteRunService: SuiteRunService.create({
      resolveClickHouseClient: null,
      startSuiteRun: vi.fn(async () => {}),
      queueSimulationRun: vi.fn(async () => {}),
    }),
  });
});

async function createExactMatchEvaluator() {
  return prisma.evaluator.create({
    data: {
      projectId,
      name: "Exact match",
      slug: `exact-match-${nanoid(6)}`,
      type: "evaluator",
      config: { evaluatorType: "langevals/exact_match", settings: {} },
    },
  });
}

/** A suite with the field golden_sql and the evaluator mapped to it. */
async function createGradedSuite() {
  const evaluator = await createExactMatchEvaluator();
  const suite = await suiteService.createTestSuite({
    projectId,
    name: "Case lookups",
    fields: [{ identifier: "golden_sql", type: "text" }],
    evaluators: [
      {
        id: "att_exact",
        evaluatorId: evaluator.id,
        required: true,
        mappings: {
          output: {
            type: "source",
            sourceId: "conversation",
            path: ["last_agent_message"],
          },
          expected_output: {
            type: "source",
            sourceId: "scenario",
            path: ["fields", "golden_sql"],
          },
        },
      },
    ],
  });
  return { evaluator, suite };
}

async function createScenario({
  testSuiteId,
  fields,
}: {
  testSuiteId: string;
  fields?: Record<string, string>;
}) {
  return scenarioService.create({
    projectId,
    name: "Refund count",
    situation: "An analyst asks how many refunds there were",
    criteria: ["The agent answers with a query"],
    labels: [],
    testSuiteId,
    ...(fields !== undefined && { fields }),
  });
}

function finishedEvent({
  scenarioId,
  suiteId,
}: {
  scenarioId: string;
  suiteId: string;
}): SimulationProcessingEvent {
  return {
    id: `evt-${nanoid(6)}`,
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: projectId,
    createdAt: 5_000,
    occurredAt: 5_000,
    version: "2026-08-06",
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    data: {
      scenarioRunId: "run-1",
      scenarioId,
      batchRunId: "batch-1",
      scenarioSetId: getSuiteSetId(suiteId),
      traceIds: ["trace-1"],
      status: "SUCCESS",
      results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
    },
  } as unknown as SimulationProcessingEvent;
}

/** The subscriber and the worker, wired over an in-memory queue. */
function wire({ agentAnswer }: { agentAnswer: string }) {
  const deps: RunScenarioEvaluationsDeps = {
    scenarios: scenarioService,
    suites: suiteService,
    runs: {
      getRunState: vi.fn(async () => ({
        messages: [
          { role: "user", content: "How many refunds?" },
          { role: "assistant", content: agentAnswer },
        ],
        traceIds: ["trace-1"],
      })),
    },
    spans: { getSpansByTraceId: vi.fn(async () => []) },
    runEvaluation: vi.fn(async ({ data }) => {
      const values = data.data as Record<string, string>;
      return {
        status: "processed" as const,
        passed: values.output === values.expected_output,
        score: values.output === values.expected_output ? 1 : 0,
      };
    }),
    reportEvaluation: vi.fn(async () => {}),
    recordEvaluations: vi.fn(async () => {}),
  };
  const queued: ScenarioEvaluationsJobPayload[] = [];
  const subscriber = createScenarioEvaluationsSubscriber({
    loadRunAttachments: (params) => loadRunAttachments({ deps, ...params }),
    enqueue: async (payload) => {
      queued.push(payload);
    },
  });
  const handler = createScenarioEvaluationsJobHandler({
    run: (params) => runScenarioEvaluations({ deps, ...params }),
    reschedule: async ({ payload }) => {
      queued.push(payload);
    },
  });
  return { deps, queued, subscriber, handler };
}

describe("scenario evaluations on a finished run", () => {
  describe("given a suite with a field and an exact match evaluator, and a scenario that carries the field", () => {
    /** @scenario "A finished run with attached evaluators is graded on the platform" */
    it("queues one job, runs the evaluator with the resolved inputs, records and reports the result", async () => {
      const { evaluator, suite } = await createGradedSuite();
      const scenario = await createScenario({
        testSuiteId: suite.id,
        fields: { golden_sql: "SELECT 1" },
      });
      const { deps, queued, subscriber, handler } = wire({
        agentAnswer: "SELECT 1",
      });

      await subscriber.handler(
        finishedEvent({ scenarioId: scenario.id, suiteId: suite.id }),
        CONTEXT,
      );

      expect(queued).toHaveLength(1);
      expect(queued[0]).toEqual(
        expect.objectContaining({
          tenantId: projectId,
          scenarioRunId: "run-1",
          scenarioId: scenario.id,
          suiteId: suite.id,
          planId: suite.id,
          attempt: 1,
        }),
      );

      await handler(queued[0]!);

      expect(deps.runEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          evaluatorType: "langevals/exact_match",
          data: {
            type: "default",
            data: { output: "SELECT 1", expected_output: "SELECT 1" },
          },
        }),
      );
      expect(deps.recordEvaluations).toHaveBeenCalledWith({
        tenantId: projectId,
        scenarioRunId: "run-1",
        occurredAt: expect.any(Number),
        evaluations: [
          {
            evaluatorId: evaluator.id,
            name: "Exact match",
            status: "passed",
            required: true,
            passed: true,
            score: 1,
            inputs: { output: "SELECT 1", expected_output: "SELECT 1" },
          },
        ],
      });
      expect(deps.reportEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: projectId,
          evaluatorId: evaluator.id,
          evaluatorName: "Exact match",
          traceId: "trace-1",
          status: "processed",
          passed: true,
        }),
      );
      expect(queued).toHaveLength(1);
    });
  });

  describe("given a scenario that carries no value for the field", () => {
    /** @scenario "A blank scenario field skips the evaluator with a reason" */
    it("records a skipped result without running the evaluator", async () => {
      const { evaluator, suite } = await createGradedSuite();
      const scenario = await createScenario({ testSuiteId: suite.id });
      const { deps, queued, subscriber, handler } = wire({
        agentAnswer: "SELECT 1",
      });

      await subscriber.handler(
        finishedEvent({ scenarioId: scenario.id, suiteId: suite.id }),
        CONTEXT,
      );
      await handler(queued[0]!);

      expect(deps.runEvaluation).not.toHaveBeenCalled();
      expect(deps.recordEvaluations).toHaveBeenCalledWith(
        expect.objectContaining({
          evaluations: [
            {
              evaluatorId: evaluator.id,
              name: "Exact match",
              status: "skipped",
              required: true,
              details: "no golden_sql on this scenario",
            },
          ],
        }),
      );
    });
  });

  describe("given a suite with no evaluators", () => {
    /** @scenario "A run whose suite and plan attach no evaluator queues no job" */
    it("queues nothing", async () => {
      const suite = await suiteService.createTestSuite({
        projectId,
        name: "Plain",
      });
      const scenario = await createScenario({ testSuiteId: suite.id });
      const { queued, subscriber } = wire({ agentAnswer: "x" });

      await subscriber.handler(
        finishedEvent({ scenarioId: scenario.id, suiteId: suite.id }),
        CONTEXT,
      );

      expect(queued).toHaveLength(0);
    });
  });
});
