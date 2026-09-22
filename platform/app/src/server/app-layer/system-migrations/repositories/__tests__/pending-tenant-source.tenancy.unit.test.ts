import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";

import { guardProjectId } from "~/utils/dbMultiTenancyProtection";
import { PrismaOrganizationTenantSource } from "../organization-tenant-source.prisma.repository";
import { PrismaUserTenantSource } from "../user-tenant-source.prisma.repository";

/**
 * The raw-query half of the multitenancy guard reads the SQL TEXT, so nothing
 * upstream of a real client can tell you whether these queries are allowed —
 * and a refusal is not one tenant failing. `findTenantIdsAfter` is called by
 * the pass itself, so a throw rejects the whole pass, the boot preflight fails
 * and no process serves. This suite runs the real queries through the real
 * guard rather than asserting on the text of the opt-out comment.
 *
 * Both queries carry a `-- @tenancy:` opt-out AND mention the state table's
 * own `tenantId` column, either of which satisfies the guard on its own. The
 * opt-out is the deliberate one: `tenantId` here is the axis a migration runs
 * on (a user id on one leg, an organization id on the other), never a scope,
 * so it must not be what carries the query.
 */
function guardedPrisma(rows: unknown[]): {
  prisma: PrismaClient;
  queryRaw: ReturnType<typeof vi.fn>;
} {
  const queryRaw = vi.fn().mockResolvedValue(rows);
  const prisma = {
    // `db.ts` hands the guard the `Sql` object Prisma builds from the tagged
    // template — `{ strings, values }` — and that shape is what the guard
    // reads the SQL text out of. Passing anything else makes it read nothing
    // and wave the query through, which is a test that proves nothing.
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) =>
      guardProjectId(
        {
          model: undefined,
          action: "queryRaw",
          args: { strings, values },
          dataPath: [],
          runInTransaction: false,
        } as never,
        async () => queryRaw(strings, ...values),
      ),
  } as unknown as PrismaClient;
  return { prisma, queryRaw };
}

describe("given a pass asks which tenants still have work for its migrations", () => {
  describe("when the multitenancy guard reads the user walk", () => {
    /** @scenario "A pass may ask which tenants have work left across the whole installation" */
    it("accepts the installation-wide walk rather than refusing the pass", async () => {
      const { prisma, queryRaw } = guardedPrisma([{ id: "user-1" }]);

      await expect(
        new PrismaUserTenantSource(prisma)
          .pendingFor({ migrationNames: ["identity-identifier-backfill"] })
          .findTenantIdsAfter({ cursor: null, limit: 100 }),
      ).resolves.toEqual(["user-1"]);
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the multitenancy guard reads the organization walk", () => {
    /** @scenario "A pass may ask which tenants have work left across the whole installation" */
    it("accepts the installation-wide walk rather than refusing the pass", async () => {
      const { prisma, queryRaw } = guardedPrisma([{ id: "org-1" }]);

      await expect(
        new PrismaOrganizationTenantSource(prisma)
          .pendingFor({ migrationNames: ["authz-engine"] })
          .findTenantIdsAfter({ cursor: null, limit: 100 }),
      ).resolves.toEqual(["org-1"]);
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a scope-less query carries neither an opt-out nor a tenancy column", () => {
    it("refuses it, so the guard is really running in this harness", async () => {
      const { prisma } = guardedPrisma([]);
      const unannotated = prisma.$queryRaw as unknown as (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<unknown>;

      await expect(
        unannotated`SELECT u."id" FROM "User" u ORDER BY u."id" ASC`,
      ).rejects.toThrow(/missing a tenancy predicate/);
    });
  });

  describe("when the installation runs none of the registered migrations", () => {
    /** @scenario "A pass with no migrations to drive visits nobody" */
    it("enumerates nobody without asking the database at all", async () => {
      const { prisma, queryRaw } = guardedPrisma([{ id: "user-1" }]);

      await expect(
        new PrismaUserTenantSource(prisma)
          .pendingFor({ migrationNames: [] })
          .findTenantIdsAfter({ cursor: null, limit: 100 }),
      ).resolves.toEqual([]);
      await expect(
        new PrismaOrganizationTenantSource(prisma)
          .pendingFor({ migrationNames: [] })
          .findTenantIdsAfter({ cursor: null, limit: 100 }),
      ).resolves.toEqual([]);
      expect(queryRaw).not.toHaveBeenCalled();
    });
  });
});
