import { describe, expect, it, vi } from "vitest";
import {
  AuthService,
  type BrowserSession,
  type VerifiedBrowserSession,
} from "@langwatch/auth-contract";
import { getServerAuthSession, type BrowserSessionApplication } from "../auth";

class TestAuthService extends AuthService {
  readonly resolve =
    vi.fn<(input: { verified: VerifiedBrowserSession | null }) => Promise<BrowserSession | null>>();

  async tryResolveBrowserSession(input: {
    verified: VerifiedBrowserSession | null;
  }): Promise<BrowserSession | null> {
    return this.resolve(input);
  }

  async revokeAllBrowserSessions(): Promise<void> {}
  async revokeBrowserSession(): Promise<void> {}
  async revokeOtherBrowserSessions(): Promise<void> {}
}

const verified: VerifiedBrowserSession = {
  session: { id: "session-1", expiresAt: new Date("2030-01-01T00:00:00.000Z") },
  user: {
    id: "user-1",
    name: "User",
    email: "user@example.com",
    image: null,
    pendingSsoSetup: false,
  },
};

const resolved: BrowserSession = {
  user: verified.user,
  expires: "2030-01-01T00:00:00.000Z",
  sessionId: "session-1",
};

function app(getSession: BrowserSessionApplication["betterAuth"]["api"]["getSession"]) {
  const auth = new TestAuthService();
  return {
    app: { auth, betterAuth: { api: { getSession } } } satisfies BrowserSessionApplication,
    auth,
  };
}

describe("getServerAuthSession", () => {
  it("uses the explicitly composed Better Auth and Auth services", async () => {
    const getSession = vi.fn().mockResolvedValue(verified);
    const fixture = app(getSession);
    fixture.auth.resolve.mockResolvedValue(resolved);

    await expect(
      getServerAuthSession({
        app: fixture.app,
        req: { headers: { cookie: "better-auth.session_token=token" } },
      }),
    ).resolves.toEqual(resolved);
    expect(getSession).toHaveBeenCalledWith({ headers: expect.any(Headers) });
    expect(fixture.auth.resolve).toHaveBeenCalledWith({ verified });
  });

  it("does not resolve a missing Better Auth session", async () => {
    const fixture = app(vi.fn().mockResolvedValue(null));

    await expect(getServerAuthSession({ app: fixture.app, req: {} })).resolves.toBeNull();
    expect(fixture.auth.resolve).not.toHaveBeenCalled();
  });

  it("preserves the legacy null result when session lookup fails", async () => {
    const fixture = app(vi.fn().mockRejectedValue(new Error("redis unavailable")));

    await expect(getServerAuthSession({ app: fixture.app, req: {} })).resolves.toBeNull();
  });
});
