import { describe, expect, it } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { computeEffectiveTeamRoleUpdates } from "../organization";

describe("computeEffectiveTeamRoleUpdates()", () => {
  describe("when requested updates are present", () => {
    describe("when new org role is not EXTERNAL", () => {
      it("returns requested updates as-is", () => {
        const requested = [
          { teamId: "team-1", role: TeamUserRole.ADMIN },
          { teamId: "team-2", role: TeamUserRole.MEMBER },
        ];

        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: requested,
          currentMemberships: [
            { teamId: "team-1", role: TeamUserRole.MEMBER },
            { teamId: "team-2", role: TeamUserRole.VIEWER },
          ],
          newOrganizationRole: OrganizationUserRole.ADMIN,
        });

        expect(result).toEqual(requested);
      });

      it("returns requested updates for MEMBER org role", () => {
        const requested = [
          { teamId: "team-1", role: TeamUserRole.ADMIN },
        ];

        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: requested,
          currentMemberships: [
            { teamId: "team-1", role: TeamUserRole.VIEWER },
          ],
          newOrganizationRole: OrganizationUserRole.MEMBER,
        });

        expect(result).toEqual(requested);
      });
    });

    describe("when new org role is EXTERNAL", () => {
      it("includes requested updates and falls back uncovered memberships to VIEWER", () => {
        const requested = [
          { teamId: "team-1", role: TeamUserRole.VIEWER },
        ];

        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: requested,
          currentMemberships: [
            { teamId: "team-1", role: TeamUserRole.ADMIN },
            { teamId: "team-2", role: TeamUserRole.MEMBER },
            { teamId: "team-3", role: TeamUserRole.VIEWER },
          ],
          newOrganizationRole: OrganizationUserRole.EXTERNAL,
        });

        expect(result).toEqual([
          { teamId: "team-1", role: TeamUserRole.VIEWER },
          { teamId: "team-2", role: TeamUserRole.VIEWER, customRoleId: undefined },
          { teamId: "team-3", role: TeamUserRole.VIEWER, customRoleId: undefined },
        ]);
      });

      it("does not duplicate teams already in requested updates", () => {
        const requested = [
          { teamId: "team-1", role: TeamUserRole.VIEWER },
          { teamId: "team-2", role: TeamUserRole.VIEWER },
        ];

        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: requested,
          currentMemberships: [
            { teamId: "team-1", role: TeamUserRole.ADMIN },
            { teamId: "team-2", role: TeamUserRole.MEMBER },
          ],
          newOrganizationRole: OrganizationUserRole.EXTERNAL,
        });

        expect(result).toEqual(requested);
      });
    });
  });

  describe("when no requested updates are present", () => {
    describe("when new org role is EXTERNAL", () => {
      it("auto-corrects all non-VIEWER memberships to VIEWER", () => {
        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: [],
          currentMemberships: [
            { teamId: "team-1", role: TeamUserRole.ADMIN },
            { teamId: "team-2", role: TeamUserRole.MEMBER },
            { teamId: "team-3", role: TeamUserRole.VIEWER },
          ],
          newOrganizationRole: OrganizationUserRole.EXTERNAL,
        });

        expect(result).toEqual([
          { teamId: "team-1", role: TeamUserRole.VIEWER, customRoleId: undefined },
          { teamId: "team-2", role: TeamUserRole.VIEWER, customRoleId: undefined },
        ]);
      });

      it("returns empty array when all memberships are already VIEWER", () => {
        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: [],
          currentMemberships: [
            { teamId: "team-1", role: TeamUserRole.VIEWER },
          ],
          newOrganizationRole: OrganizationUserRole.EXTERNAL,
        });

        expect(result).toEqual([]);
      });
    });

    describe("when new org role is MEMBER", () => {
      it("auto-upgrades VIEWER memberships to MEMBER", () => {
        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: [],
          currentMemberships: [
            { teamId: "team-1", role: TeamUserRole.VIEWER },
            { teamId: "team-2", role: TeamUserRole.ADMIN },
            { teamId: "team-3", role: TeamUserRole.VIEWER },
          ],
          newOrganizationRole: OrganizationUserRole.MEMBER,
        });

        expect(result).toEqual([
          { teamId: "team-1", role: TeamUserRole.MEMBER, customRoleId: undefined },
          { teamId: "team-3", role: TeamUserRole.MEMBER, customRoleId: undefined },
        ]);
      });

      it("returns empty array when no memberships are VIEWER", () => {
        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: [],
          currentMemberships: [
            { teamId: "team-1", role: TeamUserRole.ADMIN },
            { teamId: "team-2", role: TeamUserRole.MEMBER },
          ],
          newOrganizationRole: OrganizationUserRole.MEMBER,
        });

        expect(result).toEqual([]);
      });
    });

    describe("when new org role is ADMIN", () => {
      it("returns empty array (no automatic changes needed)", () => {
        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: [],
          currentMemberships: [
            { teamId: "team-1", role: TeamUserRole.MEMBER },
            { teamId: "team-2", role: TeamUserRole.VIEWER },
          ],
          newOrganizationRole: OrganizationUserRole.ADMIN,
        });

        expect(result).toEqual([]);
      });
    });

    describe("when there are no current memberships", () => {
      it("returns empty array for any org role", () => {
        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: [],
          currentMemberships: [],
          newOrganizationRole: OrganizationUserRole.EXTERNAL,
        });

        expect(result).toEqual([]);
      });
    });
  });
});
