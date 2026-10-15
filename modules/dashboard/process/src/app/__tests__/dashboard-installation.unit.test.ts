import { AnalyticsApi } from "@langwatch/analytics-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { AutomationApi } from "@langwatch/automation-contract";
import { DashboardApi, DashboardNotFoundError } from "@langwatch/dashboard-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { dashboardProcessModule } from "../../dashboard.module.ts";
import {
  createDashboardTestAnalytics,
  createDashboardTestAuthz,
  createDashboardTestAutomation,
  createDashboardTestProjects,
} from "./dashboard.fixture.ts";

function process(role: "api" | "worker") {
  return bootInstalledProcess({
    role,
    modules: [dashboardProcessModule],
    config: { dashboard: { publicBaseUrl: undefined } },
    stores: memoryStores(),
    peers: [
      testPeer({ token: AnalyticsApi, instance: createDashboardTestAnalytics() }),
      testPeer({ token: AuthzApi, instance: createDashboardTestAuthz() }),
      testPeer({ token: AutomationApi, instance: createDashboardTestAutomation() }),
      testPeer({ token: ProjectApi, instance: createDashboardTestProjects() }),
    ],
  });
}

describe("dashboard app installation", () => {
  describe("given a process that boots the feature over memory", () => {
    it.each(["api", "worker"] as const)("installs a working app in the %s role", async (role) => {
      const runtime = await process(role);

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
