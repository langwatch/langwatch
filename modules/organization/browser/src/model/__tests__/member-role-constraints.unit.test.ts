import { describe, expect, it } from "vitest";

import {
  getOrganizationRoleLabel,
  holdsOrganizationBinding,
  holdsSharedAccess,
  isGrantRoleAllowedForOrganizationRole,
  isTeamRoleAllowedForOrganizationRole,
  ORGANIZATION_TO_TEAM_ROLE_MAP,
  type TeamRoleValue,
} from "../member-role-constraints.ts";
import { OrganizationUserRole, TeamUserRole } from "../prisma-types.ts";

describe("member role constraints", () => {
  describe("given the org-to-team role map", () => {
    describe("when the seat is Developer", () => {
      /** Invariant (ADR-171): an ORGANIZATION-scoped ADMIN binding opens every project. */
      it("never maps to Admin", () => {
        expect(ORGANIZATION_TO_TEAM_ROLE_MAP[OrganizationUserRole.DEVELOPER]).not.toBe(
          TeamUserRole.ADMIN,
        );
      });
    });
  });

  describe("given holdsOrganizationBinding()", () => {
    it("is true for the Full seats", () => {
      expect(holdsOrganizationBinding(OrganizationUserRole.ADMIN)).toBe(true);
      expect(holdsOrganizationBinding(OrganizationUserRole.MEMBER)).toBe(true);
    });

    it("is false for Lite and Developer", () => {
      expect(holdsOrganizationBinding(OrganizationUserRole.EXTERNAL)).toBe(false);
      expect(holdsOrganizationBinding(OrganizationUserRole.DEVELOPER)).toBe(false);
    });
  });

  describe("holdsSharedAccess()", () => {
    it("is false for a Developer", () => {
      expect(holdsSharedAccess(OrganizationUserRole.DEVELOPER)).toBe(false);
    });

    it("is true for every other seat", () => {
      expect(holdsSharedAccess(OrganizationUserRole.ADMIN)).toBe(true);
      expect(holdsSharedAccess(OrganizationUserRole.MEMBER)).toBe(true);
      expect(holdsSharedAccess(OrganizationUserRole.EXTERNAL)).toBe(true);
    });
  });

  describe("getOrganizationRoleLabel()", () => {
    it("names the Developer seat", () => {
      expect(getOrganizationRoleLabel(OrganizationUserRole.DEVELOPER)).toBe("Developer");
    });

    it("keeps the other labels", () => {
      expect(getOrganizationRoleLabel(OrganizationUserRole.ADMIN)).toBe("Organization Admin");
      expect(getOrganizationRoleLabel(OrganizationUserRole.MEMBER)).toBe("Organization Member");
      expect(getOrganizationRoleLabel(OrganizationUserRole.EXTERNAL)).toBe("Lite Member");
    });
  });

  describe("when the seat is Developer", () => {
    /** @scenario A Developer cannot be given a role on a shared team */
    it("allows no team role at all, whatever the role", () => {
      for (const role of [
        TeamUserRole.ADMIN,
        TeamUserRole.MEMBER,
        TeamUserRole.VIEWER,
        "custom:cr-1" as TeamRoleValue,
      ]) {
        expect(
          isTeamRoleAllowedForOrganizationRole({
            organizationRole: OrganizationUserRole.DEVELOPER,
            teamRole: role,
          }),
        ).toBe(false);
        expect(
          isGrantRoleAllowedForOrganizationRole({
            organizationRole: OrganizationUserRole.DEVELOPER,
            role,
          }),
        ).toBe(false);
      }
    });
  });

  describe("when the seat is Lite Member", () => {
    it("allows only Viewer on a stored row", () => {
      expect(
        isGrantRoleAllowedForOrganizationRole({
          organizationRole: OrganizationUserRole.EXTERNAL,
          role: TeamUserRole.VIEWER,
        }),
      ).toBe(true);
      expect(
        isGrantRoleAllowedForOrganizationRole({
          organizationRole: OrganizationUserRole.EXTERNAL,
          role: TeamUserRole.MEMBER,
        }),
      ).toBe(false);
    });
  });
});
