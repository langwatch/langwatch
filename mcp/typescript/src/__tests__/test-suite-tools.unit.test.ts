/**
 * Digests of the test suite tools, and the test suite fields the scenario
 * tools carry so an agent can file a scenario in a suite and read a suite
 * back.
 *
 * @see specs/mcp-server/test-suite-tools.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../langwatch-api-test-suites.js", () => ({
  listTestSuites: vi.fn(),
  createTestSuite: vi.fn(),
  getTestSuite: vi.fn(),
  renameTestSuite: vi.fn(),
  archiveTestSuite: vi.fn(),
  runTestSuite: vi.fn(),
}));

vi.mock("../langwatch-api-scenarios.js", () => ({
  listScenarios: vi.fn(),
  createScenario: vi.fn(),
  updateScenario: vi.fn(),
}));

import {
  createScenario,
  listScenarios,
  updateScenario,
  type ScenarioSummary,
} from "../langwatch-api-scenarios.js";
import type { RunPlanRunResult } from "../langwatch-api-run-plans.js";
import {
  archiveTestSuite,
  createTestSuite,
  getTestSuite,
  listTestSuites,
  renameTestSuite,
  runTestSuite,
  type TestSuite,
} from "../langwatch-api-test-suites.js";

import { handleArchiveTestSuite } from "../tools/archive-test-suite.js";
import { handleCreateScenario } from "../tools/create-scenario.js";
import { handleCreateTestSuite } from "../tools/create-test-suite.js";
import { handleGetTestSuite } from "../tools/get-test-suite.js";
import { handleListScenarios } from "../tools/list-scenarios.js";
import { handleListTestSuites } from "../tools/list-test-suites.js";
import { handleRenameTestSuite } from "../tools/rename-test-suite.js";
import { handleRunTestSuite } from "../tools/run-test-suite.js";
import { handleUpdateScenario } from "../tools/update-scenario.js";

const mockListTestSuites = vi.mocked(listTestSuites);
const mockCreateTestSuite = vi.mocked(createTestSuite);
const mockGetTestSuite = vi.mocked(getTestSuite);
const mockRenameTestSuite = vi.mocked(renameTestSuite);
const mockArchiveTestSuite = vi.mocked(archiveTestSuite);
const mockRunTestSuite = vi.mocked(runTestSuite);
const mockListScenarios = vi.mocked(listScenarios);
const mockCreateScenario = vi.mocked(createScenario);
const mockUpdateScenario = vi.mocked(updateScenario);

const sampleSuite: TestSuite = {
  id: "suite_abc123",
  name: "Checkout",
  slug: "checkout",
  scenarioIds: ["scen_abc123", "scen_def456"],
  scenarioCount: 2,
  archivedAt: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-02T00:00:00Z",
  platformUrl: "https://app.langwatch.ai/proj/agent-testing/suites/checkout",
};

const sampleScenario: ScenarioSummary = {
  id: "scen_abc123",
  name: "Card declined",
  situation: "The card issuer declines the payment",
  criteria: ["Offers another payment method"],
  labels: ["checkout"],
  testSuiteId: "suite_abc123",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleListTestSuites()", () => {
  describe("when test suites exist", () => {
    let result: string;

    beforeEach(async () => {
      mockListTestSuites.mockResolvedValue([sampleSuite]);
      result = await handleListTestSuites({});
    });

    /** @scenario "Agent lists the test suites of a project" */
    it("lists each suite with the count of scenarios in it", () => {
      expect(result).toContain("# Test Suites (1 total)");
      expect(result).toContain("## Checkout");
      expect(result).toContain("**Scenarios**: 2");
    });

    it("includes the suite id", () => {
      expect(result).toContain("**ID**: suite_abc123");
    });
  });

  describe("when no test suites exist", () => {
    let result: string;

    beforeEach(async () => {
      mockListTestSuites.mockResolvedValue([]);
      result = await handleListTestSuites({});
    });

    /** @scenario "Agent lists test suites when none exist" */
    it("returns a no-suites message", () => {
      expect(result).toContain("No test suites found");
    });

    it("includes a tip to use platform_create_test_suite", () => {
      expect(result).toContain("platform_create_test_suite");
    });
  });

  describe("when format is json", () => {
    it("returns valid parseable JSON matching the suite structure", async () => {
      mockListTestSuites.mockResolvedValue([sampleSuite]);

      const result = await handleListTestSuites({ format: "json" });

      expect(JSON.parse(result)).toEqual([sampleSuite]);
    });
  });
});

describe("handleCreateTestSuite()", () => {
  describe("when the suite is created", () => {
    let result: string;

    beforeEach(async () => {
      mockCreateTestSuite.mockResolvedValue({
        ...sampleSuite,
        scenarioIds: [],
        scenarioCount: 0,
      });
      result = await handleCreateTestSuite({ name: "Checkout" });
    });

    /** @scenario "Agent creates a test suite" */
    it("confirms the suite was created and names its id", () => {
      expect(result).toContain('Test suite "Checkout" created.');
      expect(result).toContain("**ID**: suite_abc123");
    });

    it("says to file scenarios in it with testSuiteId", () => {
      expect(result).toContain("testSuiteId `suite_abc123`");
    });
  });
});

describe("handleGetTestSuite()", () => {
  describe("when scenarios are filed in the suite", () => {
    /** @scenario "Agent reads a test suite with the scenarios filed in it" */
    it("lists the name and the id of each scenario", async () => {
      mockGetTestSuite.mockResolvedValue({
        ...sampleSuite,
        scenarios: [
          { id: "scen_abc123", name: "Card declined" },
          { id: "scen_def456", name: "Coupon expired" },
        ],
      });

      const result = await handleGetTestSuite({ id: "suite_abc123" });

      expect(result).toContain("- Card declined (scen_abc123)");
      expect(result).toContain("- Coupon expired (scen_def456)");
    });
  });

  describe("when no scenario is filed in the suite", () => {
    /** @scenario "Agent reads a test suite with no scenarios filed in it" */
    it("says none are filed yet", async () => {
      mockGetTestSuite.mockResolvedValue({
        ...sampleSuite,
        scenarioIds: [],
        scenarioCount: 0,
        scenarios: [],
      });

      const result = await handleGetTestSuite({ id: "suite_abc123" });

      expect(result).toContain("None filed yet.");
    });
  });

  describe("when format is json", () => {
    it("returns valid parseable JSON matching the suite structure", async () => {
      const detail = { ...sampleSuite, scenarios: [] };
      mockGetTestSuite.mockResolvedValue(detail);

      const result = await handleGetTestSuite({
        id: "suite_abc123",
        format: "json",
      });

      expect(JSON.parse(result)).toEqual(detail);
    });
  });
});

describe("handleRenameTestSuite()", () => {
  describe("when the suite is renamed", () => {
    /** @scenario "Agent renames a test suite" */
    it("confirms the new name", async () => {
      mockRenameTestSuite.mockResolvedValue({
        ...sampleSuite,
        name: "Checkout v2",
        slug: "checkout-v2",
      });

      const result = await handleRenameTestSuite({
        id: "suite_abc123",
        name: "Checkout v2",
      });

      expect(result).toContain('Test suite suite_abc123 is now named "Checkout v2".');
    });
  });
});

describe("handleArchiveTestSuite()", () => {
  describe("when the suite is archived", () => {
    let result: string;

    beforeEach(async () => {
      mockArchiveTestSuite.mockResolvedValue({
        id: "suite_abc123",
        archived: true,
      });
      result = await handleArchiveTestSuite({ id: "suite_abc123" });
    });

    /** @scenario "Agent archives a test suite" */
    it("confirms the suite is archived", () => {
      expect(result).toContain("Test suite suite_abc123 is archived");
    });

    it("says the scenarios filed in it are archived with it", () => {
      expect(result).toContain("the scenarios filed in it are archived with it");
    });
  });
});

describe("handleRunTestSuite()", () => {
  describe("when the suite runs against one target", () => {
    const run: RunPlanRunResult = {
      scheduled: true,
      batchRunId: "batch_123",
      setId: "set_456",
      jobCount: 2,
      skippedArchived: { scenarios: [], targets: [] },
      items: [],
      runPlanId: "plan_abc123",
      planName: "Checkout Support Bot",
      created: true,
      platformUrl: "https://app.langwatch.ai/proj/agent-testing/results/regression-plan",
    };

    let result: string;

    beforeEach(async () => {
      mockRunTestSuite.mockResolvedValue(run);
      result = await handleRunTestSuite({
        id: "suite_abc123",
        targets: [{ type: "http", referenceId: "agent_abc" }],
      });
    });

    /** @scenario "Agent runs a test suite against a target" */
    it("names the run plan the run created or joined", () => {
      expect(result).toContain('Run plan "Checkout Support Bot" created and started.');
    });

    it("includes the batch run id and the job count", () => {
      expect(result).toContain("**Batch Run ID**: batch_123");
      expect(result).toContain("**Jobs**: 2");
    });

    it("sends the suite id apart from the run body", () => {
      expect(mockRunTestSuite).toHaveBeenCalledWith({
        id: "suite_abc123",
        targets: [{ type: "http", referenceId: "agent_abc" }],
      });
    });
  });

  describe("when two targets name the same agent with different parameters", () => {
    /** @scenario "Agent runs a test suite against one agent on two models" */
    it("sends both targets, each carrying its own runParameters", async () => {
      await handleRunTestSuite({
        id: "suite_abc123",
        targets: [
          {
            type: "http",
            referenceId: "agent_abc",
            parameters: { model: "gpt-5" },
          },
          {
            type: "http",
            referenceId: "agent_abc",
            parameters: { model: "gpt-5-mini" },
          },
        ],
      });

      expect(mockRunTestSuite).toHaveBeenLastCalledWith({
        id: "suite_abc123",
        targets: [
          {
            type: "http",
            referenceId: "agent_abc",
            runParameters: { model: "gpt-5" },
          },
          {
            type: "http",
            referenceId: "agent_abc",
            runParameters: { model: "gpt-5-mini" },
          },
        ],
      });
    });
  });
});

describe("handleCreateScenario() with a testSuiteId", () => {
  describe("when the scenario is filed in a test suite", () => {
    /** @scenario "Agent files a new scenario in a test suite" */
    it("says which test suite the scenario is filed in", async () => {
      mockCreateScenario.mockResolvedValue(sampleScenario);

      const result = await handleCreateScenario({
        name: "Card declined",
        situation: "The card issuer declines the payment",
        testSuiteId: "suite_abc123",
      });

      expect(result).toContain("**Test suite**: suite_abc123");
      expect(mockCreateScenario).toHaveBeenCalledWith(
        expect.objectContaining({ testSuiteId: "suite_abc123" }),
      );
    });
  });
});

describe("handleUpdateScenario() with a testSuiteId", () => {
  describe("when an unfiled scenario is filed in a test suite", () => {
    /** @scenario "Agent files an existing scenario in a test suite" */
    it("says which test suite the scenario is filed in", async () => {
      mockUpdateScenario.mockResolvedValue(sampleScenario);

      const result = await handleUpdateScenario({
        scenarioId: "scen_abc123",
        testSuiteId: "suite_abc123",
      });

      expect(result).toContain("**Test suite**: suite_abc123");
      expect(mockUpdateScenario).toHaveBeenCalledWith({
        id: "scen_abc123",
        testSuiteId: "suite_abc123",
      });
    });
  });
});

describe("handleListScenarios() with a testSuiteId", () => {
  const otherScenario: ScenarioSummary = {
    ...sampleScenario,
    id: "scen_zzz999",
    name: "Login timeout",
    testSuiteId: "suite_other",
  };

  describe("when the project has scenarios in two test suites", () => {
    /** @scenario "Agent lists only the scenarios filed in a test suite" */
    it("returns only the scenarios filed in that test suite", async () => {
      mockListScenarios.mockResolvedValue([sampleScenario, otherScenario]);

      const result = await handleListScenarios({ testSuiteId: "suite_abc123" });

      expect(result).toContain("Card declined");
      expect(result).not.toContain("Login timeout");
      expect(result).toContain("# Scenarios (1 total)");
    });
  });

  describe("when no scenario is filed in the requested test suite", () => {
    /** @scenario "Agent lists the scenarios of an empty test suite" */
    it("says no scenarios are filed in that test suite", async () => {
      mockListScenarios.mockResolvedValue([otherScenario]);

      const result = await handleListScenarios({ testSuiteId: "suite_abc123" });

      expect(result).toContain("No scenarios found in test suite suite_abc123.");
    });
  });

  describe("when no testSuiteId is given", () => {
    it("lists every scenario of the project", async () => {
      mockListScenarios.mockResolvedValue([sampleScenario, otherScenario]);

      const result = await handleListScenarios({});

      expect(result).toContain("# Scenarios (2 total)");
    });
  });
});
