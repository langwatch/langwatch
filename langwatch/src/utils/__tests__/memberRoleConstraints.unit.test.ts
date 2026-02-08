import { describe, expect, it } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import {
  getAutoCorrectedTeamRoleForOrganizationRole,
  getOrganizationRoleLabel,
  isTeamRoleAllowedForOrganizationRole,
} from "../memberRoleConstraints";

describe("memberRoleConstraints", () => {
  describe("getOrganizationRoleLabel()", () => {
    it("returns Lite Member label for EXTERNAL role", () => {
      expect(getOrganizationRoleLabel(OrganizationUserRole.EXTERNAL)).toBe(
        "Lite Member",
      );
    });
  });

  describe("isTeamRoleAllowedForOrganizationRole()", () => {
    describe("when organization role is Lite Member", () => {
      it("allows Viewer role", () => {
        expect(
          isTeamRoleAllowedForOrganizationRole({
            organizationRole: OrganizationUserRole.EXTERNAL,
            teamRole: TeamUserRole.VIEWER,
          }),
        ).toBe(true);
      });

      it("rejects non-Viewer role", () => {
        expect(
          isTeamRoleAllowedForOrganizationRole({
            organizationRole: OrganizationUserRole.EXTERNAL,
            teamRole: TeamUserRole.ADMIN,
          }),
        ).toBe(false);
      });
    });
  });

  describe("getAutoCorrectedTeamRoleForOrganizationRole()", () => {
    it("forces Viewer for Lite Member", () => {
      expect(
        getAutoCorrectedTeamRoleForOrganizationRole({
          organizationRole: OrganizationUserRole.EXTERNAL,
          currentTeamRole: TeamUserRole.ADMIN,
        }),
      ).toBe(TeamUserRole.VIEWER);
    });

    it("upgrades Viewer to Member for Member organization role", () => {
      expect(
        getAutoCorrectedTeamRoleForOrganizationRole({
          organizationRole: OrganizationUserRole.MEMBER,
          currentTeamRole: TeamUserRole.VIEWER,
        }),
      ).toBe(TeamUserRole.MEMBER);
    });
  });
});
