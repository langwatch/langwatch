/**
 * @vitest-environment node
 *
 * `SuiteService.runPlan`'s orchestration: validate first, write the plan row
 * only once the run holds up, then queue it. The name-matching and locking
 * behaviour itself is a repository concern with its own database — see
 * `specs/suites/run-plan-identity-by-name.feature`'s `@integration` scenarios,
 * not covered here.
 */
import { describe, expect, it, vi } from "vitest";
import type { AgentService } from "@langwatch/agent-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { ScenarioService } from "@langwatch/scenario-contract";
import {
  SuiteScopeEmptyError,
  SuiteTargetsRequiredError,
  type RunPlanConfigInput,
  type Suite,
} from "@langwatch/suite-contract";

import { SuiteService } from "../suite.service";
import type { SuiteExecutionPort } from "../../ports/suite-execution.port";
import type { SuiteRepository } from "../../repositories/suite.repository";
import type { SuiteRunReadRepository } from "../../repositories/suite-run.repository";

const projectId = "project-1";

function baseSuite(overrides: Partial<Suite> = {}): Suite {
  return {
    id: "suite-1",
    projectId,
    name: "Refunds prod-agent",
    slug: "refunds-prod-agent",
    kind: "run_plan",
    description: null,
    scenarioIds: [],
    scope: { mode: "scenarios" },
    targets: [],
    repeatCount: 1,
    labels: [],
    simulatorModel: null,
    judgeModel: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildService(overrides: {
  repository?: Partial<SuiteRepository>;
  scenarios?: Partial<ScenarioService>;
  agents?: Partial<AgentService>;
  execution?: SuiteExecutionPort;
}) {
  // Spied so a refusal test can assert the plan row was never touched: a
  // refused run must resolve entirely from the config it was sent, never
  // read or write the stored row.
  const findOrCreatePlanByName = vi.fn(
    overrides.repository?.findOrCreatePlanByName ??
      (async ({ id, projectId: pid, name, scope, targets }) => ({
        suite: baseSuite({ id, projectId: pid, name, scope, targets }),
        created: true,
      })),
  );
  const repository: SuiteRepository = {
    resolveScopeMembership: async () => [],
    ...overrides.repository,
    findOrCreatePlanByName,
  } as SuiteRepository;

  const scenarios: ScenarioService = {
    resolveRunParametersForScenarios: async () => undefined,
    getReferenceStates: async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({ id, archivedAt: null })),
    getRunConfigs: async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({
        id,
        name: id,
        version: 1,
        situation: "",
        criteria: [],
        parameters: {},
      })),
    ...overrides.scenarios,
  } as ScenarioService;

  const execution: SuiteExecutionPort =
    overrides.execution ??
    ({
      execute: async (input) => ({
        batchRunId: "batch-1",
        setId: `suiteset_${input.suiteId}`,
        jobCount: input.activeScenarioIds.length * input.activeTargets.length,
        skippedArchived: input.skippedArchived,
        items: [],
      }),
    } as SuiteExecutionPort);

  const agents: AgentService = {
    getReferenceStates: async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({ id, archivedAt: null })),
    getNamesByIds: async ({ ids }: { ids: string[] }) => ids.map((id) => ({ id, name: id })),
    ...overrides.agents,
  } as unknown as AgentService;

  const service = SuiteService.create({
    repository,
    scenarios,
    agents,
    prompts: {} as PromptService,
    execution,
    runRepository: {} as SuiteRunReadRepository,
    generateId: () => "suite-generated-1",
  });
  return { service, findOrCreatePlanByName };
}

const config: RunPlanConfigInput = {
  scope: { mode: "scenarios" },
  targets: [{ type: "http", referenceId: "agent-1" }],
  scenarioIds: ["scenario-1"],
};

describe("SuiteService.runPlan", () => {
  describe("when everything resolves", () => {
    it("writes the plan and queues the run", async () => {
      const { service } = buildService({});

      const result = await service.runPlan({
        projectId,
        organizationId: "org-1",
        name: "Refunds prod-agent",
        config,
        idempotencyKey: "idem-1",
      });

      expect(result.suiteId).toBe("suite-generated-1");
      expect(result.planName).toBe("Refunds prod-agent");
      expect(result.created).toBe(true);
      expect(result.batchRunId).toBe("batch-1");
    });
  });

  describe("when the config names no target", () => {
    /** @scenario "A run refused for naming no target creates no plan" */
    it("refuses before touching the plan row", async () => {
      const { service, findOrCreatePlanByName } = buildService({});

      await expect(
        service.runPlan({
          projectId,
          organizationId: "org-1",
          name: "Refunds prod-agent",
          config: { ...config, targets: [] },
          idempotencyKey: "idem-1",
        }),
      ).rejects.toThrow(SuiteTargetsRequiredError);
      expect(findOrCreatePlanByName).not.toHaveBeenCalled();
    });
  });

  describe("when the scope covers no scenario", () => {
    /** @scenario "A run refused for covering no scenario creates no plan" */
    it("refuses before touching the plan row", async () => {
      const { service, findOrCreatePlanByName } = buildService({});

      await expect(
        service.runPlan({
          projectId,
          organizationId: "org-1",
          name: "Refunds prod-agent",
          config: { ...config, scope: { mode: "labels", labels: ["checkout"] } },
          idempotencyKey: "idem-1",
        }),
      ).rejects.toThrow(SuiteScopeEmptyError);
      expect(findOrCreatePlanByName).not.toHaveBeenCalled();
    });
  });

  describe("when the name matches an existing plan", () => {
    it("joins it and reports it was not created", async () => {
      const { service } = buildService({
        repository: {
          findOrCreatePlanByName: async ({ projectId: pid, name, scope, targets }) => ({
            suite: baseSuite({ id: "existing-suite", projectId: pid, name, scope, targets }),
            created: false,
          }),
        },
      });

      const result = await service.runPlan({
        projectId,
        organizationId: "org-1",
        name: "Refunds prod-agent",
        config,
        idempotencyKey: "idem-1",
      });

      expect(result.suiteId).toBe("existing-suite");
      expect(result.created).toBe(false);
    });
  });

  describe("when the caller sends no name", () => {
    /** @scenario "A run started with no name is named after its scope and targets" */
    it("derives one from the scope label and the target names", async () => {
      const { service, findOrCreatePlanByName } = buildService({
        scenarios: {
          getNamesByIds: async () => [{ id: "scenario-1", name: "Refund flow" }],
        },
      });

      const result = await service.runPlan({
        projectId,
        organizationId: "org-1",
        config: { ...config, scope: { mode: "scenarios" } },
        idempotencyKey: "idem-1",
      });

      expect(result.planName).toBe("Refund flow agent-1");
      expect(findOrCreatePlanByName).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Refund flow agent-1" }),
      );
    });

    describe("when the scope covers every scenario", () => {
      it("names the plan after the project's whole run", async () => {
        const { service } = buildService({
          repository: { resolveScopeMembership: async () => ["scenario-1"] },
        });

        const result = await service.runPlan({
          projectId,
          organizationId: "org-1",
          config: { ...config, scope: { mode: "all" }, scenarioIds: undefined },
          idempotencyKey: "idem-1",
        });

        expect(result.planName).toBe("All test cases agent-1");
      });
    });
  });

  describe("when the config carries a repeat count", () => {
    /** @scenario "A test suite run honours the repeat count sent with the run" */
    it("stores it on the plan and passes it to execution", async () => {
      const executeSpy = vi.fn(async (input: { repeatCount: number; suiteId: string }) => ({
        batchRunId: "batch-1",
        setId: `suiteset_${input.suiteId}`,
        jobCount: 1,
        skippedArchived: { scenarios: [], targets: [] },
        items: [],
      }));
      const { service, findOrCreatePlanByName } = buildService({
        repository: {
          findOrCreatePlanByName: async ({ id, projectId: pid, name, scope, targets, config: cfg }) => ({
            suite: baseSuite({
              id,
              projectId: pid,
              name,
              scope,
              targets,
              repeatCount: cfg.repeatCount ?? 1,
            }),
            created: true,
          }),
        },
        execution: { execute: executeSpy } as unknown as SuiteExecutionPort,
      });

      await service.runPlan({
        projectId,
        organizationId: "org-1",
        name: "Refunds prod-agent",
        config: { ...config, repeatCount: 3 },
        idempotencyKey: "idem-1",
      });

      expect(findOrCreatePlanByName).toHaveBeenCalledWith(
        expect.objectContaining({ config: expect.objectContaining({ repeatCount: 3 }) }),
      );
      expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ repeatCount: 3 }));
    });
  });
});
