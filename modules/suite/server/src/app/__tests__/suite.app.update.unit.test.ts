/**
 * @vitest-environment node
 */
import { ResourceScope } from "@langwatch/runtime-composition";
import { describe, expect, it, vi } from "vitest";
import type { AgentApi } from "@langwatch/agent-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ScenarioApi, ScenarioTestSuite } from "@langwatch/scenario-contract";
import { SuiteScopeNotAllowedError } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { SuiteExecutionPort } from "../../ports/suite-execution.port.ts";
import { SuiteApp } from "../suite.app.ts";
import { createSuiteTestRepositories } from "./suite.fixture.ts";

function testSuite(overrides: Partial<ScenarioTestSuite> = {}): ScenarioTestSuite {
  return {
    id: "test_suite_1",
    projectId: "project_1",
    name: "Refunds",
    slug: "refunds",
    description: null,
    scenarioIds: [],
    targets: [],
    repeatCount: 1,
    labels: [],
    simulatorModel: null,
    judgeModel: null,
    kind: "test_suite",
    scope: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockMethod<T extends (...args: never[]) => unknown>(): T {
  return vi.fn<T>();
}

const agentApi = createApiFixture<AgentApi>({
  getAll: mockMethod(),
  getById: mockMethod(),
  list: mockMethod(),
  create: mockMethod(),
  update: mockMethod(),
  archive: mockMethod(),
  relatedEntities: mockMethod(),
  cascadeArchive: mockMethod(),
  getCopies: mockMethod(),
  getSourceOfCopy: mockMethod(),
  copy: mockMethod(),
  pushToCopies: mockMethod(),
  syncFromSource: mockMethod(),
  getHistory: mockMethod(),
  ownersOf: mockMethod(),
  getNamesByIds: mockMethod(),
  getReferenceStates: mockMethod(),
  getConnectedByNameAndEnvironment: mockMethod(),
  getConnectedByName: mockMethod(),
  testTurn: mockMethod(),
  testRun: mockMethod(),
});

const promptApi = createApiFixture<PromptApi>({
  getAllPrompts: mockMethod(),
  tryGetPromptByIdOrHandle: mockMethod(),
  getAllVersions: mockMethod(),
  createPrompt: mockMethod(),
  updatePrompt: mockMethod(),
  deletePrompt: mockMethod(),
  syncPrompt: mockMethod(),
  assignTag: mockMethod(),
  listTags: mockMethod(),
  createTag: mockMethod(),
  renameTag: mockMethod(),
  tryDeleteTagByName: mockMethod(),
  listForProject: mockMethod(),
  tryGetByIdOrHandle: mockMethod(),
  getByIdOrHandle: mockMethod(),
  listVersions: mockMethod(),
  create: mockMethod(),
  update: mockMethod(),
  updateHandle: mockMethod(),
  restoreVersion: mockMethod(),
  delete: mockMethod(),
  copyToProject: mockMethod(),
  duplicate: mockMethod(),
  applySourceToCopy: mockMethod(),
  checkHandleUniqueness: mockMethod(),
  checkModifyPermission: mockMethod(),
  getTagsForConfig: mockMethod(),
  listTagsForProject: mockMethod(),
  getNamesByIds: mockMethod(),
  getExistingIds: mockMethod(),
  listCopies: mockMethod(),
  getCopySource: mockMethod(),
  createTagForProject: mockMethod(),
  projectsSharingTagCatalog: mockMethod(),
  assertMayManageTagCatalog: mockMethod(),
  renameTagForProject: mockMethod(),
  deleteTagForProject: mockMethod(),
});

const projectApi = createApiFixture<ProjectApi>({
  tryGetById: mockMethod(),
  getOrganizationId: mockMethod(),
  getWithTeam: mockMethod(),
  tryGetWithTeam: mockMethod(),
  listByOrganization: mockMethod(),
  listByTeam: mockMethod(),
  create: mockMethod(),
  updateSettings: mockMethod(),
  archive: mockMethod(),
  regenerateLegacyProjectKey: mockMethod(),
  requestTopicClustering: mockMethod(),
  touchCodingAgentPullRequestSeen: mockMethod(),
});

function buildApp(overrides: { scenarios?: Partial<ScenarioApi> } = {}) {
  const updateTestSuite = vi.fn<ScenarioApi["updateTestSuite"]>().mockResolvedValue(testSuite());
  const scenarios = createApiFixture<ScenarioApi>({
    list: mockMethod(),
    listTestSuites: mockMethod(),
    getReferenceStates: mockMethod(),
    getRunConfigs: mockMethod(),
    getModelChoices: mockMethod(),
    resolveRunParameters: mockMethod(),
    resolveRunParametersForScenarios: mockMethod(),
    getNamesByIds: mockMethod(),
    tryGetTestSuite: vi.fn<ScenarioApi["tryGetTestSuite"]>().mockResolvedValue(testSuite()),
    createTestSuite: mockMethod(),
    updateTestSuite,
    getTestSuiteRunDefinition: mockMethod(),
    archiveTestSuite: mockMethod(),
    renameTestSuite: mockMethod(),
    getInternalSuiteSummaries: mockMethod(),
    ...overrides.scenarios,
  });

  const execution = new (class extends SuiteExecutionPort {
    execute = vi.fn<SuiteExecutionPort["execute"]>();
  })();

  const app = SuiteApp.create({
    repositories: createSuiteTestRepositories(),
    dependencies: { scenarios, agents: agentApi, prompts: promptApi, projects: projectApi },
    infrastructure: {
      execution,
      resolveClickHouseClient: null,
      defaultRetentionDays: 30,
    },
    config: void 0,
    resources: new ResourceScope(),
  });
  return { app, updateTestSuite };
}

describe("SuiteApp.update", () => {
  describe("given a test suite", () => {
    /** @scenario "The suite editor refuses to broaden a test suite into a code-owned suite" */
    it("refuses a scope or scenarioIds write on a test suite", async () => {
      const { app, updateTestSuite } = buildApp();

      await expect(
        app.update({
          id: "test_suite_1",
          projectId: "project_1",
          scope: { mode: "all" },
        }),
      ).rejects.toBeInstanceOf(SuiteScopeNotAllowedError);

      await expect(
        app.update({
          id: "test_suite_1",
          projectId: "project_1",
          scenarioIds: ["scen_x"],
        }),
      ).rejects.toMatchObject({ code: "validation_error" });

      expect(updateTestSuite).not.toHaveBeenCalled();
    });
  });

  describe("given a test suite the editor saves execution settings onto", () => {
    /** @scenario "The suite editor refuses execution settings on a test suite" */
    it("refuses with validation_error and names every execution field the request carried", async () => {
      const { app, updateTestSuite } = buildApp();

      await expect(
        app.update({
          id: "test_suite_1",
          projectId: "project_1",
          targets: [{ type: "prompt", referenceId: "prompt_1" }],
          repeatCount: 3,
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: "openai/gpt-5-mini",
        }),
      ).rejects.toMatchObject({
        code: "validation_error",
        meta: {
          fieldErrors: {
            targets: expect.any(Array),
            repeatCount: expect.any(Array),
            simulatorModel: expect.any(Array),
            judgeModel: expect.any(Array),
          },
        },
      });

      expect(updateTestSuite).not.toHaveBeenCalled();
    });

    /** @scenario "Updating a test suite with execution settings is refused with validation_error"
     */
    it("names only the execution field the request carried, leaving the row unchanged", async () => {
      const { app, updateTestSuite } = buildApp();

      await expect(
        app.update({
          id: "test_suite_1",
          projectId: "project_1",
          name: "Refunds",
          repeatCount: 5,
        }),
      ).rejects.toMatchObject({
        code: "validation_error",
        meta: { fieldErrors: { repeatCount: expect.any(Array) } },
      });

      const refusal = await app
        .update({ id: "test_suite_1", projectId: "project_1", repeatCount: 5 })
        .then(() => null)
        .catch((error: unknown) => error as { meta: { fieldErrors: Record<string, string[]> } });
      expect(Object.keys(refusal?.meta.fieldErrors ?? {})).toEqual(["repeatCount"]);
      expect(updateTestSuite).not.toHaveBeenCalled();
    });

    /** @scenario "The suite editor refuses execution settings on a test suite" */
    it("still saves a name and labels", async () => {
      const { app, updateTestSuite } = buildApp();

      await app.update({
        id: "test_suite_1",
        projectId: "project_1",
        name: "Refunds v2",
        labels: ["billing"],
      });

      expect(updateTestSuite).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Refunds v2", labels: ["billing"] }),
      );
    });
  });
});

describe("SuiteApp.listByIds", () => {
  it("keeps matching test suites, omits missing associations and looks up duplicate IDs once", async () => {
    const lookup = vi.fn<ScenarioApi["tryGetTestSuite"]>(async ({ testSuiteId, projectId }) =>
      testSuiteId === "test_suite_1" && projectId === "project_1" ? testSuite() : null,
    );
    const { app } = buildApp({ scenarios: { tryGetTestSuite: lookup } });

    const suites = await app.listByIds({
      projectId: "project_1",
      ids: ["test_suite_1", "missing", "test_suite_1"],
    });

    expect(suites).toEqual([
      expect.objectContaining({ id: "test_suite_1", projectId: "project_1" }),
    ]);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledWith({ testSuiteId: "missing", projectId: "project_1" });
    expect(await app.listByIds({ projectId: "project_other", ids: ["test_suite_1"] })).toEqual([]);
  });
});
