import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { PrismaIdentityBackfillRepository } from "../identity-backfill.prisma.repository";
import { PrismaIdentityUsersRepository } from "../identity-users.prisma.repository";

/**
 * The backfill's legacy reads and the one guarded write, against Postgres:
 * the `User`/`Account` rows read as the pass expects them (business time in
 * milliseconds, accounts in a stable order), and a hash key that is never
 * overwritten once minted.
 */
const namespace = `idbackfill-${nanoid(8)}`;
const USER = `${namespace}-user`;
const reads = new PrismaIdentityBackfillRepository(prisma);
const users = new PrismaIdentityUsersRepository(prisma);

afterEach(async () => {
  await prisma.identifier.deleteMany({ where: { userId: USER } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
});

describe("PrismaIdentityBackfillRepository", () => {
  describe("when a user with account rows is read", () => {
    it("reads the user's legacy truth with business time in milliseconds", async () => {
      const createdAt = new Date(1_690_000_000_000);
      await prisma.user.create({
        data: {
          id: USER,
          email: `${USER}@acme.com`,
          emailVerified: true,
          createdAt,
        },
      });
      await prisma.account.create({
        data: {
          id: `${namespace}-acc-b`,
          userId: USER,
          provider: "github",
          providerAccountId: "gh-1",
          createdAt: new Date(1_690_000_002_000),
        },
      });
      await prisma.account.create({
        data: {
          id: `${namespace}-acc-a`,
          userId: USER,
          provider: "google",
          providerAccountId: "g-1",
          createdAt: new Date(1_690_000_001_000),
        },
      });

      expect(await reads.findUser({ userId: USER })).toEqual({
        id: USER,
        email: `${USER}@acme.com`,
        emailVerified: true,
        createdAtMs: 1_690_000_000_000,
        userHashKey: null,
      });
      // Ordered by id, so a pass derives command ids in a stable order.
      expect(await reads.findAccountRows({ userId: USER })).toEqual([
        {
          id: `${namespace}-acc-a`,
          provider: "google",
          providerAccountId: "g-1",
          createdAtMs: 1_690_000_001_000,
        },
        {
          id: `${namespace}-acc-b`,
          provider: "github",
          providerAccountId: "gh-1",
          createdAtMs: 1_690_000_002_000,
        },
      ]);
    });

    it("answers null for a vanished user", async () => {
      expect(await reads.findUser({ userId: USER })).toBeNull();
    });
  });

  describe("when the projection rows are read for the parity proof", () => {
    it("reads exactly the columns the proof compares", async () => {
      await prisma.identifier.create({
        data: {
          id: `${namespace}-idf`,
          userId: USER,
          provider: "google",
          value: `${USER}@acme.com`,
          domain: "acme.com",
          accountId: `${namespace}-acc-a`,
          state: "VERIFIED",
          attachedAt: new Date(),
        },
      });
      expect(await reads.findIdentifierRows({ userId: USER })).toEqual([
        {
          id: `${namespace}-idf`,
          provider: "google",
          value: `${USER}@acme.com`,
          accountId: `${namespace}-acc-a`,
          state: "VERIFIED",
        },
      ]);
    });
  });
});

describe("PrismaIdentityUsersRepository", () => {
  describe("when a hash key is stored", () => {
    it("mints once and never overwrites a key already present", async () => {
      await prisma.user.create({
        data: { id: USER, email: `${USER}@acme.com` },
      });

      await users.storeUserHashKeyIfMissing({
        userId: USER,
        userHashKey: "first",
      });
      await users.storeUserHashKeyIfMissing({
        userId: USER,
        userHashKey: "second",
      });

      const user = await prisma.user.findUnique({ where: { id: USER } });
      expect(user?.userHashKey).toBe("first");
    });
  });
});
