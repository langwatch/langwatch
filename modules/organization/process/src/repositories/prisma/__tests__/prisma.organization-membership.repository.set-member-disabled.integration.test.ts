import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
/**
 * Disable/re-enable flips disabledAt without touching role or department,
 * and refuses to disable the last active admin.
 * @vitest-environment node
 * @see specs/licensing/seat-reconciliation.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, type PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaOrganizationMembershipRepository } from "../prisma.organization-membership.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const noopGrantsWriter = createApiFixture<AuthzGrantsService>({
  attachBindings: async () => ({ attached: [], duplicates: [] }),
  revokeBindingsWhere: async () => 0,
});

describe.skipIf(!DB_URL)("PrismaOrganizationMembershipRepository.setMemberDisabled", () => {
  const testNamespace = `set-member-disabled-${nanoid(8)}`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger(
      "langwatch:organization:test:organization-membership-repository-set-member-disabled",
    ),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    grants: noopGrantsWriter,
  });

  let organizationId: string;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.department.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function seedOrg() {
    const seedNamespace = `${testNamespace}-${nanoid(8)}`;
    const organization = await prisma!.organization.create({
      data: { name: "Seat Reconciliation Org", slug: `--test-${seedNamespace}` },
    });
    organizationId = organization.id;
    organizationIds.push(organizationId);

    const department = await prisma!.department.create({
      data: { id: `dept-${nanoid(8)}`, organizationId, name: "Engineering" },
    });

    const [admin, secondAdmin, member] = await Promise.all([
      prisma!.user.create({ data: { email: `admin-${seedNamespace}@test.com`, name: "Admin" } }),
      prisma!.user.create({
        data: { email: `admin2-${seedNamespace}@test.com`, name: "Second Admin" },
      }),
      prisma!.user.create({ data: { email: `member-${seedNamespace}@test.com`, name: "Member" } }),
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
