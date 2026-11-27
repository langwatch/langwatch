import { type AgentApi, AgentNotFoundError } from "@langwatch/agent-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { LimitExceededError } from "@langwatch/enterprise-licensing-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { InstantEvalJudgeApi } from "@langwatch/instant-eval-judge-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { ResourceOwnership } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { scenarioCreateInputSchema, scenarioRestCreateSchema } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import {
  scenarioExecutorPeers,
  scenarioTestSecrets,
  scenarioVoicePeers,
  scenarioTestConfig,
} from "../../__tests__/support/scenario-app-setup.fixture.ts";
import { MemoryScenarioChannels } from "../../channels/memory/memory.scenario.channels.ts";
import { MemoryScenarioRepositories } from "../../repositories/memory/memory.scenario.repositories.ts";
import { ScenarioModule } from "../scenario.app.ts";

/** The cloud Free plan's resolved shape (specs/licensing/cloud-free-creation-caps.feature). */
const CLOUD_FREE: Plan = {
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  maxMembers: 2,
  maxMembersLite: 0,
  maxMembersDeveloper: 0,
  maxMessagesPerMonth: 50_000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
  maxScenarios: 3,
  maxScenarioSets: 3,
  maxScenarioRunsPerMonth: 100,
  maxEvaluators: 3,
};

const BY = { id: "user-1", label: "user" } as const;

/** An organization on cloud Free whose two projects already hold 3 active scenarios. */
async function organizationAtTheScenarioCap({
  scenarios = 3,
  runCap = async () => {},
  agents = createApiFixture<AgentApi>(),
}: {
  scenarios?: number;
  runCap?: EntitlementApi["assertScenarioRunAllowed"];
  agents?: AgentApi;
} = {}) {
  const repositories = MemoryScenarioRepositories.create();
  for (let index = 0; index < scenarios; index++) {
    await repositories.scenarios.create({
      id: `scenario-${index}`,
      projectId: index === 0 ? "project-2" : "project-1",
      name: `Scenario ${index}`,
      situation: "A user asks for a refund",
      criteria: [],
      labels: [],
      actor: { userId: "user-1", label: "user" },
    });
  }

  const app = await ScenarioModule.create({
    channels: MemoryScenarioChannels.create(),
    repositories,
    dependencies: {
      agents,
      judges: createApiFixture<InstantEvalJudgeApi>(),
      evaluations: createApiFixture<EvaluationApi>(),
      users: createApiFixture<UserApi>(),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: async () => "organization-1",
        listIdsByOrganization: async () => ["project-1", "project-2"],
      }),
      plans: createApiFixture<EntitlementApi>({
        getActivePlan: async () => CLOUD_FREE,
        assertScenarioRunAllowed: runCap,
      }),
      modelProviders: createApiFixture<ModelProviderApi>(),
      presence: createApiFixture<PresenceApi>(),
      auditLog: createApiFixture<AuditLogApi>(),
      traces: createApiFixture<TraceApi>(),
      retention: createApiFixture<DataRetentionApi>(),
      evaluators: createApiFixture<EvaluatorApi>(),
      ...scenarioExecutorPeers(),
      ...scenarioVoicePeers(),
      featureFlags: createApiFixture<FeatureFlagApi>(),
    },
    config: { ...scenarioTestConfig, publicBaseUrl: "https://langwatch.test" },
    resources: {} as ResourceOwnership,
    secrets: scenarioTestSecrets,
  });

  return { app, repositories };
}

const LIMIT_SHAPE = {
  code: "resource_limit_exceeded",
  httpStatus: 403,
  meta: { limitType: "scenarios", current: 3, max: 3 },
};

describe("ScenarioModule on the cloud Free scenario cap", () => {
  describe("given an organization with 3 active scenarios", () => {
    /** @scenario Creating a fourth scenario in the app is refused with the upgrade shape */
    /** @scenario Creating a fourth scenario through the API is refused with the limit shape */
    it("refuses creating another with the limit shape", async () => {
      const { app } = await organizationAtTheScenarioCap();

      await expect(
        app.create(
          {
            projectId: "project-1",
            name: "Fourth",
            situation: "Another refund",
            criteria: [],
            labels: [],
          },
          BY,
        ),
      ).rejects.toMatchObject(LIMIT_SHAPE);
    });

    /** @scenario Duplicating a scenario past the cap is refused with the limit shape */
    it("refuses duplicating one with the limit shape", async () => {
      const { app } = await organizationAtTheScenarioCap();

      await expect(
        app.duplicate({ scenarioId: "scenario-1", projectId: "project-1" }, BY),
      ).rejects.toMatchObject(LIMIT_SHAPE);
    });

    /** @scenario An organization over the scenario cap can still edit its scenarios */
    it("still saves an edit to an existing scenario", async () => {
      const { app } = await organizationAtTheScenarioCap();

      const updated = await app.update(
        { id: "scenario-1", projectId: "project-1", name: "Renamed" },
        BY,
      );

      expect(updated.name).toBe("Renamed");
    });
  });

  describe("given an organization with 2 active scenarios and an applied template", () => {
    async function withAppliedTemplate() {
      const { app, repositories } = await organizationAtTheScenarioCap({ scenarios: 2 });
      const suite = await app.createTestSuite({
        projectId: "project-1",
        name: "OWASP LLM",
        templateId: "owasp-llm",
      });
      const scenario = (name: string) => ({
        projectId: "project-1",
        name,
        situation: "An attacker hides instructions",
        criteria: [],
        labels: [],
        testSuiteId: suite.id,
      });
      const applied = [];
      for (let index = 1; index <= 10; index++) {
        applied.push(
          await app.create(scenario(`LLM${index}`), BY, { sourceTemplateId: "owasp-llm" }),
        );
      }
      return { app, repositories, suite, scenario, applied };
    }
    const normal = { projectId: "project-1", situation: "A refund", criteria: [], labels: [] };

    /** @scenario A scenario a suite template creates is not counted against the scenario cap */
    it("creates all 10 template scenarios and judges the next create on normal ones", async () => {
      const { app, applied } = await withAppliedTemplate();

      expect(applied).toHaveLength(10);
      await expect(app.create({ ...normal, name: "Third" }, BY)).resolves.toMatchObject({
        name: "Third",
      });
      await expect(app.create({ ...normal, name: "Fourth" }, BY)).rejects.toMatchObject(
        LIMIT_SHAPE,
      );
    });

    /** @scenario A scenario created inside a template's suite counts against the scenario cap */
    it("counts a member's create inside the template suite", async () => {
      const { app, scenario } = await withAppliedTemplate();

      await app.create(scenario("Custom attack"), BY);

      await expect(app.create(scenario("Another attack"), BY)).rejects.toMatchObject(LIMIT_SHAPE);
    });

    /** @scenario Duplicating a template suite's scenarios counts against the scenario cap */
    it("counts a copy of a template scenario", async () => {
      const { app, applied } = await withAppliedTemplate();
      const source = { scenarioId: applied[0]!.id, projectId: "project-1" };

      await app.duplicate(source, BY);

      await expect(app.duplicate(source, BY)).rejects.toMatchObject(LIMIT_SHAPE);
    });
  });

  describe("given an organization at 3/3 that applies, moves out, archives and applies again", () => {
    /** @scenario A template scenario moved out of its suite counts against the scenario cap */
    it("counts the moved scenarios and refuses the next template apply", async () => {
      const { app, repositories } = await organizationAtTheScenarioCap({ scenarios: 3 });
      const counted = () =>
        repositories.scenarios.countActiveByProjects({ projectIds: ["project-1", "project-2"] });
      const own = await app.createTestSuite({ projectId: "project-1", name: "Mine" });
      const suite = await app.createTestSuite({
        projectId: "project-1",
        name: "Support agent",
        templateId: "support-agent",
      });
      const applied = [];
      for (const name of ["Refund", "Escalation"]) {
        applied.push(
          await app.create(
            {
              projectId: "project-1",
              name,
              situation: "A user asks",
              criteria: [],
              labels: [],
              testSuiteId: suite.id,
            },
            BY,
            { sourceTemplateId: "support-agent" },
          ),
        );
      }
      expect(await counted()).toBe(3);

      await app.moveToTestSuite({
        scenarioId: applied[0]!.id,
        projectId: "project-1",
        testSuiteId: own.id,
      });
      expect(await counted()).toBe(4);
      await app.archiveTestSuite({ projectId: "project-1", testSuiteId: suite.id });
      expect(await counted()).toBe(4);

      await expect(
        app.createTestSuite({ projectId: "project-1", name: "Again", templateId: "support-agent" }),
      ).rejects.toMatchObject({
        code: "resource_limit_exceeded",
        meta: { limitType: "scenarios", current: 4, max: 3 },
      });
    });
  });

  describe("given an organization with 3 live test suites", () => {
    /** @scenario A fourth suite from a template is refused before anything is written */
    it("refuses a template suite with the simulations limit shape and writes nothing", async () => {
      const { app, repositories } = await organizationAtTheScenarioCap({ scenarios: 0 });
      for (const name of ["One", "Two", "Three"]) {
        await app.createTestSuite({ projectId: "project-1", name, templateId: "support-agent" });
      }

      await expect(
        app.createTestSuite({ projectId: "project-2", name: "OWASP", templateId: "owasp-llm" }),
      ).rejects.toMatchObject({
        code: "resource_limit_exceeded",
        meta: { limitType: "scenarioSets", current: 3, max: 3 },
      });
      expect(
        await repositories.scenarios.countActiveTestSuitesByProjects({
          projectIds: ["project-1", "project-2"],
        }),
      ).toBe(3);
    });

    it("lets a template suite through while the organization is under the cap", async () => {
      const { app } = await organizationAtTheScenarioCap({ scenarios: 0 });
      await app.createTestSuite({ projectId: "project-1", name: "One" });

      await expect(
        app.createTestSuite({ projectId: "project-1", name: "OWASP", templateId: "owasp-llm" }),
      ).resolves.toMatchObject({ templateId: "owasp-llm" });
    });

    /** @scenario The suite cap skips the Default suite and blank suites */
    it("lets a template suite through beside each project's Default suite and blank suites", async () => {
      const { app } = await organizationAtTheScenarioCap({ scenarios: 0 });
      for (const projectId of ["project-1", "project-2"]) {
        await app.createTestSuite({ projectId, name: "Default" });
        await app.createTestSuite({ projectId, name: `Blank ${projectId}` });
      }
      await app.createTestSuite({ projectId: "project-1", name: "One", templateId: "pii" });
      await app.createTestSuite({ projectId: "project-2", name: "Two", templateId: "pii" });

      await expect(
        app.createTestSuite({ projectId: "project-1", name: "Three", templateId: "owasp-llm" }),
      ).resolves.toMatchObject({ templateId: "owasp-llm" });
    });
  });

  describe("given a create request that names a source template", () => {
    /** @scenario A scenario create request cannot mark itself as template-made */
    it("refuses it on both the tRPC input and the REST body", () => {
      const request = {
        projectId: "project-1",
        name: "Sneaky",
        situation: "A refund",
        sourceTemplateId: "owasp-llm",
      };

      expect(scenarioCreateInputSchema.validate(request)).toBe(false);
      expect(scenarioRestCreateSchema.validate(request)).toBe(false);
    });
  });
});

describe("ScenarioModule on the cloud Free scenario run cap", () => {
  describe("given an organization past the month's run cap", () => {
    /** @scenario Running a scenario from the app past the run cap opens the upgrade prompt */
    it("refuses queueing a run with the upgrade shape", async () => {
      const { app } = await organizationAtTheScenarioCap({
        runCap: async () => {
          throw new LimitExceededError("scenarioRuns", 100, 100);
        },
      });

      await expect(
        app.queueSimulationRun({
          projectId: "project-1",
          scenarioId: "scenario-0",
          scenarioRunId: "scenariorun-1",
          batchRunId: "batch-1",
          setId: "set-1",
          name: "Scenario 0",
          target: { type: "http", referenceId: "agent-1" },
          parameters: {},
          secretParameters: {},
          note: undefined,
          scenarioVersion: undefined,
        }),
      ).rejects.toMatchObject({
        code: "resource_limit_exceeded",
        httpStatus: 403,
        meta: { limitType: "scenarioRuns", current: 100, max: 100 },
      });
    });
  });

  describe("given a run whose connected target cannot be resolved", () => {
    /** @scenario A run whose target cannot be resolved takes no run from the cap */
    it("fails with the missing agent before asking the run cap", async () => {
      const runCap = vi.fn<EntitlementApi["assertScenarioRunAllowed"]>(async () => {});
      const agents = createApiFixture<AgentApi>({
        getConnectedByNameAndEnvironment: async () => [],
        getById: async ({ id, projectId }) => {
          throw new AgentNotFoundError(id, projectId);
        },
      });
      const { app } = await organizationAtTheScenarioCap({ runCap, agents });

      await expect(
        app.queueSimulationRun({
          projectId: "project-1",
          scenarioId: "scenario-0",
          scenarioRunId: "scenariorun-2",
          batchRunId: "batch-1",
          setId: "set-1",
          name: "Scenario 0",
          target: { type: "connected", referenceId: "agent-missing" },
          parameters: {},
          secretParameters: {},
          note: undefined,
          scenarioVersion: undefined,
        }),
      ).rejects.toMatchObject({ code: "agent_not_found" });
      expect(runCap).not.toHaveBeenCalled();
    });
  });
});
