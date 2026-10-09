/**
 * The device grant's directory reads, asked of their owners, keep the answers and the not-found
 * codes the grant's refusals branch on (cli-device-flow.service.ts isPersonOrOrganizationGone).
 */
import { MemberNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { AuthDirectoryRepository } from "../../../../repositories/auth-directory.repository.ts";
import {
  CliDeviceDirectoryService,
  type CliDeviceProjects,
} from "../cli-device-directory.service.ts";

const PROJECT = {
  id: "project_1",
  slug: "acme-app",
  name: "Acme app",
  teamId: "team_1",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};

function directoryOver({
  organizations = {},
  projects = {},
}: {
  organizations?: Partial<OrganizationApi>;
  projects?: Partial<CliDeviceProjects>;
}) {
  return CliDeviceDirectoryService.create({
    people: createApiFixture<AuthDirectoryRepository>(),
    organizations: createApiFixture<OrganizationApi>(organizations),
    projects: createApiFixture<CliDeviceProjects>(projects),
  });
}

describe("CliDeviceDirectoryService", () => {
  describe("given no organization claims the domain", () => {
    it("refuses with organization_not_found", async () => {
      const directory = directoryOver({ organizations: { findBySsoDomain: async () => null } });

      await expect(directory.getOrganizationIdBySsoDomain("acme.com")).rejects.toMatchObject({
        code: "organization_not_found",
      });
    });
  });

  describe("given an unknown organization id", () => {
    it("refuses with organization_not_found, not the provisioning door's not_found", async () => {
      const directory = directoryOver({
        organizations: { findProvisioningSummary: async () => null },
      });

      await expect(directory.getOrganization("org_gone")).rejects.toMatchObject({
        code: "organization_not_found",
      });
    });
  });

  describe("when asked for a member's seat", () => {
    it("answers the role of an enabled seat", async () => {
      const directory = directoryOver({
        organizations: { getMember: async () => ({ role: "ADMIN", disabledAt: null }) as never },
      });

      await expect(
        directory.findActiveMemberRole({ userId: "u", organizationId: "o" }),
      ).resolves.toBe("ADMIN");
    });

    it("answers null for a disabled seat", async () => {
      const directory = directoryOver({
        organizations: { getMember: async () => ({ role: "ADMIN", disabledAt: 1 }) as never },
      });

      await expect(
        directory.findActiveMemberRole({ userId: "u", organizationId: "o" }),
      ).resolves.toBeNull();
    });

    it("answers null for a stranger", async () => {
      const directory = directoryOver({
        organizations: {
          getMember: async ({ userId }) => {
            throw new MemberNotFoundError(userId);
          },
        },
      });

      await expect(
        directory.findActiveMemberRole({ userId: "u", organizationId: "o" }),
      ).resolves.toBeNull();
    });
  });

  describe("when binding a project by id", () => {
    const withTeam = (organizationId: string) => ({ ...PROJECT, team: { organizationId } });

    it("answers only the bindable fields of the organization's live project", async () => {
      const directory = directoryOver({
        projects: { findWithTeam: async () => withTeam("org_1") },
      });

      await expect(
        directory.getLiveProject({ projectId: "project_1", organizationId: "org_1" }),
      ).resolves.toEqual({
        id: "project_1",
        slug: "acme-app",
        name: "Acme app",
        teamId: "team_1",
        isPersonal: false,
        ownerUserId: null,
        kind: "application",
      });
    });

    it("refuses with project_not_found for another organization's project", async () => {
      const directory = directoryOver({
        projects: { findWithTeam: async () => withTeam("org_other") },
      });

      await expect(
        directory.getLiveProject({ projectId: "project_1", organizationId: "org_1" }),
      ).rejects.toMatchObject({ code: "project_not_found" });
    });
  });

  describe("when binding a project by reference", () => {
    it("refuses with project_not_found when neither id nor slug matches", async () => {
      const directory = directoryOver({ projects: { findLiveByRef: async () => [] } });

      await expect(
        directory.getLiveProjectByRef({ projectRef: "nope", organizationId: "org_1" }),
      ).rejects.toMatchObject({ code: "project_not_found" });
    });
  });
});
