/**
 * @vitest-environment node
 * @see specs/suites/test-suites.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { EvaluatorApi, EvaluatorWithFields } from "@langwatch/evaluator-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { EvaluatorAttachment, ScenarioApi } from "@langwatch/scenario-contract";
import type { RunPlanConfigInput } from "@langwatch/suite-contract";
import { beforeEach, describe, expect, it } from "vitest";

import type { SuiteExecution } from "../../app/suite.app.ts";
import { MemorySuiteDatabase } from "../../repositories/memory/memory.suite.database.ts";
import { MemorySuiteRepository } from "../../repositories/memory/memory.suite.repository.ts";
import { SuiteService } from "../suite.service.ts";

const projectId = "project-1";

function savedEvaluator(id: string): EvaluatorWithFields {
  return {
    id,
    projectId,
    name: id,
    slug: id,
    type: "evaluator",
    config: null,
    workflowId: null,
    copiedFromEvaluatorId: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    fields: [{ identifier: "output", type: "str" }],
    outputFields: [],
  };
}

function attachment(evaluatorId: string): EvaluatorAttachment {
  return {
    id: `attachment-${evaluatorId}`,
    evaluatorId,
    required: true,
    mappings: {
      output: { type: "source", sourceId: "conversation", path: ["last_agent_message"] },
    },
  };
}

const config: RunPlanConfigInput = {
  scope: { mode: "scenarios" },
  targets: [{ type: "http", referenceId: "agent-1" }],
  scenarioIds: ["scenario-1"],
};

let database: MemorySuiteDatabase;
let service: SuiteService;

beforeEach(() => {
  database = MemorySuiteDatabase.create();
  const references = async ({ ids }: { ids: string[] }) =>
    ids.map((id) => ({ id, archivedAt: null }));
  service = SuiteService.create({
    repository: MemorySuiteRepository.create({ database }),
    scenarios: createApiFixture<ScenarioApi>({
      findTestSuite: async () => null,
      list: async () => [],
      listTestSuites: async () => [],
      getReferenceStates: references,
      resolveRunParametersForScenarios: async () => [],
      getRunConfigs: async ({ ids }) =>
        ids.map((id) => ({
          id,
          name: id,
          version: 1,
          situation: "",
          criteria: [],
          parameters: {},
        })),
    }),
    agents: createApiFixture<AgentApi>({
      getReferenceStates: references,
      getNamesByIds: async ({ ids }) => ids.map((id) => ({ id, name: id })),
    }),
    prompts: createApiFixture<PromptApi>({}),
    evaluators: createApiFixture<EvaluatorApi>({
      getAllWithFields: async () => [savedEvaluator("evaluator-1")],
      findByIdWithFields: async ({ id }) =>
        id === "evaluator-1" ? savedEvaluator("evaluator-1") : undefined,
    }),
    execution: createApiFixture<SuiteExecution>({
      execute: async (input) => ({
        batchRunId: "batch-1",
        setId: `suiteset_${input.suiteId}`,
        jobCount: 1,
        skippedArchived: input.skippedArchived,
        items: [],
      }),
    }),
    generateId: () => "plan-1",
  });
});

function runPlan(evaluators: EvaluatorAttachment[]) {
  return service.runPlan({
    projectId,
    organizationId: "org-1",
    name: "Nightly",
    config: { ...config, evaluators },
    idempotencyKey: "idem-1",
  });
}

describe("a run plan's own evaluators", () => {
  describe("when a run sends evaluators the project holds", () => {
    it("stores them on the plan it joins", async () => {
      const result = await runPlan([attachment("evaluator-1")]);

      expect(database.planEvaluators.get(result.suiteId)).toEqual([attachment("evaluator-1")]);
    });
  });

  describe("when a run sends an evaluator the project does not hold", () => {
    it("refuses before any plan is written", async () => {
      await expect(runPlan([attachment("evaluator-gone")])).rejects.toMatchObject({
        code: "suite_evaluator_not_found",
      });
      expect(database.plans.size).toBe(0);
    });
  });

  describe("when a run sends an evaluator whose required input has no mapping", () => {
    it("refuses the run before any plan is written", async () => {
      await expect(runPlan([{ ...attachment("evaluator-1"), mappings: {} }])).rejects.toMatchObject(
        {
          code: "suite_evaluator_mappings_missing",
          meta: { evaluatorId: "evaluator-1", suiteId: "", inputs: ["output"] },
        },
      );
      expect(database.plans.size).toBe(0);
    });
  });

  describe("when a stored plan's evaluator lost a required mapping", () => {
    it("refuses the next run that joins the plan, naming it", async () => {
      const { suiteId } = await runPlan([attachment("evaluator-1")]);
      database.planEvaluators.set(suiteId, [{ ...attachment("evaluator-1"), mappings: {} }]);

      await expect(
        service.runPlan({
          projectId,
          organizationId: "org-1",
          name: "Nightly",
          config,
          idempotencyKey: "idem-2",
        }),
      ).rejects.toMatchObject({
        code: "suite_evaluator_mappings_missing",
        meta: { suiteId },
      });
    });
  });

  describe("when a plan is updated", () => {
    it("writes the evaluators it sends", async () => {
      const { suiteId } = await runPlan([]);

      await service.update({ id: suiteId, projectId, evaluators: [attachment("evaluator-1")] });

      expect(database.planEvaluators.get(suiteId)).toEqual([attachment("evaluator-1")]);
    });

    /** @scenario "A run plan takes evaluators but no fields" */
    it("refuses fields, which only a test suite declares", async () => {
      const { suiteId } = await runPlan([]);

      await expect(
        service.update({
          id: suiteId,
          projectId,
          fields: [{ identifier: "golden", type: "text" }],
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
    });
  });
});
