/**
 * @vitest-environment node
 * The project-keyed `/api/health/*` probes with a legacy project key, through the module's own
 * key resolution: every probe runs and logs outside the collector, only the collector runs once
 * the project is on `legacy_project_key_scope_enforced`, and full access runs all silently.
 * @see modules/auth/specs/legacy-project-key-scope.feature
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

const LEGACY_KEY = "legacy-project-key";
const FULL_ACCESS = "legacy_project_key_full_access";
const ENFORCED = "legacy_project_key_scope_enforced";

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

async function probes({ enabled }: { enabled: readonly string[] }) {
  const { logger, lines } = createTestLogger();
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
          token === LEGACY_KEY ? { type: "legacyProjectKey", project: PROJECT } : null,
      }),
      scenarios: createApiFixture<ScenarioApi>(),
      suites: createApiFixture<SuiteApi>(),
      langy: createApiFixture<LangyApi>(),
      featureFlags: createApiFixture<FeatureFlagApi>({
        isEnabled: async (flag) => enabled.includes(flag),
      }),
    },
    config: { publicBaseUrl: undefined },
    resources: { own: () => void 0, ownService: () => void 0 },
    channels: { canaries },
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    legacyKeyLogger: logger,
  });

  return {
    canaries,
    lines,
    probe: (check: "collector" | "evaluations" | "processor") =>
      app.probeWithProjectKey({ check, headers: { "x-auth-token": LEGACY_KEY }, signal: void 0 }),
    scenarios: () =>
      app.probeWithProjectKey({
        check: "scenarios",
        headers: { "x-auth-token": LEGACY_KEY },
        runPlanId: "plan-1",
      }),
  };
}

describe("a legacy project key on the project-keyed health probes", () => {
  describe("when its project is on no flag", () => {
    /** @scenario "The health probes run for an unenforced project's legacy key and log it" */
    it("runs a probe other than the collector and logs it outside its scopes", async () => {
      const { probe, canaries, lines } = await probes({ enabled: [] });

      const response = await probe("evaluations");

      expect(response.status).toBe(200);
      expect(canaries.requests()).toHaveLength(1);
      expect(lines.findLine("warn", "legacy project key outside its scopes")).toMatchObject({
        projectId: "project-1",
        route: "GET /api/health/evaluations",
        enforced: false,
      });
      expect(JSON.stringify(lines)).not.toContain(LEGACY_KEY);
    });
  });

  describe("when its project is enforced and not on the full-access flag", () => {
    /** @scenario "A legacy project key on an enforced project may run only the collector health probe" */
    it("runs the collector probe", async () => {
      const { probe, canaries } = await probes({ enabled: [ENFORCED] });

      const response = await probe("collector");

      expect(response.status).toBe(200);
      expect(canaries.requests().length).toBeGreaterThan(0);
    });

    /** @scenario "A legacy project key on an enforced project may run only the collector health probe" */
    it("refuses every other probe with the ingestion-only code, sending no canary", async () => {
      const { probe, scenarios, canaries } = await probes({ enabled: [ENFORCED] });

      for (const response of [
        await probe("evaluations"),
        await probe("processor"),
        await scenarios(),
      ]) {
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: "legacy_project_key_ingestion_only" });
      }
      expect(canaries.requests()).toEqual([]);
    });
  });

  describe("when its project is on the full-access flag", () => {
    /** @scenario "The health probes run for a legacy project key on the full-access flag" */
    it("runs a probe other than the collector", async () => {
      const { probe, canaries } = await probes({ enabled: [FULL_ACCESS, ENFORCED] });

      const response = await probe("evaluations");

      expect(response.status).toBe(200);
      expect(canaries.requests()).toHaveLength(1);
    });
  });
});
