import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { VerifiedBrowserSession } from "@langwatch/auth-contract";
import { AuthUnavailableError } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { SignInProviderMounts, SsoApi } from "@langwatch/enterprise-sso-contract";
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

const NO_MOUNTS: SignInProviderMounts = { socialProviders: {}, genericOAuthConfigs: [] };

function sessionSecretFor(named: boolean): string | undefined {
  return named ? BROWSER_SESSION.secret : void 0;
}

/** `named` supplies NEXTAUTH_SECRET and NEXTAUTH_URL together, or neither. */
async function appFor(
  named = false,
  providers: {
    config?: Partial<SignInProvidersConfig>;
    secrets?: Partial<Record<string, string>>;
    mounts?: SignInProviderMounts;
    askedFor?: { baseUrl: string }[];
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
      sso: createApiFixture<SsoApi>({
        getSignInProviderMounts: async (input) => {
          providers.askedFor?.push(input);
          return providers.mounts ?? NO_MOUNTS;
        },
      }),
      authz: createApiFixture<AuthzApi>({}),
      auditLog: createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
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
      signUp: null,
      invites: null,
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

    await expect(app.betterAuth()).rejects.toThrowError(AuthUnavailableError);
    await expect(app.betterAuth()).rejects.toThrowError(/NEXTAUTH_SECRET and NEXTAUTH_URL/);
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

    expect(await app.betterAuth()).toBe(await app.betterAuth());
  });

  it("verifies a browser session through that instance and accepts what it accepts", async () => {
    const app = await appFor(true);
    const getSession = vi.fn(async () => VERIFIED);
    (await app.betterAuth()).api.getSession = getSession as never;

    const headers = new Headers({ cookie: "better-auth.session_token=token" });

    await expect(app.tryVerifyBrowserSession({ headers })).resolves.toEqual(VERIFIED);
    expect(getSession).toHaveBeenCalledWith({ headers });
  });

  it("refuses a session that instance rejects, without raising", async () => {
    const app = await appFor(true);
    (await app.betterAuth()).api.getSession = (async () => null) as never;

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

async function mountedProviderIds(app: AuthApp): Promise<string[]> {
  const { options } = await app.betterAuth();
  const genericOAuth = options.plugins?.find((plugin) => plugin.id === "generic-oauth");
  const configs = (genericOAuth?.options as { config?: { providerId: string }[] } | undefined)
    ?.config;
  return [
    ...Object.keys(options.socialProviders ?? {}),
    ...(configs ?? []).map((config) => config.providerId),
  ];
}

describe("given enterprise SSO answers the deployment's sign-in providers", () => {
  it.each([
    {
      provider: "google",
      mounts: {
        socialProviders: { google: { clientId: "g", clientSecret: "s" } },
        genericOAuthConfigs: [],
      },
    },
    {
      provider: "github",
      mounts: {
        socialProviders: { github: { clientId: "h", clientSecret: "s" } },
        genericOAuthConfigs: [],
      },
    },
    {
      provider: "auth0",
      mounts: {
        socialProviders: {},
        genericOAuthConfigs: [
          {
            providerId: "auth0",
            clientId: "a",
            clientSecret: "s",
            discoveryUrl: "https://tenant.auth0.test/.well-known/openid-configuration",
          },
        ],
      },
    },
  ])("mounts $provider on Better Auth", async ({ provider, mounts }) => {
    const app = await appFor(true, { mounts });

    expect(await mountedProviderIds(app)).toEqual([provider]);
  });

  /** @scenario "Better Auth asks enterprise SSO for its providers on first use, not while composing" */
  it("asks SSO once, on first use, with Better Auth's own URL", async () => {
    const askedFor: { baseUrl: string }[] = [];
    const app = await appFor(true, { askedFor });

    expect(askedFor).toEqual([]);

    await Promise.all([app.betterAuth(), app.betterAuth()]);

    expect(askedFor).toEqual([{ baseUrl: BROWSER_SESSION.baseUrl }]);
  });
});
