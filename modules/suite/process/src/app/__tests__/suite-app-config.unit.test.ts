import type { AgentApi } from "@langwatch/agent-contract";
/**
 * SuiteApp reads `publicBaseUrl` off the process's own member.
 * @vitest-environment node
 */
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { ResourceScope } from "@langwatch/kernel";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { describe, expect, it } from "vitest";

import { SuiteApp } from "../suite.app.ts";
import { createSuiteTestRepositories } from "./suite.fixture.ts";

/** Never reached: this test names no run and reads no run history. */
function unreachableClickHouse(): ClickHouseQueryClient {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`This test did not expect to reach ClickHouse.${String(property)}`);
      },
    },
  ) as unknown as ClickHouseQueryClient;
}

function buildProductionApp(publicBaseUrl: string | undefined) {
  return SuiteApp.create({
    repositories: createSuiteTestRepositories(),
    dependencies: {
      scenarios: createApiFixture<ScenarioApi>({}),
      agents: createApiFixture<AgentApi>({}),
      prompts: createApiFixture<PromptApi>({}),
      projects: createApiFixture<ProjectApi>({
        findOrganizationId: async () => "organization-1",
      }),
    },
    members: { clickhouse: unreachableClickHouse(), publicBaseUrl },
    config: undefined,
    resources: new ResourceScope(),
  });
}

describe("SuiteApp built the way production composes it", () => {
  describe("given a deployment that configured a public base URL", () => {
    /** @scenario "The list surface renders a deep link when a public base URL is configured" */
    it("answers a platform link instead of refusing by name", () => {
      const app = buildProductionApp("https://app.langwatch.test");

      expect(app.platformUrl({ projectSlug: "acme", path: "/suites/suite_1" })).toBe(
        "https://app.langwatch.test/acme/suites/suite_1",
      );
    });
  });

  describe("given a deployment that named no public base URL", () => {
    /** @scenario "The list surface refuses a deep link by name when no public base URL is configured" */
    it("still refuses by name, as it did before this deployment had a config seam", () => {
      const app = buildProductionApp(undefined);

      expect(() => app.platformUrl({ projectSlug: "acme", path: "/suites/suite_1" })).toThrow(
        /named no public base URL/,
      );
    });
  });
});
