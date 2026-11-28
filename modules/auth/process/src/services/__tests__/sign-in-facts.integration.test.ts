/**
 * The staff investigation read of one address (ADR-202, ops functions) over real `Passkey` and
 * `SignInAttemptLock` rows: the user's facts with auth's own passkey count and lock added.
 * @see dev/docs/adr/202-ops-agent-access.md
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { fromDate } from "@langwatch/time";
import type { UserApi, UserSignInAccount } from "@langwatch/user-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaPasskeyRepository } from "../../repositories/prisma/prisma.passkey.repository.ts";
import { PrismaSignInAttemptLockRepository } from "../../repositories/prisma/prisma.sign-in-attempt-lock.repository.ts";
import { keyedIdentifierHasher } from "../../rules/sign-in-identifier-hash.rules.ts";
import { SignInFactsService } from "../sign-in-facts.service.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-sign-in-facts-${randomUUID()}`;
const samId = `${namespace}-sam`;
const kimId = `${namespace}-kim`;
const samEmail = `${namespace}-sam@example.com`;
const kimEmail = `${namespace}-kim@example.com`;
const NOW = fromDate(new Date("2026-11-25T12:00:00Z"));
const hashIdentifier = keyedIdentifierHasher("test-session-secret");

function accountOf(userId: string): UserSignInAccount {
  return {
    userId,
    createdAt: 1_700_000_000_000,
    lastSignInAt: null,
    methods: ["password"],
    twoStepEnabled: false,
    deactivated: false,
  };
}

describe.skipIf(!databaseUrl)("SignInFactsService over Postgres", () => {
  let connection: PrismaConnection;
  let service: SignInFactsService;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:auth:test:sign-in-facts"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    const locks = PrismaSignInAttemptLockRepository.create({ prisma });
    const byEmail = new Map([
      [samEmail, samId],
      [kimEmail, kimId],
    ]);
    service = SignInFactsService.create({
      users: createApiFixture<Pick<UserApi, "findSignInAccounts">>({
        findSignInAccounts: async ({ email }) => {
          const userId = byEmail.get(email.trim().toLowerCase());
          return userId ? [accountOf(userId)] : [];
        },
      }),
      passkeys: PrismaPasskeyRepository.create(prisma),
      locks,
      hashIdentifier,
      now: () => NOW,
    });

    for (const [id, email] of [
      [samId, samEmail],
      [kimId, kimEmail],
    ] as const) {
      await prisma.user.create({ data: { id, email, name: id } });
    }
    for (const index of [1, 2]) {
      await prisma.passkey.create({
        data: {
          userId: samId,
          credentialID: `${namespace}-credential-${index}`,
          publicKey: "cose-public-key",
          counter: 0,
          deviceType: "singleDevice",
          transports: "internal",
        },
      });
    }
    await locks.save({
      identifierHash: hashIdentifier(kimEmail),
      state: {
        failedCount: 5,
        lockedUntil: NOW.add({ minutes: 15 }),
        consecutiveLockouts: 1,
        heldForReview: false,
      },
      userId: kimId,
    });
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.signInAttemptLock.deleteMany({
      where: { userId: { in: [samId, kimId] } },
    });
    await connection.client.passkey.deleteMany({ where: { userId: { in: [samId, kimId] } } });
    await connection.client.user.deleteMany({ where: { id: { in: [samId, kimId] } } });
    await connection.closeOnce();
  });

  describe("given an account with two passkeys and no failed sign-ins", () => {
    it("adds the passkey count and method, unlocked", async () => {
      await expect(service.findByEmail({ email: samEmail })).resolves.toEqual([
        { ...accountOf(samId), methods: ["password", "passkey"], passkeys: 2, locked: false },
      ]);
    });
  });

  describe("given an address locked after five failures", () => {
    it("answers locked, whatever case the address is typed in", async () => {
      const [facts] = await service.findByEmail({ email: kimEmail.toUpperCase() });

      expect(facts).toEqual({ ...accountOf(kimId), passkeys: 0, locked: true });
    });

    it("answers unlocked once the lock has lifted", async () => {
      const later = SignInFactsService.create({
        users: createApiFixture<Pick<UserApi, "findSignInAccounts">>({
          findSignInAccounts: async () => [accountOf(kimId)],
        }),
        passkeys: PrismaPasskeyRepository.create(connection.client),
        locks: PrismaSignInAttemptLockRepository.create({ prisma: connection.client }),
        hashIdentifier,
        now: () => NOW.add({ minutes: 16 }),
      });

      await expect(later.findByEmail({ email: kimEmail })).resolves.toMatchObject([
        { locked: false },
      ]);
    });
  });

  describe("when no account holds the address", () => {
    it("answers an empty list", async () => {
      await expect(
        service.findByEmail({ email: `${namespace}-nobody@example.com` }),
      ).resolves.toEqual([]);
    });
  });
});
