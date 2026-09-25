import { guardOrganizationId } from "@langwatch/prisma-client";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import { PrismaMfaEnrollmentRepository } from "../prisma.mfa-enrollment.repository.ts";

/**
 * `findRequiringOrganizationSlugs` spans every org a person belongs to, so
 * `guardOrganizationId` (ADR-021) refuses it as a top-level `findMany` — what
 * broke Backoffice impersonation in production. The stub runs the REAL guard.
 */

function makeGuardedPrisma(person: unknown) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue(person) },
    organizationUser: {
      findMany: vi.fn(async (args: unknown) =>
        guardOrganizationId(
          { model: "OrganizationUser", action: "findMany", args },
          async () => [],
        ),
      ),
    },
  };
}

describe("PrismaMfaEnrollmentRepository", () => {
  describe("given the organization-tenancy guard is in force", () => {
    describe("when asked which of a person's organizations require a second factor", () => {
      it("answers with the slugs and issues no top-level OrganizationUser query", async () => {
        const prisma = makeGuardedPrisma({
          orgMemberships: [
            { organization: { slug: "acme" } },
            { organization: { slug: "globex" } },
          ],
        });
        const repository = PrismaMfaEnrollmentRepository.create(prismaDouble(prisma));

        const slugs = await repository.findRequiringOrganizationSlugs({
          userId: "user_1",
        });

        expect(slugs).toEqual(["acme", "globex"]);
        expect(prisma.organizationUser.findMany).not.toHaveBeenCalled();
        // A disabled seat holds no access, so it must not keep a factor switched on.
        expect(prisma.user.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({
            select: {
              orgMemberships: expect.objectContaining({
                where: { disabledAt: null, organization: { mfaRequired: true } },
              }),
            },
          }),
        );
      });

      it("answers empty for somebody the row lookup does not find", async () => {
        const prisma = makeGuardedPrisma(null);
        const repository = PrismaMfaEnrollmentRepository.create(prismaDouble(prisma));

        const slugs = await repository.findRequiringOrganizationSlugs({
          userId: "user_missing",
        });

        // Nobody's memberships is not the same as an error, and a person who
        // belongs to nothing requires nothing.
        expect(slugs).toEqual([]);
        expect(prisma.organizationUser.findMany).not.toHaveBeenCalled();
      });
    });
  });
});
