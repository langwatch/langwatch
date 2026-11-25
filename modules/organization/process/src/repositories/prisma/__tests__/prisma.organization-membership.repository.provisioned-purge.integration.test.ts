import type { AuthzGrantsService } from "@langwatch/authz-contract";
/**
 * A provisioned-organization purge removes its memberships: they do not cascade.
 * @vitest-environment node
 * @see specs/organizations/organizations-provisioning-rest-api.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, TeamUserRole } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaOrganizationMembershipRepository } from "../prisma.organization-membership.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

const noopGrantsWriter = createApiFixture<AuthzGrantsService>({
  attachBindings: async () => ({ attached: [], duplicates: [] }),
  revokeBindingsWhere: async () => 0,
});

describe.skipIf(!DB_URL)(
  "PrismaOrganizationMembershipRepository.deleteProvisionedOrganization",
  () => {
    const testNamespace = `provisioned-purge-${nanoid(8)}`;

    const connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:organization:test:provisioned-purge"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    const prisma = connection.client;
    const repository = PrismaOrganizationMembershipRepository.create({
      database: prisma,
      cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
      grants: noopGrantsWriter,
    });

    let organizationId = "";
    let userId = "";

    afterAll(async () => {
      await cleanupTestRows(prisma, [
        ["teamUser", { userId }],
        ["organizationUser", { organizationId }],
        ["team", { organizationId }],
        ["organization", { id: organizationId }],
        ["user", { id: userId }],
      ]);
      await prisma.$disconnect();
    });

    describe("given a provisioned organization with a member of it and of its team", () => {
      /** @scenario Rolling back a provisioned organization removes its memberships */
      it("removes both memberships along with the organization and its team", async () => {
        const organization = await prisma.organization.create({
          data: { name: "Provisioned Org", slug: `--test-org-${testNamespace}` },
        });
        organizationId = organization.id;
        const team = await prisma.team.create({
          data: { name: "Provisioned Team", slug: `--test-team-${testNamespace}`, organizationId },
        });
        const user = await prisma.user.create({
          data: { name: "Member", email: `member-${testNamespace}@example.com` },
        });
        userId = user.id;
        await prisma.organizationUser.create({
          data: { userId, organizationId, role: OrganizationUserRole.ADMIN },
        });
        await prisma.teamUser.create({
          data: { userId, teamId: team.id, role: TeamUserRole.ADMIN },
        });

        await repository.deleteProvisionedOrganization(organizationId);

        expect(await prisma.organizationUser.count({ where: { organizationId } })).toBe(0);
        expect(await prisma.teamUser.count({ where: { teamId: team.id } })).toBe(0);
        expect(await prisma.team.count({ where: { organizationId } })).toBe(0);
        expect(await prisma.organization.findUnique({ where: { id: organizationId } })).toBeNull();
      });
    });
  },
);
