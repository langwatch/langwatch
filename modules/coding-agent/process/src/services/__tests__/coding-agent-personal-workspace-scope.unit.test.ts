import type { OrganizationApi } from "@langwatch/organization-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi, UserFullProfile } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { CodingAgentCallerScopeService } from "../coding-agent-caller-scope.service.ts";
import type { CodingAgentScopeProject } from "../coding-agent-scope-directory.service.ts";
import { CodingAgentScopeDirectoryService } from "../coding-agent-scope-directory.service.ts";
import type { CodingAgentScopePermissions } from "../coding-agent-scope-permissions.service.ts";

const caller = { kind: "user", userId: "user-1" } as const;

const PERSONAL_WORKSPACE: Project = {
  id: "project-personal",
  name: "Personal workspace",
  slug: "personal",
  apiKey: "legacy-personal",
  lwqlKey: "lwql-personal",
  teamId: "team-personal",
  language: "en",
  framework: "other",
  kind: "application",
  firstMessage: false,
  integrated: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  userLinkTemplate: null,
  traceSharingEnabled: false,
  presenceEnabled: false,
  s3Endpoint: null,
  s3AccessKeyId: null,
  s3SecretAccessKey: null,
  s3Bucket: null,
  archivedAt: null,
  isPersonal: true,
  ownerUserId: null,
  personalFeatures: {},
  departmentId: null,
  langyEgressAllowlist: null,
  lastCodingAgentSessionAt: null,
  lastCodingAgentPullRequestAt: null,
};

class AllowAllPermissions implements CodingAgentScopePermissions {
  projectCuts(input: { projects: readonly CodingAgentScopeProject[] }) {
    const ids = new Set(input.projects.map((project) => project.id));
    return Promise.resolve(new Map([["traces:view", ids] as const, ["cost:view", ids] as const]));
  }
}

function profile(input: { id: string; name: string | null; email: string }): UserFullProfile {
  return {
    ...input,
    emailVerified: true,
    image: null,
    pendingSsoSetup: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    lastLoginAt: null,
    deactivatedAt: null,
    lastHomePath: null,
    tracesExplorerTourDismissedAt: null,
  };
}

/** The caller's scope resolved through the real directory over its three peers. */
function resolveScope(input: { ownerUserId: string; profiles: readonly UserFullProfile[] }) {
  const directory = CodingAgentScopeDirectoryService.create({
    projects: createApiFixture<ProjectApi>({
      listByOrganization: async ({ page, limit }) => ({
        data: [PERSONAL_WORKSPACE],
        pagination: { page, limit, total: 1 },
      }),
    }),
    organizations: createApiFixture<OrganizationApi>({
      findPersonalTeamOwners: async () => [
        { teamId: PERSONAL_WORKSPACE.teamId, ownerUserId: input.ownerUserId },
      ],
    }),
    users: createApiFixture<UserApi>({
      getProfiles: async ({ userIds }) =>
        input.profiles.filter((user) => userIds.includes(user.id)),
    }),
  });
  return CodingAgentCallerScopeService.create({
    directory,
    permissions: new AllowAllPermissions(),
  }).resolve({ caller, organizationId: "org-1" });
}

describe("given a personal workspace in the organization", () => {
  describe("when its only member has no display name", () => {
    /** @scenario "A person with no display name is named by their email address" */
    it("names the workspace by that member's email address", async () => {
      const scope = await resolveScope({
        ownerUserId: "user-grace",
        profiles: [profile({ id: "user-grace", name: null, email: "grace@example.com" })],
      });

      expect(scope.projects["project-personal"]).toMatchObject({
        contributorLabel: "grace@example.com",
        isLinkable: false,
      });
    });
  });

  describe("when its membership row points at a user that no longer exists", () => {
    /** @scenario "A membership row that outlives its user still resolves the scope" */
    it("resolves the scope and names the workspace by itself", async () => {
      const scope = await resolveScope({ ownerUserId: "user-gone", profiles: [] });

      expect(scope.permittedProjectIds).toEqual(["project-personal"]);
      expect(scope.projects["project-personal"]).toMatchObject({
        contributorLabel: "Personal workspace",
        isLinkable: false,
      });
    });
  });
});
