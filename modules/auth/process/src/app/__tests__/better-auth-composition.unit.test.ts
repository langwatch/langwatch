import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { VerifiedBrowserSession } from "@langwatch/auth-contract";
import { AuthUnavailableError } from "@langwatch/auth-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
/**
 * The module composes the deployment's ONE Better Auth instance, and the
 * session verification every door on the process reads runs through it.
 *
 * @see specs/auth/auth-rest-family-mounted.feature
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { describe, expect, it, vi } from "vitest";

import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import { AuthApp } from "../auth.app.ts";
import { NO_SIGN_IN_PROVIDERS, type SignInProvidersConfig } from "./support/sign-in-providers.ts";
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

function sessionSecretFor(named: boolean): string | undefined {
  return named ? BROWSER_SESSION.secret : void 0;
}

/** `named` supplies NEXTAUTH_SECRET and NEXTAUTH_URL together, or neither. */
async function appFor(
  named = false,
  providers: {
    config?: Partial<SignInProvidersConfig>;
    secrets?: Partial<Record<string, string>>;
  } = {},
): Promise<AuthApp> {
  return AuthApp.create({
    config: {
      sessionUrl: named ? BROWSER_SESSION.baseUrl : undefined,
      mfaEnrollmentOpen: BROWSER_SESSION.mfaEnrollmentOpen,
      passkeysEnabled: BROWSER_SESSION.passkeysEnabled,
      passkeyHandleSecret: BROWSER_SESSION.passkeyHandleSecret,
      trustedIdpOrigins: undefined,
      idpSimulatorUrl: undefined,
      localPasswords: false,
      signInProviders: { ...NO_SIGN_IN_PROVIDERS, ...providers.config },
    },
    repositories: MemoryAuthRepositories.create(),
    dependencies: {
      users: new TestUserApi({}) as never,
      apiKeys: { findResolvedToken: async () => null } as never,
      featureFlags: {} as never,
      identity: createApiFixture<IdentityApi>(),
      organizations: createApiFixture<OrganizationApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      licensing: createApiFixture<LicensingApi>(),
      auditLog: createApiFixture<AuditLogApi>({ record: async () => {} }),
    },
    members: {
      encryption: { encrypt: (value: string) => value, decrypt: (value: string) => value },
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
      route: undefined as never,
      signUp: null,
      invites: null,
      authProvider: undefined as never,
      isSaas: false,
      nodeEnvironment: undefined,
      processName: "langwatch-api",
    },
    resources: { own: () => undefined } as never,
    // The deployment's session key reaches the app through its declared handle.
    secrets: new ScopedSecrets(async (handle, build) =>
      build({ ...providers.secrets, NEXTAUTH_SECRET: sessionSecretFor(named) }[handle.id]),
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
    ).resolves.toEqual({ kind: "anonymous" });
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

function mountedProviderIds(app: AuthApp): string[] {
  const { options } = app.betterAuth();
  const genericOAuth = options.plugins?.find((plugin) => plugin.id === "generic-oauth");
  const configs = (genericOAuth?.options as { config?: { providerId: string }[] } | undefined)
    ?.config;
  return [
    ...Object.keys(options.socialProviders ?? {}),
    ...(configs ?? []).map((config) => config.providerId),
  ];
}

describe("given a deployment that names no sign-in provider", () => {
  /** @scenario "A deployment that names no provider mounts none" */
  it("mounts no social or enterprise provider", async () => {
    const app = await appFor(true);

    expect(mountedProviderIds(app)).toEqual([]);
  });
});

describe("given a deployment that names a provider and supplies its registration", () => {
  it.each([
    {
      provider: "google",
      config: { googleClientId: "google-id" },
      secrets: { GOOGLE_CLIENT_SECRET: "google-secret" },
    },
    {
      provider: "github",
      config: { githubClientId: "github-id" },
      secrets: { GITHUB_CLIENT_SECRET: "github-secret" },
    },
    {
      provider: "auth0",
      config: { auth0ClientId: "auth0-id", auth0Issuer: "https://tenant.auth0.test/" },
      secrets: { AUTH0_CLIENT_SECRET: "auth0-secret" },
    },
  ])("mounts $provider", async ({ provider, config, secrets }) => {
    const app = await appFor(true, { config: { authProvider: provider, ...config }, secrets });

    expect(mountedProviderIds(app)).toEqual([provider]);
  });

  /** @scenario "A named provider with its credentials mounts on Better Auth" */
  it("mounts auth0 with its stored-account issuer pin and ID-token verification", async () => {
    const app = await appFor(true, {
      config: {
        authProvider: "auth0",
        auth0ClientId: "auth0-id",
        auth0Issuer: "https://tenant.auth0.test/",
      },
      secrets: { AUTH0_CLIENT_SECRET: "auth0-secret" },
    });
    const genericOAuth = app
      .betterAuth()
      .options.plugins?.find((plugin) => plugin.id === "generic-oauth");

    expect(genericOAuth?.options).toMatchObject({
      config: [
        {
          providerId: "auth0",
          clientSecret: "auth0-secret",
          accountIssuer: "local:oauth:auth0",
          requireIdTokenVerification: true,
          redirectURI: "https://app.langwatch.test/api/auth/callback/auth0",
        },
      ],
    });
  });

  /** @scenario "A named provider without its secret mounts nothing" */
  it("mounts nothing when the named provider's secret is missing", async () => {
    const app = await appFor(true, {
      config: { authProvider: "google", googleClientId: "google-id" },
    });

    expect(mountedProviderIds(app)).toEqual([]);
  });
});

describe("given a deployment outside email mode with several providers' credentials set", () => {
  /** @scenario "Every social provider with credentials mounts outside email mode" */
  it("mounts every social provider beside the named one", async () => {
    const app = await appFor(true, {
      config: {
        authProvider: "auth0",
        auth0ClientId: "auth0-id",
        auth0Issuer: "https://tenant.auth0.test/",
        googleClientId: "google-id",
        githubClientId: "github-id",
      },
      secrets: {
        AUTH0_CLIENT_SECRET: "auth0-secret",
        GOOGLE_CLIENT_SECRET: "google-secret",
        GITHUB_CLIENT_SECRET: "github-secret",
      },
    });

    expect(mountedProviderIds(app)).toEqual(["google", "github", "auth0"]);
  });
});

describe("given a deployment in email mode with social credentials lingering", () => {
  /** @scenario "Email mode mounts no social provider whatever credentials linger" */
  it("mounts none of them", async () => {
    const app = await appFor(true, {
      config: { authProvider: "email", googleClientId: "google-id" },
      secrets: { GOOGLE_CLIENT_SECRET: "google-secret" },
    });

    expect(mountedProviderIds(app)).toEqual([]);
  });
});
