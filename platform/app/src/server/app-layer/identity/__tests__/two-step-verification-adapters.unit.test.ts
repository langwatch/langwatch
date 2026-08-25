import { describe, expect, it, vi } from "vitest";

import type { GuardParams } from "~/utils/dbGuardMiddleware";
import { guardOrganizationId } from "~/utils/dbOrganizationIdProtection";

// The adapter reaches the two-factor plugin for its protocol half, which has
// no place in a test about a database read.
vi.mock("~/server/better-auth", () => ({ auth: {} }));

import type { PrismaClient } from "~/generated/prisma/client";
import { PrismaTwoStepAccount } from "../two-step-verification-adapters";

/**
 * The organizations that require two-step verification, read through the REAL
 * org-tenancy guard.
 *
 * The guard is the thing under test here as much as the query is: it is a
 * Prisma middleware, so a double that just returns rows proves nothing about
 * whether the real client would have accepted the call — and it did not. A
 * `findMany` over `OrganizationUser` keyed only by `userId` spans every
 * organization at once, which the guard refuses with a plain Error, and that
 * error took the whole two-step section of /settings/security down as
 * an unknown failure.
 *
 * So the double runs the guard the client runs, over the args the adapter
 * actually builds. Nothing here restates the guard's rule; it calls it.
 */
function guardedPrisma(rows: unknown[]): PrismaClient {
  const guarded =
    (model: string) =>
    async (args: unknown): Promise<unknown> =>
      guardOrganizationId(
        { model, action: "findMany", args } as GuardParams,
        async () => rows,
      );

  return {
    organization: { findMany: guarded("Organization") },
    organizationUser: { findMany: guarded("OrganizationUser") },
  } as unknown as PrismaClient;
}

describe("the organizations that require two-step verification", () => {
  describe("given a member of one organization that requires it", () => {
    it("names that organization, through a read the tenancy guard allows", async () => {
      const account = new PrismaTwoStepAccount(
        guardedPrisma([{ id: "org_acme", name: "Acme", slug: "acme" }]),
      );

      const requiring = await account.requiringOrganizations({
        userId: "user_sam",
      });

      expect(requiring).toEqual([
        { organizationId: "org_acme", name: "Acme", slug: "acme" },
      ]);
    });
  });

  describe("given the membership rows are asked for directly instead", () => {
    // The failure this suite exists for, made observable: the shape the
    // adapter used to build is refused before it reaches the database. The
    // assertion is on the guard's prose because a tenancy refusal is a plain
    // Error with no code to assert on — matched loosely, on the one word that
    // names the constraint rather than on the sentence around it.
    it("is refused by the tenancy guard, which is why the read is shaped the way it is", async () => {
      const prisma = guardedPrisma([]) as unknown as {
        organizationUser: { findMany: (args: unknown) => Promise<unknown> };
      };

      await expect(
        prisma.organizationUser.findMany({
          where: {
            userId: "user_sam",
            disabledAt: null,
            organization: { mfaRequired: true },
          },
        }),
      ).rejects.toThrow(/organizationId/);
    });
  });

  describe("given nobody requires it", () => {
    it("names nothing, and still does not raise", async () => {
      const account = new PrismaTwoStepAccount(guardedPrisma([]));

      await expect(
        account.requiringOrganizations({ userId: "user_sam" }),
      ).resolves.toEqual([]);
    });
  });
});
