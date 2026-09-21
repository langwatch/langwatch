import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { guardProjectId } from "~/utils/dbMultiTenancyProtection";
import { PrismaSecretHealTenantSource } from "../secret-heal-tenant-source.prisma.repository";

/**
 * The raw-query half of the multitenancy guard reads the SQL TEXT, so nothing
 * upstream of a real client can tell you whether this query is allowed — and
 * a refusal here is not one tenant failing. `findTenantIdsAfter` is called by
 * the pass itself, so a throw rejects the whole pass, the boot preflight fails
 * and no process serves. This suite runs the real query through the real
 * guard rather than asserting on the text of the opt-out comment.
 */
function guardedPrisma(): {
  prisma: PrismaClient;
  queryRaw: ReturnType<typeof vi.fn>;
} {
  const queryRaw = vi.fn().mockResolvedValue([{ userId: "user-1" }]);
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

describe("given the secret heal asks which users it has work for", () => {
  describe("when the multitenancy guard reads the query", () => {
    /** @scenario "The heal pass enumerates only users whose legacy secrets could have drifted" */
    it("accepts the installation-wide scan rather than refusing the pass", async () => {
      const { prisma, queryRaw } = guardedPrisma();

      await expect(
        new PrismaSecretHealTenantSource(prisma).findTenantIdsAfter({
          cursor: null,
          limit: 100,
        }),
      ).resolves.toEqual(["user-1"]);
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it("refuses the same query without its opt-out, so the guard is really running", async () => {
      const { prisma } = guardedPrisma();
      const unannotated = prisma.$queryRaw as unknown as (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => Promise<unknown>;

      await expect(
        unannotated`SELECT DISTINCT a."userId" FROM "Account" a`,
      ).rejects.toThrow(/missing a tenancy predicate/);
    });
  });
});
