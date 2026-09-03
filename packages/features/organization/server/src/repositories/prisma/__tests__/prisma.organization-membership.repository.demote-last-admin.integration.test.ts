/**
 * @vitest-environment node
 *
 * @see specs/licensing/seat-reconciliation.feature
 *
 * Moved from `organization.member-roles.planLimit.integration.test.ts` on
 * platform/app, whose real subject was the plan-limit gate exercised through
 * the deleted `appRouter` — a process-owned tRPC boundary this package does
 * not own. The one scenario that belongs here is the repository's own
 * invariant: demoting the organization's last ADMIN is refused before any
 * plan check runs.
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

describe.skipIf(!DB_URL)(
  "PrismaOrganizationMembershipRepository.updateMemberRole — last admin guard",
  () => {
    let connection: PrismaConnection | undefined;
    let prisma: PrismaClient | undefined;
    let repository: PrismaOrganizationMembershipRepository;
    const testNamespace = `demote-last-admin-${nanoid(8)}`;

    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
    repository = PrismaOrganizationMembershipRepository.create({
      database: prisma,
      grants: noopGrantsWriter,
    });

    let organizationId: string;
    let adminUserId: string;

    afterAll(async () => {
      if (!prisma) return;
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.user.deleteMany({ where: { id: adminUserId } });
      await prisma.$disconnect();
    });

    describe("given the organization's only ADMIN", () => {
      /** @scenario Demoting the last admin is refused */
      it("refuses, so someone can always still sign in and fix it", async () => {
        const organization = await prisma!.organization.create({
          data: { name: "Last Admin Org", slug: `--test-org-${testNamespace}` },
        });
        organizationId = organization.id;

        const admin = await prisma!.user.create({
          data: { name: "Admin User", email: `admin-${testNamespace}@example.com` },
        });
        adminUserId = admin.id;

        await prisma!.organizationUser.create({
          data: {
            userId: adminUserId,
            organizationId,
            role: OrganizationUserRole.ADMIN,
          },
        });

        await expect(
          repository.updateMemberRole({
            organizationId,
            userId: adminUserId,
            role: OrganizationUserRole.MEMBER,
            effectiveTeamRoleUpdates: [],
            currentUserId: adminUserId,
          }),
        ).rejects.toMatchObject({ code: "cannot_demote_last_admin" });

        // And the admin seat is genuinely untouched.
        const reread = await prisma!.organizationUser.findUnique({
          where: { userId_organizationId: { userId: adminUserId, organizationId } },
          select: { role: true },
        });
        expect(reread?.role).toBe(OrganizationUserRole.ADMIN);
      });
    });
  },
);
