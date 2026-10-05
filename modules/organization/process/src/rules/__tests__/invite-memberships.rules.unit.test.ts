/** A Developer invitation enters no metered pool and grants no team (ADR-171). */
import { OrganizationUserRole, TeamUserRole } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import {
  classifyInvitesByMemberType,
  resolveInviteTeamMemberships,
} from "../invite-memberships.rules.ts";

describe("given invitations onto the Developer seat", () => {
  describe("when they are classified for the seat check", () => {
    /** @scenario An administrator invites a Developer while the plan is at its seat cap */
    it("counts them in neither metered pool", () => {
      expect(
        classifyInvitesByMemberType({
          invites: [
            { role: OrganizationUserRole.DEVELOPER },
            { role: OrganizationUserRole.DEVELOPER, teams: [] },
          ],
          customRoleMap: new Map(),
          isViewOnlyCustomRole: () => true,
        }),
      ).toEqual({ fullMembers: 0, liteMembers: 0 });
    });
  });

  describe("when a stored Developer invitation carries teams in either form", () => {
    /** @scenario An administrator invites a Developer while the plan is at its seat cap */
    it("grants no team at all", () => {
      expect(
        resolveInviteTeamMemberships({
          role: OrganizationUserRole.DEVELOPER,
          teamIds: "team-1,team-2",
          teamAssignments: null,
        }),
      ).toEqual([]);
      expect(
        resolveInviteTeamMemberships({
          role: OrganizationUserRole.DEVELOPER,
          teamIds: "",
          teamAssignments: [{ teamId: "team-1", role: TeamUserRole.ADMIN }],
        }),
      ).toEqual([]);
    });
  });
});
