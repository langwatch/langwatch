/**
 * @vitest-environment node
 *
 * The last gate a deactivated account meets. Sign-in ends at a Session row,
 * so whatever route brought the person here — password, OAuth, passkey — the
 * refusal has to live where that row is written, or a revoked account gets a
 * live session through whichever route the check forgot.
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import { beforeSessionCreate } from "../better-auth-hooks";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function prismaAnswering(deactivatedAt: Date | null) {
  const findUnique = vi.fn(async () => ({ deactivatedAt }));
  return { prisma: { user: { findUnique } } as unknown as PrismaClient, findUnique };
}

describe("beforeSessionCreate", () => {
  describe("given a user account with a non-null deactivatedAt", () => {
    describe("when a session is about to be created for them", () => {
      /** @scenario "Deactivated user is blocked from signing in" */
      it("denies the sign-in", async () => {
        const { prisma } = prismaAnswering(new Date("2026-01-01T00:00:00.000Z"));

        await expect(beforeSessionCreate({ prisma, session: { userId: "user-1" } })).resolves.toBe(
          false,
        );
      });
    });
  });

  describe("given a user account with deactivatedAt null", () => {
    describe("when a session is about to be created for them", () => {
      /** @scenario "Active user is not blocked from signing in" */
      it("leaves the sign-in to continue", async () => {
        const { prisma, findUnique } = prismaAnswering(null);

        await expect(
          beforeSessionCreate({ prisma, session: { userId: "user-1" } }),
        ).resolves.toBeUndefined();
        expect(findUnique).toHaveBeenCalled();
      });
    });
  });
});
