import { describe, expect, it, vi } from "vitest";
import { databaseHooks } from "../config/database-hooks";
import { CredentialSessionGuard } from "../credential-session-guard";
import { BetterAuthDatabaseHooks } from "../hooks";

/**
 * The sign-up policy on the paths better-auth creates a user through: the
 * social and generic OAuth callbacks and the single sign-on plugin
 * (specs/auth/sign-up-restriction.feature).
 *
 * Driven through the configured `user.create.before` slot, the way
 * better-auth calls it, so the order against the other create checks is part
 * of what is pinned.
 */

function userCreateBefore({
  allowed,
  governingConnection = null,
}: {
  allowed: boolean;
  governingConnection?: { connectionId: string } | null;
}) {
  const checkSignUp = vi.fn().mockResolvedValue({ allowed });
  const hooks = new BetterAuthDatabaseHooks({
    users: {
      findById: async () => null,
      updatePendingSsoSetup: async () => undefined,
      updateLastLoginAt: async () => undefined,
      countOrganizationMemberships: async () => 0,
    },
    organizations: { findByDomain: async () => null },
    connectionRouting: { connectionGoverning: async () => governingConnection },
    accounts: { countForUser: async () => 0 },
    ssoArrival: { admit: async () => undefined },
    ssoMigration: {
      decideAccountLink: async () => ({ kind: "not_migrating" }),
      authorizeAndRecordAuthentication: async () => ({ action: "continue" }),
    },
    federationAllowed: async () => false,
    signUpPolicy: { checkSignUp },
    analytics: { trackSignUp: () => undefined },
    nurturing: {
      trackActivity: () => undefined,
      syncProfile: () => undefined,
    },
  });

  const configured = databaseHooks({
    credentialSessions: () =>
      new CredentialSessionGuard({ canSignIn: async () => true }),
    hooks: () => hooks,
    userErasure: () => ({ beforeUserDelete: vi.fn() }),
    accountCeremonies: () => ({
      beforeAccountCreate: vi.fn(),
      beforeAccountDelete: vi.fn(),
    }),
    sessionClaims: () => ({
      claimsForMint: vi.fn().mockResolvedValue({ identifierId: null, amr: [] }),
    }),
    providerAssertions: () => ({
      recordVerifiedCallbackToken: vi.fn(),
      recordAuthenticatedCallbackAccount: vi.fn(),
    }),
  });
  const before = configured?.user?.create?.before;
  if (before === undefined) throw new Error("user create hook is missing");

  const create = (email: string) =>
    Reflect.apply(before, null, [
      { email, name: "Sam" },
      { path: "/callback/:id", params: { id: "google" } },
    ]);
  return { create, checkSignUp };
}

describe("user.create.before", () => {
  describe("when the sign-up policy refuses the address", () => {
    /** @scenario "An identity provider sign-in for an uninvited address creates no account" */
    it("refuses with the restricted code the sign-in error page renders", async () => {
      const { create, checkSignUp } = userCreateBefore({ allowed: false });

      await expect(create("stranger@example.com")).rejects.toMatchObject({
        body: { code: "auth_sign_up_restricted" },
      });
      expect(checkSignUp).toHaveBeenCalledWith({
        email: "stranger@example.com",
      });
    });
  });

  describe("when an organization's own connection governs the address", () => {
    /** @scenario "An address an organization's own SSO connection governs is not restricted" */
    it("creates the account without asking the policy", async () => {
      const { create, checkSignUp } = userCreateBefore({
        allowed: false,
        governingConnection: { connectionId: "ssoc_acme" },
      });

      await expect(create("sam@acme.com")).resolves.not.toBe(false);
      expect(checkSignUp).not.toHaveBeenCalled();
    });
  });

  describe("when the policy admits the address", () => {
    it("creates the account", async () => {
      const { create } = userCreateBefore({ allowed: true });
      await expect(create("sam@acme.com")).resolves.not.toBe(false);
    });
  });
});
