import type { AgentApi } from "@langwatch/agent-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { ResourceOwnership } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

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
  maxEvaluators: 3,
};

const BY = { id: "user-1", label: "user" } as const;

/** An organization on cloud Free whose two projects already hold 3 active scenarios. */
async function organizationAtTheScenarioCap({ scenarios = 3 }: { scenarios?: number } = {}) {
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
      agents: createApiFixture<AgentApi>(),
      evaluations: createApiFixture<EvaluationApi>(),
      users: createApiFixture<UserApi>(),
      projects: createApiFixture<ProjectApi>({
        getOrganizationId: async () => "organization-1",
        listIdsByOrganization: async () => ["project-1", "project-2"],
      }),
      plans: createApiFixture<EntitlementApi>({ getActivePlan: async () => CLOUD_FREE }),
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
      const suite = await app.createTestSuite({ projectId: "project-1", name: "OWASP LLM" });
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
});
