/**
 * @vitest-environment node
 *
 * `SuiteService.runPlan`'s orchestration: validate first, write the plan row
 * only once the run holds up, then queue it. The name-matching and locking
 * behaviour itself is a repository concern with its own database — see
 * `specs/suites/run-plan-identity-by-name.feature`'s `@integration` scenarios,
 * not covered here.
 */
import { describe, expect, it } from "vitest";
import type { AgentService } from "@langwatch/agent-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { ScenarioService } from "@langwatch/scenario-contract";
import {
  AllScenariosArchivedError,
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
}) {
  const repository: SuiteRepository = {
    resolveScopeMembership: async () => [],
    findOrCreatePlanByName: async ({ id, projectId: pid, name, scope, targets }) => ({
      suite: baseSuite({ id, projectId: pid, name, scope, targets }),
      created: true,
    }),
    ...overrides.repository,
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

  const execution: SuiteExecutionPort = {
    execute: async (input) => ({
      batchRunId: "batch-1",
      setId: `suiteset_${input.suiteId}`,
      jobCount: input.activeScenarioIds.length * input.activeTargets.length,
      skippedArchived: input.skippedArchived,
      items: [],
    }),
  } as SuiteExecutionPort;

  const agents: AgentService = {
    getReferenceStates: async ({ ids }: { ids: string[] }) =>
      ids.map((id) => ({ id, archivedAt: null })),
  } as unknown as AgentService;

  return SuiteService.create({
    repository,
    scenarios,
    agents,
    prompts: {} as PromptService,
    execution,
    runRepository: {} as SuiteRunReadRepository,
    generateId: () => "suite-generated-1",
  });
}

const config: RunPlanConfigInput = {
  scope: { mode: "scenarios" },
  targets: [{ type: "http", referenceId: "agent-1" }],
  scenarioIds: ["scenario-1"],
};

describe("SuiteService.runPlan", () => {
  describe("when everything resolves", () => {
    it("writes the plan and queues the run", async () => {
      const service = buildService({});

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
    it("refuses before touching the plan row", async () => {
      const service = buildService({});

      await expect(
        service.runPlan({
          projectId,
          organizationId: "org-1",
          name: "Refunds prod-agent",
          config: { ...config, targets: [] },
          idempotencyKey: "idem-1",
        }),
      ).rejects.toThrow(SuiteTargetsRequiredError);
    });
  });

  describe("when every named scenario is archived", () => {
    it("refuses before touching the plan row", async () => {
      const service = buildService({
        scenarios: {
          getReferenceStates: async ({ ids }: { ids: string[] }) =>
            ids.map((id) => ({ id, archivedAt: new Date() })),
        },
      });

      await expect(
        service.runPlan({
          projectId,
          organizationId: "org-1",
          name: "Refunds prod-agent",
          config,
          idempotencyKey: "idem-1",
        }),
      ).rejects.toThrow(AllScenariosArchivedError);
    });
  });

  describe("when the name matches an existing plan", () => {
    it("joins it and reports it was not created", async () => {
      const service = buildService({
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
});
