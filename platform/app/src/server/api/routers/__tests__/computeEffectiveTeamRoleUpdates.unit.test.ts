import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import { describe, expect, it } from "vitest";
import { computeEffectiveTeamRoleUpdates } from "~/server/app-layer/organizations/compute-effective-team-role-updates";

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

        expect(result).toEqual(
          requested.map((update) => ({ ...update, origin: "requested" })),
        );
      });

      it("returns requested updates for MEMBER org role", () => {
        const requested = [{ teamId: "team-1", role: TeamUserRole.ADMIN }];

        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: requested,
          currentMemberships: [{ teamId: "team-1", role: TeamUserRole.VIEWER }],
          newOrganizationRole: OrganizationUserRole.MEMBER,
        });

        expect(result).toEqual(
          requested.map((update) => ({ ...update, origin: "requested" })),
        );
      });
    });

    describe("when new org role is EXTERNAL", () => {
      it("includes requested updates and falls back uncovered memberships to VIEWER", () => {
        const requested = [{ teamId: "team-1", role: TeamUserRole.VIEWER }];

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
          { teamId: "team-1", role: TeamUserRole.VIEWER, origin: "requested" },
          {
            teamId: "team-2",
            role: TeamUserRole.VIEWER,
            customRoleId: undefined,
            origin: "seat-correction",
          },
          {
            teamId: "team-3",
            role: TeamUserRole.VIEWER,
            customRoleId: undefined,
            origin: "seat-correction",
          },
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

        expect(result).toEqual(
          requested.map((update) => ({ ...update, origin: "requested" })),
        );
      });
    });
  });

  describe("when no requested updates are present", () => {
    describe("when new org role is EXTERNAL", () => {
      /** @scenario All team assignments respect Lite Member restrictions */
      /** @scenario Switching org role updates all team assignments */
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
          {
            teamId: "team-1",
            role: TeamUserRole.VIEWER,
            customRoleId: undefined,
            origin: "seat-correction",
          },
          {
            teamId: "team-2",
            role: TeamUserRole.VIEWER,
            customRoleId: undefined,
            origin: "seat-correction",
          },
        ]);
      });

      it("returns empty array when all memberships are already VIEWER", () => {
        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: [],
          currentMemberships: [{ teamId: "team-1", role: TeamUserRole.VIEWER }],
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
          {
            teamId: "team-1",
            role: TeamUserRole.MEMBER,
            customRoleId: undefined,
            origin: "seat-correction",
          },
          {
            teamId: "team-3",
            role: TeamUserRole.MEMBER,
            customRoleId: undefined,
            origin: "seat-correction",
          },
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

    describe("when a correction would take away a team's only admin", () => {
      /** @scenario Moving the only admin of a shared team to a Lite Member seat goes through */
      it("marks the correction as coming from the seat change, not the caller", () => {
        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: [],
          currentMemberships: [{ teamId: "team-1", role: TeamUserRole.ADMIN }],
          newOrganizationRole: OrganizationUserRole.EXTERNAL,
        });

        // The origin is what lets the last-admin guard tell a team-local
        // decision from an organization-level one, so it is the whole contract
        // between this function and that guard.
        expect(result).toEqual([
          {
            teamId: "team-1",
            role: TeamUserRole.VIEWER,
            customRoleId: undefined,
            origin: "seat-correction",
          },
        ]);
      });

      /** @scenario A seat change that names team roles outright still keeps the guard */
      it("keeps a team the caller named outright attributed to the caller", () => {
        const result = computeEffectiveTeamRoleUpdates({
          requestedTeamRoleUpdates: [
            { teamId: "team-1", role: TeamUserRole.VIEWER },
          ],
          currentMemberships: [{ teamId: "team-1", role: TeamUserRole.ADMIN }],
          newOrganizationRole: OrganizationUserRole.EXTERNAL,
        });

        expect(result).toEqual([
          { teamId: "team-1", role: TeamUserRole.VIEWER, origin: "requested" },
        ]);
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
