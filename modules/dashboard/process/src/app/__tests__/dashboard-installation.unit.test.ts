import { DashboardApi, DashboardNotFoundError } from "@langwatch/dashboard-contract";
import { createApp, withMemoryRepositories } from "@langwatch/process";
import { describe, expect, it } from "vitest";

import { dashboardProcessModule } from "../../dashboard.module.ts";
import {
  createDashboardTestAnalytics,
  createDashboardTestAuthz,
  createDashboardTestAutomation,
  createDashboardTestFeatureFlags,
  createDashboardTestOrganizations,
  createDashboardTestProjects,
} from "./dashboard.fixture.ts";

function process(role: "api" | "worker") {
  return createApp({ role })
    .withModules([withMemoryRepositories(dashboardProcessModule)])
    .withMember("publicBaseUrl", undefined)
    .provide({
      analytics: createDashboardTestAnalytics(),
      automation: createDashboardTestAutomation(),
      project: createDashboardTestProjects(),
      "feature-flag": createDashboardTestFeatureFlags(),
      authz: createDashboardTestAuthz(),
      organization: createDashboardTestOrganizations(),
    });
}

describe("dashboard app installation", () => {
  describe("given a process that boots the feature over memory", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
      const runtime = await process(role).boot();

      try {
        const app = runtime.service(DashboardApi);

        expect(runtime.module(dashboardProcessModule).provided).toBe(app);

        const created = await app.create({ projectId: "project-1", name: "Reports" });

        await expect(
          app.getById({ projectId: "project-1", dashboardId: created.id }),
        ).resolves.toMatchObject({ name: "Reports", graphs: [] });

        await expect(
          app.getById({ projectId: "other-project", dashboardId: created.id }),
        ).rejects.toBeInstanceOf(DashboardNotFoundError);
      } finally {
        await runtime.stop();
      }
    });
  });
});
