import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryAuthSessionRepository } from "../memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "../memory.auth.database.ts";
import { MemoryAuthRepositories } from "../memory.auth.repositories.ts";
import { MemoryCliDeviceSessionRepository } from "../memory.cli-device-session.repository.ts";
import { MemorySignUpVerificationTokenRepository } from "../memory.signup-verification-token.repository.ts";

const NOW = Temporal.Instant.from("2026-08-28T00:00:00.000Z");

function sessions() {
  const memory = MemoryAuthDatabase.create();

  memory.sessions.set("s1", { id: "s1", userId: "u1", sessionToken: "t1", impersonating: null });
  memory.sessions.set("s2", { id: "s2", userId: "u1", sessionToken: "t2", impersonating: null });
  memory.sessions.set("s3", { id: "s3", userId: "u2", sessionToken: "t3", impersonating: null });

  return MemoryAuthSessionRepository.create({ memory });
}

describe("MemoryAuthSessionRepository", () => {
  describe("given three sessions across two people", () => {
    describe("when one person's sessions are listed", () => {
      it("names only that person's tokens", async () => {
        await expect(sessions().listTokensForUser({ userId: "u1" })).resolves.toEqual(["t1", "t2"]);
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

    describe("when a session that has already gone is revoked again", () => {
      it("counts zero rather than raising, as deleteMany does", async () => {
        await expect(sessions().deleteById({ id: "absent" })).resolves.toBe(0);
      });
    });
  });
});

describe("MemorySignUpVerificationTokenRepository", () => {
  function tokens() {
    return MemorySignUpVerificationTokenRepository.create({
      memory: MemoryAuthDatabase.create(),
    });
  }

  describe("given a live confirmation token", () => {
    describe("when it is spent", () => {
      it("answers the identifier it was issued for", async () => {
        const repository = tokens();
        await repository.issue({
          identifier: "signup:someone@example.com",
          token: "live",
          expires: NOW.add({ hours: 1 }),
        });

        await expect(repository.findAndClaim({ token: "live", now: NOW })).resolves.toEqual({
          identifier: "signup:someone@example.com",
        });
      });
    });

    describe("when it is spent twice", () => {
      it("refuses the second attempt, so a link cannot be replayed", async () => {
        const repository = tokens();
        await repository.issue({
          identifier: "signup:someone@example.com",
          token: "live",
          expires: NOW.add({ hours: 1 }),
        });

        await repository.findAndClaim({ token: "live", now: NOW });

        await expect(repository.findAndClaim({ token: "live", now: NOW })).resolves.toBeNull();
      });
    });
  });

  describe("given an expired token", () => {
    describe("when it is spent", () => {
      it("answers nothing and still destroys the row", async () => {
        const repository = tokens();
        await repository.issue({
          identifier: "signup:someone@example.com",
          token: "stale",
          expires: NOW.subtract({ hours: 1 }),
        });

        await expect(repository.findAndClaim({ token: "stale", now: NOW })).resolves.toBeNull();
        await expect(repository.findAndClaim({ token: "stale", now: NOW })).resolves.toBeNull();
      });
    });
  });

  describe("given a token nobody issued", () => {
    it("answers nothing", async () => {
      await expect(tokens().findAndClaim({ token: "guessed", now: NOW })).resolves.toBeNull();
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
    await expect(repository.tryGet("device")).resolves.toBe("pending");

    now += 1;
    await expect(repository.tryGet("device")).resolves.toBeNull();
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
