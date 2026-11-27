/**
 * @vitest-environment node
 * The project-keyed `/api/health/*` probes are public routes that resolve their own key, so they
 * run before the staff access gate. A staff access key is answered as no key on every probe.
 * @see modules/staff-access/specs/staff-access-use.feature
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AutomationApi } from "@langwatch/automation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { LangyApi } from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import type { SuiteApi } from "@langwatch/suite-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { MemorySubsystemProbeChannel } from "../../channels/memory/memory.subsystem-probe.channel.ts";
import { PlatformHealthModule } from "../platform-health.app.ts";

const STAFF_KEY = "staff-access-key";

const PROJECT = {
  id: "project-1",
  name: "Project",
  slug: "project",
  teamId: "team-1",
  organizationId: "org-1",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

async function staffKeyProbes() {
  const { logger } = createTestLogger();
  const canaries = MemorySubsystemProbeChannel.create({
    answer: () => new Response(JSON.stringify({ passed: true }), { status: 200 }),
  });
  const app = await PlatformHealthModule.create({
    dependencies: {
      automation: createApiFixture<AutomationApi>(),
      workflow: createApiFixture<WorkflowApi>(),
      projects: createApiFixture<ProjectApi>(),
      apiKeys: createApiFixture<ApiKeyApi>({
        findResolvedToken: async ({ token }) =>
          token === STAFF_KEY
            ? {
                type: "apiKey",
                apiKeyId: "staff-key-1",
                userId: null,
                organizationId: "org-1",
                ingestSourceType: null,
                ingestionTemplateId: null,
                isStaffAccessKey: true,
                project: PROJECT,
              }
            : null,
      }),
      scenarios: createApiFixture<ScenarioApi>(),
      suites: createApiFixture<SuiteApi>(),
      langy: createApiFixture<LangyApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
    },
    config: { publicBaseUrl: undefined },
    resources: { own: () => void 0, ownService: () => void 0 },
    channels: { canaries },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    legacyKeyLogger: logger,
  });
  const headers = { "x-auth-token": STAFF_KEY, "x-project-id": PROJECT.id };

  return {
    canaries,
    probe: (check: "evaluations" | "triggers" | "workflows") =>
      app.probeWithProjectKey({ check, headers, signal: void 0 }),
    scenarios: () => app.probeWithProjectKey({ check: "scenarios", headers, runPlanId: "plan-1" }),
  };
}

describe("a staff access key on the project-keyed health probes", () => {
  /** @scenario "A staff key never reaches the public health probes" */
  it("answers 401 as for no key on every probe, starting no run and sending no canary", async () => {
    const { probe, scenarios, canaries } = await staffKeyProbes();

    for (const response of [
      await scenarios(),
      await probe("evaluations"),
      await probe("triggers"),
      await probe("workflows"),
    ]) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ message: "Invalid auth token." });
    }
    expect(canaries.requests()).toEqual([]);
  });
});
