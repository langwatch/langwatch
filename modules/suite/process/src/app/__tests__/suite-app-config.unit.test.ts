import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
/**
 * SuiteApp reads `publicBaseUrl` off the process's own member.
 * @vitest-environment node
 */
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import { ResourceScope } from "@langwatch/kernel";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { SuiteApp } from "../suite.app.ts";
import { createSuiteTestRepositories } from "./suite.fixture.ts";

function buildProductionApp(
  publicBaseUrl: string | undefined,
  retention = createApiFixture<DataRetentionApi>({ getPlatformDefaultRetentionDays: () => 49 }),
) {
  return SuiteApp.create({
    repositories: createSuiteTestRepositories(),
    dependencies: {
      scenarios: createApiFixture<ScenarioApi>({}),
      agents: createApiFixture<AgentApi>({}),
      prompts: createApiFixture<PromptApi>({}),
      projects: createApiFixture<ProjectApi>({
        findOrganizationId: async () => "organization-1",
      }),
      retention,
    },
    members: { clickhouse: clickHouseQueryClientDouble(), publicBaseUrl, redis: null },
    config: undefined,
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
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

describe("SuiteApp's platform retention default", () => {
  /** @scenario "A suite reads the platform retention default from data retention" */
  it("leaves the data retention capability unasked while the process is constructing", () => {
    let asks = 0;
    const retention = createApiFixture<DataRetentionApi>({
      getPlatformDefaultRetentionDays: () => {
        asks += 1;
        return 49;
      },
    });

    buildProductionApp(undefined, retention);

    expect(asks).toBe(0);
  });
});
