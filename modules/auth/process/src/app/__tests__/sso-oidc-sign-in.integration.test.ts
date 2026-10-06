import { randomUUID } from "node:crypto";

/**
 * A sign-in through a verified single sign-on connection, end to end: the composed Better Auth over
 * Postgres, the SSO plugin's whole OIDC callback, and the harness provider as the issuer.
 * @see specs/identity/identity-storage-adapter.feature
 * @vitest-environment node
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { SsoApi } from "@langwatch/enterprise-sso-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { type IdentityApi, NO_SESSION_CLAIMS } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { type ServedOidcProvider, startOidcProvider } from "@langwatch/test-harness/oidc-provider";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import type { BetterAuthTransport } from "../../channels/http/http.better-auth.channel.ts";
import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import { AuthModule } from "../auth.app.ts";
import { NO_SIGN_IN_PROVIDERS } from "./support/sign-in-providers.ts";
import { TestUserApi } from "./support/test-user-api.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const SUITE = randomUUID().slice(0, 8);
const BASE_URL = "http://localhost:3000";
const PROVIDER_ID = `sso-oidc-${SUITE}`;
const DOMAIN = `${SUITE}.sso-oidc-test.example`;
const EMAIL = `member-${SUITE}@${DOMAIN}`;
const SUBJECT = `idp-subject-${SUITE}`;
const CLIENT = { clientId: "langwatch-test-client", clientSecret: "langwatch-test-secret" };

const connection = PrismaConnectionService.create({
  guard: PrismaTenancyGuardService.create(),
  logger: createLogger("langwatch:auth:test:sso-oidc-sign-in"),
}).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
const prisma = connection.client;

/** Every admission the composed `resolveUser` asked identity for, so the test can say it ran. */
const decisionsAsked: { providerId: string; email: string | null | undefined }[] = [];

function identityFor(provider: ServedOidcProvider): IdentityApi {
  return createApiFixture<IdentityApi>({
    ssoIssuers: () => ({
      findIssuersForConnection: async () => [provider.issuer],
      findIssuersForDomain: async () => [provider.issuer],
      findEndpointOrigins: async () => [provider.origin],
    }),
    ssoAssertion: () => ({
      decide: async ({ providerId, email }) => {
        decisionsAsked.push({ providerId, email });
        return { action: "continue" };
      },
      resolveUser: async () => ({ action: "continue" }),
    }),
    ssoArrival: () => ({ admit: async () => undefined }),
    ssoActivity: () => ({ record: async () => undefined }),
    ssoMigrationCallbacks: () => ({
      decideAccountLink: async () => ({ kind: "not_migrating" }),
      authorizeAndRecordAuthentication: async () => ({ action: "continue" }),
    }),
    ceremonies: () => ({
      beforeUserDelete: async () => undefined,
      createAccountIdentifier: async () => ({ pinned: false }),
      beforeAccountDelete: async () => undefined,
    }),
    claimsForMint: async () => NO_SESSION_CLAIMS,
  });
}

async function composedBetterAuth(provider: ServedOidcProvider): Promise<BetterAuthTransport> {
  const app = await AuthModule.create({
    config: {
      sessionUrl: BASE_URL,
      mfaEnrollmentOpen: false,
      passkeysEnabled: false,
      passkeyHandleSecret: "test-passkey-secret",
      trustedIdpOrigins: provider.origin,
      idpSimulatorUrl: undefined,
      localPasswords: false,
      auth0ManagementClientId: undefined,
      isSaas: false,
      signInProviders: NO_SIGN_IN_PROVIDERS,
      signUpMode: "open",
      publicBaseUrl: undefined,
      nodeEnvironment: undefined,
    },
    repositories: MemoryAuthRepositories.create(),
    dependencies: {
      users: new TestUserApi({}) as never,
      apiKeys: { findResolvedToken: async () => null } as never,
      featureFlags: {} as never,
      identity: identityFor(provider),
      organizations: createApiFixture<OrganizationApi>({
        checkSignUp: async () => ({ allowed: true, via: "open" }),
      }),
      entitlements: createApiFixture<EntitlementApi>(),
      licensing: createApiFixture<LicensingApi>({ isPlatformSsoLicensed: async () => false }),
      notifications: createApiFixture<NotificationService>(),
      sso: createApiFixture<SsoApi>({
        getSignInProviderMounts: async () => ({ socialProviders: {}, genericOAuthConfigs: [] }),
      }),
      authz: createApiFixture<AuthzApi>({}),
      auditLog: createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit", occurredAt: 0 }),
      }),
    },
    members: {
      encryption: { encrypt: (value: string) => value, decrypt: (value: string) => value },
      prisma,
      redis: null as never,
      identityEmails: undefined as never,
      invites: null,
      processName: "langwatch-api",
    },
    resources: { own: () => undefined } as never,
    secrets: new ScopedSecrets(async (handle, build) =>
      build({ NEXTAUTH_SECRET: "test-session-secret-test-session-secret" }[handle.id]),
    ),
  });

  return app.betterAuth();
}

const cookiesOf = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((set) => set.split(";")[0])
    .join("; ");

/** Starts the sign-in, lets the provider authorize it, and hands its code to the callback. */
async function signInThroughConnection({ auth }: { auth: BetterAuthTransport }) {
  const started = await auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/sso`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ providerId: PROVIDER_ID, callbackURL: `${BASE_URL}/dashboard` }),
    }),
  );
  const startedBody = (await started.json()) as unknown;
  const authorizeUrl = z.object({ url: z.string() }).parse(startedBody).url;
  const authorized = await fetch(authorizeUrl, { redirect: "manual" });
  const callbackUrl = authorized.headers.get("location") ?? "";

  const callback = await auth.handler(
    new Request(callbackUrl, { method: "GET", headers: { cookie: cookiesOf(started) } }),
  );
  const cookie = cookiesOf(callback);
  const session = await auth.api.getSession({ headers: new Headers({ cookie }) });

  return {
    startedStatus: started.status,
    location: callback.headers.get("location") ?? "",
    cookie,
    session,
  };
}

describe.skipIf(!DB_URL)("given a verified single sign-on connection", () => {
  let provider: ServedOidcProvider;
  let auth: BetterAuthTransport;

  beforeAll(async () => {
    // The served provider's spread drops `signInAs`, so its subject is fixed at start.
    provider = await startOidcProvider({
      client: CLIENT,
      subject: { sub: SUBJECT, email: EMAIL, name: "Sam Sso" },
    });
    await prisma.ssoProvider.create({
      data: {
        id: `ssoprov_${SUITE}`,
        providerId: PROVIDER_ID,
        issuer: provider.issuer,
        domain: DOMAIN,
        // The plaintext form the provider-config cipher still reads: no deployment secret needed.
        oidcConfig: JSON.stringify({
          clientId: CLIENT.clientId,
          clientSecret: CLIENT.clientSecret,
          discoveryEndpoint: provider.endpoints.discovery,
          authorizationEndpoint: provider.endpoints.authorization,
          tokenEndpoint: provider.endpoints.token,
          jwksEndpoint: provider.endpoints.jwks,
          userInfoEndpoint: provider.endpoints.userInfo,
          pkce: true,
          scopes: ["openid", "email", "profile"],
          mapping: { id: "sub", email: "email", emailVerified: "email_verified" },
        }),
      },
    });
    auth = await composedBetterAuth(provider);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({ where: { email: EMAIL }, select: { id: true } });
    const userIds = users.map((user) => user.id);
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.account.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.ssoProvider.deleteMany({ where: { providerId: PROVIDER_ID } });
    await prisma.verificationToken.deleteMany({ where: { identifier: { contains: PROVIDER_ID } } });
    await provider.stop();
    await prisma.$disconnect();
  });

  describe("when somebody signs in through it", () => {
    /** @scenario "A sign-in through a connection completes" */
    it("signs them in, and does not refuse the adapter its transactions", async () => {
      const { startedStatus, location, cookie, session } = await signInThroughConnection({ auth });

      expect(startedStatus).toBe(200);
      expect(location).not.toContain("SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS");
      expect(location).not.toContain("error");
      expect(location).toBe(`${BASE_URL}/dashboard`);
      expect(cookie).not.toBe("");
      expect(decisionsAsked).toEqual([{ providerId: PROVIDER_ID, email: EMAIL }]);
      expect(session?.user.email).toBe(EMAIL);
      expect(
        await prisma.account.findFirst({
          where: { provider: PROVIDER_ID, providerAccountId: SUBJECT },
          select: { providerAccountId: true },
        }),
      ).not.toBeNull();
    });
  });
});
