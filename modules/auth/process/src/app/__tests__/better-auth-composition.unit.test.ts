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
import type { NotificationService } from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import { AuthModule } from "../auth.app.ts";
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

type MountsRequest = Parameters<SsoApi["getSignInProviderMounts"]>[0];

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
    askedFor?: MountsRequest[];
    identity?: IdentityApi;
  } = {},
): Promise<AuthModule> {
  return AuthModule.create({
    config: {
      sessionUrl: named ? BROWSER_SESSION.baseUrl : undefined,
      mfaEnrollmentOpen: BROWSER_SESSION.mfaEnrollmentOpen,
      passkeysEnabled: BROWSER_SESSION.passkeysEnabled,
      passkeyHandleSecret: BROWSER_SESSION.passkeyHandleSecret,
      trustedIdpOrigins: undefined,
      idpSimulatorUrl: undefined,
      localPasswords: false,
      auth0ManagementClientId: undefined,
      isSaas: false,
      signInProviders: { ...NO_SIGN_IN_PROVIDERS, ...providers.config },
    },
    repositories: MemoryAuthRepositories.create(),
    dependencies: {
      users: new TestUserApi({}) as never,
      apiKeys: { findResolvedToken: async () => null } as never,
      featureFlags: {} as never,
      identity: providers.identity ?? createApiFixture<IdentityApi>(),
      organizations: createApiFixture<OrganizationApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      licensing: createApiFixture<LicensingApi>(),
      notifications: createApiFixture<NotificationService>(),
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

    await expect(app.verifyBrowserSession({ headers: new Headers() })).resolves.toEqual({
      kind: "anonymous",
    });
    await expect(app.getSessionByCookie({ cookie: undefined })).resolves.toEqual({
      document: null,
    });
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

    await expect(app.verifyBrowserSession({ headers })).resolves.toEqual({
      kind: "verified",
      verified: VERIFIED,
    });
    expect(getSession).toHaveBeenCalledWith({ headers });
  });

  it("refuses a session that instance rejects, without raising", async () => {
    const app = await appFor(true);
    (await app.betterAuth()).api.getSession = (async () => null) as never;

    await expect(
      app.verifyBrowserSession({ headers: new Headers({ cookie: "stale=1" }) }),
    ).resolves.toEqual({ kind: "anonymous" });
  });
});

describe("when Better Auth deletes a user", () => {
  const USER = {
    id: "user_1",
    email: "person@example.test",
    name: "Person",
    emailVerified: true,
    image: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  /** @scenario "Deleting a user erases their identity identifiers" */
  it("asks identity to erase the user before the row goes", async () => {
    const erased: { id: string }[] = [];
    const app = await appFor(true, {
      identity: createApiFixture<IdentityApi>({
        ceremonies: () => ({
          beforeUserDelete: async (user) => void erased.push(user),
          createAccountIdentifier: async () => ({ pinned: false }),
          beforeAccountDelete: async () => undefined,
        }),
      }),
    });
    const { options } = await app.betterAuth();

    await options.databaseHooks?.user?.delete?.before?.(USER, null);

    expect(erased.map(({ id }) => id)).toEqual(["user_1"]);
  });
});

const genericOAuthOptionsSchema = z.object({
  config: z.array(z.object({ providerId: z.string() })),
});

/** Mounted means initialised too: plugin init (OIDC discovery) settles inside the test. */
async function mountedProviderIds(app: AuthModule): Promise<string[]> {
  const auth = await app.betterAuth();
  await auth.$context;
  const { options } = auth;
  const genericOAuth = options.plugins?.find((plugin) => plugin.id === "generic-oauth");
  const configs =
    genericOAuth !== undefined && "options" in genericOAuth
      ? genericOAuthOptionsSchema.parse(genericOAuth.options).config
      : [];
  return [
    ...Object.keys(options.socialProviders ?? {}),
    ...configs.map((config) => config.providerId),
  ];
}

const AUTH0_DISCOVERY_URL = "https://tenant.auth0.test/.well-known/openid-configuration";

/** The discovery document the generic-OAuth plugin fetches while it initialises. */
function answerDiscovery(): void {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== AUTH0_DISCOVERY_URL) return realFetch(input, init);
    return Response.json({
      issuer: "https://tenant.auth0.test/",
      authorization_endpoint: "https://tenant.auth0.test/authorize",
      token_endpoint: "https://tenant.auth0.test/oauth/token",
      userinfo_endpoint: "https://tenant.auth0.test/userinfo",
    });
  });
}

describe("given enterprise SSO answers the deployment's sign-in providers", () => {
  beforeEach(answerDiscovery);
  afterEach(() => vi.restoreAllMocks());

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
            discoveryUrl: AUTH0_DISCOVERY_URL,
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
    const askedFor: MountsRequest[] = [];
    const app = await appFor(true, { askedFor });

    expect(askedFor).toEqual([]);

    await Promise.all([app.betterAuth(), app.betterAuth()]);

    expect(askedFor).toEqual([
      { baseUrl: BROWSER_SESSION.baseUrl, onMicrosoftProfile: expect.any(Function) },
    ]);
  });

  it("hands each Microsoft profile to identity to move a legacy account key", async () => {
    const askedFor: MountsRequest[] = [];
    const moved: unknown[] = [];
    const identity = createApiFixture<IdentityApi>({
      moveLegacyMicrosoftAccountKey: async ({ profile }) => {
        moved.push(profile);
      },
    });
    const app = await appFor(true, { askedFor, identity });
    await app.betterAuth();

    await askedFor[0]?.onMicrosoftProfile?.({ oid: "object-1", tid: "tenant-1" });

    expect(moved).toEqual([{ oid: "object-1", tid: "tenant-1" }]);
  });
});
