import type { VerifiedBrowserSession } from "@langwatch/auth-contract";
import { AuthUnavailableError } from "@langwatch/auth-contract";
/**
 * The module composes the deployment's ONE Better Auth instance, and the
 * session verification every door on the process reads runs through it.
 *
 * @see specs/auth/auth-rest-family-mounted.feature
 */
import { createLogger } from "@langwatch/observability";
import { ScopedSecrets } from "@langwatch/secrets";
import { describe, expect, it, vi } from "vitest";

import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import { AuthApp } from "../auth.app.ts";
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

/** `named` supplies NEXTAUTH_SECRET and NEXTAUTH_URL together, or neither. */
async function appFor(named = false): Promise<AuthApp> {
  return AuthApp.create({
    config: {
      sessionUrl: named ? BROWSER_SESSION.baseUrl : undefined,
      mfaEnrollmentOpen: BROWSER_SESSION.mfaEnrollmentOpen,
      passkeysEnabled: BROWSER_SESSION.passkeysEnabled,
      passkeyHandleSecret: BROWSER_SESSION.passkeyHandleSecret,
    },
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
      rateLimiter: { check: async () => ({ allowed: true }) } as never,
      secrets: {
        find: () => undefined,
        read: (key: string) => {
          throw new Error(`test double does not stub secrets.read("${key}")`);
        },
      },
      publicBaseUrl: undefined,
      identityEmails: undefined as never,
      rateLimit: undefined as never,
      route: undefined as never,
      signUp: null,
      invites: null,
      authProvider: undefined as never,
      federatedProvider: undefined,
      isSaas: false,
      processName: "langwatch-api",
    },
    resources: { own: () => undefined } as never,
    // The deployment's session key reaches the app through its declared handle.
    secrets: new ScopedSecrets(async (_handle, build) =>
      build(named ? BROWSER_SESSION.secret : void 0),
    ),
  });
}

describe("given a deployment that named no browser-session identity", () => {
  it("composes no instance and refuses the sign-in door by name", async () => {
    const app = await appFor();

    expect(() => app.betterAuth()).toThrowError(AuthUnavailableError);
    expect(() => app.betterAuth()).toThrowError(/NEXTAUTH_SECRET and NEXTAUTH_URL/);
  });

  it("verifies every caller as anonymous rather than failing", async () => {
    const app = await appFor();

    await expect(app.tryVerifyBrowserSession({ headers: new Headers() })).resolves.toBeNull();
    await expect(
      app.resolveSession(new Request("https://app.langwatch.test/api/auth/session")),
    ).resolves.toBeNull();
  });
});

describe("given a deployment that named one", () => {
  it("composes exactly one instance, shared by every caller", async () => {
    const app = await appFor(true);

    expect(app.betterAuth()).toBe(app.betterAuth());
  });

  it("verifies a browser session through that instance and accepts what it accepts", async () => {
    const app = await appFor(true);
    const getSession = vi.fn(async () => VERIFIED);
    app.betterAuth().api.getSession = getSession as never;

    const headers = new Headers({ cookie: "better-auth.session_token=token" });

    await expect(app.tryVerifyBrowserSession({ headers })).resolves.toEqual(VERIFIED);
    expect(getSession).toHaveBeenCalledWith({ headers });
  });

  it("refuses a session that instance rejects, without raising", async () => {
    const app = await appFor(true);
    app.betterAuth().api.getSession = (async () => null) as never;

    await expect(
      app.tryVerifyBrowserSession({ headers: new Headers({ cookie: "stale=1" }) }),
    ).resolves.toBeNull();
  });
});

describe("when the born-finalized entrance is reached", () => {
  it("refuses by name rather than signing somebody up outside the birth context", async () => {
    const app = await appFor(true);

    await expect(app.runWithIdentityBirth(async () => "unreached")).rejects.toThrowError(
      /identity birth context/,
    );
  });
});
