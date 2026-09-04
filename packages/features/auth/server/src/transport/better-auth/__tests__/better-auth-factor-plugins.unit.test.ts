/**
 * The two-step verification and passkey plugins mount only when their
 * deployment flag is on (D06/D07). Both default off, so the check imports
 * the instance under each setting rather than trusting one that happens to
 * pass because nothing was ever turned on.
 *
 * Corresponds to specs/identity/mfa-and-session-shape.feature and
 * specs/identity/passkeys.feature.
 */
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import {
  createBetterAuthTransport,
  type BetterAuthDeploymentConfiguration,
} from "../better-auth.api";

function deployment(
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

function pluginIdsFor(overrides: Partial<BetterAuthDeploymentConfiguration>): string[] {
  const auth = createBetterAuthTransport({
    auth: {} as never,
    database: {} as never,
    storage: {
      adapter: () =>
        memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    } as never,
    deployment: deployment(overrides),
    federation: {
      federationCapable: () => false,
      resolveSignInMethodPolicy: async () => ({}) as never,
      platformSsoAllowed: async () => false,
    } as never,
    identity: {
      beforeUserDelete: async () => undefined,
      beforeAccountCreate: async () => undefined,
      beforeAccountDelete: async () => undefined,
    } as never,
    invites: {
      findPendingByOrganizationAndEmail: async () => null,
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
  });
  return ((auth.options?.plugins ?? []) as Array<{ id?: string }>).map((p) => p.id ?? "");
}

describe("the deployment's Better Auth factor plugins", () => {
  describe("given both flags are off", () => {
    /**
     * @scenario "With the flag off nothing about two-step verification exists"
     * @scenario "With the flag off, passkeys do not exist"
     */
    it("mounts neither plugin", () => {
      const ids = pluginIdsFor({});
      expect(ids).not.toContain("two-factor");
      expect(ids).not.toContain("passkey");
    });
  });

  describe("given the two-step verification flag is on", () => {
    it("mounts the two-factor plugin only", () => {
      const ids = pluginIdsFor({ mfaEnrollmentOpen: true });
      expect(ids).toContain("two-factor");
      expect(ids).not.toContain("passkey");
    });
  });

  describe("given the passkeys flag is on", () => {
    it("mounts the passkey plugin only", () => {
      const ids = pluginIdsFor({ passkeysEnabled: true });
      expect(ids).toContain("passkey");
      expect(ids).not.toContain("two-factor");
    });
  });
});
