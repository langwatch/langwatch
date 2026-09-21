import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaOrganizationTenantSource } from "../organization-tenant-source.prisma.repository";
import { PrismaUserTenantSource } from "../user-tenant-source.prisma.repository";

/**
 * Which tenants a pass enumerates at all, against Postgres.
 *
 * This can only be proved here. The rule compares a COUNT of rows on an
 * unrelated table against the number of migrations the pass is driving, so it
 * is raw SQL rather than a Prisma filter, and a unit test over a fake would
 * prove the fake rather than the query.
 *
 * What it protects is startup. A tenant that has latched every migration is
 * still a claim, a state read per migration and a release on every pass, on
 * every replica, and two passes must finish before any of them may serve. The
 * claim with teeth is therefore the NEGATIVE one: a tenant with nothing left
 * to do must not be named.
 *
 * @see specs/migration/system-migrations-runner.feature
 */
const ns = `pendingsrc-${nanoid(8)}`;
const FIRST = `pending-src-first-${ns}`;
const SECOND = `pending-src-second-${ns}`;
const BOTH = [FIRST, SECOND];

const SETTLED = `${ns}-a-settled`;
const PINNED = `${ns}-b-pinned`;
const HALF_DONE = `${ns}-c-half-done`;
const PARKED = `${ns}-d-parked`;
const UNTOUCHED = `${ns}-e-untouched`;
const EVERY_TENANT = [SETTLED, PINNED, HALF_DONE, PARKED, UNTOUCHED];

/** Starts the walk immediately before this suite's own ids, so the page is
 *  this suite's tenants and whatever the installation already had after
 *  them — never a full table ahead of them. */
const CURSOR = ns;

async function recordState({
  tenantId,
  rows,
}: {
  tenantId: string;
  rows: Array<{ migrationName: string; status: string }>;
}): Promise<void> {
  await prisma.systemMigrationTenantState.createMany({
    data: rows.map((row) => ({ ...row, tenantId })),
  });
}

async function seedStates(): Promise<void> {
  await recordState({
    tenantId: SETTLED,
    rows: [
      { migrationName: FIRST, status: "finalized" },
      { migrationName: SECOND, status: "finalized" },
    ],
  });
  await recordState({
    tenantId: PINNED,
    rows: [
      { migrationName: FIRST, status: "rolled_back" },
      { migrationName: SECOND, status: "rolled_back" },
    ],
  });
  await recordState({
    tenantId: HALF_DONE,
    rows: [{ migrationName: FIRST, status: "finalized" }],
  });
  await recordState({
    tenantId: PARKED,
    rows: [
      { migrationName: FIRST, status: "parked" },
      { migrationName: SECOND, status: "finalized" },
    ],
  });
}

function ours(tenantIds: string[]): string[] {
  return tenantIds.filter((tenantId) => tenantId.startsWith(ns));
}

describe("given tenants at every stage of a two-migration pass", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: EVERY_TENANT.map((id) => ({
        id,
        email: `${id}@acme.com`,
        emailVerified: true,
      })),
    });
    await prisma.organization.createMany({
      data: EVERY_TENANT.map((id) => ({
        id,
        name: `Pending ${id}`,
        slug: `--test-${id}`,
      })),
    });
    await seedStates();
  });

  afterAll(async () => {
    // One call per tenant, because the multitenancy guard wants a bulk write
    // to name ONE tenant: it tests `typeof where.tenantId === "string"`, so an
    // `in` list over this file's tenants reads as migration-wide and is
    // refused. A migration-wide delete would drop every tenant's `finalized`
    // latch and return switched-over organizations to their legacy path.
    for (const tenantId of EVERY_TENANT) {
      await prisma.systemMigrationTenantState.deleteMany({
        where: { migrationName: { in: BOTH }, tenantId },
      });
    }
    await prisma.organization.deleteMany({
      where: { id: { in: EVERY_TENANT } },
    });
    await prisma.user.deleteMany({ where: { id: { in: EVERY_TENANT } } });
  });

  describe("when the user leg asks who still has work", () => {
    /** @scenario "A tenant that has finished every migration a pass drives is not visited again" */
    /** @scenario "A tenant an operator rolled back is not visited again" */
    /** @scenario "A tenant with one of a pass's migrations still to finish is visited" */
    /** @scenario "A tenant no pass has ever touched is visited" */
    it("names the half-done, parked and untouched users and leaves out the settled and pinned ones", async () => {
      const visited = ours(
        await new PrismaUserTenantSource(prisma)
          .pendingFor({ migrationNames: BOTH })
          .findTenantIdsAfter({ cursor: CURSOR, limit: 100 }),
      );

      expect(visited).toEqual([HALF_DONE, PARKED, UNTOUCHED]);
    });

    it("drops a user from the walk once the last of the pass's migrations latches", async () => {
      const source = new PrismaUserTenantSource(prisma).pendingFor({
        migrationNames: BOTH,
      });
      expect(
        ours(await source.findTenantIdsAfter({ cursor: CURSOR, limit: 100 })),
      ).toContain(HALF_DONE);

      await prisma.systemMigrationTenantState.create({
        data: {
          migrationName: SECOND,
          tenantId: HALF_DONE,
          status: "finalized",
        },
      });

      expect(
        ours(await source.findTenantIdsAfter({ cursor: CURSOR, limit: 100 })),
      ).not.toContain(HALF_DONE);

      await prisma.systemMigrationTenantState.delete({
        where: {
          migrationName_tenantId: {
            migrationName: SECOND,
            tenantId: HALF_DONE,
          },
        },
      });
    });

    it("walks in ascending id order, a page at a time", async () => {
      const source = new PrismaUserTenantSource(prisma).pendingFor({
        migrationNames: BOTH,
      });

      const first = await source.findTenantIdsAfter({
        cursor: `${ns}-c`,
        limit: 1,
      });
      expect(first).toEqual([HALF_DONE]);
      const second = await source.findTenantIdsAfter({
        cursor: HALF_DONE,
        limit: 1,
      });
      expect(second).toEqual([PARKED]);
    });

    it("accepts the null cursor the first page of a pass carries", async () => {
      // The `::text IS NULL` branch is the one every pass takes first, and a
      // parameter Postgres refuses there would throw out of the pass.
      const page = await new PrismaUserTenantSource(prisma)
        .pendingFor({ migrationNames: BOTH })
        .findTenantIdsAfter({ cursor: null, limit: 1 });

      expect(Array.isArray(page)).toBe(true);
      expect(page.length).toBeLessThanOrEqual(1);
    });
  });

  describe("when the pass drives only the first migration", () => {
    /** @scenario "A tenant with one of a pass's migrations still to finish is visited" */
    it("counts only that migration, so the half-done user is settled and the parked one is not", async () => {
      const visited = ours(
        await new PrismaUserTenantSource(prisma)
          .pendingFor({ migrationNames: [FIRST] })
          .findTenantIdsAfter({ cursor: CURSOR, limit: 100 }),
      );

      expect(visited).toEqual([PARKED, UNTOUCHED]);
    });
  });

  describe("when the organization leg asks who still has work", () => {
    /** @scenario "A tenant that has finished every migration a pass drives is not visited again" */
    /** @scenario "A tenant an operator rolled back is not visited again" */
    it("answers the same question over organizations", async () => {
      const visited = ours(
        await new PrismaOrganizationTenantSource(prisma)
          .pendingFor({ migrationNames: BOTH })
          .findTenantIdsAfter({ cursor: CURSOR, limit: 100 }),
      );

      expect(visited).toEqual([HALF_DONE, PARKED, UNTOUCHED]);
    });
  });
});
