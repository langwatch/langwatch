/**
 * The process's Better Auth transport, built from stand-ins for every port it
 * takes. Shared by the tests that read the instance's OPTIONS rather than call
 * it — the plugin list, the account-linking guard, the password verifier.
 */
import { memoryAdapter } from "better-auth/adapters/memory";
import {
  createBetterAuthTransport,
  type BetterAuthDeploymentConfiguration,
} from "../better-auth.api.ts";

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
      adapter: () => memoryAdapter({ user: [], session: [], account: [], verification: [] }),
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
      tryFindPendingByOrganizationAndEmail: async () => null,
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
    sendResetPassword: async () => undefined,
    redis: null,
    signUpVerification: { requestVerification: async () => undefined } as never,
    users: {} as never,
    ...ports,
  });
}
