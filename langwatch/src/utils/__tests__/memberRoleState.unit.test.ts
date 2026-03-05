import { describe, expect, it } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import {
  applyOrganizationRoleToPendingTeamRoles,
  arePendingTeamRolesEqual,
  buildInitialPendingTeamRoles,
  getLicenseLimitTypeForRoleChange,
  getTeamRoleDisplayName,
  getTeamRoleUpdates,
  hasPendingRoleChanges,
  resolveTeamRoleValue,
  type TeamMembershipWithRole,
} from "../memberRoleState";

function makeMembership(
  overrides: Partial<TeamMembershipWithRole> & {
    teamId: string;
    role: string;
  },
): TeamMembershipWithRole {
  return {
    userId: "user-1",
    teamId: overrides.teamId,
    role: overrides.role,
    assignedRole: overrides.assignedRole ?? null,
    team: overrides.team ?? {
      id: overrides.teamId,
      name: "Team",
      slug: "team",
      organizationId: "org-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      archivedAt: null,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  } as TeamMembershipWithRole;
}

describe("memberRoleState", () => {
  describe("resolveTeamRoleValue()", () => {
    describe("when role is CUSTOM with assignedRole", () => {
      it("returns custom:<id> format", () => {
        const membership = makeMembership({
          teamId: "t1",
          role: TeamUserRole.CUSTOM,
          assignedRole: {
            id: "cr-1",
            name: "Dev",
            description: null,
            permissions: [],
            organizationId: "org-1",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

        expect(resolveTeamRoleValue(membership)).toBe("custom:cr-1");
      });
    });

    describe("when role is CUSTOM without assignedRole", () => {
      it("returns the missing custom role value", () => {
        const membership = makeMembership({
          teamId: "t1",
          role: TeamUserRole.CUSTOM,
          assignedRole: null,
        });

        expect(resolveTeamRoleValue(membership)).toBe("custom:missing");
      });
    });

    describe("when role is a built-in role", () => {
      it("returns the role string directly", () => {
        const membership = makeMembership({
          teamId: "t1",
          role: TeamUserRole.ADMIN,
        });

        expect(resolveTeamRoleValue(membership)).toBe("ADMIN");
      });
    });
  });

  describe("getTeamRoleDisplayName()", () => {
    describe("when role is CUSTOM with assignedRole", () => {
      it("returns the custom role name", () => {
        const membership = makeMembership({
          teamId: "t1",
          role: "CUSTOM",
          assignedRole: {
            id: "cr-1",
            name: "Developer",
            description: null,
            permissions: [],
            organizationId: "org-1",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });

        expect(getTeamRoleDisplayName(membership)).toBe("Developer");
      });
    });

    describe("when role is CUSTOM without assignedRole", () => {
      it("returns 'Custom' as fallback", () => {
        const membership = makeMembership({
          teamId: "t1",
          role: "CUSTOM",
          assignedRole: null,
        });

        expect(getTeamRoleDisplayName(membership)).toBe("Custom");
      });
    });

    describe("when role is a built-in role", () => {
      it("returns the label from teamRolesOptions", () => {
        const membership = makeMembership({
          teamId: "t1",
          role: TeamUserRole.VIEWER,
        });

        expect(getTeamRoleDisplayName(membership)).toBe("Viewer");
      });
    });
  });

  describe("buildInitialPendingTeamRoles()", () => {
    describe("when memberships span multiple organizations", () => {
      it("filters by organizationId", () => {
        const memberships = [
          makeMembership({
            teamId: "t1",
            role: TeamUserRole.ADMIN,
            team: {
              id: "t1",
              name: "Team A",
              slug: "a",
              organizationId: "org-1",
              createdAt: new Date(),
              updatedAt: new Date(),
              archivedAt: null,
            },
          }),
          makeMembership({
            teamId: "t2",
            role: TeamUserRole.MEMBER,
            team: {
              id: "t2",
              name: "Team B",
              slug: "b",
              organizationId: "org-other",
              createdAt: new Date(),
              updatedAt: new Date(),
              archivedAt: null,
            },
          }),
        ];

        const result = buildInitialPendingTeamRoles({
          teamMemberships: memberships,
          organizationId: "org-1",
        });

        expect(Object.keys(result)).toEqual(["t1"]);
      });
    });

    describe("when memberships belong to the target organization", () => {
      it("maps roles correctly", () => {
        const memberships = [
          makeMembership({
            teamId: "t1",
            role: TeamUserRole.ADMIN,
          }),
          makeMembership({
            teamId: "t2",
            role: TeamUserRole.CUSTOM,
            assignedRole: {
              id: "cr-1",
              name: "Dev",
              description: null,
              permissions: [],
              organizationId: "org-1",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }),
        ];

        const result = buildInitialPendingTeamRoles({
          teamMemberships: memberships,
          organizationId: "org-1",
        });

        expect(result).toEqual({
          t1: { role: "ADMIN", customRoleId: undefined },
          t2: { role: "custom:cr-1", customRoleId: "cr-1" },
        });
      });
    });
  });

  describe("getTeamRoleUpdates()", () => {
    describe("when no changes exist", () => {
      it("returns an empty array", () => {
        const memberships = [
          makeMembership({ teamId: "t1", role: TeamUserRole.ADMIN }),
        ];

        const result = getTeamRoleUpdates({
          teamMemberships: memberships,
          pendingTeamRoles: { t1: { role: "ADMIN" } },
          userId: "user-1",
        });

        expect(result).toEqual([]);
      });
    });

    describe("when role changed", () => {
      it("returns the update payload", () => {
        const memberships = [
          makeMembership({ teamId: "t1", role: TeamUserRole.ADMIN }),
        ];

        const result = getTeamRoleUpdates({
          teamMemberships: memberships,
          pendingTeamRoles: { t1: { role: "VIEWER" } },
          userId: "user-1",
        });

        expect(result).toEqual([
          {
            teamId: "t1",
            userId: "user-1",
            role: "VIEWER",
            customRoleId: undefined,
          },
        ]);
      });
    });

    describe("when customRoleId changed", () => {
      it("returns the update payload with new customRoleId", () => {
        const memberships = [
          makeMembership({
            teamId: "t1",
            role: TeamUserRole.CUSTOM,
            assignedRole: {
              id: "cr-1",
              name: "Dev",
              description: null,
              permissions: [],
              organizationId: "org-1",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          }),
        ];

        const result = getTeamRoleUpdates({
          teamMemberships: memberships,
          pendingTeamRoles: {
            t1: { role: "custom:cr-2", customRoleId: "cr-2" },
          },
          userId: "user-1",
        });

        expect(result).toEqual([
          {
            teamId: "t1",
            userId: "user-1",
            role: "custom:cr-2",
            customRoleId: "cr-2",
          },
        ]);
      });
    });
  });

  describe("hasPendingRoleChanges()", () => {
    describe("when organization role changed", () => {
      it("returns true", () => {
        const result = hasPendingRoleChanges({
          teamMemberships: [],
          pendingTeamRoles: {},
          pendingOrganizationRole: OrganizationUserRole.EXTERNAL,
          currentOrganizationRole: OrganizationUserRole.MEMBER,
        });

        expect(result).toBe(true);
      });
    });

    describe("when team role changed", () => {
      it("returns true", () => {
        const memberships = [
          makeMembership({ teamId: "t1", role: TeamUserRole.ADMIN }),
        ];

        const result = hasPendingRoleChanges({
          teamMemberships: memberships,
          pendingTeamRoles: { t1: { role: "VIEWER" } },
          pendingOrganizationRole: OrganizationUserRole.MEMBER,
          currentOrganizationRole: OrganizationUserRole.MEMBER,
        });

        expect(result).toBe(true);
      });
    });

    describe("when no changes exist", () => {
      it("returns false", () => {
        const memberships = [
          makeMembership({ teamId: "t1", role: TeamUserRole.ADMIN }),
        ];

        const result = hasPendingRoleChanges({
          teamMemberships: memberships,
          pendingTeamRoles: { t1: { role: "ADMIN" } },
          pendingOrganizationRole: OrganizationUserRole.MEMBER,
          currentOrganizationRole: OrganizationUserRole.MEMBER,
        });

        expect(result).toBe(false);
      });
    });

    describe("when pendingOrganizationRole is null", () => {
      it("returns false even with matching team roles", () => {
        const memberships = [
          makeMembership({ teamId: "t1", role: TeamUserRole.ADMIN }),
        ];

        const result = hasPendingRoleChanges({
          teamMemberships: memberships,
          pendingTeamRoles: { t1: { role: "ADMIN" } },
          pendingOrganizationRole: null,
          currentOrganizationRole: OrganizationUserRole.MEMBER,
        });

        expect(result).toBe(false);
      });
    });
  });

  describe("arePendingTeamRolesEqual()", () => {
    describe("when maps are equal", () => {
      it("returns true", () => {
        const left = {
          t1: { role: TeamUserRole.ADMIN },
          t2: { role: TeamUserRole.VIEWER },
        };
        const right = {
          t1: { role: TeamUserRole.ADMIN },
          t2: { role: TeamUserRole.VIEWER },
        };

        expect(arePendingTeamRolesEqual(left, right)).toBe(true);
      });
    });

    describe("when roles differ", () => {
      it("returns false", () => {
        const left = { t1: { role: TeamUserRole.ADMIN } };
        const right = { t1: { role: TeamUserRole.VIEWER } };

        expect(arePendingTeamRolesEqual(left, right)).toBe(false);
      });
    });

    describe("when maps have different lengths", () => {
      it("returns false", () => {
        const left = { t1: { role: TeamUserRole.ADMIN } };
        const right = {
          t1: { role: TeamUserRole.ADMIN },
          t2: { role: TeamUserRole.VIEWER },
        };

        expect(arePendingTeamRolesEqual(left, right)).toBe(false);
      });
    });

    describe("when customRoleId differs", () => {
      it("returns false", () => {
        const left = {
          t1: { role: "custom:cr-1" as const, customRoleId: "cr-1" },
        };
        const right = {
          t1: { role: "custom:cr-1" as const, customRoleId: "cr-2" },
        };

        expect(arePendingTeamRolesEqual(left, right)).toBe(false);
      });
    });
  });

  describe("getLicenseLimitTypeForRoleChange()", () => {
    describe("when changing from EXTERNAL to non-EXTERNAL", () => {
      it("returns 'members'", () => {
        const result = getLicenseLimitTypeForRoleChange({
          previousRole: OrganizationUserRole.EXTERNAL,
          nextRole: OrganizationUserRole.MEMBER,
        });

        expect(result).toBe("members");
      });
    });

    describe("when changing from non-EXTERNAL to EXTERNAL", () => {
      it("returns 'membersLite'", () => {
        const result = getLicenseLimitTypeForRoleChange({
          previousRole: OrganizationUserRole.MEMBER,
          nextRole: OrganizationUserRole.EXTERNAL,
        });

        expect(result).toBe("membersLite");
      });
    });

    describe("when staying in the same license category", () => {
      it("returns null for MEMBER to ADMIN", () => {
        const result = getLicenseLimitTypeForRoleChange({
          previousRole: OrganizationUserRole.MEMBER,
          nextRole: OrganizationUserRole.ADMIN,
        });

        expect(result).toBeNull();
      });

      it("returns null for EXTERNAL to EXTERNAL", () => {
        const result = getLicenseLimitTypeForRoleChange({
          previousRole: OrganizationUserRole.EXTERNAL,
          nextRole: OrganizationUserRole.EXTERNAL,
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("applyOrganizationRoleToPendingTeamRoles()", () => {
    describe("when organization role is EXTERNAL", () => {
      it("forces all team roles to Viewer", () => {
        const result = applyOrganizationRoleToPendingTeamRoles({
          organizationRole: OrganizationUserRole.EXTERNAL,
          currentPendingTeamRoles: {
            t1: { role: "ADMIN" },
            t2: { role: "MEMBER", customRoleId: "cr-1" },
          },
        });

        expect(result).toEqual({
          t1: { role: "VIEWER", customRoleId: undefined },
          t2: { role: "VIEWER", customRoleId: undefined },
        });
      });
    });

    describe("when organization role is MEMBER", () => {
      it("upgrades Viewer to Member", () => {
        const result = applyOrganizationRoleToPendingTeamRoles({
          organizationRole: OrganizationUserRole.MEMBER,
          currentPendingTeamRoles: {
            t1: { role: "VIEWER" },
            t2: { role: "ADMIN" },
          },
        });

        expect(result).toEqual({
          t1: { role: "MEMBER", customRoleId: undefined },
          t2: { role: "ADMIN", customRoleId: undefined },
        });
      });

      it("preserves customRoleId for non-Viewer roles", () => {
        const result = applyOrganizationRoleToPendingTeamRoles({
          organizationRole: OrganizationUserRole.MEMBER,
          currentPendingTeamRoles: {
            t1: { role: "custom:cr-1", customRoleId: "cr-1" },
          },
        });

        expect(result).toEqual({
          t1: { role: "custom:cr-1", customRoleId: "cr-1" },
        });
      });
    });

    describe("when organization role is ADMIN", () => {
      it("preserves all team roles unchanged", () => {
        const result = applyOrganizationRoleToPendingTeamRoles({
          organizationRole: OrganizationUserRole.ADMIN,
          currentPendingTeamRoles: {
            t1: { role: "VIEWER" },
            t2: { role: "MEMBER" },
          },
        });

        expect(result).toEqual({
          t1: { role: "VIEWER", customRoleId: undefined },
          t2: { role: "MEMBER", customRoleId: undefined },
        });
      });
    });
  });
});
