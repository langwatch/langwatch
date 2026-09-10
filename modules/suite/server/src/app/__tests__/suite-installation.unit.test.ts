/**
 * @vitest-environment node
 * The installer over memory persistence, in both roles that boot it.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { createApp } from "@langwatch/runtime-composition";
import { ScenarioApi, type ScenarioApi as ScenarioApiContract } from "@langwatch/scenario-contract";
import { AgentApi as AgentApiToken } from "@langwatch/agent-contract";
import { ProjectApi as ProjectApiToken } from "@langwatch/project-contract";
import { PromptApi as PromptApiToken } from "@langwatch/prompt-contract";
import { SuiteApi, SuiteNameTakenError } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { suiteServer } from "../../suite.server.ts";
import { RecordingSuiteExecution } from "./suite.fixture.ts";

function process() {
  return createApp({ name: "suite-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure({})
    .withProvided(
      ScenarioApi,
      createApiFixture<ScenarioApiContract>({ findTestSuite: async () => null }),
    )
    .withProvided(AgentApiToken, createApiFixture<AgentApi>({}))
    .withProvided(PromptApiToken, createApiFixture<PromptApi>({}))
    .withProvided(
      ProjectApiToken,
      createApiFixture<ProjectApi>({ tryGetOrganizationId: async () => "organization-1" }),
    )
    .withModule(suiteServer, {
      infrastructure: {
        execution: new RecordingSuiteExecution(),
        resolveClickHouseClient: null,
        defaultRetentionDays: 30,
      },
    });
}

const plan = { projectId: "project-1", name: "Nightly", scenarioIds: ["scenario-1"] };

describe("suite app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process().boot({ role });

    try {
      const app = runtime.service(SuiteApi);
      const created = await app.create(plan);

      expect(runtime.module(suiteServer).provided).toBe(app);
      expect(created.slug).toBe("nightly");

      await expect(app.list({ projectId: plan.projectId })).resolves.toMatchObject([
        { id: created.id },
      ]);
      await expect(app.create(plan)).rejects.toBeInstanceOf(SuiteNameTakenError);
    } finally {
      await runtime.stop();
    }
  });

  it("allocates independent memory repositories for each installation", async () => {
    const first = await process().boot({ role: "api" });
    const second = await process().boot({ role: "api" });

    try {
      await first.service(SuiteApi).create(plan);

      await expect(
        second.service(SuiteApi).list({ projectId: plan.projectId }),
      ).resolves.toHaveLength(0);
    } finally {
      await Promise.all([first.stop(), second.stop()]);
    }
  });
});
