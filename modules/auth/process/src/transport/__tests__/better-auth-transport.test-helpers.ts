/**
 * The process's Better Auth transport, built from stand-ins for every port it
 * takes. Shared by the tests that read the instance's OPTIONS rather than call
 * it — the plugin list, the account-linking guard, the password verifier.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type {
  SsoArrivalApi,
  SsoAssertionApi,
  SsoAuthenticationActivityApi,
  SsoMigrationCallbackApi,
} from "@langwatch/identity-contract";
import { InviteNotFoundError } from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";
import { memoryAdapter } from "better-auth/adapters/memory";

import { createSecondaryStorage } from "../../app/auth-composition.build.ts";
import {
  createBetterAuthTransport,
  type BetterAuthDeploymentConfiguration,
} from "../../channels/http/http.better-auth.channel.ts";
import { CredentialSessionGuard } from "../../channels/http/http.credential-session-guard.channel.ts";
import { signInSecurityFixture } from "../../services/__tests__/sign-in-security.fixture.ts";
import { CredentialSignInPolicyService } from "../../services/credential-sign-in-policy.service.ts";

export function deployment(
  overrides: Partial<BetterAuthDeploymentConfiguration> = {},
): BetterAuthDeploymentConfiguration {
  return {
    baseUrl: "https://app.langwatch.test",
    secret: "test-secret",
    emailPasswordEnabled: true,
    mfaEnrollmentOpen: false,
    passkeysEnabled: false,
    passkeyHandleSecret: "test-passkey-secret",
    socialProviders: {},
    genericOAuthConfigs: [],
    trustedIdpOrigins: undefined,
    idpSimulatorUrl: undefined,
    isProduction: false,
    ...overrides,
  };
}

export function betterAuthTransportFor(
  overrides: Partial<BetterAuthDeploymentConfiguration> = {},
  /** The collaborators a test needs to be real, over the refusing stand-ins. */
  ports: Partial<Parameters<typeof createBetterAuthTransport>[0]> = {},
) {
  return createBetterAuthTransport({
    auth: {} as never,
    database: {} as never,
    storage: {
      adapter: () =>
        memoryAdapter({ user: [], session: [], account: [], verification: [], ssoProvider: [] }),
    } as never,
    deployment: deployment(overrides),
    federation: {
      federationCapable: () => false,
      resolveSignInMethodPolicy: async () => ({}) as never,
      platformSsoAllowed: async () => false,
    } as never,
    identity: {
      beforeUserDelete: async () => undefined,
      tryBeforeAccountCreate: async () => undefined,
      beforeAccountDelete: async () => undefined,
    } as never,
    invites: {
      getPendingByOrganizationAndEmail: async () => {
        throw new InviteNotFoundError();
      },
      applyInvite: async () => undefined,
    } as never,
    announcements: {
      trackServerEvent: () => undefined,
      reportError: () => undefined,
      announceSignup: () => undefined,
      ssoAutoAddNurturing: () => undefined,
      sessionNurturing: () => undefined,
    } as never,
    shadow: {
      mode: () => "off",
      route: async () => undefined,
      resolveAuthProvider: async () => "credential",
    } as never,
    authzGrants: {} as never,
    arrivals: createApiFixture<SsoArrivalApi>({ admit: async () => undefined }),
    ssoActivity: createApiFixture<SsoAuthenticationActivityApi>({ record: async () => undefined }),
    ssoMigration: createApiFixture<SsoMigrationCallbackApi>({
      decideAccountLink: async () => ({ kind: "not_migrating" }),
    }),
    ssoAssertions: createApiFixture<SsoAssertionApi>({
      decide: async () => ({ action: "continue" }),
    }),
    /** Nothing registered: a test that needs an origin trusted says so. */
    ssoIssuers: { issuersForRequest: async () => [] },
    /** No routing directory, so no organization connection governs a
     *  credential sign-in; a test that needs one supplies its own guard. */
    /** No organization has set a threshold, so nothing is ever locked out. */
    signInLockout: signInSecurityFixture({ now: nowInstant }).lockout,
    addressRoutesToConnection: async () => false,
    credentialGuard: CredentialSessionGuard.create(
      CredentialSignInPolicyService.create({
        routing: null,
        connections: { getOrganization: async () => ({ organizationId: "org-absent" }) },
        recovery: { findGrants: async () => [] },
      }),
    ),
    sendResetPassword: async () => undefined,
    redis: null,
    secondaryStorage: createSecondaryStorage(null),
    signUpVerification: { requestVerification: async () => undefined } as never,
    users: {} as never,
    ...ports,
  });
}
