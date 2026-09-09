import { describe, expect, it } from "vitest";
import { browserSessionSchema, verifiedBrowserSessionSchema } from "@langwatch/auth-contract";

describe("Auth contract", () => {
  it("defines the Better Auth-compatible browser-session boundary", () => {
    const verified = verifiedBrowserSessionSchema.parse({
      session: { id: "session-1", expiresAt: "2030-01-01T00:00:00.000Z" },
      user: { id: "user-1", name: "User", email: "user@example.com", image: null },
    });

    expect(
      browserSessionSchema.parse({
        user: { ...verified.user, pendingSsoSetup: false },
        expires: "2030-01-01T00:00:00.000Z",
        sessionId: verified.session.id,
      }),
    ).toMatchObject({ sessionId: "session-1", user: { id: "user-1" } });
  });

  describe("when Better Auth answers with its own whole record", () => {
    /**
     * What `auth.api.getSession` actually returns: the full session and user
     * rows, plus the `additionalFields` the transport configures. The API
     * composition passes this through unreshaped, so it is what the contract
     * meets in production — and the trimmed object every other fixture in this
     * repo hand-builds is a shape Better Auth never sends.
     */
    const betterAuthSession = {
      session: {
        id: "session-1",
        token: "a-session-token",
        userId: "user-1",
        expiresAt: new Date("2030-01-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        ipAddress: "203.0.113.7",
        userAgent: "Mozilla/5.0",
        impersonating: false,
      },
      user: {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        emailVerified: true,
        image: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        pendingSsoSetup: false,
        deactivatedAt: null,
        lastLoginAt: new Date("2026-01-03T00:00:00.000Z"),
      },
    };

    it("resolves the session rather than refusing the keys it did not ask for", () => {
      const parsed = verifiedBrowserSessionSchema.parse(betterAuthSession);

      expect(parsed.session.id).toBe("session-1");
      expect(parsed.user.id).toBe("user-1");
    });

    it("keeps the token and the rest of the record out of the parsed value", () => {
      const parsed = verifiedBrowserSessionSchema.parse(betterAuthSession);

      expect(Object.keys(parsed.session).sort()).toEqual(["expiresAt", "id"]);
      expect(Object.keys(parsed.user).sort()).toEqual([
        "email",
        "id",
        "image",
        "name",
        "pendingSsoSetup",
      ]);
    });
  });
});
