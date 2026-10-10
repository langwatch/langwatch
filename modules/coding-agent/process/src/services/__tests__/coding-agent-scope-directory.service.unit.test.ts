import type { OrganizationApi } from "@langwatch/organization-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi, UserFullProfile } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { CodingAgentScopeDirectoryService } from "../coding-agent-scope-directory.service.ts";

function project(id: string): Project {
  return {
    id,
    name: `Project ${id}`,
    slug: id,
    apiKey: `legacy-${id}`,
    lwqlKey: `lwql-${id}`,
    teamId: `team-${id}`,
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
    isPersonal: false,
    ownerUserId: null,
    personalFeatures: {},
    departmentId: null,
    langyEgressAllowlist: null,
    lastCodingAgentSessionAt: null,
    lastCodingAgentPullRequestAt: null,
  };
}

function profile(id: string, name: string | null, email: string | null): UserFullProfile {
  return {
    id,
    name,
    email,
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

function directory({
  projects = [],
  owners = [],
  profiles = [],
}: {
  projects?: Project[];
  owners?: { teamId: string; ownerUserId: string | null }[];
  profiles?: UserFullProfile[];
}) {
  const pages: number[] = [];
  const service = CodingAgentScopeDirectoryService.create({
    projects: createApiFixture<ProjectApi>({
      listByOrganization: async ({ page, limit }) => {
        pages.push(page);
        return {
          data: projects.slice((page - 1) * limit, page * limit),
          pagination: { page, limit, total: projects.length },
        };
      },
    }),
    organizations: createApiFixture<OrganizationApi>({
      findPersonalTeamOwners: async ({ teamIds }) =>
        owners.filter((owner) => teamIds.includes(owner.teamId)),
    }),
    users: createApiFixture<UserApi>({
      getProfiles: async ({ userIds }) => profiles.filter((user) => userIds.includes(user.id)),
    }),
  });
  return { service, pages };
}

describe("given the organization's project directory read over its peers", () => {
  describe("when the organization holds more projects than one page", () => {
    /** @scenario The organization's projects are read across every page */
    it("reads every page until the total is reached", async () => {
      const projects = Array.from({ length: 1_001 }, (_, index) => project(`p${index}`));
      const { service, pages } = directory({ projects });

      const listed = await service.listOrganizationProjects({ organizationId: "org-1" });

      expect(listed).toHaveLength(1_001);
      expect(listed[1_000]).toEqual({
        id: "p1000",
        name: "Project p1000",
        slug: "p1000",
        teamId: "team-p1000",
        isPersonal: false,
      });
      expect(pages).toEqual([1, 2]);
    });
  });

  describe("when personal workspaces are named", () => {
    /** @scenario A personal workspace in the rollup is named by its owner */
    it("names each by its owner's name, else their email, and names nothing without an owner", async () => {
      const { service } = directory({
        owners: [
          { teamId: "team-ada", ownerUserId: "user-ada" },
          { teamId: "team-grace", ownerUserId: "user-grace" },
          { teamId: "team-orphan", ownerUserId: null },
          { teamId: "team-gone", ownerUserId: "user-gone" },
        ],
        profiles: [
          profile("user-ada", " Ada Lovelace ", "ada@example.com"),
          profile("user-grace", "  ", "grace@example.com"),
        ],
      });

      const names = await service.listPersonalTeamOwnerNames({
        organizationId: "org-1",
        teamIds: ["team-ada", "team-grace", "team-orphan", "team-gone"],
      });

      expect([...names]).toEqual([
        ["team-ada", "Ada Lovelace"],
        ["team-grace", "grace@example.com"],
      ]);
    });
  });
});
