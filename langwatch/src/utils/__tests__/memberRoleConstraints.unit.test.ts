import { describe, expect, it } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import {
  getAutoCorrectedTeamRoleForOrganizationRole,
  getOrganizationRoleLabel,
  isTeamRoleAllowedForOrganizationRole,
} from "../memberRoleConstraints";
import type { TeamRoleValue } from "../memberRoleConstraints";

describe("memberRoleConstraints", () => {
  describe("getOrganizationRoleLabel()", () => {
    describe("when role is ADMIN", () => {
      it("returns Organization Admin", () => {
        expect(getOrganizationRoleLabel(OrganizationUserRole.ADMIN)).toBe(
          "Organization Admin",
        );
      });
    });

    describe("when role is MEMBER", () => {
      it("returns Organization Member", () => {
        expect(getOrganizationRoleLabel(OrganizationUserRole.MEMBER)).toBe(
          "Organization Member",
        );
      });
    });

    describe("when role is EXTERNAL", () => {
      /** @scenario Organization role dropdown shows "Lite Member" instead of "External / Viewer" */
      it("returns Lite Member", () => {
        expect(getOrganizationRoleLabel(OrganizationUserRole.EXTERNAL)).toBe(
          "Lite Member",
        );
      });
    });
  });

  describe("isTeamRoleAllowedForOrganizationRole()", () => {
    describe("when organization role is Lite Member", () => {
      /** @scenario Lite Member org role restricts team role to Viewer only */
      /** @scenario Lite Member does not show custom roles in team role dropdown */
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

    describe("when organization role is Member", () => {
      /** @scenario Member org role excludes Viewer from team role options */
      /** @scenario Member org role includes custom roles */
      it("allows Admin team role", () => {
        expect(
          isTeamRoleAllowedForOrganizationRole({
            organizationRole: OrganizationUserRole.MEMBER,
            teamRole: TeamUserRole.ADMIN,
          }),
        ).toBe(true);
      });

      it("allows Member team role", () => {
        expect(
          isTeamRoleAllowedForOrganizationRole({
            organizationRole: OrganizationUserRole.MEMBER,
            teamRole: TeamUserRole.MEMBER,
          }),
        ).toBe(true);
      });

      it("rejects Viewer team role", () => {
        expect(
          isTeamRoleAllowedForOrganizationRole({
            organizationRole: OrganizationUserRole.MEMBER,
            teamRole: TeamUserRole.VIEWER,
          }),
        ).toBe(false);
      });

      it("allows custom role", () => {
        expect(
          isTeamRoleAllowedForOrganizationRole({
            organizationRole: OrganizationUserRole.MEMBER,
            teamRole: "custom:role-abc" as TeamRoleValue,
          }),
        ).toBe(true);
      });
    });

    describe("when organization role is Admin", () => {
      /** @scenario Admin org role has all team role options available */
      /** @scenario Admin org role includes custom roles */
      it("allows Viewer team role", () => {
        expect(
          isTeamRoleAllowedForOrganizationRole({
            organizationRole: OrganizationUserRole.ADMIN,
            teamRole: TeamUserRole.VIEWER,
          }),
        ).toBe(true);
      });

      it("allows Admin team role", () => {
        expect(
          isTeamRoleAllowedForOrganizationRole({
            organizationRole: OrganizationUserRole.ADMIN,
            teamRole: TeamUserRole.ADMIN,
          }),
        ).toBe(true);
      });

      it("allows Member team role", () => {
        expect(
          isTeamRoleAllowedForOrganizationRole({
            organizationRole: OrganizationUserRole.ADMIN,
            teamRole: TeamUserRole.MEMBER,
          }),
        ).toBe(true);
      });

      it("allows custom role", () => {
        expect(
          isTeamRoleAllowedForOrganizationRole({
            organizationRole: OrganizationUserRole.ADMIN,
            teamRole: "custom:role-xyz" as TeamRoleValue,
          }),
        ).toBe(true);
      });
    });
  });

  describe("getAutoCorrectedTeamRoleForOrganizationRole()", () => {
    describe("when organization role is Lite Member", () => {
      /** @scenario Switching from Member to Lite Member auto-corrects team role to Viewer */
      /** @scenario Switching from Admin to Lite Member auto-corrects team role to Viewer */
      /** @scenario Saving a Lite Member update enforces Viewer team role in every team */
      it("forces Admin to Viewer", () => {
        expect(
          getAutoCorrectedTeamRoleForOrganizationRole({
            organizationRole: OrganizationUserRole.EXTERNAL,
            currentTeamRole: TeamUserRole.ADMIN,
          }),
        ).toBe(TeamUserRole.VIEWER);
      });

      it("forces Member to Viewer", () => {
        expect(
          getAutoCorrectedTeamRoleForOrganizationRole({
            organizationRole: OrganizationUserRole.EXTERNAL,
            currentTeamRole: TeamUserRole.MEMBER,
          }),
        ).toBe(TeamUserRole.VIEWER);
      });

      it("forces custom role to Viewer", () => {
        expect(
          getAutoCorrectedTeamRoleForOrganizationRole({
            organizationRole: OrganizationUserRole.EXTERNAL,
            currentTeamRole: "custom:role-abc" as TeamRoleValue,
          }),
        ).toBe(TeamUserRole.VIEWER);
      });
    });

    describe("when organization role is Member", () => {
      /** @scenario Switching from Lite Member to Member auto-corrects team role to Member */
      /** @scenario Switching from Admin to Member with Viewer team role auto-corrects to Member */
      it("upgrades Viewer to Member", () => {
        expect(
          getAutoCorrectedTeamRoleForOrganizationRole({
            organizationRole: OrganizationUserRole.MEMBER,
            currentTeamRole: TeamUserRole.VIEWER,
          }),
        ).toBe(TeamUserRole.MEMBER);
      });

      it("keeps Admin as Admin", () => {
        expect(
          getAutoCorrectedTeamRoleForOrganizationRole({
            organizationRole: OrganizationUserRole.MEMBER,
            currentTeamRole: TeamUserRole.ADMIN,
          }),
        ).toBe(TeamUserRole.ADMIN);
      });

      it("keeps Member as Member", () => {
        expect(
          getAutoCorrectedTeamRoleForOrganizationRole({
            organizationRole: OrganizationUserRole.MEMBER,
            currentTeamRole: TeamUserRole.MEMBER,
          }),
        ).toBe(TeamUserRole.MEMBER);
      });
    });

    describe("when organization role is Admin", () => {
      /** @scenario Switching from Member to Admin keeps existing team role */
      it("keeps Viewer as Viewer", () => {
        expect(
          getAutoCorrectedTeamRoleForOrganizationRole({
            organizationRole: OrganizationUserRole.ADMIN,
            currentTeamRole: TeamUserRole.VIEWER,
          }),
        ).toBe(TeamUserRole.VIEWER);
      });

      it("keeps Admin as Admin", () => {
        expect(
          getAutoCorrectedTeamRoleForOrganizationRole({
            organizationRole: OrganizationUserRole.ADMIN,
            currentTeamRole: TeamUserRole.ADMIN,
          }),
        ).toBe(TeamUserRole.ADMIN);
      });
    });
  });
});
