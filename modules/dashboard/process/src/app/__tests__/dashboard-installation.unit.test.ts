import { AnalyticsApi } from "@langwatch/analytics-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { AutomationApi } from "@langwatch/automation-contract";
import { DashboardApi, DashboardNotFoundError } from "@langwatch/dashboard-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { isMigrationStep } from "@langwatch/upgrade/step";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { dashboardProcessModule } from "../../dashboard.module.ts";
import {
  createDashboardTestAnalytics,
  createDashboardTestAuthz,
  createDashboardTestAutomation,
  createDashboardTestProjects,
  createDashboardTestUsers,
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
      testPeer({ token: UserApi, instance: createDashboardTestUsers() }),
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

    /** @scenario "My dashboards made before the mark are marked by a background step" */
    it("declares dashboard:mark-my-dashboards as its migration step", async () => {
      const runtime = await process("worker");

      try {
        expect(runtime.migrationSteps(isMigrationStep).map((step) => step.id)).toEqual([
          "dashboard:mark-my-dashboards",
        ]);
      } finally {
        await runtime.stop();
      }
    });
  });
});
