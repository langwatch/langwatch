import { describe, expect, it, vi } from "vitest";
import { MemoryFeatureFlagService } from "@langwatch/feature-flag-server/testing";
import { ProjectService } from "@langwatch/project-contract";
import { AppDashboardGraphVisibilityPolicy } from "../dashboard-graph-visibility-policy.adapter";

function projectsWithOrganization(organizationId: string): ProjectService {
  const projects: ProjectService = Object.create(ProjectService.prototype);
  projects.getOrganizationId = vi.fn().mockResolvedValue(organizationId);
  return projects;
}

describe("AppDashboardGraphVisibilityPolicy", () => {
  it("uses the project-scoped LangWatchQL gate to expose placeable kinds", async () => {
    const featureFlags = MemoryFeatureFlagService.create();
    featureFlags.setFlag("release_lwql_workbench", true);
    const projects = projectsWithOrganization("organization_1");
    const policy = AppDashboardGraphVisibilityPolicy.create({ featureFlags, projects });

    await expect(policy.placeableKinds({ projectId: "project_1" })).resolves.toEqual([
      "builder",
      "workbench_sql",
    ]);
    expect(projects.getOrganizationId).toHaveBeenCalledWith("project_1");

    featureFlags.setFlag("release_lwql_workbench", false);
    await expect(policy.placeableKinds({ projectId: "project_1" })).resolves.toEqual(["builder"]);
  });
});
