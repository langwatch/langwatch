/**
 * @vitest-environment node
 * @see specs/identity/identifier-model.feature
 *
 * A user's hash key is minted once: when the ceremony and a backfill pass mint
 * one at the same moment, the second write re-reads the row it waited for.
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { PrismaIdentityUsersRepository } from "../prisma.identity-users.repository.ts";
import { raceOnOneRow } from "./support/row-lock-race.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaIdentityUsersRepository.storeUserHashKeyIfMissing", () => {
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:identity:test:user-hash-key"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const userId = `hash-key-${nanoid(8)}`;

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  describe("when the ceremony and a backfill pass mint a key for one user at the same moment", () => {
    /** @scenario "A user's hash key is minted once, whichever writer arrives first" */
    it("keeps the first key, because the second write re-reads the row it waited for", async () => {
      await prisma.user.create({ data: { id: userId, email: `${userId}@acme.com` } });
      const mint = (userHashKey: string) => (tx: Prisma.TransactionClient) =>
        PrismaIdentityUsersRepository.create(tx).storeUserHashKeyIfMissing({ userId, userHashKey });

      await raceOnOneRow({ prisma, table: "User", first: mint("first"), second: mint("second") });

      const user = await prisma.user.findUnique({ where: { id: userId } });
      expect(user?.userHashKey).toBe("first");
    });
  });
});
