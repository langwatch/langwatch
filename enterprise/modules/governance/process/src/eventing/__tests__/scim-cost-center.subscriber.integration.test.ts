// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * SCIM's cost-center fact -> department assignment against real Postgres, over governance's
 * own department service. Spec: specs/ai-gateway/governance/departments.feature
 */
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDepartmentTestService } from "../../__tests__/testing.ts";
import { assignScimCostCenterDepartment } from "../scim-cost-center.subscriber.ts";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createLogger("langwatch:governance:test:scim-cost-center"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;
const prisma = connection?.client as PrismaClient;

describe.skipIf(!databaseUrl)("SCIM cost-center facts landing as departments", () => {
  const ns = `scim-dept-${nanoid(8)}`;
  const ORG_ID = `org-${ns}`;

  const memberDepartments = createApiFixture<OrganizationApi>({
    findMembersWithDepartments: ({ organizationId }) =>
      prisma.organizationUser.findMany({
        where: { organizationId },
        select: { userId: true, departmentId: true, user: { select: { name: true, email: true } } },
      }),
    assignMemberDepartment: async ({ organizationId, userId, departmentId }) =>
      (
        await prisma.organizationUser.updateMany({
          where: { organizationId, userId },
          data: { departmentId },
        })
      ).count > 0,
  });
  const departments = () => createDepartmentTestService(prisma, memberDepartments);

  /** What SCIM records for one push: the member, joined first, and its cost center. */
  const deliver = async (email: string, costCenter: string | null) => {
    const user = await prisma.user.upsert({
      where: { email },
      create: { name: "Test User", email },
      update: {},
    });
    await prisma.organizationUser.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: ORG_ID } },
      create: { userId: user.id, organizationId: ORG_ID, role: "MEMBER" },
      update: {},
    });
    const service = departments();
    await assignScimCostCenterDepartment({
      departments: {
        departmentResolveByNameOrCreate: (input) => service.resolveByNameOrCreate(input),
        departmentAssignUser: (input) => service.assignUser(input),
      },
    })({ organizationId: ORG_ID, userId: user.id, costCenter });
  };

  const membershipFor = async (email: string) => {
    const user = await prisma.user.findFirstOrThrow({ where: { email } });

    return prisma.organizationUser.findUniqueOrThrow({
      where: { userId_organizationId: { userId: user.id, organizationId: ORG_ID } },
    });
  };

  beforeAll(async () => {
    await prisma.organization.create({ data: { id: ORG_ID, name: ns, slug: ORG_ID } });
  }, 60_000);

  afterAll(async () => {
    await prisma.department.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({ where: { email: { contains: ns } } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  });

  describe("given an org that provisions users through SCIM", () => {
    /** @scenario A SCIM-provisioned user is assigned from the enterprise costCenter attribute */
    it("assigns the user to the named department carried on the enterprise extension", async () => {
      const engineering = await departments().create({
        organizationId: ORG_ID,
        name: "Engineering",
      });
      const email = `${ns}-eng@example.com`;

      await deliver(email, "Engineering");

      const membership = await membershipFor(email);
      expect(membership.departmentId).toBe(engineering.id);
    });

    /** @scenario An unrecognized SCIM costCenter creates the department on first use */
    it("creates a department the first time SCIM references it, then assigns it", async () => {
      const email = `${ns}-research@example.com`;

      const before = await prisma.department.findFirst({
        where: { organizationId: ORG_ID, name: "Research", archivedAt: null },
      });
      expect(before).toBeNull();

      await deliver(email, "Research");

      const created = await prisma.department.findFirstOrThrow({
        where: { organizationId: ORG_ID, name: "Research", archivedAt: null },
      });
      const membership = await membershipFor(email);
      expect(membership.departmentId).toBe(created.id);
    });

    /** @scenario Updating the SCIM costCenter reassigns the user */
    it("replaces the prior assignment when a later fact names another cost center", async () => {
      const marketing = await departments().create({ organizationId: ORG_ID, name: "Marketing" });
      const email = `${ns}-move@example.com`;
      await deliver(email, "Engineering");

      await deliver(email, "Marketing");

      const membership = await membershipFor(email);
      expect(membership.departmentId).toBe(marketing.id);
    });

    /** @scenario Clearing the SCIM costCenter unassigns the user */
    it("clears the assignment when a fact clears the cost center", async () => {
      const email = `${ns}-clear@example.com`;
      await deliver(email, "Engineering");

      await deliver(email, null);

      const membership = await membershipFor(email);
      expect(membership.departmentId).toBeNull();
    });
  });
});
