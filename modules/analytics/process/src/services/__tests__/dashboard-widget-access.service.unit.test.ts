import { CustomChartPlaygroundNotEnabledError } from "@langwatch/analytics-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { DashboardWidgetAccessService } from "../dashboard-widget-access.service.ts";

const PROJECT = { projectId: "project-1" };

function accessWith(...on: string[]): DashboardWidgetAccessService {
  return DashboardWidgetAccessService.create({
    featureFlags: createApiFixture<FeatureFlagApi>({
      isEnabled: async (flag: string) => on.includes(flag),
    }),
    projects: createApiFixture<ProjectApi>({
      getOrganizationId: async () => "org-1",
      findOrganizationId: async () => "org-1",
    }),
  });
}

describe("DashboardWidgetAccessService", () => {
  describe("given Dashboards and LangWatchQL are on", () => {
    /** @scenario "Dashboard widgets open with the Dashboards and LangWatchQL flags alone" */
    it("admits the project", async () => {
      await expect(
        accessWith("release_dashboards", "release_lwql_workbench").assertEnabled(PROJECT),
      ).resolves.toBeUndefined();
    });
  });

  describe("given only one of Dashboards and LangWatchQL is on", () => {
    /** @scenario "Dashboard widgets stay closed while the Dashboards or the LangWatchQL flag is off" */
    it.each([["release_dashboards"], ["release_lwql_workbench"], []])(
      "refuses the project with %s on",
      async (...on: string[]) => {
        const code = new CustomChartPlaygroundNotEnabledError().code;

        await expect(accessWith(...on).assertEnabled(PROJECT)).rejects.toMatchObject({ code });
      },
    );
  });
});
