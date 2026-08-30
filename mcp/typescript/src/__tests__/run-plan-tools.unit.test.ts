/**
 * Digests of the run plan tools.
 *
 * @see specs/mcp-server/run-plan-tools.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../langwatch-api-run-plans.js", () => ({
  listRunPlans: vi.fn(),
  getRunPlan: vi.fn(),
  runRunPlan: vi.fn(),
  rerunRunPlan: vi.fn(),
  archiveRunPlan: vi.fn(),
}));

import {
  archiveRunPlan,
  getRunPlan,
  listRunPlans,
  rerunRunPlan,
  runRunPlan,
  type RunPlan,
  type RunPlanRunResult,
} from "../langwatch-api-run-plans.js";

import { handleArchiveRunPlan } from "../tools/archive-run-plan.js";
import { handleGetRunPlan } from "../tools/get-run-plan.js";
import { handleListRunPlans } from "../tools/list-run-plans.js";
import { handleRerunRunPlan } from "../tools/rerun-run-plan.js";
import { handleRunPlan } from "../tools/run-plan.js";

const mockListRunPlans = vi.mocked(listRunPlans);
const mockGetRunPlan = vi.mocked(getRunPlan);
const mockRunRunPlan = vi.mocked(runRunPlan);
const mockRerunRunPlan = vi.mocked(rerunRunPlan);
const mockArchiveRunPlan = vi.mocked(archiveRunPlan);

const samplePlan: RunPlan = {
  id: "plan_abc123",
  name: "Regression Plan",
  slug: "regression-plan",
  scope: { mode: "labels", labels: ["auth", "checkout"] },
  scenarioIds: ["scen_abc123"],
  targets: [{ type: "http", referenceId: "agent_abc" }],
  repeatCount: 3,
  simulatorModel: "openai/gpt-5-mini",
  judgeModel: "openai/gpt-5-mini",
  labels: ["nightly"],
  archivedAt: null,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-02T00:00:00Z",
  platformUrl: "https://app.langwatch.ai/proj/simulations/run-plans/plan_abc123",
};

const sampleRun: RunPlanRunResult = {
  scheduled: true,
  batchRunId: "batch_123",
  setId: "set_456",
  jobCount: 6,
  skippedArchived: { scenarios: [], targets: [] },
  items: [],
  runPlanId: "plan_abc123",
  planName: "Regression Plan",
  created: true,
  platformUrl: "https://app.langwatch.ai/proj/simulations/batches/batch_123",
};

const runInput = {
  scope: { mode: "labels" as const, labels: ["auth"] },
  targets: [{ type: "http" as const, referenceId: "agent_abc" }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleRunPlan()", () => {
  describe("when the name no plan carries yet", () => {
    let result: string;

    beforeEach(async () => {
      mockRunRunPlan.mockResolvedValue({ ...sampleRun, created: true });
      result = await handleRunPlan({ name: "Regression Plan", ...runInput });
    });

    /** @scenario "Agent runs a name that no plan carries yet" */
    it("says the plan was created and started", () => {
      expect(result).toContain(
        'Run plan "Regression Plan" created and started.',
      );
    });

    /** @scenario "Agent reads the batch a run started" */
    it("names the plan, the batch and the job count", () => {
      expect(result).toContain("**Plan**: Regression Plan (plan_abc123)");
      expect(result).toContain("**Batch Run ID**: batch_123");
      expect(result).toContain("**Jobs**: 6");
    });

    it("includes the platform URL of the batch", () => {
      expect(result).toContain(
        "**View**: https://app.langwatch.ai/proj/simulations/batches/batch_123",
      );
    });

    it("sends the configuration under config and the note beside it", async () => {
      await handleRunPlan({
        name: "Regression Plan",
        ...runInput,
        repeatCount: 2,
        note: "nightly regression",
      });

      expect(mockRunRunPlan).toHaveBeenLastCalledWith({
        name: "Regression Plan",
        config: {
          scope: { mode: "labels", labels: ["auth"] },
          targets: [{ type: "http", referenceId: "agent_abc" }],
          repeatCount: 2,
          simulatorModel: undefined,
          judgeModel: undefined,
          scenarioIds: undefined,
        },
        idempotencyKey: undefined,
        parameters: undefined,
        note: "nightly regression",
      });
    });
  });

  describe("when a plan already carries the name", () => {
    /** @scenario "Agent runs a name an existing plan carries" */
    it("says the plan ran with the configuration of this run", async () => {
      mockRunRunPlan.mockResolvedValue({ ...sampleRun, created: false });

      const result = await handleRunPlan({
        name: "Regression Plan",
        ...runInput,
      });

      expect(result).toContain(
        'Run plan "Regression Plan" started with the configuration of this run.',
      );
    });
  });

  describe("when two targets name the same agent with different parameters", () => {
    /** @scenario "Agent compares one agent on two models in one run" */
    it("sends both targets, each carrying its own runParameters", async () => {
      await handleRunPlan({
        scope: { mode: "labels", labels: ["auth"] },
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

      expect(mockRunRunPlan).toHaveBeenLastCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
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
          }),
        }),
      );
    });

    /** @scenario "Agent compares one agent on two models in one run" */
    it("keeps the run-level parameters, which a target overrides for itself", async () => {
      await handleRunPlan({
        ...runInput,
        targets: [
          {
            type: "http",
            referenceId: "agent_abc",
            parameters: { model: "gpt-5" },
          },
        ],
        parameters: { model: "gpt-5-mini", account_tier: "gold" },
      });

      expect(mockRunRunPlan).toHaveBeenLastCalledWith(
        expect.objectContaining({
          parameters: { model: "gpt-5-mini", account_tier: "gold" },
          config: expect.objectContaining({
            targets: [
              {
                type: "http",
                referenceId: "agent_abc",
                runParameters: { model: "gpt-5" },
              },
            ],
          }),
        }),
      );
    });

    it("leaves runParameters out of a target that names none", async () => {
      await handleRunPlan(runInput);

      expect(mockRunRunPlan).toHaveBeenLastCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            targets: [{ type: "http", referenceId: "agent_abc" }],
          }),
        }),
      );
    });
  });

  describe("when the run skipped archived rows", () => {
    /** @scenario "A run reports what it skipped as archived" */
    it("lists the skipped scenarios and the skipped targets", async () => {
      mockRunRunPlan.mockResolvedValue({
        ...sampleRun,
        skippedArchived: {
          scenarios: ["scen_gone"],
          targets: ["agent_gone"],
        },
      });

      const result = await handleRunPlan(runInput);

      expect(result).toContain("**Skipped archived scenarios**: scen_gone");
      expect(result).toContain("**Skipped archived targets**: agent_gone");
    });
  });
});

describe("handleListRunPlans()", () => {
  describe("when run plans exist", () => {
    let result: string;

    beforeEach(async () => {
      mockListRunPlans.mockResolvedValue([samplePlan]);
      result = await handleListRunPlans({});
    });

    /** @scenario "Agent lists the run plans of a project" */
    it("lists each plan with what it covers", () => {
      expect(result).toContain("# Run Plans (1 total)");
      expect(result).toContain("## Regression Plan");
      expect(result).toContain("**Covers**: labels: auth, checkout");
    });

    it("includes the targets and the repeat count", () => {
      expect(result).toContain("**Targets**: 1 (http:agent_abc)");
      expect(result).toContain("**Repeat**: 3x");
    });

    it("asks the API for non-archived plans by default", () => {
      expect(mockListRunPlans).toHaveBeenCalledWith({
        includeArchived: undefined,
      });
    });
  });

  describe("when includeArchived is set", () => {
    it("marks an archived plan as archived", async () => {
      mockListRunPlans.mockResolvedValue([
        { ...samplePlan, archivedAt: "2024-02-01T00:00:00Z" },
      ]);

      const result = await handleListRunPlans({ includeArchived: true });

      expect(result).toContain("## Regression Plan (archived)");
      expect(mockListRunPlans).toHaveBeenCalledWith({ includeArchived: true });
    });
  });

  describe("when no run plans exist", () => {
    let result: string;

    beforeEach(async () => {
      mockListRunPlans.mockResolvedValue([]);
      result = await handleListRunPlans({});
    });

    /** @scenario "Agent lists run plans when none exist" */
    it("returns a no-plans message", () => {
      expect(result).toContain("No run plans found");
    });

    it("includes a tip to use platform_run_plan", () => {
      expect(result).toContain("platform_run_plan");
    });
  });

  describe("when format is json", () => {
    it("returns valid parseable JSON matching the plan structure", async () => {
      mockListRunPlans.mockResolvedValue([samplePlan]);

      const result = await handleListRunPlans({ format: "json" });

      expect(JSON.parse(result)).toEqual([samplePlan]);
    });
  });
});

describe("handleGetRunPlan()", () => {
  describe("when the plan names labels, targets and models", () => {
    let result: string;

    beforeEach(async () => {
      mockGetRunPlan.mockResolvedValue(samplePlan);
      result = await handleGetRunPlan({ id: "plan_abc123" });
    });

    /** @scenario "Agent reads the full configuration of a run plan" */
    it("includes the scope, the targets, the repeat count and the models", () => {
      expect(result).toContain("**Covers**: labels: auth, checkout");
      expect(result).toContain("- http:agent_abc");
      expect(result).toContain("**Repeat**: 3x");
      expect(result).toContain("**Simulator model**: openai/gpt-5-mini");
      expect(result).toContain("**Judge model**: openai/gpt-5-mini");
    });

    it("includes the plan name in the heading", () => {
      expect(result).toContain("# Run Plan: Regression Plan");
    });
  });

  describe("when a plan compares one agent on two models", () => {
    /** @scenario "Agent reads the full configuration of a run plan" */
    it("reads the two targets apart by the parameters each one runs with", async () => {
      mockGetRunPlan.mockResolvedValue({
        ...samplePlan,
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

      const result = await handleGetRunPlan({ id: "plan_abc123" });

      expect(result).toContain("- http:agent_abc (model=gpt-5)");
      expect(result).toContain("- http:agent_abc (model=gpt-5-mini)");
    });
  });

  describe("when the scope names test suites", () => {
    /** @scenario "Agent reads a plan that runs the scenarios of a test suite" */
    it("says the plan covers the scenarios of those test suites", async () => {
      mockGetRunPlan.mockResolvedValue({
        ...samplePlan,
        scope: { mode: "test_suites", testSuiteIds: ["suite_a", "suite_b"] },
      });

      const result = await handleGetRunPlan({ id: "plan_abc123" });

      expect(result).toContain("**Covers**: test suites: suite_a, suite_b");
    });
  });

  describe("when the plan names no models", () => {
    /** @scenario "Agent reads a plan that names its own models" */
    it("says both models are the project default", async () => {
      mockGetRunPlan.mockResolvedValue({
        ...samplePlan,
        simulatorModel: null,
        judgeModel: null,
      });

      const result = await handleGetRunPlan({ id: "plan_abc123" });

      expect(result).toContain("**Simulator model**: project default");
      expect(result).toContain("**Judge model**: project default");
    });
  });

  describe("when the plan carries no scope", () => {
    it("reads as the hand-picked scenario list it already held", async () => {
      mockGetRunPlan.mockResolvedValue({ ...samplePlan, scope: null });

      const result = await handleGetRunPlan({ id: "plan_abc123" });

      expect(result).toContain("**Covers**: hand-picked scenarios (1)");
    });
  });

  describe("when format is json", () => {
    it("returns valid parseable JSON matching the plan structure", async () => {
      mockGetRunPlan.mockResolvedValue(samplePlan);

      const result = await handleGetRunPlan({
        id: "plan_abc123",
        format: "json",
      });

      expect(JSON.parse(result)).toEqual(samplePlan);
    });
  });
});

describe("handleRerunRunPlan()", () => {
  describe("when the plan is run again", () => {
    let result: string;

    beforeEach(async () => {
      mockRerunRunPlan.mockResolvedValue({ ...sampleRun, created: false });
      result = await handleRerunRunPlan({
        id: "plan_abc123",
        note: "after the retry fix",
      });
    });

    /** @scenario "Agent runs a plan again with the configuration it holds" */
    it("says the plan ran with the configuration of this run", () => {
      expect(result).toContain(
        'Run plan "Regression Plan" started with the configuration of this run.',
      );
    });

    it("includes the batch run id", () => {
      expect(result).toContain("**Batch Run ID**: batch_123");
    });

    it("sends only the parameters and the note", () => {
      expect(mockRerunRunPlan).toHaveBeenCalledWith("plan_abc123", {
        parameters: undefined,
        note: "after the retry fix",
      });
    });
  });
});

describe("handleArchiveRunPlan()", () => {
  describe("when the plan is archived", () => {
    let result: string;

    beforeEach(async () => {
      mockArchiveRunPlan.mockResolvedValue({
        id: "plan_abc123",
        archived: true,
      });
      result = await handleArchiveRunPlan({ id: "plan_abc123" });
    });

    /** @scenario "Agent archives a run plan" */
    it("confirms the plan is archived", () => {
      expect(result).toContain("Run plan plan_abc123 is archived");
    });

    it("says the past runs stay readable", () => {
      expect(result).toContain("past runs stay readable");
    });
  });
});
