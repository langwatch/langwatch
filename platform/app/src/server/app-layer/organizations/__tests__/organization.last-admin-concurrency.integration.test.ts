/**
 * @vitest-environment node
 *
 * @see specs/organizations/organization-members-rest-api.feature
 *
 * The last-admin guard has to survive two offboarding runs landing at once,
 * which is exactly what a count-then-delete cannot do: under read-committed
 * both transactions count two admins, both pass the guard, and both commit,
 * leaving an organization nobody can sign in to and no way back from inside
 * the product. Driven against the real repository and a real database,
 * because the failure only exists between two live transactions.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrganizationUserRole } from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { PrismaOrganizationRepository } from "../repositories/organization.prisma.repository";

describe("PrismaOrganizationRepository.deleteMember", () => {
  const ns = `last-admin-${nanoid(8)}`;
  const repo = new PrismaOrganizationRepository(prisma);

  let organizationId: string;
  let firstAdminId: string;
  let secondAdminId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Last Admin Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    const [first, second] = await Promise.all([
      prisma.user.create({
        data: { email: `admin1-${ns}@example.com`, name: "First Admin" },
      }),
      prisma.user.create({
        data: { email: `admin2-${ns}@example.com`, name: "Second Admin" },
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
  });

  afterAll(async () => {
    if (!organizationId) return;
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["organizationUser", { organizationId }],
      ["user", { email: { contains: ns } }],
      ["organization", { id: organizationId }],
    ]);
  });

  describe("given the organization has exactly two active admins", () => {
    /** @scenario Two admins removed at the same time cannot both succeed */
    it("refuses one of two simultaneous removals and keeps an admin", async () => {
      const outcomes = await Promise.allSettled([
        repo.deleteMember({ organizationId, userId: firstAdminId }),
        repo.deleteMember({ organizationId, userId: secondAdminId }),
      ]);

      const refused = outcomes.filter(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === "rejected",
      );
      expect(refused).toHaveLength(1);
      expect(refused[0]!.reason).toMatchObject({
        code: "cannot_remove_last_admin",
      });

      const remainingAdmins = await prisma.organizationUser.count({
        where: {
          organizationId,
          role: OrganizationUserRole.ADMIN,
          disabledAt: null,
        },
      });
      expect(remainingAdmins).toBe(1);
    });
  });
});
