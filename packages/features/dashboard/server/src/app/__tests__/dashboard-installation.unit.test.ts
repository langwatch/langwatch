import { AnalyticsApi } from "@langwatch/analytics-contract";
import { AutomationApi } from "@langwatch/automation-contract";
import { DashboardApi, DashboardNotFoundError } from "@langwatch/dashboard-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp } from "@langwatch/runtime-composition";
import { describe, expect, it } from "vitest";

import { dashboardServer } from "../../dashboard.server.ts";
import {
  createDashboardTestAnalytics,
  createDashboardTestAutomation,
  createDashboardTestInfrastructure,
  createDashboardTestProjects,
} from "./dashboard.fixture.ts";

function process() {
  return createApp({ name: "dashboard-installation-test" })
    .withPersistence("memory", {})
    .withInfrastructure(createDashboardTestInfrastructure())
    .withProvided(AnalyticsApi, createDashboardTestAnalytics())
    .withProvided(AutomationApi, createDashboardTestAutomation())
    .withProvided(ProjectApi, createDashboardTestProjects())
    .withFeature(dashboardServer);
}

describe("dashboard app installation", () => {
  describe("given a process that boots the feature over memory", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
      const runtime = await process().boot({ role });

      try {
        const app = runtime.service(DashboardApi);

        expect(runtime.feature(dashboardServer).provided).toBe(app);

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
