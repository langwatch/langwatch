/** The auth app the storage-seam tests compose, over either tier of its registry. */
import { createErrorHandler } from "@langwatch/api";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { SsoApi } from "@langwatch/enterprise-sso-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { type IdentityApi, NO_SESSION_CLAIMS } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Hono } from "hono";

import type { AuthRepositories } from "../../../repositories/auth.repositories.ts";
import { AuthModule } from "../../auth.app.ts";
import { NO_SIGN_IN_PROVIDERS } from "./sign-in-providers.ts";
import { TestUserApi } from "./test-user-api.ts";

export const SEAM_BASE = "https://app.langwatch.test";

/**
 * Auth composed over the repositories a test's registry built, mounted behind the door the
 * api process mounts it behind. Every peer answers as a deployment with no organization rules.
 */
export async function composedAuth({
  repositories,
  members,
}: {
  repositories: AuthRepositories;
  members: { prisma: unknown; redis: unknown };
}) {
  const app = await AuthModule.create({
    config: {
      sessionUrl: SEAM_BASE,
      mfaEnrollmentOpen: false,
      passkeysEnabled: false,
      passkeyHandleSecret: "test-passkey-secret",
      trustedIdpOrigins: undefined,
      idpSimulatorUrl: undefined,
      localPasswords: true,
      auth0ManagementClientId: undefined,
      isSaas: false,
      signInProviders: NO_SIGN_IN_PROVIDERS,
      signUpMode: "open",
      publicBaseUrl: undefined,
      nodeEnvironment: undefined,
    },
    repositories,
    dependencies: {
      projects: createApiFixture<ProjectApi>(),
      users: new TestUserApi({}) as never,
      apiKeys: { findResolvedToken: async () => null } as never,
      featureFlags: {} as never,
      identity: createApiFixture<IdentityApi>({
        ceremonies: () => ({
          beforeUserDelete: async () => undefined,
          createAccountIdentifier: async () => ({ pinned: false }),
          beforeAccountDelete: async () => undefined,
        }),
        ssoMigrationCallbacks: () => ({
          decideAccountLink: async () => ({ kind: "not_migrating" }),
          authorizeAndRecordAuthentication: async () => ({ action: "continue" }),
        }),
        ssoActivity: () => ({ record: async () => undefined }),
        routeSignIn: async () => ({
          outcome: "method_picker",
          methodSet: [{ id: "password", kind: "password", connectionId: null }],
          reasonCode: "account_methods",
        }),
        claimsForMint: async () => NO_SESSION_CLAIMS,
      }),
      organizations: createApiFixture<OrganizationApi>({
        checkSignUp: async () => ({ allowed: true, via: "open" }),
        countMembershipsForUser: async () => 0,
        findConfiguredSignInSecurityPolicies: async () => [],
      }),
      entitlements: createApiFixture<EntitlementApi>(),
      licensing: createApiFixture<LicensingApi>(),
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
      prisma: members.prisma as never,
      redis: members.redis as never,
      identityEmails: undefined as never,
      invites: null,
      processName: "langwatch-api",
    },
    resources: { own: () => undefined } as never,
    secrets: new ScopedSecrets(async (handle, build) =>
      build({ NEXTAUTH_SECRET: "test-session-secret" }[handle.id]),
    ),
  });
  const transport = await app.betterAuth();
  // Mounted as the api process mounts it, so a released refusal is answered by the door.
  const host = new Hono();
  host.onError(createErrorHandler());
  host.all("/api/auth/*", (context) => transport.handler(context.req.raw));
  const call = (path: string, init: { body?: unknown; cookie?: string } = {}) =>
    host.fetch(
      new Request(`${SEAM_BASE}/api/auth${path}`, {
        method: init.body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          origin: SEAM_BASE,
          ...(init.cookie ? { cookie: init.cookie } : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    );
  return { transport, call };
}

/** The cookies a response set, as the browser would send them back. */
export function sessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}
