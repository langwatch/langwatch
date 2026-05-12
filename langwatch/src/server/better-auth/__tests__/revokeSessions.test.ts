/**
 * Regression test for iter-24 bug 20: with `secondaryStorage` enabled,
 * BetterAuth's `findSession` reads cached sessions from Redis FIRST and
 * short-circuits before going to the DB. So a Prisma `session.deleteMany`
 * alone is invisible — the user stays "logged in" until the cache TTL.
 *
 * The `revokeAllSessionsForUser` helper clears BOTH stores so admin
 * actions like `user.deactivate` actually kick the user out.
 */
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockRedisGet = vi.fn();
const mockRedisDel = vi.fn();
const mockRedisSet = vi.fn();
vi.mock("~/server/redis", () => ({
  connection: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  },
}));

import {
  revokeAllSessionsForUser,
  revokeOtherSessionsForUser,
} from "../revokeSessions";

const makePrismaMock = (sessionTokens: string[] = []): PrismaClient =>
  ({
    session: {
      findUnique: vi.fn(),
      findMany: vi
        .fn()
        .mockResolvedValue(sessionTokens.map((sessionToken) => ({ sessionToken }))),
      deleteMany: vi.fn().mockResolvedValue({ count: sessionTokens.length }),
    },
  }) as unknown as PrismaClient;

describe("revokeAllSessionsForUser", () => {
  beforeEach(() => {
    mockRedisGet.mockReset();
    mockRedisDel.mockReset();
    mockRedisSet.mockReset();
  });

  describe("when user has cached sessions in Redis", () => {
    it("clears the active-sessions index, each token cache key, and the DB rows", async () => {
      const tokens = [
        { token: "token_a", expiresAt: Date.now() + 60000 },
        { token: "token_b", expiresAt: Date.now() + 60000 },
      ];
      mockRedisGet.mockImplementation(async (key: string) => {
        if (key === "better-auth:active-sessions-user_1") {
          return JSON.stringify(tokens);
        }
        return null;
      });

      const prisma = makePrismaMock(["token_a", "token_b"]);
      await revokeAllSessionsForUser({ prisma, userId: "user_1" });

      // The two token cache keys should be deleted
      expect(mockRedisDel).toHaveBeenCalledWith("better-auth:token_a");
      expect(mockRedisDel).toHaveBeenCalledWith("better-auth:token_b");
      // The active-sessions index should be deleted
      expect(mockRedisDel).toHaveBeenCalledWith(
        "better-auth:active-sessions-user_1",
      );
      // The DB rows should be deleted
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user_1" },
      });
    });
  });

  describe("when the active-sessions index is missing but DB has rows", () => {
    it("falls back to scanning Postgres and clears each token from Redis", async () => {
      mockRedisGet.mockResolvedValue(null);

      const prisma = makePrismaMock(["orphan_token_1", "orphan_token_2"]);
      await revokeAllSessionsForUser({ prisma, userId: "user_2" });

      // Even without the index, we delete the DB-known tokens from Redis
      expect(mockRedisDel).toHaveBeenCalledWith("better-auth:orphan_token_1");
      expect(mockRedisDel).toHaveBeenCalledWith("better-auth:orphan_token_2");
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user_2" },
      });
    });
  });

  describe("when Redis is unavailable (transient failure)", () => {
    it("still deletes the Postgres rows so the user is at least DB-revoked", async () => {
      mockRedisGet.mockRejectedValue(new Error("Redis connection refused"));

      const prisma = makePrismaMock(["token_x"]);
      await revokeAllSessionsForUser({ prisma, userId: "user_3" });

      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user_3" },
      });
    });
  });

  describe("when the user has no sessions at all", () => {
    it("completes cleanly without errors", async () => {
      mockRedisGet.mockResolvedValue(null);

      const prisma = makePrismaMock([]);
      await expect(
        revokeAllSessionsForUser({ prisma, userId: "user_none" }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("revokeOtherSessionsForUser", () => {
  beforeEach(() => {
    mockRedisGet.mockReset();
    mockRedisDel.mockReset();
    mockRedisSet.mockReset();
  });

  describe("when user has multiple sessions including the keep one", () => {
    it("clears all OTHER token cache keys but keeps the index entry for the kept session", async () => {
      const tokens = [
        { token: "current_token", expiresAt: Date.now() + 60000 },
        { token: "old_device_token", expiresAt: Date.now() + 60000 },
        { token: "stolen_token", expiresAt: Date.now() + 60000 },
      ];
      mockRedisGet.mockImplementation(async (key: string) => {
        if (key === "better-auth:active-sessions-user_1") {
          return JSON.stringify(tokens);
        }
        return null;
      });

      const prisma = {
        session: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ sessionToken: "current_token" }),
          findMany: vi.fn().mockResolvedValue([
            { sessionToken: "old_device_token" },
            { sessionToken: "stolen_token" },
          ]),
          deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
      } as unknown as PrismaClient;

      await revokeOtherSessionsForUser({
        prisma,
        userId: "user_1",
        keepSessionId: "current_session_id",
      });

      // The two OTHER token cache keys should be deleted
      expect(mockRedisDel).toHaveBeenCalledWith("better-auth:old_device_token");
      expect(mockRedisDel).toHaveBeenCalledWith("better-auth:stolen_token");
      // The CURRENT token cache key should NOT be deleted
      expect(mockRedisDel).not.toHaveBeenCalledWith("better-auth:current_token");
      // The DB delete should exclude the current session
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user_1", NOT: { id: "current_session_id" } },
      });
    });
  });

  describe("when only the current session exists", () => {
    it("does not delete anything from Redis or DB beyond the empty NOT-id query", async () => {
      mockRedisGet.mockImplementation(async (key: string) => {
        if (key === "better-auth:active-sessions-solo_user") {
          return JSON.stringify([
            { token: "only_token", expiresAt: Date.now() + 60000 },
          ]);
        }
        return null;
      });

      const prisma = {
        session: {
          findUnique: vi.fn().mockResolvedValue({ sessionToken: "only_token" }),
          findMany: vi.fn().mockResolvedValue([]),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      } as unknown as PrismaClient;

      await revokeOtherSessionsForUser({
        prisma,
        userId: "solo_user",
        keepSessionId: "solo_session_id",
      });

      // The current token must NOT be cleared
      expect(mockRedisDel).not.toHaveBeenCalledWith("better-auth:only_token");
      // No other sessions to delete
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: "solo_user", NOT: { id: "solo_session_id" } },
      });
    });
  });
});
