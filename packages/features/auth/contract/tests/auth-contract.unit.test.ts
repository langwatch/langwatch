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
});
