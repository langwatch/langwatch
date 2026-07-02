import type { Organization, User } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaOrganizationRepository } from "../repositories/organization.prisma.repository";

/**
 * Regression test for issue #5278.
 *
 * `PrismaOrganizationRepository.getAllForUser` runs a `findMany` on
 * `Organization` with no `orderBy`, so Postgres/Prisma make no guarantee
 * about the order of the returned rows. Client code
 * (`useOrganizationTeamProject.ts`) falls back to `organizations.data[0]`
 * as the user's "current org" whenever `localStorage`'s
 * `selectedOrganizationId` doesn't match a real membership — and that
 * fallback feeds the `release_ui_ai_governance_enabled` feature-flag
 * check on `/me` and `/governance`. Without a deterministic order, which
 * org lands in slot 0 (and therefore which org's flags gate those pages)
 * is effectively random.
 *
 * This test seeds two orgs with `OrganizationUser` membership rows
 * inserted in one order (orgB first, orgA second) but with `createdAt`
 * timestamps that disagree with that insertion order (orgA joined a day
 * before orgB). It only passes if `getAllForUser` actually orders
 * organizations by the user's membership `createdAt` (earliest first)
 * rather than relying on incidental physical/insertion order.
 */
describe("PrismaOrganizationRepository — membership order determinism (#5278)", () => {
  let repository: PrismaOrganizationRepository;
  let orgA: Organization;
  let orgB: Organization;
  let testUser: User;
  const testNamespace = `membership-order-${nanoid(8)}`;

  beforeAll(async () => {
    repository = new PrismaOrganizationRepository(prisma);

    testUser = await prisma.user.create({
      data: {
        email: `membership-order-test-${testNamespace}@example.com`,
        name: `Test User ${testNamespace}`,
      },
    });

    // NOTE: `getAllForUser` queries `Organization.findMany` directly (not
    // via `OrganizationUser`), so an unordered Postgres result tends to
    // follow the *Organization* row's own insertion/physical order — not
    // just the `OrganizationUser` membership row order. Create orgB's
    // Organization row FIRST (and orgA's SECOND) so physical/insertion
    // order for the queried table also disagrees with the correct
    // (createdAt-based) answer; otherwise the assertion below could pass
    // by accident of Organization row order rather than because the
    // repository actually orders by membership createdAt.
    orgB = await prisma.organization.create({
      data: {
        name: `Org B ${testNamespace}`,
        slug: `org-b-${testNamespace}`,
      },
    });

    orgA = await prisma.organization.create({
      data: {
        name: `Org A ${testNamespace}`,
        slug: `org-a-${testNamespace}`,
      },
    });

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Insert orgB's membership FIRST (so naive insertion/physical order
    // would put orgB first), but give it the LATER createdAt.
    await prisma.organizationUser.create({
      data: {
        userId: testUser.id,
        organizationId: orgB.id,
        role: "ADMIN",
        createdAt: now,
      },
    });

    // Insert orgA's membership SECOND, but give it the EARLIER createdAt —
    // orgA is the user's actual first-joined org.
    await prisma.organizationUser.create({
      data: {
        userId: testUser.id,
        organizationId: orgA.id,
        role: "ADMIN",
        createdAt: oneDayAgo,
      },
    });
  });

  afterAll(async () => {
    await prisma.organizationUser.deleteMany({
      where: {
        userId: testUser.id,
        organizationId: { in: [orgA.id, orgB.id] },
      },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: [orgA.id, orgB.id] } },
    });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  describe("when a user belongs to multiple organizations", () => {
    it("returns the earlier-joined organization (orgA) first, regardless of membership row insertion order", async () => {
      const result = await repository.getAllForUser({
        userId: testUser.id,
        isDemo: false,
        demoProjectUserId: "",
        demoProjectId: "",
      });

      expect(result[0]?.id).toBe(orgA.id);
    });
  });

  describe("when a user's membership createdAt is exactly identical across organizations", () => {
    let tieOrgs: Organization[];
    let tieUser: User;
    const tieNamespace = `membership-order-tie-${nanoid(8)}`;
    const tieOrgLetters = ["A", "B", "C", "D", "E"] as const;

    beforeAll(async () => {
      tieUser = await prisma.user.create({
        data: {
          email: `membership-order-tie-test-${tieNamespace}@example.com`,
          name: `Test User ${tieNamespace}`,
        },
      });

      // `Organization.id` is generated via Prisma's `@default(nanoid())`
      // (schema.prisma), which produces a random alphabet with no
      // relationship whatsoever to insertion/creation order (unlike, say,
      // cuid). So there's no way to "reverse" insertion order relative to
      // id order here — the two are independent by construction. Instead,
      // we create enough tied organizations (5) that the odds of the DB's
      // incidental/unordered `findMany` result happening to already come
      // back in fully-sorted-by-id order by pure chance are 1-in-120 —
      // negligible enough that a passing assertion below is reliable proof
      // the repository's id-based tie-breaker (not luck) produced the
      // order.
      tieOrgs = [];
      for (const letter of tieOrgLetters) {
        const org = await prisma.organization.create({
          data: {
            name: `Tie Org ${letter} ${tieNamespace}`,
            slug: `tie-org-${letter.toLowerCase()}-${tieNamespace}`,
          },
        });
        tieOrgs.push(org);
      }

      // All memberships get the EXACT same createdAt timestamp (not just
      // "close" — the identical Date instance), so `createdAt.getTime()`
      // comparisons in the sort comparator are tied for every pair and the
      // id-based tie-breaker is the only thing that can determine order.
      const sameInstant = new Date("2024-01-01T00:00:00.000Z");

      for (const org of tieOrgs) {
        await prisma.organizationUser.create({
          data: {
            userId: tieUser.id,
            organizationId: org.id,
            role: "ADMIN",
            createdAt: sameInstant,
          },
        });
      }
    });

    afterAll(async () => {
      await prisma.organizationUser.deleteMany({
        where: {
          userId: tieUser.id,
          organizationId: { in: tieOrgs.map((org) => org.id) },
        },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: tieOrgs.map((org) => org.id) } },
      });
      await prisma.user.delete({ where: { id: tieUser.id } });
    });

    it("breaks the tie by lexicographically smaller organization id, regardless of membership row insertion order", async () => {
      const result = await repository.getAllForUser({
        userId: tieUser.id,
        isDemo: false,
        demoProjectUserId: "",
        demoProjectId: "",
      });

      const tieOrgIds = new Set(tieOrgs.map((org) => org.id));
      const actualIds = result
        .filter((org) => tieOrgIds.has(org.id))
        .map((org) => org.id);

      expect(actualIds).toHaveLength(tieOrgs.length);

      const expectedSortedIds = [...actualIds].sort();
      expect(actualIds).toEqual(expectedSortedIds);
    });
  });
});
