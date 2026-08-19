/**
 * @vitest-environment node
 *
 * The team's last-admin guard under two removals landing at once.
 *
 * Read-then-write is the failure: both transactions see two admins, both pass
 * the guard, and both commit, leaving a team nobody administers. The removal
 * used to delete the binding rows inside the transaction, which is what made
 * the two collide; the bindings are ledger facts now and cannot be deleted in
 * there, so the conflict has to come from somewhere else. Driven against a
 * real database, because the failure only exists between two live
 * transactions.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { TeamService } from "../team.service";

describe("TeamService.removeMember", () => {
  const ns = `team-last-admin-${nanoid(8)}`;
  const service = new TeamService(prisma);

  let organizationId: string;
  let teamId: string;
  let firstAdminId: string;
  let secondAdminId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Team Last Admin Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: {
        name: "Shared Team",
        slug: `--test-team-${ns}`,
        organizationId,
      },
    });
    teamId = team.id;

    const [first, second] = await Promise.all([
      prisma.user.create({
        data: { email: `tadmin1-${ns}@example.com`, name: "First Admin" },
      }),
      prisma.user.create({
        data: { email: `tadmin2-${ns}@example.com`, name: "Second Admin" },
      }),
    ]);
    firstAdminId = first.id;
    secondAdminId = second.id;

    await prisma.organizationUser.createMany({
      data: [
        {
          userId: firstAdminId,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
        {
          userId: secondAdminId,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
      ],
    });
    await prisma.roleBinding.createMany({
      data: [firstAdminId, secondAdminId].map((userId) => ({
        organizationId,
        userId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.TEAM,
        scopeId: teamId,
      })),
    });
  });

  afterAll(async () => {
    if (!organizationId) return;
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["teamUser", { teamId }],
      ["organizationUser", { organizationId }],
      ["auditLog", { organizationId }],
      ["team", { organizationId }],
      ["user", { email: { contains: ns } }],
      ["organization", { id: organizationId }],
    ]);
  });

  describe("given the team has exactly two admins", () => {
    describe("when both are removed at the same time", () => {
      /** @scenario Two team admins removed at the same time cannot both succeed */
      it("refuses one of the two and leaves the team with an admin", async () => {
        const outcomes = await Promise.allSettled([
          service.removeMember({
            teamId,
            userId: firstAdminId,
            currentUserId: secondAdminId,
          }),
          service.removeMember({
            teamId,
            userId: secondAdminId,
            currentUserId: firstAdminId,
          }),
        ]);

        const refused = outcomes.filter(
          (outcome): outcome is PromiseRejectedResult =>
            outcome.status === "rejected",
        );
        expect(refused).toHaveLength(1);
        // The refusal is Postgres's own serialization failure (40001,
        // surfaced by Prisma as P2034), not a domain error the service
        // decided on — the two transactions both read two admins and both
        // pass the in-transaction guard; it is the team row's write-write
        // conflict that stops the second from committing. Asserting the
        // code, not just that something rejected, is what catches a
        // regression that lets an unrelated failure (a deadlock, a leaked
        // connection error) pass this test for the wrong reason.
        expect(refused[0]!.reason).toMatchObject({ code: "P2034" });

        const adminsLeft = await prisma.roleBinding.count({
          where: {
            organizationId,
            scopeType: RoleBindingScopeType.TEAM,
            scopeId: teamId,
            role: TeamUserRole.ADMIN,
          },
        });
        // Exactly one, not merely "at least one": that also passes if the
        // "winning" removal silently failed to remove anyone and both
        // admins are still standing.
        expect(adminsLeft).toBe(1);
      });
    });
  });
});
