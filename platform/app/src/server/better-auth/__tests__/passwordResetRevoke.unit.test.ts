import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The revoke-all a password reset performs, and what D06 did NOT do to it.
 *
 * `specs/auth/password-reset.feature` owns the guarantee that a reset ends
 * every session. Per-identifier revocation arrived beside it as a narrower
 * instrument, and this is the test that says the narrower one did not quietly
 * become the wider one: a reset still names the person and nothing else, so
 * it takes every session whatever minted it — the ones a password minted, the
 * ones an identity provider minted, and the ones that recorded nothing at all
 * because they predate the column.
 */

const redis = { get: vi.fn(), del: vi.fn(), set: vi.fn() };
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ redis }),
}));

import { revokeAllSessionsForUser } from "../revokeSessions";

const sessionsOfEveryMethod = [
  { sessionToken: "token-password", identifierId: "id_password", amr: ["pwd"] },
  {
    sessionToken: "token-provider",
    identifierId: "id_provider",
    amr: ["oidc", "mfa"],
  },
  { sessionToken: "token-before-the-column", identifierId: null, amr: [] },
];

describe("given a person holding sessions minted by several methods", () => {
  let prisma: {
    session: {
      findMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    redis.get.mockReset().mockResolvedValue(null);
    redis.del.mockReset().mockResolvedValue(1);
    prisma = {
      session: {
        findMany: vi.fn().mockResolvedValue(sessionsOfEveryMethod),
        deleteMany: vi
          .fn()
          .mockResolvedValue({ count: sessionsOfEveryMethod.length }),
      },
    };
  });

  describe("when they complete a password reset", () => {
    /** @scenario "Resetting a password still ends every session" */
    it("ends every one of their sessions, whatever method minted it", async () => {
      await revokeAllSessionsForUser({
        prisma: prisma as never,
        userId: "sam",
      });

      expect(prisma.session.deleteMany).toHaveBeenCalledTimes(1);
      // The person, and nothing else. No identifier, no `amr`, no sign-in
      // method: a reset is the recovery path for an account somebody may have
      // lost control of, and narrowing it would leave the attacker's session
      // in place.
      expect(prisma.session.deleteMany).toHaveBeenCalledWith({
        where: { userId: "sam" },
      });
    });

    /** @scenario "Resetting a password still ends every session" */
    it("clears the cached session behind every one of them", async () => {
      await revokeAllSessionsForUser({
        prisma: prisma as never,
        userId: "sam",
      });

      for (const session of sessionsOfEveryMethod) {
        expect(redis.del).toHaveBeenCalledWith(
          `better-auth:${session.sessionToken}`,
        );
      }
    });
  });
});
