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

import { PrismaOrganizationMembershipRepository } from "../prisma.organization-membership.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const LEDGER_DOWN = "grant ledger unavailable";

const failingGrantsWriter = createApiFixture<AuthzGrantsService>({
  attachBindings: async () => {
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

    let organizationId: string;
    let adminUserId: string;
    let payerUserId: string;

    beforeAll(async () => {
      organizationId = (
        await prisma.organization.create({ data: { name: "Billing Org", slug: `--test-${ns}` } })
      ).id;
      adminUserId = (await prisma.user.create({ data: { email: `admin-${ns}@acme.test` } })).id;
      payerUserId = (await prisma.user.create({ data: { email: `payer-${ns}@acme.test` } })).id;
      await prisma.organizationUser.createMany({
        data: [
          { userId: adminUserId, organizationId, role: OrganizationUserRole.ADMIN },
          {
            userId: payerUserId,
            organizationId,
            role: OrganizationUserRole.EXTERNAL,
            billingOnly: true,
          },
        ],
      });
    });

    afterAll(async () => {
      await cleanupTestRows(prisma, [
        ["organizationUser", { organizationId }],
        ["organization", { id: organizationId }],
        ["user", { id: { in: [adminUserId, payerUserId] } }],
      ]);
      await prisma.$disconnect();
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
  },
);
