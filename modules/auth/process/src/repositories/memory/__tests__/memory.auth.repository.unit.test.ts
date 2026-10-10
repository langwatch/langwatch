import { Temporal, toDate, type Instant } from "@langwatch/time";
import type { BetterAuthOptions } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";

import { MemoryAuthSessionRepository } from "../memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "../memory.auth.database.ts";
import { MemoryAuthRepositories } from "../memory.auth.repositories.ts";
import { MemoryCliDeviceSessionRepository } from "../memory.cli-device-session.repository.ts";
import { MemorySignUpVerificationTokenRepository } from "../memory.signup-verification-token.repository.ts";

const NOW = Temporal.Instant.from("2026-08-28T00:00:00.000Z");
const SESSION = { sessionToken: "token" };

function sessions() {
  const memory = MemoryAuthDatabase.create();

  memory.db.Session.push(
    { id: "s1", userId: "u1", sessionToken: "t1" },
    { id: "s2", userId: "u1", sessionToken: "t2" },
    { id: "s3", userId: "u2", sessionToken: "t3" },
  );

  return MemoryAuthSessionRepository.create({ memory });
}

describe("MemoryAuthSessionRepository", () => {
  describe("given three sessions across two people", () => {
    describe("when one person's sessions are listed", () => {
      it("names only that person's tokens", async () => {
        await expect(sessions().findTokensForUser({ userId: "u1" })).resolves.toEqual(["t1", "t2"]);
      });
    });

    describe("when every session of one person is revoked", () => {
      it("counts what it deleted and leaves the other person alone", async () => {
        const repository = sessions();

        await expect(repository.deleteAllForUser({ userId: "u1" })).resolves.toBe(2);
        await expect(repository.findById({ id: "s1" })).resolves.toBeNull();
        await expect(repository.findById({ id: "s3" })).resolves.not.toBeNull();
      });
    });

    describe("when every session but the current device is revoked", () => {
      it("keeps the named session and counts the rest", async () => {
        const repository = sessions();

        await expect(
          repository.deleteOthersForUser({ userId: "u1", keepSessionId: "s1" }),
        ).resolves.toBe(1);
        await expect(repository.findById({ id: "s1" })).resolves.not.toBeNull();
        await expect(repository.findById({ id: "s2" })).resolves.toBeNull();
      });
    });

    describe("when the signed-in users are counted among some people", () => {
      /** @scenario "An organization's signed-in count holds its own members only" */
      it("counts each of those people with a live session once, and nobody else", async () => {
        const memory = MemoryAuthDatabase.create();
        const live = toDate(NOW.add({ hours: 1 }));
        memory.db.Session.push(
          { ...SESSION, id: "s1", userId: "u1", expires: live },
          { ...SESSION, id: "s2", userId: "u1", expires: live },
          { ...SESSION, id: "s3", userId: "u2", expires: toDate(NOW.subtract({ hours: 1 })) },
          { ...SESSION, id: "s4", userId: "outsider", expires: live },
        );
        const repository = MemoryAuthSessionRepository.create({ memory });

        await expect(
          repository.countSignedInUsersAmong({
            userIds: ["u1", "u2"],
            at: NOW.epochMilliseconds,
          }),
        ).resolves.toBe(1);
        await expect(
          repository.countSignedInUsersAmong({ userIds: [], at: NOW.epochMilliseconds }),
        ).resolves.toBe(0);
      });
    });

    describe("when a session that has already gone is revoked again", () => {
      it("counts zero rather than raising, as deleteMany does", async () => {
        await expect(sessions().deleteById({ id: "absent" })).resolves.toBe(0);
      });
    });
  });
});

/** Better Auth's model and field names, as the channel maps them onto the tables. */
const BETTER_AUTH_TABLES = {
  user: { modelName: "User" },
  account: { modelName: "Account" },
  session: {
    modelName: "Session",
    fields: { token: "sessionToken", expiresAt: "expires" },
    additionalFields: {
      amr: { type: "string[]", required: false, input: false },
      identifierId: { type: "string", required: false, input: false },
    },
  },
  verification: {
    modelName: "VerificationToken",
    fields: { identifier: "identifier", value: "token", expiresAt: "expires" },
  },
} satisfies BetterAuthOptions;

describe("given Better Auth's memory adapter over the twins' database", () => {
  async function mint({
    memory,
    token,
    expiresAt,
  }: {
    memory: MemoryAuthDatabase;
    token: string;
    expiresAt: Instant;
  }) {
    const adapter = memoryAdapter(memory.db)(BETTER_AUTH_TABLES);

    await adapter.transaction(async (transaction) => {
      await transaction.create({
        model: "session",
        data: {
          userId: "u1",
          token,
          expiresAt: toDate(expiresAt),
          createdAt: toDate(NOW),
          updatedAt: toDate(NOW),
        },
      });
    });
  }

  describe("when a session is written inside a transaction and committed", () => {
    it("is read back by the session twin after the commit replaced the table", async () => {
      const memory = MemoryAuthDatabase.create();
      const repository = MemoryAuthSessionRepository.create({ memory });
      const before = memory.db.Session;

      await mint({ memory, token: "minted", expiresAt: NOW.add({ hours: 1 }) });

      expect(memory.db.Session).not.toBe(before);
      await expect(repository.findTokensForUser({ userId: "u1" })).resolves.toEqual(["minted"]);
      const [stored] = await repository.findStoredForUser({ userId: "u1" });
      await expect(repository.findById({ id: stored!.id })).resolves.toMatchObject({
        userId: "u1",
        sessionToken: "minted",
        impersonation: null,
        createdAt: NOW,
      });
      await expect(repository.findExpiryByToken({ token: "minted" })).resolves.toEqual([
        { expires: NOW.add({ hours: 1 }), userId: "u1" },
      ]);
      await expect(repository.countSignedInUsers({ at: NOW.epochMilliseconds })).resolves.toBe(1);
    });
  });

  describe("when the committed session has already expired", () => {
    it("does not count its owner as signed in", async () => {
      const memory = MemoryAuthDatabase.create();
      const repository = MemoryAuthSessionRepository.create({ memory });

      await mint({ memory, token: "stale", expiresAt: NOW.subtract({ hours: 1 }) });

      await expect(repository.findTokensForUser({ userId: "u1" })).resolves.toEqual(["stale"]);
      await expect(repository.countSignedInUsers({ at: NOW.epochMilliseconds })).resolves.toBe(0);
    });
  });

  describe("when a token is issued by the twin and a transaction commits beside it", () => {
    it("keeps the twin's row, so the token is still claimable", async () => {
      const memory = MemoryAuthDatabase.create();
      const tokens = MemorySignUpVerificationTokenRepository.create({ memory });
      await tokens.issue({
        identifier: "signup:someone@example.com",
        token: "live",
        expires: NOW.add({ hours: 1 }),
      });

      await mint({ memory, token: "minted", expiresAt: NOW.add({ hours: 1 }) });

      await expect(
        tokens.claim({ token: "live", now: NOW, keepSpentUntil: NOW.add({ hours: 24 }) }),
      ).resolves.toEqual({ claimed: true, identifier: "signup:someone@example.com" });
    });
  });
});

describe("MemorySignUpVerificationTokenRepository", () => {
  function tokens() {
    return MemorySignUpVerificationTokenRepository.create({
      memory: MemoryAuthDatabase.create(),
    });
  }

  const GRACE = NOW.add({ hours: 24 });

  describe("given a live confirmation token", () => {
    describe("when it is spent", () => {
      it("answers the identifier it was issued for", async () => {
        const repository = tokens();
        await repository.issue({
          identifier: "signup:someone@example.com",
          token: "live",
          expires: NOW.add({ hours: 1 }),
        });

        await expect(
          repository.claim({ token: "live", now: NOW, keepSpentUntil: GRACE }),
        ).resolves.toEqual({ claimed: true, identifier: "signup:someone@example.com" });
      });
    });

    describe("when it is spent twice", () => {
      it("refuses the second attempt and recognises the spent link instead", async () => {
        const repository = tokens();
        await repository.issue({
          identifier: "signup:someone@example.com",
          token: "live",
          expires: NOW.add({ hours: 1 }),
        });

        await repository.claim({ token: "live", now: NOW, keepSpentUntil: GRACE });

        await expect(
          repository.claim({ token: "live", now: NOW, keepSpentUntil: GRACE }),
        ).resolves.toEqual({ claimed: false });
        await expect(repository.findSpent({ token: "live", now: NOW })).resolves.toEqual({
          identifier: "signup:someone@example.com",
        });
      });
    });

    describe("when the spent marker's grace has run out", () => {
      it("recognises nothing", async () => {
        const repository = tokens();
        await repository.issue({
          identifier: "signup:someone@example.com",
          token: "live",
          expires: NOW.add({ hours: 1 }),
        });
        await repository.claim({ token: "live", now: NOW, keepSpentUntil: GRACE });

        await expect(
          repository.findSpent({ token: "live", now: GRACE.add({ seconds: 1 }) }),
        ).resolves.toBeNull();
      });
    });
  });

  describe("given an expired token", () => {
    describe("when it is spent", () => {
      it("answers nothing and leaves nothing to recognise", async () => {
        const repository = tokens();
        await repository.issue({
          identifier: "signup:someone@example.com",
          token: "stale",
          expires: NOW.subtract({ hours: 1 }),
        });

        await expect(
          repository.claim({ token: "stale", now: NOW, keepSpentUntil: GRACE }),
        ).resolves.toEqual({ claimed: false });
        await expect(repository.findSpent({ token: "stale", now: NOW })).resolves.toBeNull();
      });
    });
  });

  describe("given a token nobody issued", () => {
    it("answers nothing", async () => {
      await expect(
        tokens().claim({ token: "guessed", now: NOW, keepSpentUntil: GRACE }),
      ).resolves.toEqual({ claimed: false });
    });
  });
});

describe("MemoryAuthRepositories", () => {
  describe("when the module selects the memory backend", () => {
    it("hands the browser, CLI, and sign-up repositories over its selected stores", () => {
      const repositories = MemoryAuthRepositories.create();

      expect(repositories.sessions).toBeInstanceOf(MemoryAuthSessionRepository);
      expect(repositories.cliSessions).toBeInstanceOf(MemoryCliDeviceSessionRepository);
      expect(repositories.signUpTokens).toBeInstanceOf(MemorySignUpVerificationTokenRepository);
    });
  });
});

describe("MemoryCliDeviceSessionRepository", () => {
  it("expires values after their configured TTL", async () => {
    let now = 0;
    const repository = MemoryCliDeviceSessionRepository.create({ now: () => now });

    await repository.set({ key: "device", value: "pending", ttlSeconds: 1 });
    now += 999;
    await expect(repository.get("device")).resolves.toBe("pending");

    now += 1;
    await expect(repository.get("device")).rejects.toMatchObject({
      code: "cli_session_record_not_found",
    });
  });

  it("releases an expired exclusive claim for the next exchange", async () => {
    let now = 0;
    const repository = MemoryCliDeviceSessionRepository.create({ now: () => now });

    await expect(repository.setIfAbsent({ key: "claim", value: "1", ttlSeconds: 1 })).resolves.toBe(
      true,
    );
    await expect(repository.setIfAbsent({ key: "claim", value: "1", ttlSeconds: 1 })).resolves.toBe(
      false,
    );

    now += 1_000;

    await expect(repository.setIfAbsent({ key: "claim", value: "1", ttlSeconds: 1 })).resolves.toBe(
      true,
    );
  });

  it("expires a token index before a later operation can retain stale members", async () => {
    let now = 0;
    const repository = MemoryCliDeviceSessionRepository.create({ now: () => now });

    await repository.indexTokens({ indexKey: "tokens", memberKeys: ["access"], ttlMs: 1_000 });
    now += 1_000;
    await repository.removeFromIndex({ indexKey: "tokens", memberKey: "access" });

    expect(repository.tokenIndexes.has("tokens")).toBe(false);
  });
});
