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

import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
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
});
