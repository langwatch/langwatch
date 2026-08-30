import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { guardOrganizationId } from "~/utils/dbOrganizationIdProtection";
import { PrismaMfaEnrollmentRepository } from "../mfa-enrollment.prisma.repository";

/**
 * `findRequiringOrganizationSlugs` asks which of ONE person's organizations
 * require a second factor. That question spans every organization they belong
 * to, so it has no single-organization predicate to offer and
 * `guardOrganizationId` (ADR-021) refuses to serve it as a top-level
 * `organizationUser.findMany` — the refusal being a thrown `Error`, which the
 * boundary degrades to a generic 500 rather than to a skipped check.
 *
 * The identical query shape in the Backoffice impersonation service did exactly
 * that in production. This read is reachable from `disableMfa`, behind
 * `MFA_ENROLLMENT_OPEN`, so it would have waited for the flag to do the same.
 *
 * The stub below therefore runs the REAL guard rather than answering: the
 * repository is expected to read the memberships nested off the person, which
 * never reaches that delegate at all, and a regression to the top-level query
 * fails here with the production error.
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
        const repository = new PrismaMfaEnrollmentRepository(
          prisma as unknown as PrismaClient,
        );

        const slugs = await repository.findRequiringOrganizationSlugs({
          userId: "user_1",
        });

        expect(slugs).toEqual(["acme", "globex"]);
        expect(prisma.organizationUser.findMany).not.toHaveBeenCalled();
      });

      it("answers empty for somebody the row lookup does not find", async () => {
        const prisma = makeGuardedPrisma(null);
        const repository = new PrismaMfaEnrollmentRepository(
          prisma as unknown as PrismaClient,
        );

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
