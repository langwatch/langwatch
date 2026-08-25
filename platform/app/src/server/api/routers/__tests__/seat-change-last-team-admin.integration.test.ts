/**
 * @vitest-environment node
 *
 * A seat decision, and the team whose only admin it takes away.
 *
 * Correcting somebody down to a Lite Member seat sets their role in every shared
 * team to Viewer, and the last-admin guard used to refuse that whenever they were
 * a team's only admin. The refusal was raised inside the transaction that also
 * carried the organization role change, so nothing was saved at all: the seat the
 * admin was trying to change stayed exactly as it was, and no amount of editing
 * the member's access first helped, because the seat change is applied before it
 * and always read the roles as they still were.
 *
 * It goes through now. The guard exists so a team is never left with nobody who
 * can administer it, and that is not what this produces: an ORGANIZATION-scoped
 * ADMIN binding grants team permissions in every shared team, which the last case
 * here proves rather than assumes. What the decision changed is reported back, so
 * the admin who made it is not left to discover it.
 *
 * What a seat correction is still not allowed to do lives in
 * `seat-change-team-admin-guard.integration.test.ts`, against the same fixture.
 *
 * Requires: PostgreSQL database (Prisma)
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import { prisma } from "../../../db";
import { hasTeamPermission } from "../../rbac";
import {
  createSeatChangeFixture,
  type SeatChangeFixture,
} from "./seatChangeLastTeamAdminFixture";

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

let fixture: SeatChangeFixture;

const moveSoloUserTo = (role: OrganizationUserRole) =>
  fixture.callerAsAdmin().organization.updateMemberRole({
    organizationId: fixture.organizationId,
    userId: fixture.soloUserId,
    role,
  });

describe("given a member who is the only admin of shared teams", () => {
  beforeAll(async () => {
    fixture = await createSeatChangeFixture({
      prisma,
      ns: `seat-admin-${nanoid(8)}`,
    });
  });

  beforeEach(() => fixture.resetMemberships());

  afterAll(() => fixture.cleanup());

  describe("when an organization admin moves them to a Lite Member seat", () => {
    /** @scenario Moving the only admin of a shared team to a Lite Member seat goes through */
    it("saves the seat change", async () => {
      await expect(moveSoloUserTo(OrganizationUserRole.EXTERNAL)).resolves.toMatchObject({
        success: true,
      });

      await expect(fixture.organizationRoleOfSoloUser()).resolves.toBe(
        OrganizationUserRole.EXTERNAL,
      );
    });

    /** @scenario Moving the only admin of a shared team to a Lite Member seat goes through */
    it("corrects their role on that team to viewer", async () => {
      await moveSoloUserTo(OrganizationUserRole.EXTERNAL);

      await expect(
        fixture.teamRoleOf({
          userId: fixture.soloUserId,
          teamId: fixture.onlyAdminTeamId,
        }),
      ).resolves.toBe(TeamUserRole.VIEWER);
    });

    /** @scenario The teams left without a team admin are named back to the admin */
    it("names every team left without a team admin", async () => {
      const result = await moveSoloUserTo(OrganizationUserRole.EXTERNAL);

      expect(result.teamsLeftWithoutAdmin.map((team) => team.id).sort()).toEqual(
        [fixture.onlyAdminTeamId, fixture.alsoOnlyAdminTeamId].sort(),
      );
    });

    /** @scenario The teams left without a team admin are named back to the admin */
    it("names them the way their admin reads them", async () => {
      const result = await moveSoloUserTo(OrganizationUserRole.EXTERNAL);

      // The id is for the client to key off; the name is the only part a person
      // can act on, so a report carrying one without the other is not a report.
      expect(result.teamsLeftWithoutAdmin).toEqual(
        expect.arrayContaining([
          { id: fixture.onlyAdminTeamId, name: fixture.onlyAdminTeamName },
        ]),
      );
    });

    /** @scenario The teams left without a team admin are named back to the admin */
    it("leaves out a team that still has another admin", async () => {
      const result = await moveSoloUserTo(OrganizationUserRole.EXTERNAL);

      expect(result.teamsLeftWithoutAdmin.map((team) => team.id)).not.toContain(
        fixture.sharedWithAnotherAdminTeamId,
      );
    });

    /** @scenario Moving a member to a Lite Member seat corrects their project access rows to Viewer */
    it("corrects their access on a shared project to viewer", async () => {
      await moveSoloUserTo(OrganizationUserRole.EXTERNAL);

      await expect(
        fixture.projectBindingOf({
          userId: fixture.soloUserId,
          projectId: fixture.sharedProjectId,
        }),
      ).resolves.toEqual({ role: TeamUserRole.VIEWER, customRoleId: null });
    });

    /** @scenario Moving a member to a Lite Member seat corrects their project access rows to Viewer */
    it("leaves project access as it is on the way back to a full seat", async () => {
      await moveSoloUserTo(OrganizationUserRole.EXTERNAL);
      await moveSoloUserTo(OrganizationUserRole.MEMBER);

      // The downgrade corrects; the upgrade grants nothing back on its own.
      await expect(
        fixture.projectBindingOf({
          userId: fixture.soloUserId,
          projectId: fixture.sharedProjectId,
        }),
      ).resolves.toEqual({ role: TeamUserRole.VIEWER, customRoleId: null });
    });

    /** @scenario A seat correction leaves the personal workspace access row alone */
    it("leaves the personal workspace rows untouched", async () => {
      await moveSoloUserTo(OrganizationUserRole.EXTERNAL);

      await expect(
        fixture.teamRoleOf({
          userId: fixture.soloUserId,
          teamId: fixture.personalTeamId,
        }),
      ).resolves.toBe(TeamUserRole.ADMIN);
    });

    /** @scenario The teams left without a team admin are named back to the admin */
    it("leaves out a team a group with members still administers", async () => {
      await fixture.withAdminGroupOn({
        teamId: fixture.onlyAdminTeamId,
        memberUserId: fixture.companionUserId,
        run: async () => {
          const result = await moveSoloUserTo(OrganizationUserRole.EXTERNAL);

          const reportedIds = result.teamsLeftWithoutAdmin.map((team) => team.id);
          expect(reportedIds).not.toContain(fixture.onlyAdminTeamId);
          // The sibling team has no group covering it, so the report still
          // fires where nobody is actually left.
          expect(reportedIds).toContain(fixture.alsoOnlyAdminTeamId);
        },
      });
    });

    /** @scenario Moving the only admin of a shared team to a Lite Member seat goes through */
    it("leaves the team administered by the organization's admins", async () => {
      await moveSoloUserTo(OrganizationUserRole.EXTERNAL);

      // The whole reason this is allowed. If an organization admin could not
      // administer a team whose last team-scoped admin is gone, the guard would
      // be protecting something real and refusing would be correct.
      await expect(
        hasTeamPermission(
          {
            prisma,
            session: {
              user: {
                id: fixture.adminUserId,
                name: "Org Admin",
                email: fixture.adminEmail,
              },
              expires: "1",
            } as any,
          },
          fixture.onlyAdminTeamId,
          "team:manage",
        ),
      ).resolves.toBe(true);
    });

    /** @scenario Moving the only admin of a shared team to a Lite Member seat goes through */
    it("takes them back to a full seat without a repair step", async () => {
      await moveSoloUserTo(OrganizationUserRole.EXTERNAL);
      await moveSoloUserTo(OrganizationUserRole.ADMIN);

      // An organization ADMIN keeps whatever team roles they hold, so the
      // correction is not undone here; what matters is that the round trip is
      // not refused now that the team has no other admin.
      await expect(fixture.organizationRoleOfSoloUser()).resolves.toBe(
        OrganizationUserRole.ADMIN,
      );
    });
  });
});
