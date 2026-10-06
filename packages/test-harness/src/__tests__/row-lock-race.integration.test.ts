/**
 * @vitest-environment node
 * @see specs/tooling/test-row-lock-race.feature
 * Requires LANGWATCH_TEST_DATABASE_URL.
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { raceOnOneRow } from "../row-lock-race.ts";
import { createTestLogger } from "../test-logger.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("raceOnOneRow (real DB)", () => {
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createTestLogger().logger,
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const userId = `row-lock-race-${nanoid(8)}`;

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${userId}@acme.com` } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const storeKeyIfMissing = async (
    tx: Prisma.TransactionClient,
    userHashKey: string,
  ): Promise<number> =>
    tx.$executeRaw`
      -- @tenancy: User is global; the row is the one this suite created.
      UPDATE "User" SET "userHashKey" = ${userHashKey}
       WHERE id = ${userId} AND "userHashKey" IS NULL
    `;

  describe("when the first write returns nothing", () => {
    /** @scenario "A first write that returns nothing still stages the race" */
    it("parks the second write on the lock, which then re-reads the committed row", async () => {
      await prisma.user.update({ where: { id: userId }, data: { userHashKey: null } });

      const answers = await raceOnOneRow<number | void>({
        prisma,
        table: "User",
        second: (tx) => storeKeyIfMissing(tx, "second"),
        first: async (tx) => {
          await tx.user.update({ where: { id: userId }, data: { userHashKey: "first" } });
        },
      });

      expect(answers.first).toBeUndefined();
      expect(answers.second).toBe(0);
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.userHashKey).toBe("first");
    });
  });

  describe("when the first write returns a value", () => {
    /** @scenario "A first write's answer is handed back with the second's" */
    it("returns both writes' answers", async () => {
      await prisma.user.update({ where: { id: userId }, data: { userHashKey: null } });

      const answers = await raceOnOneRow({
        prisma,
        table: "User",
        second: (tx) => storeKeyIfMissing(tx, "second"),
        first: (tx) => storeKeyIfMissing(tx, "first"),
      });

      expect(answers).toEqual({ first: 1, second: 0 });
    });
  });

  describe("when the first write throws", () => {
    /** @scenario "A failing first write is reported as itself" */
    it("rejects with that error and rolls the first write back", async () => {
      await prisma.user.update({ where: { id: userId }, data: { userHashKey: null } });

      const race = raceOnOneRow({
        prisma,
        table: "User",
        second: (tx) => storeKeyIfMissing(tx, "second"),
        first: async (tx) => {
          await tx.user.update({ where: { id: userId }, data: { userHashKey: "first" } });
          throw new Error("the first write failed");
        },
      });

      await expect(race).rejects.toThrow("the first write failed");
      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.userHashKey).toBeNull();
    });
  });
});
