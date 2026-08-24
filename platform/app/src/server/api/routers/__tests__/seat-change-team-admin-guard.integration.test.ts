/**
 * @vitest-environment node
 *
 * The last-admin guard, on the paths a seat correction is not.
 *
 * Only the correction a seat change derives for itself is allowed to leave a
 * shared team without a team-scoped admin. A caller who names the team and the
 * role is making a team-local decision, whether that arrives as part of a seat
 * change or from the team's own member list, and a team-local decision still
 * meets the guard. Each refusal names the team, because both are raised while
 * editing one member who may be an admin of several.
 *
 * The allowed half lives in `seat-change-last-team-admin.integration.test.ts`,
 * against the same fixture.
 *
 * Requires: PostgreSQL database (Prisma)
 */

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
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { prisma } from "../../../db";
import {
  createSeatChangeFixture,
  type SeatChangeFixture,
} from "./seatChangeLastTeamAdminFixture";

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

let fixture: SeatChangeFixture;

const seatChangeNamingTheTeamRole = () =>
  fixture.callerAsAdmin().organization.updateMemberRole({
    organizationId: fixture.organizationId,
    userId: fixture.soloUserId,
    role: OrganizationUserRole.EXTERNAL,
    teamRoleUpdates: [
      {
        teamId: fixture.onlyAdminTeamId,
        userId: fixture.soloUserId,
        role: TeamUserRole.VIEWER,
      },
    ],
  });

describe("given a member who is the only admin of a shared team", () => {
  beforeAll(async () => {
    fixture = await createSeatChangeFixture({
      prisma,
      ns: `seat-guard-${nanoid(8)}`,
    });
  });

  beforeEach(() => fixture.resetMemberships());

  afterAll(() => fixture.cleanup());

  describe("when the caller names that team role outright", () => {
    /** @scenario A seat change that names team roles outright still keeps the guard */
    it("refuses, naming the team", async () => {
      await expect(seatChangeNamingTheTeamRole()).rejects.toMatchObject({
        cause: {
          code: "team_last_admin_required",
          meta: { teamName: fixture.onlyAdminTeamName },
        },
      });
    });

    /** @scenario A seat change that names team roles outright still keeps the guard */
    it("saves nothing at all", async () => {
      await seatChangeNamingTheTeamRole().catch(() => undefined);

      // The refusal is raised inside the transaction carrying the organization
      // role change, so a refused save leaves both halves as they were.
      await expect(
        fixture.teamRoleOf({
          userId: fixture.soloUserId,
          teamId: fixture.onlyAdminTeamId,
        }),
      ).resolves.toBe(TeamUserRole.ADMIN);
      await expect(fixture.organizationRoleOfSoloUser()).resolves.toBe(
        OrganizationUserRole.MEMBER,
      );
    });
  });

  describe("when an admin edits that team's own members", () => {
    /** @scenario Editing one team's members still refuses to remove its last admin */
    it("refuses, naming the team", async () => {
      await expect(
        fixture.callerAsAdmin().organization.updateTeamMemberRole({
          teamId: fixture.onlyAdminTeamId,
          userId: fixture.soloUserId,
          role: TeamUserRole.VIEWER,
        }),
      ).rejects.toMatchObject({
        cause: {
          code: "team_last_admin_required",
          meta: { teamName: fixture.onlyAdminTeamName },
        },
      });
    });
  });

  describe("when a group with a member also holds the Admin role on the team", () => {
    /** @scenario A group that administers the team counts as its admin */
    it("lets the team's own member edit demote them", async () => {
      await fixture.withAdminGroupOn({
        teamId: fixture.onlyAdminTeamId,
        memberUserId: fixture.companionUserId,
        run: async () => {
          await expect(
            fixture.callerAsAdmin().organization.updateTeamMemberRole({
              teamId: fixture.onlyAdminTeamId,
              userId: fixture.soloUserId,
              role: TeamUserRole.VIEWER,
            }),
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

    /** @scenario A group that administers the team counts as its admin */
    it("lets a seat change naming the team role go through", async () => {
      await fixture.withAdminGroupOn({
        teamId: fixture.onlyAdminTeamId,
        memberUserId: fixture.companionUserId,
        run: async () => {
          await expect(seatChangeNamingTheTeamRole()).resolves.toMatchObject({
            success: true,
          });

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

  describe("given a seat correction left the team with no admin at all", () => {
    beforeEach(() =>
      prisma.roleBinding.updateMany({
        where: {
          organizationId: fixture.organizationId,
          userId: fixture.soloUserId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: fixture.onlyAdminTeamId,
        },
        data: { role: TeamUserRole.VIEWER },
      }),
    );

    describe("when a member's role on the team is edited", () => {
      /** @scenario A team already without a team admin stays editable */
      it("saves the change", async () => {
        await expect(
          fixture.callerAsAdmin().organization.updateTeamMemberRole({
            teamId: fixture.onlyAdminTeamId,
            userId: fixture.soloUserId,
            role: TeamUserRole.MEMBER,
          }),
        ).resolves.toMatchObject({ success: true });

        await expect(
          fixture.teamRoleOf({
            userId: fixture.soloUserId,
            teamId: fixture.onlyAdminTeamId,
          }),
        ).resolves.toBe(TeamUserRole.MEMBER);
      });
    });

    describe("when a member is promoted back to Admin", () => {
      /** @scenario A team already without a team admin stays editable */
      it("repairs the team", async () => {
        await expect(
          fixture.callerAsAdmin().organization.updateTeamMemberRole({
            teamId: fixture.onlyAdminTeamId,
            userId: fixture.soloUserId,
            role: TeamUserRole.ADMIN,
          }),
        ).resolves.toMatchObject({ success: true });

        await expect(
          fixture.teamRoleOf({
            userId: fixture.soloUserId,
            teamId: fixture.onlyAdminTeamId,
          }),
        ).resolves.toBe(TeamUserRole.ADMIN);
      });
    });
  });

  describe("when a team's only Admin role is held by a group with members", () => {
    /** @scenario A team administered only through a group accepts member edits */
    it("accepts a member edit from the team", async () => {
      // The SCIM shape: nobody holds a direct ADMIN binding on the team, the
      // group does. Guards that count only direct bindings read this team as
      // having no admin and refuse every edit.
      await prisma.roleBinding.updateMany({
        where: {
          organizationId: fixture.organizationId,
          userId: fixture.soloUserId,
          scopeType: RoleBindingScopeType.TEAM,
          scopeId: fixture.onlyAdminTeamId,
        },
        data: { role: TeamUserRole.VIEWER },
      });

      await fixture.withAdminGroupOn({
        teamId: fixture.onlyAdminTeamId,
        memberUserId: fixture.companionUserId,
        run: async () => {
          await expect(
            fixture.callerAsAdmin().organization.updateTeamMemberRole({
              teamId: fixture.onlyAdminTeamId,
              userId: fixture.soloUserId,
              role: TeamUserRole.MEMBER,
            }),
          ).resolves.toMatchObject({ success: true });

          await expect(
            fixture.teamRoleOf({
              userId: fixture.soloUserId,
              teamId: fixture.onlyAdminTeamId,
            }),
          ).resolves.toBe(TeamUserRole.MEMBER);
        },
      });
    });
  });
});
