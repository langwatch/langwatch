/** Tenant purge must clean all rows keyed to it, including non-cascading authorization tables. */

import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaOrganizationMembershipRepository } from "../prisma/prisma.organization-membership.repository.ts";

const ORGANIZATION_ID = "org_acme";

const expectedPurgeWhere = (model: string): Record<string, string> => {
  if (model === "organization") return { id: ORGANIZATION_ID };
  if (model === "systemMigrationTenantState") return { tenantId: ORGANIZATION_ID };
  return { organizationId: ORGANIZATION_ID };
};

function purgingPrisma() {
  const deletions: { model: string; where: unknown }[] = [];
  const deleting = (model: string) => ({
    deleteMany: vi.fn((args?: { where?: unknown }) => {
      deletions.push({ model, where: args?.where });
      return { model };
    }),
  });
  const transaction = vi.fn((operations: unknown) => Promise.resolve(operations));
  const prisma = prismaDouble({
    roleBinding: deleting("roleBinding"),
    grantUsage: deleting("grantUsage"),
    grant: deleting("grant"),
    role: deleting("role"),
    systemMigrationTenantState: deleting("systemMigrationTenantState"),
    systemMigrationEnrollment: deleting("systemMigrationEnrollment"),
    apiKey: deleting("apiKey"),
    promptTag: deleting("promptTag"),
    team: deleting("team"),
    organization: deleting("organization"),
    $transaction: transaction,
  });
  return { prisma, deletions, transaction };
}

describe("PrismaOrganizationMembershipRepository.deleteProvisionedOrganization", () => {
  describe("when a provisioned organization is purged", () => {
    it("deletes the grants ledger's projections along with the legacy rows", async () => {
      const { prisma, deletions } = purgingPrisma();
      const repository = PrismaOrganizationMembershipRepository.create({
        database: prisma,
        grants: createApiFixture<AuthzGrantsService>(),
      });

      await repository.deleteProvisionedOrganization(ORGANIZATION_ID);

      expect(deletions.map((deletion) => deletion.model)).toEqual([
        // Role bindings first: RoleBinding.apiKeyId restricts api-key deletion.
        "roleBinding",
        // Usage before the Grant row it accounts for.
        "grantUsage",
        "grant",
        "role",
        // The migration machinery's own per-tenant rows: nothing cascades
        // them either, and leaving them would keep a deleted tenant enrolled.
        "systemMigrationTenantState",
        "systemMigrationEnrollment",
        "apiKey",
        "promptTag",
        "team",
        "organization",
      ]);
    });

    it("scopes every delete to the organization being purged", async () => {
      const { prisma, deletions } = purgingPrisma();
      const repository = PrismaOrganizationMembershipRepository.create({
        database: prisma,
        grants: createApiFixture<AuthzGrantsService>(),
      });

      await repository.deleteProvisionedOrganization(ORGANIZATION_ID);

      for (const deletion of deletions) {
        // The organization row itself is keyed by id, the migration state row
        // by the tenant id it tracks; everything else by the organization it
        // belongs to.
        expect(deletion.where).toEqual(expectedPurgeWhere(deletion.model));
      }
    });

    it("purges everything in one transaction, so a half-purged tenant cannot survive", async () => {
      const { prisma, transaction, deletions } = purgingPrisma();
      const repository = PrismaOrganizationMembershipRepository.create({
        database: prisma,
        grants: createApiFixture<AuthzGrantsService>(),
      });

      await repository.deleteProvisionedOrganization(ORGANIZATION_ID);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(transaction.mock.calls[0]?.[0]).toHaveLength(deletions.length);
    });
  });
});
