/**
 * @vitest-environment node
 *
 * @see specs/licensing/seat-reconciliation.feature
 *
 * Moved from `organization.setMemberDisabled.integration.test.ts` on
 * platform/app. That file drove its assertions through the deleted
 * `appRouter`, the authz engine's `permissions.getDecision`, and the license
 * seat-counting service — none of which this package owns any more (the
 * seat counter moved to `@langwatch/entitlement-server`, the permission
 * decision to the authz package). What is left as this repository's own
 * invariant is the disable/re-enable write itself: it flips `disabledAt`
 * without touching role or department, and it refuses to take the last
 * active admin down.
 *
 * Requires LANGWATCH_TEST_DATABASE_URL. Skips cleanly without it so the
 * suite stays runnable on a box with no database.
 */
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, type PrismaClient } from "@langwatch/prisma-client/generated";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { PrismaOrganizationMembershipRepository } from "../prisma.organization-membership.repository";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const noopGrantsWriter = {
  attachBindings: async () => ({ attached: [], duplicates: [] }),
  revokeBindingsWhere: async () => 0,
} as unknown as AuthzGrantsService;

describe.skipIf(!DB_URL)("PrismaOrganizationMembershipRepository.setMemberDisabled", () => {
  let connection: PrismaConnection | undefined;
  let prisma: PrismaClient | undefined;
  let repository: PrismaOrganizationMembershipRepository;
  const testNamespace = `set-member-disabled-${nanoid(8)}`;

  connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  prisma = connection.client as PrismaClient;
  repository = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    grants: noopGrantsWriter,
  });

  let organizationId: string;
  const userIds: string[] = [];

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.department.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function seedOrg() {
    const organization = await prisma!.organization.create({
      data: { name: "Seat Reconciliation Org", slug: `--test-${testNamespace}` },
    });
    organizationId = organization.id;

    const department = await prisma!.department.create({
      data: { id: `dept-${nanoid(8)}`, organizationId, name: "Engineering" },
    });

    const [admin, secondAdmin, member] = await Promise.all([
      prisma!.user.create({ data: { email: `admin-${testNamespace}@test.com`, name: "Admin" } }),
      prisma!.user.create({
        data: { email: `admin2-${testNamespace}@test.com`, name: "Second Admin" },
      }),
      prisma!.user.create({ data: { email: `member-${testNamespace}@test.com`, name: "Member" } }),
    ]);
    userIds.push(admin.id, secondAdmin.id, member.id);

    await prisma!.organizationUser.createMany({
      data: [
        { userId: admin.id, organizationId, role: OrganizationUserRole.ADMIN },
        { userId: secondAdmin.id, organizationId, role: OrganizationUserRole.ADMIN },
        {
          userId: member.id,
          organizationId,
          role: OrganizationUserRole.MEMBER,
          departmentId: department.id,
        },
      ],
    });

    return { adminId: admin.id, secondAdminId: secondAdmin.id, memberId: member.id, department };
  }

  describe("when a member is disabled", () => {
    /** @scenario A disabled member loses access but keeps their record */
    it("leaves their role and department untouched, so nothing is rebuilt on re-enable", async () => {
      const { memberId, department } = await seedOrg();

      await repository.setMemberDisabled({ organizationId, userId: memberId, disabled: true });

      const membership = await prisma!.organizationUser.findUnique({
        where: { userId_organizationId: { userId: memberId, organizationId } },
        select: { role: true, departmentId: true, disabledAt: true },
      });

      expect(membership).toMatchObject({
        role: OrganizationUserRole.MEMBER,
        departmentId: department.id,
      });
      expect(membership?.disabledAt).toBeInstanceOf(Date);
    });
  });

  describe("when disabling would leave the organization without an admin", () => {
    /** @scenario Disabling the last admin is refused */
    it("refuses, so someone can always still sign in and fix it", async () => {
      const { adminId, secondAdminId } = await seedOrg();

      // Take the org down to a single active admin first.
      await repository.setMemberDisabled({
        organizationId,
        userId: secondAdminId,
        disabled: true,
      });

      await expect(
        repository.setMemberDisabled({ organizationId, userId: adminId, disabled: true }),
      ).rejects.toMatchObject({ code: "cannot_disable_last_admin" });

      const reread = await prisma!.organizationUser.findUnique({
        where: { userId_organizationId: { userId: adminId, organizationId } },
        select: { disabledAt: true },
      });
      expect(reread?.disabledAt).toBeNull();
    });
  });
});
