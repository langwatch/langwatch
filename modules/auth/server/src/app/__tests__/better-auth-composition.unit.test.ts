/**
 * The module composes the deployment's ONE Better Auth instance, and the
 * session verification every door on the process reads runs through it.
 *
 * @see specs/auth/auth-rest-family-mounted.feature
 */
import { createLogger } from "@langwatch/observability";
import type { VerifiedBrowserSession } from "@langwatch/auth-contract";
import { describe, expect, it, vi } from "vitest";
import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import { AuthApp, AuthUnavailableError, type AuthAppConfig } from "../auth.app.ts";
import { TestUserApi } from "./support/test-user-api.ts";

const BROWSER_SESSION = {
  secret: "test-session-secret",
  baseUrl: "https://app.langwatch.test",
  publicBaseUrl: undefined,
  mfaEnrollmentOpen: false,
  passkeysEnabled: false,
  passkeyHandleSecret: "test-passkey-secret",
} as const;

const VERIFIED: VerifiedBrowserSession = {
  session: { id: "session_1" },
  user: { id: "user_1" },
} as VerifiedBrowserSession;

function appFor(config: Partial<AuthAppConfig> = {}): AuthApp {
  return AuthApp.create({
    config: { processName: "langwatch-api", isSaas: false, ...config },
    repositories: MemoryAuthRepositories.create(),
    dependencies: {
      users: new TestUserApi({}) as never,
      apiKeys: { findResolvedToken: async () => null } as never,
      featureFlags: {} as never,
    },
    members: {
      logger: createLogger("langwatch:auth:test"),
      // Better Auth's storage and hook repositories take the client and query
      // nothing until a request reaches them; no test below reaches one.
      prisma: {} as never,
      redis: null as never,
      identityEmails: undefined as never,
      rateLimit: undefined as never,
      route: undefined as never,
      signUp: null,
      invites: null,
      authProvider: undefined as never,
      processName: "langwatch-api",
    },
    resources: { own: () => undefined } as never,
  });
}

describe("given a deployment that named no browser-session identity", () => {
  it("composes no instance and refuses the sign-in door by name", () => {
    const app = appFor();

    expect(() => app.betterAuth()).toThrowError(AuthUnavailableError);
    expect(() => app.betterAuth()).toThrowError(/NEXTAUTH_SECRET and NEXTAUTH_URL/);
  });

  it("verifies every caller as anonymous rather than failing", async () => {
    const app = appFor();

    await expect(app.tryVerifyBrowserSession({ headers: new Headers() })).resolves.toBeNull();
    await expect(
      app.resolveSession(new Request("https://app.langwatch.test/api/auth/session")),
    ).resolves.toBeNull();
  });
});

describe("given a deployment that named one", () => {
  it("composes exactly one instance, shared by every caller", () => {
    const app = appFor({ browserSession: BROWSER_SESSION });

    expect(app.betterAuth()).toBe(app.betterAuth());
  });

  it("verifies a browser session through that instance and accepts what it accepts", async () => {
    const app = appFor({ browserSession: BROWSER_SESSION });
    const getSession = vi.fn(async () => VERIFIED);
    app.betterAuth().api.getSession = getSession as never;

    const headers = new Headers({ cookie: "better-auth.session_token=token" });

    await expect(app.tryVerifyBrowserSession({ headers })).resolves.toEqual(VERIFIED);
    expect(getSession).toHaveBeenCalledWith({ headers });
  });

  it("refuses a session that instance rejects, without raising", async () => {
    const app = appFor({ browserSession: BROWSER_SESSION });
    app.betterAuth().api.getSession = (async () => null) as never;

    await expect(
      app.tryVerifyBrowserSession({ headers: new Headers({ cookie: "stale=1" }) }),
    ).resolves.toBeNull();
  });
});

describe("when the born-finalized entrance is reached", () => {
  it("refuses by name rather than signing somebody up outside the birth context", async () => {
    const app = appFor({ browserSession: BROWSER_SESSION });

    await expect(app.runWithIdentityBirth(async () => "unreached")).rejects.toThrowError(
      /identity birth context/,
    );
  });
});
