/**
 * Tests for getServerAuthSession, the BetterAuth-backed session helper in
 * src/server/auth.ts. This is the nexus every protected tRPC call + API
 * route goes through, so its behavior — especially the admin impersonation
 * compat path — must be covered.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.fn();
vi.mock("~/server/better-auth", () => ({
  auth: {
    api: {
      get getSession() {
        return mockGetSession;
      },
    },
  },
}));

const mockSessionFindUnique = vi.fn();
const mockUserFindUnique = vi.fn();
/**
 * GAC-10. `getServerAuthSession` asks whether this person's organizations
 * bound the session's lifetime, and that question starts with "has anybody on
 * this installation set one at all" — a read across organizations.
 *
 * Every test below except the session-window ones answers "nobody", which is
 * the default every installation holds and which makes the rest of this file
 * behave exactly as it did before the bound existed.
 */
const mockOrganizationFindMany = vi.fn();
const mockOrganizationUserFindMany = vi.fn();
const mockSessionUpdateMany = vi.fn();
const mockSessionDeleteMany = vi.fn();
vi.mock("~/server/db", () => ({
  prisma: {
    session: {
      get findUnique() {
        return mockSessionFindUnique;
      },
      get updateMany() {
        return mockSessionUpdateMany;
      },
      // How a session past its window is actually destroyed. Absent from this
      // mock the destroy fails silently — the service swallows it on purpose
      // so a store blip cannot sign somebody IN — and the idle test below
      // would pass against an implementation that never deleted anything.
      get deleteMany() {
        return mockSessionDeleteMany;
      },
    },
    user: {
      get findUnique() {
        return mockUserFindUnique;
      },
    },
    organization: {
      get findMany() {
        return mockOrganizationFindMany;
      },
    },
    organizationUser: {
      get findMany() {
        return mockOrganizationUserFindMany;
      },
    },
  },
}));

import { forgetSignInSecurityPolicies } from "../app-layer/identity/runtime";
import { getServerAuthSession } from "../auth";

const fakeReq = { headers: { cookie: "better-auth.session_token=abc" } } as any;

const makeBetterAuthResponse = (
  overrides: Partial<{
    id: string;
    email: string;
    name: string;
    image: string;
  }> = {},
  sessionOverrides: Partial<{ id: string; expiresAt: Date | string }> = {},
) => ({
  session: {
    id: sessionOverrides.id ?? "sess_real",
    expiresAt: sessionOverrides.expiresAt ?? new Date(Date.now() + 86400_000),
  },
  user: {
    id: overrides.id ?? "user_1",
    email: overrides.email ?? "user1@example.com",
    name: overrides.name ?? "User One",
    image: overrides.image ?? null,
  },
});

/** A session row with no impersonation on it — every ordinary session. */
const ordinarySessionRow = (userId = "user_1") => ({
  userId,
  actorUserId: null,
  subjectUserId: null,
  impersonationReason: null,
  impersonationExpiresAt: null,
  // GAC-10's columns. Minted a minute ago and used a minute ago, so nothing
  // here is idle or over-age under any window a test might set.
  sessionToken: "token_real",
  createdAt: new Date(Date.now() - 60_000),
  lastSeenAt: new Date(Date.now() - 60_000),
  updatedAt: new Date(Date.now() - 60_000),
});

/** A session row carrying the {actor, subject} claims (D06). */
const impersonatingSessionRow = ({
  sessionUserId,
  subjectUserId,
  actorUserId,
  reason = "support",
  expiresAt,
}: {
  sessionUserId: string;
  subjectUserId: string;
  actorUserId?: string;
  reason?: string;
  expiresAt?: Date;
}) => ({
  userId: sessionUserId,
  actorUserId: actorUserId ?? sessionUserId,
  subjectUserId,
  impersonationReason: reason,
  impersonationExpiresAt: expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
});

describe("getServerAuthSession", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockSessionFindUnique.mockReset();
    mockUserFindUnique.mockReset();
    mockOrganizationFindMany.mockReset();
    mockOrganizationUserFindMany.mockReset();
    mockSessionUpdateMany.mockReset();
    mockSessionDeleteMany.mockReset();
    mockSessionDeleteMany.mockResolvedValue({ count: 1 });
    // Default: any impersonation subject is an active user.
    mockUserFindUnique.mockResolvedValue({
      id: "target_1",
      name: "Target User",
      email: "target@customer.com",
      image: null,
      deactivatedAt: null,
    });
    // Default: nobody on this installation bounds a session's lifetime, which
    // is what every organization holds until an administrator sets one.
    mockOrganizationFindMany.mockResolvedValue([]);
    mockOrganizationUserFindMany.mockResolvedValue([]);
    mockSessionUpdateMany.mockResolvedValue({ count: 1 });
    // The installation-wide answer is memoised for thirty seconds so it is
    // not re-read per request; a test that changes it has to say so.
    forgetSignInSecurityPolicies();
  });

  describe("when there is no session cookie", () => {
    it("returns null", async () => {
      mockGetSession.mockResolvedValue(null);
      const result = await getServerAuthSession({ req: fakeReq });
      expect(result).toBeNull();
    });
  });

  describe("when a plain session exists with no impersonation", () => {
    it("returns the NextAuth-shaped session", async () => {
      mockGetSession.mockResolvedValue(makeBetterAuthResponse());
      mockSessionFindUnique.mockResolvedValue(ordinarySessionRow());

      const result = await getServerAuthSession({ req: fakeReq });
      expect(result).toMatchObject({
        user: {
          id: "user_1",
          email: "user1@example.com",
          name: "User One",
        },
      });
      expect(result?.user.impersonator).toBeUndefined();
    });

    it("populates pendingSsoSetup when the user has it", async () => {
      mockGetSession.mockResolvedValue({
        session: { id: "sess_real", expiresAt: new Date() },
        user: {
          id: "user_1",
          email: "u@example.com",
          name: "U",
          image: null,
          pendingSsoSetup: true,
        },
      });
      mockSessionFindUnique.mockResolvedValue(ordinarySessionRow());

      const result = await getServerAuthSession({ req: fakeReq });
      expect(result?.user.pendingSsoSetup).toBe(true);
    });
  });

  describe("when BetterAuth returns a cached session but the DB row is gone (CodeRabbit)", () => {
    // This covers the fail-closed fix for bug 38: if the Redis-cached
    // BetterAuth session outlives the DB row (Redis delete failed during
    // revocation, or some out-of-band DB delete happened), we must
    // reject the session instead of accepting it.
    it("returns null and does not expose user identity", async () => {
      mockGetSession.mockResolvedValue(makeBetterAuthResponse());
      mockSessionFindUnique.mockResolvedValue(null);

      const result = await getServerAuthSession({ req: fakeReq });
      expect(result).toBeNull();
    });
  });

  describe("when an admin is impersonating another user", () => {
    /** @scenario "An impersonated session records both people" */
    it("names the operator as the actor and the subject as the subject", async () => {
      mockGetSession.mockResolvedValue(
        makeBetterAuthResponse({
          id: "admin_1",
          email: "admin@langwatch.ai",
          name: "Admin One",
        }),
      );
      mockSessionFindUnique.mockResolvedValue(
        impersonatingSessionRow({
          sessionUserId: "admin_1",
          subjectUserId: "target_1",
          reason: "customer asked us to look",
        }),
      );
      mockUserFindUnique.mockResolvedValue({
        id: "target_1",
        name: "Target User",
        email: "target@customer.com",
        image: null,
        deactivatedAt: null,
      });

      const result = await getServerAuthSession({ req: fakeReq });

      expect(result?.principal).toEqual({
        actor: { userId: "admin_1" },
        subject: { userId: "target_1" },
      });
      expect(result?.impersonationReason).toBe("customer asked us to look");
      expect(result?.user.id).toBe("target_1");
      expect(result?.user.email).toBe("target@customer.com");
      expect(result?.user.impersonator).toEqual({
        id: "admin_1",
        name: "Admin One",
        email: "admin@langwatch.ai",
        image: null,
      });
    });
  });

  describe("when nobody is impersonating", () => {
    /** @scenario "An impersonated session records both people" */
    it("names the same person as actor and subject", async () => {
      mockGetSession.mockResolvedValue(makeBetterAuthResponse());
      mockSessionFindUnique.mockResolvedValue(ordinarySessionRow());

      const result = await getServerAuthSession({ req: fakeReq });

      expect(result?.principal).toEqual({
        actor: { userId: "user_1" },
        subject: { userId: "user_1" },
      });
      expect(result?.user.impersonator).toBeUndefined();
    });
  });

  describe("when the impersonation window has lapsed", () => {
    it("returns the operator to their own session, ending nothing", async () => {
      mockGetSession.mockResolvedValue(
        makeBetterAuthResponse({
          id: "admin_1",
          email: "admin@langwatch.ai",
        }),
      );
      mockSessionFindUnique.mockResolvedValue(
        impersonatingSessionRow({
          sessionUserId: "admin_1",
          subjectUserId: "target_1",
          expiresAt: new Date(Date.now() - 1000),
        }),
      );

      const result = await getServerAuthSession({ req: fakeReq });
      expect(result?.user.id).toBe("admin_1");
      expect(result?.user.impersonator).toBeUndefined();
      expect(result?.principal).toEqual({
        actor: { userId: "admin_1" },
        subject: { userId: "admin_1" },
      });
    });
  });

  describe("when the claims are half written", () => {
    it("ignores a subject with no actor beside it", async () => {
      mockGetSession.mockResolvedValue(makeBetterAuthResponse());
      mockSessionFindUnique.mockResolvedValue({
        ...ordinarySessionRow(),
        subjectUserId: "target_1",
        impersonationExpiresAt: new Date(Date.now() + 60_000),
      });
      const result = await getServerAuthSession({ req: fakeReq });
      expect(result?.user.id).toBe("user_1");
      expect(result?.user.impersonator).toBeUndefined();
    });

    it("ignores claims with no window on them", async () => {
      mockGetSession.mockResolvedValue(makeBetterAuthResponse());
      mockSessionFindUnique.mockResolvedValue({
        ...ordinarySessionRow(),
        actorUserId: "user_1",
        subjectUserId: "target_1",
      });
      const result = await getServerAuthSession({ req: fakeReq });
      expect(result?.user.id).toBe("user_1");
      expect(result?.user.impersonator).toBeUndefined();
    });

    it("ignores an actor that is not the session's own user", async () => {
      mockGetSession.mockResolvedValue(makeBetterAuthResponse());
      mockSessionFindUnique.mockResolvedValue(
        impersonatingSessionRow({
          sessionUserId: "user_1",
          actorUserId: "somebody_else",
          subjectUserId: "target_1",
        }),
      );
      const result = await getServerAuthSession({ req: fakeReq });
      expect(result?.user.id).toBe("user_1");
      expect(result?.user.impersonator).toBeUndefined();
    });
  });

  describe("when the impersonation subject was deleted after it started", () => {
    it("falls back to the operator's own session", async () => {
      mockGetSession.mockResolvedValue(
        makeBetterAuthResponse({ id: "admin_1", email: "admin@x.com" }),
      );
      mockSessionFindUnique.mockResolvedValue(
        impersonatingSessionRow({
          sessionUserId: "admin_1",
          subjectUserId: "target_1",
        }),
      );
      // Subject returned as null — deleted
      mockUserFindUnique.mockResolvedValue(null);

      const result = await getServerAuthSession({ req: fakeReq });
      expect(result?.user.id).toBe("admin_1");
      expect(result?.user.impersonator).toBeUndefined();
    });
  });

  describe("when the impersonation subject was deactivated after it started", () => {
    it("falls back to the operator's own session", async () => {
      mockGetSession.mockResolvedValue(
        makeBetterAuthResponse({ id: "admin_1", email: "admin@x.com" }),
      );
      mockSessionFindUnique.mockResolvedValue(
        impersonatingSessionRow({
          sessionUserId: "admin_1",
          subjectUserId: "target_1",
        }),
      );
      // Subject exists but is deactivated
      mockUserFindUnique.mockResolvedValue({
        id: "target_1",
        name: "Target",
        email: "target@x.com",
        image: null,
        deactivatedAt: new Date("2020-01-01"),
      });

      const result = await getServerAuthSession({ req: fakeReq });
      expect(result?.user.id).toBe("admin_1");
      expect(result?.user.impersonator).toBeUndefined();
    });
  });

  describe("when the BetterAuth getSession call throws", () => {
    it("returns null instead of propagating the error", async () => {
      mockGetSession.mockRejectedValue(new Error("boom"));
      const result = await getServerAuthSession({ req: fakeReq });
      expect(result).toBeNull();
    });
  });

  describe("when the request headers are missing", () => {
    it("passes empty headers and does not throw", async () => {
      mockGetSession.mockResolvedValue(null);
      const result = await getServerAuthSession({ req: {} as any });
      expect(result).toBeNull();
      expect(mockGetSession).toHaveBeenCalled();
    });
  });

  /**
   * GAC-10, specs/identity/org-session-lifetime.feature.
   *
   * These are the tests that pin the BOUND TO THE SEAM. The arithmetic and
   * the service are proved elsewhere; what matters here is that this
   * function — the one place every surface turns a session into an identity —
   * actually asks, and that a session past its window stops being one.
   */
  describe("when the person's organization ends idle sessions", () => {
    /** A member of one organization with a sixty-minute idle timeout. */
    const boundedToAnHourIdle = () => {
      mockOrganizationFindMany.mockResolvedValue([
        { sessionIdleTimeoutMinutes: 60, sessionMaxLifetimeMinutes: 0 },
      ]);
      mockOrganizationUserFindMany.mockResolvedValue([
        {
          organization: {
            sessionIdleTimeoutMinutes: 60,
            sessionMaxLifetimeMinutes: 0,
          },
        },
      ]);
      forgetSignInSecurityPolicies();
    };

    /** @scenario "A session past its window is refused on every surface" */
    it("refuses a session that has been idle past the window", async () => {
      boundedToAnHourIdle();
      mockGetSession.mockResolvedValue(makeBetterAuthResponse());
      const idleSince = new Date(Date.now() - 70 * 60_000);
      mockSessionFindUnique.mockResolvedValue({
        ...ordinarySessionRow(),
        lastSeenAt: idleSince,
        updatedAt: idleSince,
      });

      expect(await getServerAuthSession({ req: fakeReq })).toBeNull();
      // DESTROYED, not merely refused. Refusing it here while the row and its
      // cached copy live on would leave it honoured everywhere else, and this
      // assertion is the difference — without it the test passes against an
      // implementation that deletes nothing at all.
      expect(mockSessionDeleteMany).toHaveBeenCalledWith({
        where: { sessionToken: "token_real" },
      });
    });

    it("leaves a session that is still being used", async () => {
      boundedToAnHourIdle();
      mockGetSession.mockResolvedValue(makeBetterAuthResponse());
      mockSessionFindUnique.mockResolvedValue(ordinarySessionRow());

      expect(await getServerAuthSession({ req: fakeReq })).not.toBeNull();
    });

    it("records that a session was used, once the stamp is stale enough", async () => {
      boundedToAnHourIdle();
      mockGetSession.mockResolvedValue(makeBetterAuthResponse());
      const usedTwentyMinutesAgo = new Date(Date.now() - 20 * 60_000);
      mockSessionFindUnique.mockResolvedValue({
        ...ordinarySessionRow(),
        lastSeenAt: usedTwentyMinutesAgo,
        updatedAt: usedTwentyMinutesAgo,
      });

      await getServerAuthSession({ req: fakeReq });

      expect(mockSessionUpdateMany).toHaveBeenCalled();
    });
  });

  describe("when nobody on the installation bounds a session", () => {
    /** @scenario "No window means the session behaves as it always has" */
    it("leaves a session untouched however long it has been idle", async () => {
      mockGetSession.mockResolvedValue(makeBetterAuthResponse());
      const idleSinceFebruary = new Date(Date.now() - 200 * 24 * 3600_000);
      mockSessionFindUnique.mockResolvedValue({
        ...ordinarySessionRow(),
        lastSeenAt: idleSinceFebruary,
        updatedAt: idleSinceFebruary,
      });

      expect(await getServerAuthSession({ req: fakeReq })).not.toBeNull();
      // The early-out: no per-person read, and no stamp written. This is what
      // keeps the feature free for every installation that has not turned it
      // on, and it is asserted rather than assumed.
      expect(mockOrganizationUserFindMany).not.toHaveBeenCalled();
      expect(mockSessionUpdateMany).not.toHaveBeenCalled();
    });
  });
});
