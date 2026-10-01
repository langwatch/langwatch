/**
 * @vitest-environment node
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { EvaluatorApi, EvaluatorWithFields } from "@langwatch/evaluator-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type {
  EvaluatorAttachment,
  ScenarioApi,
  ScenarioTestSuite,
  ScenarioTestSuiteUpdateInput,
} from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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

function attachment(evaluatorId: string, path = "last_agent_message"): EvaluatorAttachment {
  return {
    id: `attachment-${evaluatorId}`,
    evaluatorId,
    required: true,
    mappings: {
      output:
        path === "golden"
          ? { type: "source", sourceId: "scenario", path: ["fields", "golden"] }
          : { type: "source", sourceId: "conversation", path: [path] },
    },
  };
}

function testSuite(overrides: Partial<ScenarioTestSuite> = {}): ScenarioTestSuite {
  return {
    id: "suite-1",
    projectId,
    name: "Checkout",
    slug: "checkout",
    description: null,
    scenarioIds: [],
    targets: [],
    repeatCount: 1,
    labels: [],
    simulatorModel: null,
    judgeModel: null,
    kind: "test_suite",
    scope: null,
    fields: [],
    evaluators: [],
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

let stored: ScenarioTestSuite;
let writes: ScenarioTestSuiteUpdateInput[];
let created: number;
let service: SuiteService;

beforeEach(() => {
  stored = testSuite();
  writes = [];
  created = 0;
  service = SuiteService.create({
    repository: MemorySuiteRepository.create({ database: MemorySuiteDatabase.create() }),
    scenarios: createApiFixture<ScenarioApi>({
      findTestSuite: async () => stored,
      createTestSuite: async (input) => {
        created += 1;
        return testSuite({ name: input.name });
      },
      updateTestSuite: async (input) => {
        writes.push(input);
        return stored;
      },
    }),
    agents: createApiFixture<AgentApi>({}),
    prompts: createApiFixture<PromptApi>({}),
    evaluators: createApiFixture<EvaluatorApi>({
      findByIdWithFields: async ({ id }) =>
        id === "evaluator-1" ? savedEvaluator("evaluator-1") : undefined,
    }),
    execution: createApiFixture<SuiteExecution>({}),
  });
});

describe("a test suite's evaluators", () => {
  describe("when an edit attaches an evaluator the project does not hold", () => {
    /** @scenario "A test suite write refuses an evaluator the project does not hold" */
    /** @scenario "An attachment naming an evaluator the project does not have is refused" */
    it("refuses with suite_evaluator_not_found and writes nothing", async () => {
      await expect(
        service.updateTestSuite({
          testSuiteId: "suite-1",
          projectId,
          name: "Checkout",
          fields: [{ identifier: "apidiff", type: "text" }],
          evaluators: [attachment("apidiff")],
        }),
      ).rejects.toMatchObject({
        code: "suite_evaluator_not_found",
        meta: { evaluatorId: "apidiff" },
      });
      expect(writes).toEqual([]);
    });
  });

  describe("when a new test suite attaches an evaluator the project does not hold", () => {
    it("refuses with suite_evaluator_not_found and creates nothing", async () => {
      await expect(
        service.createTestSuite({ projectId, name: "Checkout", evaluators: [attachment("gone")] }),
      ).rejects.toMatchObject({ code: "suite_evaluator_not_found" });
      expect(created).toBe(0);
    });
  });

  describe("when an edit attaches an evaluator the project holds", () => {
    /** @scenario "An evaluator is attached to a test suite with its mappings" */
    it("writes the edit with the attachment and its mappings", async () => {
      await service.updateTestSuite({
        testSuiteId: "suite-1",
        projectId,
        evaluators: [attachment("evaluator-1")],
      });

      expect(writes).toHaveLength(1);
      expect(writes[0]?.evaluators).toEqual([attachment("evaluator-1")]);
    });
  });

  describe("when an edit drops a field an attached evaluator still reads", () => {
    /** @scenario "A test suite edit refuses dropping a field an attached evaluator still reads" */
    /** @scenario "A field an evaluator reads cannot be removed" */
    it("refuses with suite_field_in_use", async () => {
      stored = testSuite({
        fields: [{ identifier: "golden", type: "text" }],
        evaluators: [attachment("evaluator-1", "golden")],
      });

      await expect(
        service.updateTestSuite({ testSuiteId: "suite-1", projectId, fields: [] }),
      ).rejects.toMatchObject({ code: "suite_field_in_use" });
      expect(writes).toEqual([]);
    });
  });
});
