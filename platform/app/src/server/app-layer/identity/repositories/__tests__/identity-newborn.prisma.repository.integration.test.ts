/**
 * The born-finalized entrance's row writes, against real Postgres.
 *
 * Two claims here are only true against a database. The pinned user id is a
 * convergence key for a RETRY of one birth, never a claim on a user who
 * already exists — normalization strips plus-tags, so `sam+x@acme.com` derives
 * the id `sam@acme.com` was born under, and a transaction that adopted
 * whatever row stood there would hand the second signer a session as the
 * first. And the sweep's candidate query has to EXCLUDE held users in SQL: a
 * fleet with more held users than one page holds would otherwise return a page
 * of them forever and never reach an orphan.
 *
 * Corresponds to specs/identity/identity-storage-adapter.feature.
 */
import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME } from "../../migration-name";
import {
  IDENTITY_BORN_REPORT_KIND,
  PrismaIdentityNewbornRepository,
} from "../identity-newborn.prisma.repository";

const namespace = `idnb-${nanoid(8)}`;
const repository = new PrismaIdentityNewbornRepository(prisma);
const OLD = new Date(Date.now() - 2 * 60 * 60 * 1000);
const OLDEST = new Date(Date.now() - 3 * 60 * 60 * 1000);
const HORIZON = new Date(Date.now() - 60 * 60 * 1000);

/** Every tenant this file wrote, so the cleanup can name each one — the
 *  multitenancy guard refuses a bulk write on the state table that does
 *  not. */
const writtenTenants = new Set<string>();

const tenant = (suffix: string) => {
  const id = `${namespace}-${suffix}`;
  writtenTenants.add(id);
  return id;
};

async function claimAt({
  tenantId,
  kind,
  status = "migrated",
  updatedAt = OLD,
}: {
  tenantId: string;
  kind: string;
  status?: string;
  updatedAt?: Date;
}): Promise<void> {
  await prisma.systemMigrationTenantState.create({
    data: {
      migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
      tenantId,
      status,
      report: { kind },
      updatedAt,
    },
  });
}

afterEach(async () => {
  for (const tenantId of writtenTenants) {
    await prisma.systemMigrationTenantState.deleteMany({
      where: {
        migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
        tenantId,
      },
    });
    await prisma.accountCredential.deleteMany({ where: { userId: tenantId } });
    await prisma.user.deleteMany({ where: { id: tenantId } });
  }
  writtenTenants.clear();
});

describe("PrismaIdentityNewbornRepository", () => {
  describe("when the pinned id is free", () => {
    it("creates the user and finalizes the state row in one transaction", async () => {
      const userId = tenant("fresh");
      await repository.claim({ userId });

      const written = await repository.commitNewborn({
        userId,
        user: { email: `${userId}@acme.com`, name: "Sam" },
      });

      expect(written.id).toBe(userId);
      expect(
        (
          await prisma.systemMigrationTenantState.findUnique({
            where: {
              migrationName_tenantId: {
                migrationName: IDENTITY_IDENTIFIER_BACKFILL_MIGRATION_NAME,
                tenantId: userId,
              },
            },
          })
        )?.status,
      ).toBe("finalized");
    });
  });

  describe("when a user already stands at the pinned id", () => {
    /** @scenario "A flagged sign-up is refused when its pinned id is already someone's" */
    it("refuses with the collision code rather than adopting them", async () => {
      const userId = tenant("taken");
      await prisma.user.create({
        data: { id: userId, email: `${userId}@acme.com` },
      });

      expect(await repository.findUserAtPinnedId({ userId })).toEqual({
        id: userId,
      });
      await expect(
        repository.commitNewborn({
          userId,
          user: { email: `${userId}+news@acme.com`, name: "Impostor" },
        }),
      ).rejects.toMatchObject({ code: "identity_email_in_use" });

      // The standing user is untouched: no adoption, no rewritten email.
      expect(
        (await prisma.user.findUnique({ where: { id: userId } }))?.email,
      ).toBe(`${userId}@acme.com`);
    });
  });

  describe("when held users outnumber one sweep page", () => {
    /** @scenario "The sweep finds an orphan behind a page of held users" */
    it("returns the abandoned newborn, never a held user", async () => {
      // The held claims are OLDER, so they sort ahead of the orphan: a page
      // as wide as they are cannot reach it unless the query excludes them.
      for (const suffix of ["held-a", "held-b", "held-c"]) {
        const userId = tenant(suffix);
        await claimAt({
          tenantId: userId,
          kind: "identifier_backfill",
          updatedAt: OLDEST,
        });
        await prisma.user.create({
          data: { id: userId, email: `${userId}@acme.com` },
        });
      }
      const orphan = tenant("orphan");
      await claimAt({ tenantId: orphan, kind: IDENTITY_BORN_REPORT_KIND });

      const found = await repository.findAbandoned({
        olderThan: HORIZON,
        limit: 3,
      });

      // Filtering held users AFTER the page would return a page of them and
      // report nothing to sweep, for every pass, forever.
      expect(found.map((row) => row.userId)).toContain(orphan);
      for (const suffix of ["held-a", "held-b", "held-c"]) {
        expect(found.map((row) => row.userId)).not.toContain(
          `${namespace}-${suffix}`,
        );
      }
    });

    it("leaves a born claim whose user row exists alone", async () => {
      const userId = tenant("born-and-committed");
      await claimAt({ tenantId: userId, kind: IDENTITY_BORN_REPORT_KIND });
      await prisma.user.create({
        data: { id: userId, email: `${userId}@acme.com` },
      });

      const found = await repository.findAbandoned({
        olderThan: HORIZON,
        limit: 100,
      });
      expect(found.filter((row) => row.userId.startsWith(namespace))).toEqual(
        [],
      );
    });
  });

  describe("when a user is deleted", () => {
    /** @scenario "Deleting a user reaps the credentials of an unlatched one too" */
    it("takes their credential rows with them", async () => {
      const userId = tenant("deleted");
      await prisma.user.create({
        data: { id: userId, email: `${userId}@acme.com` },
      });
      await prisma.accountCredential.create({
        data: {
          id: `${userId}-acc`,
          userId,
          provider: "credential",
          password: "hashed",
        },
      });

      await prisma.user.delete({ where: { id: userId } });

      // A password hash and provider tokens must never outlive the user, and
      // the identity branch's own delete is not the only path that removes
      // one.
      expect(
        await prisma.accountCredential.findMany({ where: { userId } }),
      ).toEqual([]);
    });
  });
});
