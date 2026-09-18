/**
 * @vitest-environment node
 * The installer over memory persistence, in both roles that boot it.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi as ScenarioApiContract } from "@langwatch/scenario-contract";
import { SuiteApi, SuiteNameTakenError } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it } from "vitest";

import { suiteServer } from "../../suite.server.ts";

/**
 * The one member `SuiteApp` declares reading (`reads("clickhouse")`).
 * Installing on the memory tier never reaches a store, so boot needs the
 * member to EXIST — a stub that refuses on use proves it, naming the failure.
 */
function analyticalWithoutStore(): ClickHouseQueryClient {
  const client: Partial<ClickHouseQueryClient> = {};
  return new Proxy(client, {
    get(_target, property) {
      throw new Error(`The memory tier must not reach ClickHouse (read "${String(property)}").`);
    },
  }) as ClickHouseQueryClient;
}

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([withMemoryRepositories(suiteServer)])
    .withAnalytical(analyticalWithoutStore())
    .withMembers({ publicBaseUrl: undefined })
    .provide({
      scenario: createApiFixture<ScenarioApiContract>({ findTestSuite: async () => null }),
      agent: createApiFixture<AgentApi>({}),
      prompt: createApiFixture<PromptApi>({}),
      project: createApiFixture<ProjectApi>({ findOrganizationId: async () => "organization-1" }),
    });
}

const plan = { projectId: "project-1", name: "Nightly", scenarioIds: ["scenario-1"] };

describe("suite app installation", () => {
  it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
    const runtime = await process(role).boot();

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
    const first = await process("api").boot();
    const second = await process("api").boot();

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
