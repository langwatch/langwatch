import type { AuthzGrantsService } from "@langwatch/authz-contract";
/**
 * A role change whose grant correction fails puts a Billing-only member back as they were.
 * @vitest-environment node
 * @see ../../../../../../../specs/licensing/billing-only-invite.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, type PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FakeAuthzGrantsService } from "../../../features/invite/services/__tests__/support/invite-fakes.ts";
import { PrismaOrganizationMembershipRepository } from "../prisma.organization-membership.repository.ts";
import { PrismaOrganizationSeatRepository } from "../prisma.organization-seat.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const LEDGER_DOWN = "grant ledger unavailable";

/** Runs before the ledger fails: a write that lands while the role change is in flight. */
let writeDuringLedgerCall: () => Promise<void> = async () => {};

const failingGrantsWriter = createApiFixture<AuthzGrantsService>({
  attachBindings: async () => {
    await writeDuringLedgerCall();
    throw new Error(LEDGER_DOWN);
  },
  changeBindingRole: async () => {
    throw new Error(LEDGER_DOWN);
  },
  revokeBindings: async () => {
    throw new Error(LEDGER_DOWN);
  },
  revokeBindingsWhere: async () => {
    throw new Error(LEDGER_DOWN);
  },
});

describe.skipIf(!DB_URL)(
  "PrismaOrganizationMembershipRepository.updateMemberRole, a Billing-only member",
  () => {
    const ns = `billing-only-compensation-${nanoid(8)}`;
    const connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:organization:test:billing-only-compensation"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    const prisma = connection.client as PrismaClient;
    const repository = PrismaOrganizationMembershipRepository.create({
      database: prisma,
      cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
      grants: failingGrantsWriter,
    });

    const seats = PrismaOrganizationSeatRepository.create(prisma);
    let organizationId: string;
    let adminUserId: string;
    let payerUserId: string;
    let movedPayerUserId: string;
    let departmentPayerUserId: string;

    beforeAll(async () => {
      organizationId = (
        await prisma.organization.create({ data: { name: "Billing Org", slug: `--test-${ns}` } })
      ).id;
      adminUserId = (await prisma.user.create({ data: { email: `admin-${ns}@acme.test` } })).id;
      payerUserId = (await prisma.user.create({ data: { email: `payer-${ns}@acme.test` } })).id;
      movedPayerUserId = (
        await prisma.user.create({ data: { email: `moved-payer-${ns}@acme.test` } })
      ).id;
      departmentPayerUserId = (
        await prisma.user.create({ data: { email: `department-payer-${ns}@acme.test` } })
      ).id;
      await prisma.organizationUser.createMany({
        data: [
          { userId: adminUserId, organizationId, role: OrganizationUserRole.ADMIN },
          {
            userId: payerUserId,
            organizationId,
            role: OrganizationUserRole.EXTERNAL,
            billingOnly: true,
          },
          {
            userId: movedPayerUserId,
            organizationId,
            role: OrganizationUserRole.EXTERNAL,
            billingOnly: true,
          },
          {
            userId: departmentPayerUserId,
            organizationId,
            role: OrganizationUserRole.EXTERNAL,
            billingOnly: true,
          },
        ],
      });
    });

    afterAll(async () => {
      await cleanupTestRows(prisma, [
        ["organizationSeatLease", { organizationId }],
        ["organizationUser", { organizationId }],
        ["department", { organizationId }],
        ["organization", { id: organizationId }],
        [
          "user",
          { id: { in: [adminUserId, payerUserId, movedPayerUserId, departmentPayerUserId] } },
        ],
      ]);
      await prisma.$disconnect();
    });

    describe("when the members are listed page by page", () => {
      it("marks the Billing-only member apart from a Lite member", async () => {
        const { members } = await repository.listAllMembers({
          organizationId,
          includeDisabled: true,
          offset: 0,
          limit: 50,
        });

        expect(members.find((member) => member.userId === movedPayerUserId)?.billingOnly).toBe(
          true,
        );
        expect(members.find((member) => member.userId === adminUserId)?.billingOnly).toBe(false);
      });
    });

    describe("given the grant correction after a role change fails", () => {
      it("refuses the change and leaves the member Billing only", async () => {
        await expect(
          repository.updateMemberRole({
            caller: { type: "system" },
            organizationId,
            userId: payerUserId,
            role: OrganizationUserRole.MEMBER,
            effectiveTeamRoleUpdates: [],
            currentUserId: adminUserId,
          }),
        ).rejects.toThrow(LEDGER_DOWN);

        const reread = await prisma.organizationUser.findUnique({
          where: { userId_organizationId: { userId: payerUserId, organizationId } },
        });
        expect(reread).toMatchObject({ role: OrganizationUserRole.EXTERNAL, billingOnly: true });
      });
    });

    describe("given another write lands on the membership before the correction fails", () => {
      it("keeps that later write instead of restoring Billing only", async () => {
        writeDuringLedgerCall = async () => {
          await prisma.organizationUser.update({
            where: { userId_organizationId: { userId: payerUserId, organizationId } },
            data: { role: OrganizationUserRole.MEMBER, billingOnly: false },
          });
        };

        await expect(
          repository.updateMemberRole({
            caller: { type: "system" },
            organizationId,
            userId: payerUserId,
            role: OrganizationUserRole.MEMBER,
            effectiveTeamRoleUpdates: [],
            currentUserId: adminUserId,
          }),
        ).rejects.toThrow(LEDGER_DOWN);
        writeDuringLedgerCall = async () => {};

        const reread = await prisma.organizationUser.findUnique({
          where: { userId_organizationId: { userId: payerUserId, organizationId } },
        });
        expect(reread).toMatchObject({ role: OrganizationUserRole.MEMBER, billingOnly: false });
      });
    });

    describe("given only a department edit lands before the correction fails", () => {
      it("still restores Billing only and keeps the department", async () => {
        const departmentId = (
          await prisma.department.create({ data: { organizationId, name: `Finance ${ns}` } })
        ).id;
        writeDuringLedgerCall = async () => {
          await repository.assignMemberDepartment({
            organizationId,
            userId: departmentPayerUserId,
            departmentId,
          });
        };

        await expect(
          repository.updateMemberRole({
            caller: { type: "system" },
            organizationId,
            userId: departmentPayerUserId,
            role: OrganizationUserRole.MEMBER,
            effectiveTeamRoleUpdates: [],
            currentUserId: adminUserId,
          }),
        ).rejects.toThrow(LEDGER_DOWN);
        writeDuringLedgerCall = async () => {};

        const reread = await prisma.organizationUser.findUnique({
          where: { userId_organizationId: { userId: departmentPayerUserId, organizationId } },
        });
        expect(reread).toMatchObject({
          role: OrganizationUserRole.EXTERNAL,
          billingOnly: true,
          departmentId,
        });
      });
    });

    describe("given an admin moves a Billing-only member to the Member role", () => {
      /** @scenario "A role change clears Billing only and the new role is metered" */
      it("clears Billing only and counts them in the member seats", async () => {
        const working = PrismaOrganizationMembershipRepository.create({
          database: prisma,
          cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
          grants: new FakeAuthzGrantsService(),
        });
        const before = await seats.countMemberSeats(organizationId);

        await working.updateMemberRole({
          caller: { type: "system" },
          organizationId,
          userId: movedPayerUserId,
          role: OrganizationUserRole.MEMBER,
          effectiveTeamRoleUpdates: [],
          currentUserId: adminUserId,
        });

        const reread = await prisma.organizationUser.findUnique({
          where: { userId_organizationId: { userId: movedPayerUserId, organizationId } },
        });
        expect(reread).toMatchObject({ role: OrganizationUserRole.MEMBER, billingOnly: false });
        const after = await seats.countMemberSeats(organizationId);
        expect(after.fullMembers).toBe(before.fullMembers + 1);
      });
    });
  },
);
