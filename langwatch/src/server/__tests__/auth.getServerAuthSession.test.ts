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
vi.mock("~/server/db", () => ({
  prisma: {
    session: {
      get findUnique() {
        return mockSessionFindUnique;
      },
    },
    user: {
      get findUnique() {
        return mockUserFindUnique;
      },
    },
  },
}));

import { getServerAuthSession } from "../auth";

const fakeReq = { headers: { cookie: "better-auth.session_token=abc" } } as any;

const makeBetterAuthResponse = (
  overrides: Partial<{ id: string; email: string; name: string; image: string }> = {},
  sessionOverrides: Partial<{ id: string; expiresAt: Date | string }> = {},
) => ({
  session: {
    id: sessionOverrides.id ?? "sess_real",
    expiresAt:
      sessionOverrides.expiresAt ?? new Date(Date.now() + 86400_000),
  },
  user: {
    id: overrides.id ?? "user_1",
    email: overrides.email ?? "user1@example.com",
    name: overrides.name ?? "User One",
    image: overrides.image ?? null,
  },
});

describe("getServerAuthSession", () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockSessionFindUnique.mockReset();
    mockUserFindUnique.mockReset();
    // Default: any impersonation target is an active user.
    mockUserFindUnique.mockResolvedValue({ id: "target_1", deactivatedAt: null });
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
      mockSessionFindUnique.mockResolvedValue({ impersonating: null });

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
      mockSessionFindUnique.mockResolvedValue({ impersonating: null });

      const result = await getServerAuthSession({ req: fakeReq });
      expect(result?.user.pendingSsoSetup).toBe(true);
    });
  });

  describe("when an admin is impersonating another user", () => {
    it("rewrites session.user to the impersonated user and sets impersonator", async () => {
      mockGetSession.mockResolvedValue(makeBetterAuthResponse({
        id: "admin_1",
        email: "admin@langwatch.ai",
        name: "Admin One",
      }));
      mockSessionFindUnique.mockResolvedValue({
        impersonating: {
          id: "target_1",
          name: "Target User",
          email: "target@customer.com",
          image: null,
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      });

      const result = await getServerAuthSession({ req: fakeReq });

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

  describe("when impersonation has expired", () => {
    it("falls through to the real session without impersonator", async () => {
      mockGetSession.mockResolvedValue(makeBetterAuthResponse({
        id: "admin_1",
        email: "admin@langwatch.ai",
      }));
      mockSessionFindUnique.mockResolvedValue({
        impersonating: {
          id: "target_1",
          name: "Target",
          email: "target@x.com",
          image: null,
          expires: new Date(Date.now() - 1000).toISOString(),
        },
      });

      const result = await getServerAuthSession({ req: fakeReq });
      expect(result?.user.id).toBe("admin_1");
      expect(result?.user.impersonator).toBeUndefined();
    });
  });

  describe("when impersonating has a malformed payload", () => {
    it("ignores it and returns the real session", async () => {
      mockGetSession.mockResolvedValue(makeBetterAuthResponse());
      mockSessionFindUnique.mockResolvedValue({
        impersonating: { garbage: true },
      });
      const result = await getServerAuthSession({ req: fakeReq });
      expect(result?.user.id).toBe("user_1");
      expect(result?.user.impersonator).toBeUndefined();
    });

    it("ignores it when impersonating is missing required fields", async () => {
      mockGetSession.mockResolvedValue(makeBetterAuthResponse());
      mockSessionFindUnique.mockResolvedValue({
        impersonating: { expires: new Date(Date.now() + 10000) },
      });
      const result = await getServerAuthSession({ req: fakeReq });
      expect(result?.user.id).toBe("user_1");
      expect(result?.user.impersonator).toBeUndefined();
    });

    it("ignores it when expires is missing", async () => {
      mockGetSession.mockResolvedValue(makeBetterAuthResponse());
      mockSessionFindUnique.mockResolvedValue({
        impersonating: { id: "target_1", email: "t@x.com" },
      });
      const result = await getServerAuthSession({ req: fakeReq });
      expect(result?.user.id).toBe("user_1");
      expect(result?.user.impersonator).toBeUndefined();
    });
  });

  describe("when the impersonation target was deleted after impersonation started", () => {
    it("falls back to the admin session", async () => {
      mockGetSession.mockResolvedValue(
        makeBetterAuthResponse({ id: "admin_1", email: "admin@x.com" }),
      );
      mockSessionFindUnique.mockResolvedValue({
        impersonating: {
          id: "target_1",
          name: "Target",
          email: "target@x.com",
          image: null,
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      });
      // Target user returned as null — deleted
      mockUserFindUnique.mockResolvedValue(null);

      const result = await getServerAuthSession({ req: fakeReq });
      expect(result?.user.id).toBe("admin_1");
      expect(result?.user.impersonator).toBeUndefined();
    });
  });

  describe("when the impersonation target was deactivated after impersonation started", () => {
    it("falls back to the admin session", async () => {
      mockGetSession.mockResolvedValue(
        makeBetterAuthResponse({ id: "admin_1", email: "admin@x.com" }),
      );
      mockSessionFindUnique.mockResolvedValue({
        impersonating: {
          id: "target_1",
          name: "Target",
          email: "target@x.com",
          image: null,
          expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        },
      });
      // Target exists but is deactivated
      mockUserFindUnique.mockResolvedValue({
        id: "target_1",
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
});
