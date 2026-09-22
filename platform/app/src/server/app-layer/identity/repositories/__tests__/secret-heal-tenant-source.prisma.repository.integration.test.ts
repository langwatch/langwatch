import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaSecretHealTenantSource } from "../secret-heal-tenant-source.prisma.repository";

/**
 * Which users the heal leg visits at all (ADR-116 §4), against Postgres.
 *
 * This can only be proved here. The predicate compares a column against a
 * column on a RELATED row, so it is raw SQL rather than a Prisma filter, and
 * a unit test over a fake would prove the fake rather than the join.
 *
 * What it is protecting is startup. The heal never finalizes a user, so the
 * runner re-proves everyone this source hands it on every pass — twice over
 * before a process may serve. Handing it the whole `User` table put a claim,
 * a state read and a state write per user in front of the listener, which is
 * what stopped pods binding their port. So the claim with teeth is the
 * NEGATIVE one: a settled user must not be named.
 *
 * Corresponds to specs/identity/identity-storage-adapter.feature.
 */
const namespace = `healsrc-${nanoid(8)}`;
const NO_ACCOUNT_USER = `${namespace}-user-bare`;
const SETTLED_USER = `${namespace}-user-settled`;
const DRIFTED_USER = `${namespace}-user-drifted`;
const UNCARRIED_USER = `${namespace}-user-uncarried`;
const EVERY_USER = [
  NO_ACCOUNT_USER,
  SETTLED_USER,
  DRIFTED_USER,
  UNCARRIED_USER,
];

const CREATED_AT = new Date(1_690_000_000_000);
const ACCOUNT_UPDATED_AT = new Date(1_690_000_500_000);
/** Behind the account: the legacy branch wrote after the copy was taken. */
const STALE_CREDENTIAL_UPDATED_AT = new Date(1_690_000_400_000);

const source = new PrismaSecretHealTenantSource(prisma);

async function createUser(id: string): Promise<void> {
  await prisma.user.create({
    data: { id, email: `${id}@acme.com`, emailVerified: true },
  });
}

async function createAccount(userId: string): Promise<void> {
  await prisma.account.create({
    data: {
      id: `${userId}-account`,
      userId,
      provider: "credential",
      issuer: "local:credential",
      providerAccountId: userId,
      password: "hashed-legacy-password",
      createdAt: CREATED_AT,
      updatedAt: ACCOUNT_UPDATED_AT,
    },
  });
}

async function createCredential({
  userId,
  updatedAt,
}: {
  userId: string;
  updatedAt: Date;
}): Promise<void> {
  await prisma.accountCredential.create({
    data: {
      id: `${userId}-account`,
      userId,
      provider: "credential",
      password: "hashed-legacy-password",
      createdAt: CREATED_AT,
      updatedAt,
    },
  });
}

async function namedTenants(): Promise<string[]> {
  const named = await source.findTenantIdsAfter({ cursor: null, limit: 1000 });
  return named.filter((id) => id.startsWith(namespace)).sort();
}

afterEach(async () => {
  await prisma.accountCredential.deleteMany({
    where: { userId: { in: EVERY_USER } },
  });
  await prisma.account.deleteMany({ where: { userId: { in: EVERY_USER } } });
  await prisma.user.deleteMany({ where: { id: { in: EVERY_USER } } });
});

describe("choosing which users the heal pass visits", () => {
  describe("given users in each of the states the bridge can leave them in", () => {
    async function seedEveryState(): Promise<void> {
      await createUser(NO_ACCOUNT_USER);

      await createUser(SETTLED_USER);
      await createAccount(SETTLED_USER);
      await createCredential({
        userId: SETTLED_USER,
        // Level with the account row: the carry settled it, so there is
        // nothing left to copy and no reason to look at this user again.
        updatedAt: ACCOUNT_UPDATED_AT,
      });

      await createUser(DRIFTED_USER);
      await createAccount(DRIFTED_USER);
      await createCredential({
        userId: DRIFTED_USER,
        updatedAt: STALE_CREDENTIAL_UPDATED_AT,
      });
    }

    /** @scenario "The heal pass enumerates only users whose legacy secrets could have drifted" */
    it("names the user whose Account row is ahead of their credential row", async () => {
      await seedEveryState();

      expect(await namedTenants()).toEqual([DRIFTED_USER]);
    });

    /** @scenario "The heal pass enumerates only users whose legacy secrets could have drifted" */
    it("does not name a user who holds no Account row", async () => {
      await seedEveryState();

      expect(await namedTenants()).not.toContain(NO_ACCOUNT_USER);
    });

    /** @scenario "The heal pass enumerates only users whose legacy secrets could have drifted" */
    it("does not name a user whose credential row is already level", async () => {
      await seedEveryState();

      expect(await namedTenants()).not.toContain(SETTLED_USER);
    });
  });

  describe("given a user whose secrets have not been carried across yet", () => {
    /** @scenario "A user whose secrets have not been carried across yet is still enumerated" */
    it("names them, so the carry still reaches a latching user", async () => {
      await createUser(UNCARRIED_USER);
      await createAccount(UNCARRIED_USER);

      expect(await namedTenants()).toEqual([UNCARRIED_USER]);
    });
  });

  describe("when the enumeration is paged", () => {
    it("walks in user id order and resumes after the cursor", async () => {
      await createUser(DRIFTED_USER);
      await createAccount(DRIFTED_USER);
      await createCredential({
        userId: DRIFTED_USER,
        updatedAt: STALE_CREDENTIAL_UPDATED_AT,
      });
      await createUser(UNCARRIED_USER);
      await createAccount(UNCARRIED_USER);

      const [first, second] = [DRIFTED_USER, UNCARRIED_USER].sort();

      const firstPage = await source.findTenantIdsAfter({
        cursor: null,
        limit: 1,
      });
      expect(firstPage).toEqual([first]);

      const resumed = await source.findTenantIdsAfter({
        cursor: first ?? null,
        limit: 1000,
      });
      expect(resumed.filter((id) => id.startsWith(namespace))).toEqual([
        second,
      ]);
    });
  });
});
