/**
 * The hourly sweep over CLI login keys whose session ran out, and the
 * synchronous form of it an admin's policy change runs.
 *
 * Feature: specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  applySessionCeiling,
  reapExpiredCliLoginKeys,
} from "../cli-login-key-reaper";
import { CLI_LOGIN_KEY_NAME_PREFIX } from "../reserved-names";

const NOW = new Date("2026-09-07T12:00:00.000Z");

function prismaWith({
  elapsed,
  live = [],
}: {
  elapsed: Array<{ id: string; userId: string | null; organizationId: string }>;
  live?: Array<{ id: string; createdAt: Date; expiresAt: Date | null }>;
}) {
  const findMany = vi.fn(async (args: { where: Record<string, unknown> }) =>
    "expiresAt" in args.where &&
    (args.where.expiresAt as { lte?: Date }).lte instanceof Date
      ? elapsed
      : live,
  );
  const updateMany = vi.fn(async () => ({ count: 1 }));
  return {
    prisma: { apiKey: { findMany, updateMany } } as unknown as PrismaClient,
    findMany,
    updateMany,
  };
}

describe("reapExpiredCliLoginKeys", () => {
  describe("given a login key whose expiry passed and one whose expiry has not", () => {
    /** @scenario "The reaper retires login keys whose session window ran out" */
    it("revokes only the elapsed key, with cause expired, through the cascade", async () => {
      const { prisma, findMany } = prismaWith({
        elapsed: [{ id: "ak_old", userId: "user_1", organizationId: "org_1" }],
      });
      const revokeSessionKey = vi
        .fn()
        .mockResolvedValue({ loginKeyRevoked: true, ingestKeysRevoked: 2 });

      const count = await reapExpiredCliLoginKeys({
        prisma,
        now: NOW,
        loginKeys: { revokeSessionKey },
      });

      expect(count).toBe(1);
      // The read names exactly the sweep's predicate: what the tenancy guard
      // admits, and nothing wider.
      expect(findMany).toHaveBeenCalledWith({
        where: {
          name: { startsWith: CLI_LOGIN_KEY_NAME_PREFIX },
          revokedAt: null,
          expiresAt: { not: null, lte: NOW },
        },
        select: { id: true, userId: true, organizationId: true },
      });
      expect(revokeSessionKey).toHaveBeenCalledTimes(1);
      expect(revokeSessionKey).toHaveBeenCalledWith({
        apiKeyId: "ak_old",
        userId: "user_1",
        organizationId: "org_1",
        cause: "expired",
      });
    });
  });

  describe("given a key one revoke cannot retire", () => {
    it("keeps going with the rest and counts only what it revoked", async () => {
      const { prisma } = prismaWith({
        elapsed: [
          { id: "ak_a", userId: "user_1", organizationId: "org_1" },
          { id: "ak_b", userId: "user_2", organizationId: "org_2" },
          { id: "ak_dead", userId: "user_3", organizationId: "org_3" },
        ],
      });
      const revokeSessionKey = vi.fn(
        async ({ apiKeyId }: { apiKeyId: string }) => {
          if (apiKeyId === "ak_a") throw new Error("postgres is down");
          return {
            loginKeyRevoked: apiKeyId !== "ak_dead",
            ingestKeysRevoked: 0,
          };
        },
      );

      const count = await reapExpiredCliLoginKeys({
        prisma,
        now: NOW,
        loginKeys: { revokeSessionKey },
      });

      expect(count).toBe(1);
      expect(revokeSessionKey).toHaveBeenCalledTimes(3);
    });
  });

  describe("given an organization to sweep", () => {
    it("bounds the read to that organization", async () => {
      const { prisma, findMany } = prismaWith({ elapsed: [] });

      await reapExpiredCliLoginKeys({
        prisma,
        now: NOW,
        organizationId: "org_1",
        loginKeys: { revokeSessionKey: vi.fn() },
      });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: "org_1" }),
        }),
      );
    });
  });
});

describe("applySessionCeiling", () => {
  describe("given a ceiling shorter than the sessions already open", () => {
    it("brings each live key's expiry forward to the ceiling, then reaps", async () => {
      const startedAt = new Date("2026-08-01T00:00:00.000Z");
      const { prisma, updateMany } = prismaWith({
        elapsed: [{ id: "ak_old", userId: "user_1", organizationId: "org_1" }],
        live: [
          // Past the new ceiling: expiry moves back to start + 7d.
          {
            id: "ak_old",
            createdAt: startedAt,
            expiresAt: new Date("2026-10-01T00:00:00.000Z"),
          },
          // Already inside it: left alone.
          {
            id: "ak_recent",
            createdAt: new Date("2026-09-06T00:00:00.000Z"),
            expiresAt: new Date("2026-09-08T00:00:00.000Z"),
          },
        ],
      });
      const revokeSessionKey = vi
        .fn()
        .mockResolvedValue({ loginKeyRevoked: true, ingestKeysRevoked: 0 });

      const reaped = await applySessionCeiling({
        prisma,
        organizationId: "org_1",
        maxSessionDurationDays: 7,
        now: NOW,
        loginKeys: { revokeSessionKey },
      });

      expect(updateMany).toHaveBeenCalledTimes(1);
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: "ak_old", organizationId: "org_1", revokedAt: null },
        data: { expiresAt: new Date("2026-08-08T00:00:00.000Z") },
      });
      expect(reaped).toBe(1);
      expect(revokeSessionKey).toHaveBeenCalledWith(
        expect.objectContaining({ apiKeyId: "ak_old", cause: "expired" }),
      );
    });
  });

  describe("given the ceiling is lifted", () => {
    it("leaves every expiry as it is and only reaps what already elapsed", async () => {
      const { prisma, updateMany, findMany } = prismaWith({ elapsed: [] });

      await applySessionCeiling({
        prisma,
        organizationId: "org_1",
        maxSessionDurationDays: 0,
        now: NOW,
        loginKeys: { revokeSessionKey: vi.fn() },
      });

      expect(updateMany).not.toHaveBeenCalled();
      expect(findMany).toHaveBeenCalledTimes(1);
    });
  });
});
