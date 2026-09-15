/**
 * What a rule write answers when it cannot be carried out. Every refusal here
 * is handled: the process maps the status to its door's code and the browser
 * reads its copy from the code, so none of them reaches a customer as unknown.
 */
import { AuthzApi, type AuthzCanBatchByIdsInput } from "@langwatch/authz-contract";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { createApp, withMemoryRepositories } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";
import { dataPrivacyServer } from "../../data-privacy.server.ts";
import {
  createDataPrivacyTestProjects,
  dataPrivacyTestGraph,
  dataPrivacyTestInfrastructure,
  MemoryDataPrivacyDirectory,
} from "./data-privacy.fixture.ts";

const { projectId, teamId, organizationId } = dataPrivacyTestGraph;
const USER_ID = "user-1";

/** A caller who may write at every tier, so only the target is under test. */
const permittedAuthz = createApiFixture<AuthzApi>({
  hasPermission: async () => true,
  canBatchByIds: async (input: AuthzCanBatchByIdsInput) => ({
    teams: new Map(input.teams.map((team) => [team.teamId, true])),
    projects: new Map(input.projects.map((project) => [project.projectId, true])),
    organizationRole: null,
  }),
});

async function bootWith(scopeOrganizationId: string | null): Promise<DataPrivacyApi> {
  const directory = MemoryDataPrivacyDirectory.create({
    lineage: {
      projectId,
      name: "Acme production",
      teamId,
      organizationId,
      organizationName: "Acme",
    },
    scopeOrganizationId,
  });

  const runtime = await createApp({ role: "api", config: {} })
    .withProvided(ProjectApi, createDataPrivacyTestProjects())
    .withProvided(OrganizationApi, createApiFixture<OrganizationApi>())
    .withProvided(AuthzApi, permittedAuthz)
    .withProvided(FeatureFlagApi, createApiFixture<FeatureFlagApi>())
    .withModules([withMemoryRepositories(dataPrivacyServer)])
    .boot();

  return runtime.module(dataPrivacyServer).provided;
}

describe("given a rule write through the data-privacy app", () => {
  describe("when the scope it targets no longer exists", () => {
    /** @scenario "A rule aimed at a scope that no longer exists is refused by name" */
    it("refuses with the scope-target code rather than an unknown failure", async () => {
      const app = await bootWith(null);

      await expect(
        app.setScopeRule({
          projectId,
          scope: { scopeType: "TEAM", scopeId: "gone" },
          personalOnly: false,
          config: { categories: { input: { disposition: "drop" } } },
          userId: USER_ID,
        }),
      ).rejects.toMatchObject({
        code: "data_privacy_scope_target_not_found",
        httpStatus: 404,
        isHandled: true,
      });
    });
  });

  describe("when the scope it targets sits in another organization", () => {
    /** @scenario "A rule aimed outside the project's organization is refused by name" */
    it("refuses with the outside-organization code", async () => {
      const app = await bootWith("organization-2");

      await expect(
        app.setScopeRule({
          projectId,
          scope: { scopeType: "TEAM", scopeId: "team-elsewhere" },
          personalOnly: false,
          config: { categories: { input: { disposition: "drop" } } },
          userId: USER_ID,
        }),
      ).rejects.toMatchObject({
        code: "data_privacy_scope_outside_organization",
        httpStatus: 400,
        isHandled: true,
      });
    });
  });

  describe("when the configuration carries a pattern the feature refuses", () => {
    /** @scenario "A rule whose pattern is refused says which pattern and why" */
    it("refuses with the invalid-config code and names the pattern in its meta", async () => {
      const app = await bootWith(organizationId);

      await expect(
        app.setScopeRule({
          projectId,
          scope: { scopeType: "PROJECT", scopeId: projectId },
          personalOnly: false,
          config: { secrets: { enabled: true, customPatterns: [".*"] } },
          userId: USER_ID,
        }),
      ).rejects.toMatchObject({
        code: "data_privacy_config_invalid",
        httpStatus: 400,
        isHandled: true,
        meta: { reason: expect.stringContaining("also matches ordinary text") },
      });
    });
  });
});
