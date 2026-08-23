/**
 * The tenant purge, seen from the tables it has to leave empty.
 *
 * Deleting an organization is the one path that has to know about EVERY row
 * keyed to it, and the authorization read model (Grant, GrantUsage, Role) is
 * the easiest one to forget: those rows carry organizationId as a plain
 * column and never a relation, so the database will not cascade them and a
 * missed one leaves a deleted tenant's access standing as the surviving head.
 *
 * The list this pins is the whole transaction, in order, for the same reason:
 * a refactor that trims the tail is invisible in a diff that only looks like
 * it removed two dead tables, and what it actually removes is the delete of
 * the organization itself.
 */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import type { GrantsLedgerWriter } from "~/server/app-layer/authz/ledger";
import { PrismaOrganizationRepository } from "../repositories/organization.prisma.repository";

const ORGANIZATION_ID = "org_acme";

function purgingPrisma() {
  const deletions: Array<{ model: string; where: Record<string, unknown> }> =
    [];
  const deleteManyFor = (model: string) =>
    vi.fn(({ where }: { where: Record<string, unknown> }) => {
      deletions.push({ model, where });
      return { model };
    });
  const models = [
    "roleBinding",
    "grantUsage",
    "grant",
    "role",
    "systemMigrationTenantState",
    "systemMigrationEnrollment",
    "apiKey",
    "promptTag",
    "team",
    "organization",
  ];
  const transaction = vi.fn((operations: unknown[]) =>
    Promise.resolve(operations),
  );
  const prisma = {
    ...Object.fromEntries(
      models.map((model) => [model, { deleteMany: deleteManyFor(model) }]),
    ),
    $transaction: transaction,
  } as unknown as PrismaClient;
  return { prisma, deletions, transaction };
}

describe("PrismaOrganizationRepository.deleteProvisionedOrganization", () => {
  describe("when a provisioned organization is purged", () => {
    it("deletes the grants ledger's projections along with the legacy rows", async () => {
      const { prisma, deletions } = purgingPrisma();
      const repository = new PrismaOrganizationRepository(
        prisma,
        {} as unknown as GrantsLedgerWriter,
      );

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
      const repository = new PrismaOrganizationRepository(
        prisma,
        {} as unknown as GrantsLedgerWriter,
      );

      await repository.deleteProvisionedOrganization(ORGANIZATION_ID);

      for (const deletion of deletions) {
        // The organization row itself is keyed by id, the migration state row
        // by the tenant id it tracks; everything else by the organization it
        // belongs to.
        expect(deletion.where).toEqual(
          deletion.model === "organization"
            ? { id: ORGANIZATION_ID }
            : deletion.model === "systemMigrationTenantState"
              ? { tenantId: ORGANIZATION_ID }
              : { organizationId: ORGANIZATION_ID },
        );
      }
    });

    it("purges everything in one transaction, so a half-purged tenant cannot survive", async () => {
      const { prisma, transaction, deletions } = purgingPrisma();
      const repository = new PrismaOrganizationRepository(
        prisma,
        {} as unknown as GrantsLedgerWriter,
      );

      await repository.deleteProvisionedOrganization(ORGANIZATION_ID);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(transaction.mock.calls[0]?.[0]).toHaveLength(deletions.length);
    });
  });
});
