/**
 * @vitest-environment node
 *
 * The team settings form and the team's last admin.
 *
 * `team.update` saves the whole member list in one diff, and it used to be the
 * one write path with no last-admin awareness: demoting the only admin, or
 * leaving them out of the list, reported "Team updated successfully" and left
 * the team with nobody who can administer it. Found by driving the form in a
 * browser after the per-member paths got their guard. The form is a team-local
 * decision, so it meets the same rule those paths enforce, with one carve-out:
 * a team that already has no team-scoped admin (a seat correction can
 * legitimately produce one) stays editable here, because this form is also
 * where somebody gets promoted back.
 *
 * Requires: PostgreSQL database (Prisma)
 */

import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { prisma } from "../../../db";
import {
  createSeatChangeFixture,
  type SeatChangeFixture,
} from "./seatChangeLastTeamAdminFixture";

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

let fixture: SeatChangeFixture;

const saveTeam = (members: Array<{ userId: string; role: TeamUserRole }>) =>
  fixture.callerAsAdmin().team.update({
    teamId: fixture.onlyAdminTeamId,
    name: fixture.onlyAdminTeamName,
    members,
  });

describe("given a team whose only admin is one of its members", () => {
  beforeAll(async () => {
    fixture = await createSeatChangeFixture({
      prisma,
      ns: `team-form-${nanoid(8)}`,
    });
  });

  beforeEach(() => fixture.resetMemberships());

  afterAll(() => fixture.cleanup());

  describe("when the team is saved with that member demoted", () => {
    /** @scenario Saving the team form cannot take its last admin away */
    it("refuses, naming the team, and keeps the admin", async () => {
      await expect(
        saveTeam([{ userId: fixture.soloUserId, role: TeamUserRole.VIEWER }]),
      ).rejects.toMatchObject({
        cause: {
          code: "team_last_admin_required",
          meta: { teamName: fixture.onlyAdminTeamName },
        },
      });

      await expect(
        fixture.teamRoleOf({
          userId: fixture.soloUserId,
          teamId: fixture.onlyAdminTeamId,
        }),
      ).resolves.toBe(TeamUserRole.ADMIN);
    });
  });

  describe("when the team is saved with that member dropped from the list", () => {
    /** @scenario Saving the team form cannot take its last admin away */
    it("refuses, and they stay on the team", async () => {
      await expect(saveTeam([])).resolves.toMatchObject({ success: true });
      // An empty list is a rename-only save and touches nobody; dropping the
      // admin means submitting a list without them.
      await expect(
        saveTeam([
          { userId: fixture.companionUserId, role: TeamUserRole.MEMBER },
        ]),
      ).rejects.toMatchObject({
        cause: { code: "team_last_admin_required" },
      });

      await expect(
        fixture.teamRoleOf({
          userId: fixture.soloUserId,
          teamId: fixture.onlyAdminTeamId,
        }),
      ).resolves.toBe(TeamUserRole.ADMIN);
    });
  });

  describe("when the save promotes somebody else and demotes them", () => {
    /** @scenario The team form hands the admin role to somebody else in one save */
    it("goes through", async () => {
      await expect(
        saveTeam([
          { userId: fixture.soloUserId, role: TeamUserRole.VIEWER },
          { userId: fixture.companionUserId, role: TeamUserRole.ADMIN },
        ]),
      ).resolves.toMatchObject({ success: true });

      await expect(
        fixture.teamRoleOf({
          userId: fixture.companionUserId,
          teamId: fixture.onlyAdminTeamId,
        }),
      ).resolves.toBe(TeamUserRole.ADMIN);
    });
  });

  describe("when a group with a member also holds the Admin role on the team", () => {
    /** @scenario A group that administers the team counts as its admin */
    it("lets its only directly assigned admin be demoted", async () => {
      await fixture.withAdminGroupOn({
        teamId: fixture.onlyAdminTeamId,
        memberUserId: fixture.companionUserId,
        run: async () => {
          await expect(
            saveTeam([
              { userId: fixture.soloUserId, role: TeamUserRole.VIEWER },
            ]),
          ).resolves.toMatchObject({ success: true });

          await expect(
            fixture.teamRoleOf({
              userId: fixture.soloUserId,
              teamId: fixture.onlyAdminTeamId,
            }),
          ).resolves.toBe(TeamUserRole.VIEWER);
        },
      });
    });
  });

  describe("when the only group holding the Admin role has no members", () => {
    /** @scenario A group with no members does not keep a team administered */
    it("still refuses to demote the only directly assigned admin", async () => {
      await fixture.withAdminGroupOn({
        teamId: fixture.onlyAdminTeamId,
        run: async () => {
          await expect(
            saveTeam([
              { userId: fixture.soloUserId, role: TeamUserRole.VIEWER },
            ]),
          ).rejects.toMatchObject({
            cause: { code: "team_last_admin_required" },
          });
        },
      });
    });
  });

  describe("when the team already has no team admin at all", () => {
    /** @scenario A team already without a team admin stays editable */
    it("still accepts a membership change", async () => {
      // The state a seat correction leaves behind: the only admin's row is
      // gone entirely, so there is no admin for this save to lose.
      await prisma.roleBinding.deleteMany({
        where: {
          organizationId: fixture.organizationId,
          userId: fixture.soloUserId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: fixture.onlyAdminTeamId,
        },
      });

      await expect(
        saveTeam([
          { userId: fixture.companionUserId, role: TeamUserRole.MEMBER },
        ]),
      ).resolves.toMatchObject({ success: true });

      await expect(
        fixture.teamRoleOf({
          userId: fixture.companionUserId,
          teamId: fixture.onlyAdminTeamId,
        }),
      ).resolves.toBe(TeamUserRole.MEMBER);
    });
  });
});
