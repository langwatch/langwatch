import { guardProjectId } from "@langwatch/prisma-client";
import { describe, expect, it, vi } from "vitest";

import type { PrismaOrganizationTenantDatabase } from "../prisma.organization-tenant-source.repository.ts";
import { PrismaOrganizationTenantSourceRepository } from "../prisma.organization-tenant-source.repository.ts";
import type { PrismaUserTenantDatabase } from "../prisma.user-tenant-source.repository.ts";
import { PrismaUserTenantSourceRepository } from "../prisma.user-tenant-source.repository.ts";

/**
 * The guard's raw-query half reads the SQL TEXT, so only a real run says
 * whether these walks are allowed — and a refusal is not one tenant failing:
 * a throw rejects the pass, so no process serves.
 */

const walkedRows = {
  findMany: async () => [],
};

/** The `Sql` shape `db.ts` hands the guard — anything else makes it read
 *  nothing and wave the query through, proving nothing. */
function guardedPrisma(rows: unknown[]): {
  prisma: PrismaOrganizationTenantDatabase & PrismaUserTenantDatabase;
  queryRaw: ReturnType<typeof vi.fn>;
} {
  const queryRaw = vi.fn().mockResolvedValue(rows);

  return {
    prisma: {
      organization: walkedRows,
      user: walkedRows,
      $queryRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ): Promise<{ id: string }[]> => {
        let answered: { id: string }[] = [];
        await guardProjectId(
          {
            model: void 0,
            action: "queryRaw",
            args: { strings, values },
            dataPath: [],
            runInTransaction: false,
          } as never,
          async () => {
            answered = await queryRaw(strings, ...values);

            return answered;
          },
        );

        return answered;
      },
    },
    queryRaw,
  };
}

describe("given a pass asks which tenants still have work for its migrations", () => {
  /** @scenario "A pass may ask which tenants have work left across the whole installation" */
  it("accepts the installation-wide walk over users rather than refusing the pass", async () => {
    const { prisma, queryRaw } = guardedPrisma([{ id: "user-1" }]);

    await expect(
      PrismaUserTenantSourceRepository.create({ prisma })
        .pendingFor({ migrationNames: ["identity-identifier-backfill"] })
        .findTenantIdsAfter({ cursor: null, limit: 100 }),
    ).resolves.toEqual(["user-1"]);
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  /** @scenario "A pass may ask which tenants have work left across the whole installation" */
  it("accepts the installation-wide walk over organizations too", async () => {
    const { prisma, queryRaw } = guardedPrisma([{ id: "org-1" }]);

    await expect(
      PrismaOrganizationTenantSourceRepository.create({ prisma })
        .pendingFor({ migrationNames: ["authz-engine"] })
        .findTenantIdsAfter({ cursor: "org-0", limit: 100 }),
    ).resolves.toEqual(["org-1"]);
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  /** @scenario "A pass may ask which tenants have work left across the whole installation" */
  it("asks nothing at all when the pass drives no migrations", async () => {
    const { prisma, queryRaw } = guardedPrisma([{ id: "user-1" }]);

    await expect(
      PrismaUserTenantSourceRepository.create({ prisma })
        .pendingFor({ migrationNames: [] })
        .findTenantIdsAfter({ cursor: null, limit: 100 }),
    ).resolves.toEqual([]);
    await expect(
      PrismaOrganizationTenantSourceRepository.create({ prisma })
        .pendingFor({ migrationNames: [] })
        .findTenantIdsAfter({ cursor: null, limit: 100 }),
    ).resolves.toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
