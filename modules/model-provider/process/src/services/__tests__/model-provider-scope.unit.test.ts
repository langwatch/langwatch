// Spec: specs/model-providers/hierarchical-default-models.feature
import { ModelProviderInvalidError } from "@langwatch/model-provider-contract";
import type { OrganizationApi, OrganizationTeam } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ModelProviderScopeService } from "../model-provider-scope.service.ts";

const teamOrganizations: Record<string, string> = { "team-a": "org-a", "team-b": "org-b" };

function team(teamId: string): OrganizationTeam {
  const at = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: teamId,
    name: teamId,
    slug: teamId,
    organizationId: teamOrganizations[teamId] ?? "org-x",
    isPersonal: false,
    ownerUserId: null,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

const service = ModelProviderScopeService.create({
  projects: createApiFixture<ProjectApi>({}, "ProjectApi"),
  organizations: createApiFixture<OrganizationApi>(
    { getTeamById: async ({ teamId }) => team(teamId) },
    "OrganizationApi",
  ),
});

describe("ModelProviderScopeService.getOrganizationIdForScopes", () => {
  describe("when the scopes belong to different organizations", () => {
    /** @scenario "Scopes spanning more than one organization are refused" */
    it("refuses with the handled invalid-provider error", async () => {
      await expect(
        service.getOrganizationIdForScopes([
          { scopeType: "TEAM", scopeId: "team-a" },
          { scopeType: "TEAM", scopeId: "team-b" },
        ]),
      ).rejects.toBeInstanceOf(ModelProviderInvalidError);
    });
  });

  describe("when every scope belongs to one organization", () => {
    it("returns that organization", async () => {
      await expect(
        service.getOrganizationIdForScopes([{ scopeType: "TEAM", scopeId: "team-a" }]),
      ).resolves.toBe("org-a");
    });
  });
});
