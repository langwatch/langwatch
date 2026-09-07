import { describe, expect, it, vi } from "vitest";
import { SsoArrivalService } from "~/server/app-layer/identity/sso-arrival.service";
import type { SignInConnection } from "~/server/app-layer/identity/sso-assertion.service";
import {
  BetterAuthDatabaseHooks,
  type DatabaseHookUser,
  type SsoMigrationAccountLinkDecision,
} from "../hooks";

/**
 * better-auth's database hooks, driven the way better-auth drives them: a
 * loosely typed row in, a refusal or a service call out.
 *
 * Every collaborator is a port fake, including the arrival service's own — the
 * hooks reach no database, so nothing here mocks one. The arrival service
 * itself is REAL rather than stubbed, because what these scenarios are about
 * is the consequence a hook has (a membership row, a grant beside it), and a
 * stub would assert only that a call was made.
 */

const userRow = (over: Partial<DatabaseHookUser> = {}): DatabaseHookUser => ({
  id: "user_1",
  email: "u@acme.com",
  name: "User",
  deactivatedAt: null,
  pendingSsoSetup: false,
  signupConfirmationPending: false,
  ...over,
});

type LegacyOrganization = {
  id: string;
  name: string;
  ssoProvider: string | null;
};

const legacyOrganization = (
  over: Partial<LegacyOrganization> = {},
): LegacyOrganization => ({
  id: "org_1",
  name: "Acme",
  ssoProvider: null,
  ...over,
});

const hooksOver = ({
  user = null,
  organization = null,
  accountCount = 0,
  federationAllowed = true,
  memberships = 0,
  pendingInvite = null,
  migrationDecision = { kind: "not_migrating" },
  authenticationDecision = { action: "continue" },
  arrivalConnection = null,
  arrivalOrganization = null,
}: {
  user?: DatabaseHookUser | null;
  organization?: LegacyOrganization | null;
  accountCount?: number;
  federationAllowed?: boolean;
  memberships?: number;
  pendingInvite?: { inviteId: string } | null;
  migrationDecision?: SsoMigrationAccountLinkDecision;
  authenticationDecision?:
    | { action: "continue" }
    | {
        action: "reject";
        code:
          | "SSO_LEGACY_AUTH_RETIRED"
          | "SSO_MIGRATION_AUTH_AMBIGUOUS"
          | "SSO_MIGRATION_AUTH_NOT_ALLOWED";
      };
  arrivalConnection?: SignInConnection | null;
  arrivalOrganization?: { id: string; name: string } | null;
} = {}) => {
  const users = {
    findById: vi.fn().mockResolvedValue(user),
    updatePendingSsoSetup: vi.fn().mockResolvedValue(undefined),
    updateLastLoginAt: vi.fn().mockResolvedValue(undefined),
    countOrganizationMemberships: vi.fn().mockResolvedValue(memberships),
  };
  const organizations = {
    findByDomain: vi.fn().mockResolvedValue(organization),
  };
  const accounts = {
    countForUser: vi.fn().mockResolvedValue(accountCount),
    reconcileOAuthAccounts: vi.fn().mockResolvedValue(undefined),
  };
  const ssoMigration = {
    decideAccountLink: vi.fn().mockResolvedValue(migrationDecision),
    authorizeAndRecordAuthentication: vi
      .fn()
      .mockResolvedValue(authenticationDecision),
  };
  const createMembership = vi.fn().mockResolvedValue("created");
  const applyPendingInvite = vi.fn().mockResolvedValue(pendingInvite);
  const attachBindings = vi.fn().mockResolvedValue(undefined);
  const announceSignup = vi.fn();
  const startNurturing = vi.fn();
  const trackSignUp = vi.fn();
  const trackActivity = vi.fn();
  const syncProfile = vi.fn();

  const ssoArrival = new SsoArrivalService({
    connections: {
      findConnectionForSignIn: vi.fn().mockResolvedValue(arrivalConnection),
    },
    memberships: {
      findMembership: vi.fn().mockResolvedValue(false),
      createMembership,
      findOrganizationForMembership: vi
        .fn()
        .mockResolvedValue(arrivalOrganization),
    },
    invites: { applyPendingInvite },
    joinRequests: {
      requestFromSsoArrival: vi.fn().mockResolvedValue(null),
    },
    grants: { attachBindings },
    notifications: { announceSignup, startNurturing },
  });

  return {
    hooks: new BetterAuthDatabaseHooks({
      users,
      organizations,
      accounts,
      ssoArrival,
      ssoMigration,
      federationAllowed: vi.fn().mockResolvedValue(federationAllowed),
      analytics: { trackSignUp },
      nurturing: { trackActivity, syncProfile },
    }),
    users,
    organizations,
    accounts,
    ssoMigration,
    createMembership,
    applyPendingInvite,
    attachBindings,
    announceSignup,
    trackSignUp,
    trackActivity,
    syncProfile,
  };
};

describe("beforeUserCreate", () => {
  describe("when the user is deactivated", () => {
    it("blocks the creation by returning false", () => {
      const { hooks } = hooksOver();
      const result = hooks.beforeUserCreate({
        user: { email: "u@x.com", deactivatedAt: new Date("2020-01-01") },
      });
      expect(result).toBe(false);
    });
  });

  describe("when the user is active and brought a name", () => {
    it("does not block and leaves the name alone", () => {
      const { hooks } = hooksOver();
      const result = hooks.beforeUserCreate({
        user: { email: "u@x.com", name: "Sam Patel" },
      });
      expect(result).toBeUndefined();
    });
  });

  // A passkey sign-up asks for no name, an identity provider may assert none,
  // and an OAuth profile can carry `null`. Every screen that names somebody
  // reads this column, and the header menu rendered the gap as "null (u@x.com)".
  describe("when the user arrives with no name", () => {
    it("fills it with the address, so nothing renders a hole", () => {
      const { hooks } = hooksOver();
      const result = hooks.beforeUserCreate({
        user: { email: "u@x.com", name: null },
      });
      expect(result).toEqual({ data: { email: "u@x.com", name: "u@x.com" } });
    });

    it("treats a name that is only whitespace as no name at all", () => {
      const { hooks } = hooksOver();
      const result = hooks.beforeUserCreate({
        user: { email: "u@x.com", name: "   " },
      });
      expect(result).toMatchObject({ data: { name: "u@x.com" } });
    });

    it("carries every other field the creation brought with it", () => {
      const { hooks } = hooksOver();
      const result = hooks.beforeUserCreate({
        user: { email: "u@x.com", image: "https://example.com/a.png" },
      });
      expect(result).toMatchObject({
        data: { image: "https://example.com/a.png", name: "u@x.com" },
      });
    });

    it("still blocks a deactivated user rather than naming them", () => {
      const { hooks } = hooksOver();
      const result = hooks.beforeUserCreate({
        user: { email: "u@x.com", deactivatedAt: new Date("2020-01-01") },
      });
      expect(result).toBe(false);
    });
  });
});

describe("afterUserCreate", () => {
  describe("for every new user", () => {
    /** @scenario BetterAuth signup tracks the PostHog signed_up milestone */
    it("tracks the signed_up analytics event with the user id", async () => {
      const { hooks, trackSignUp } = hooksOver();

      await hooks.afterUserCreate({
        user: { id: "user_1", email: "u@other.com", name: "User" },
      });

      expect(trackSignUp).toHaveBeenCalledTimes(1);
      expect(trackSignUp).toHaveBeenCalledWith({ userId: "user_1" });
    });

    /** @scenario PostHog signed_up still fires when the email has no parsable domain */
    it("tracks signed_up even when the user has no parsable email domain", async () => {
      const { hooks, trackSignUp } = hooksOver();

      await hooks.afterUserCreate({
        user: { id: "user_3", email: "", name: "User" },
      });

      expect(trackSignUp).toHaveBeenCalledWith({ userId: "user_3" });
    });
  });

  describe("when a bare legacy ssoDomain matches the signup address", () => {
    it("does not join from user creation without an authenticated proved connection", () => {
      const { hooks, organizations, createMembership } = hooksOver({
        organization: legacyOrganization(),
      });

      hooks.afterUserCreate({
        user: { id: "user_1", email: "new@acme.com", name: "New User" },
      });

      expect(organizations.findByDomain).not.toHaveBeenCalled();
      expect(createMembership).not.toHaveBeenCalled();
    });
  });
});

describe("beforeAccountCreate", () => {
  const account = (over: Record<string, string> = {}) => ({
    userId: "user_1",
    providerId: "google",
    accountId: "sub-1",
    ...over,
  });

  describe("when the user does not exist", () => {
    it("does nothing", async () => {
      const { hooks, organizations } = hooksOver();
      await hooks.beforeAccountCreate({ account: account() });
      expect(organizations.findByDomain).not.toHaveBeenCalled();
    });
  });

  describe("when the user is deactivated", () => {
    /** @scenario Deactivated user is blocked */
    it("throws USER_DEACTIVATED", async () => {
      const { hooks } = hooksOver({
        user: userRow({ deactivatedAt: new Date("2020-01-01") }),
      });
      await expect(
        hooks.beforeAccountCreate({ account: account() }),
      ).rejects.toThrow("USER_DEACTIVATED");
    });
  });

  describe("when the user's email domain matches an org with correct SSO provider", () => {
    /** @scenario Existing user with correct SSO provider auto-links */
    it("defers reconciliation to afterAccountCreate (no writes in before)", async () => {
      const { hooks, users, accounts } = hooksOver({
        user: userRow({ email: "existing@acme.com" }),
        organization: legacyOrganization({ ssoProvider: "google" }),
      });

      await hooks.beforeAccountCreate({ account: account() });

      expect(accounts.reconcileOAuthAccounts).not.toHaveBeenCalled();
      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
    });
  });

  describe("when a direct connection replaces a grandfathered legacy connection", () => {
    it.each([
      "SSO_MIGRATION_LINK_UNVERIFIED",
      "SSO_MIGRATION_LINK_AMBIGUOUS",
      "SSO_MIGRATION_LINK_NOT_ALLOWED",
      "SSO_LEGACY_AUTH_RETIRED",
    ] as const)("refuses the link with actionable code %s", async (code) => {
      const { hooks } = hooksOver({
        user: userRow({ email: "existing@acme.com" }),
        migrationDecision: { kind: "reject", code },
      });

      await expect(
        hooks.beforeAccountCreate({
          account: account({
            providerId: "local_ssoc_replacement",
            accountId: "direct-subject",
          }),
        }),
      ).rejects.toThrow(code);
    });

    it("allows only a policy-proved predecessor/replacement pair", async () => {
      const keepAccounts = [
        { providerId: "auth0", accountId: "auth0|legacy-subject" },
        {
          providerId: "local_ssoc_replacement",
          accountId: "direct-subject",
        },
      ] as const;
      const { hooks, users } = hooksOver({
        user: userRow({ email: "existing@acme.com" }),
        migrationDecision: {
          kind: "allow_replacement_pair",
          arrivalConnectionId: "local_ssoc_replacement",
          keepAccounts,
        },
      });

      await hooks.beforeAccountCreate({
        account: {
          userId: "user_1",
          providerId: "local_ssoc_replacement",
          accountId: "direct-subject",
        },
      });

      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
    });
  });

  describe("when an EXISTING user's email domain matches an org with WRONG SSO provider", () => {
    /** @scenario Existing user with wrong SSO provider gets pending flag */
    it("soft-blocks by setting pendingSsoSetup=true without throwing", async () => {
      const { hooks, users } = hooksOver({
        user: userRow({ email: "existing@acme.com" }),
        organization: legacyOrganization({ ssoProvider: "okta" }),
        // Existing user — already has a linked account from a prior login.
        accountCount: 1,
      });

      await hooks.beforeAccountCreate({ account: account() });

      expect(users.updatePendingSsoSetup).toHaveBeenCalledWith({
        userId: "user_1",
        pendingSsoSetup: true,
      });
    });
  });

  describe("when the platform SSO gate DENIES (unlicensed deployment)", () => {
    /** @scenario Existing users on an unlicensed deployment self-recover via password reset */
    it("does not set pendingSsoSetup for a credential account at a matching ssoDomain", async () => {
      // The v6 reset-recovery path creates a `credential` account for an
      // OAuth-born user; without the gate check this would strand them behind
      // a permanent, unclearable "Link your SSO account" banner.
      const { hooks, users, organizations } = hooksOver({
        user: userRow({ email: "sso-born@acme.com" }),
        federationAllowed: false,
      });

      await hooks.beforeAccountCreate({
        account: account({ providerId: "credential", accountId: "user_1" }),
      });

      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
      // Gate denied before any ssoDomain lookup even happened.
      expect(organizations.findByDomain).not.toHaveBeenCalled();
    });
  });

  describe("when a NEW user's email domain matches an SSO-enforced org with WRONG provider", () => {
    it("hard-blocks by throwing SSO_PROVIDER_NOT_ALLOWED", async () => {
      const { hooks } = hooksOver({
        user: userRow({ email: "newsignup@acme.com" }),
        organization: legacyOrganization({ ssoProvider: "okta" }),
        // No existing accounts → this is a first-time signup.
        accountCount: 0,
      });

      await expect(
        hooks.beforeAccountCreate({ account: account() }),
      ).rejects.toThrow("SSO_PROVIDER_NOT_ALLOWED");
    });
  });

  describe("when a NEW user's email domain matches an SSO-enforced org and provider is credential (on-prem)", () => {
    it("does NOT hard-block (credentials exempt — on-prem email mode)", async () => {
      const { hooks } = hooksOver({
        user: userRow({ email: "onprem@acme.com" }),
        organization: legacyOrganization({ ssoProvider: "okta" }),
        accountCount: 0,
      });

      await expect(
        hooks.beforeAccountCreate({
          account: account({
            providerId: "credential",
            accountId: "onprem@acme.com",
          }),
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the email domain does not match any SSO org", () => {
    it("does nothing (normal account creation flow)", async () => {
      const { hooks, users } = hooksOver({
        user: userRow({ email: "u@unrelated.com" }),
      });

      await hooks.beforeAccountCreate({ account: account() });

      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
    });
  });
});

describe("afterAccountCreate", () => {
  describe("when the new account is the credential provider", () => {
    it("does nothing (on-prem email-mode path)", async () => {
      const { hooks, users, accounts } = hooksOver();

      await hooks.afterAccountCreate({
        account: {
          userId: "user_1",
          providerId: "credential",
          accountId: "u@acme.com",
        },
      });

      expect(users.findById).not.toHaveBeenCalled();
      expect(accounts.reconcileOAuthAccounts).not.toHaveBeenCalled();
    });
  });

  describe("when the user's email domain matches an org with the correct SSO provider", () => {
    it("clears pendingSsoSetup and removes stale OAuth accounts", async () => {
      const { hooks, accounts } = hooksOver({
        user: userRow({ email: "existing@acme.com" }),
        organization: legacyOrganization({ ssoProvider: "auth0" }),
      });

      await hooks.afterAccountCreate({
        account: {
          userId: "user_1",
          providerId: "auth0",
          accountId: "auth0|sub-1",
        },
      });

      expect(accounts.reconcileOAuthAccounts).toHaveBeenCalledWith({
        userId: "user_1",
        keepAccounts: [{ providerId: "auth0", accountId: "auth0|sub-1" }],
      });
    });
  });

  describe("when the provider does not match the org's configured SSO", () => {
    it("does not reconcile (leaves state for beforeAccountCreate to flag)", async () => {
      const { hooks, accounts } = hooksOver({
        user: userRow({ email: "existing@acme.com" }),
        organization: legacyOrganization({ ssoProvider: "okta" }),
      });

      await hooks.afterAccountCreate({
        account: {
          userId: "user_1",
          providerId: "google",
          accountId: "sub-1",
        },
      });

      expect(accounts.reconcileOAuthAccounts).not.toHaveBeenCalled();
    });
  });

  describe("when the email domain does not match any SSO org", () => {
    it("does nothing", async () => {
      const { hooks, accounts } = hooksOver({
        user: userRow({ email: "u@unrelated.com" }),
      });

      await hooks.afterAccountCreate({
        account: {
          userId: "user_1",
          providerId: "google",
          accountId: "sub-1",
        },
      });

      expect(accounts.reconcileOAuthAccounts).not.toHaveBeenCalled();
    });
  });

  describe("when a callback resolves a canonically proved grandfathered connection", () => {
    it("uses the connection arrival policy instead of the bare legacy domain", async () => {
      const legacyAccount = {
        providerId: "auth0",
        accountId: "waad|acme-connection|user-1",
      };
      const { hooks, createMembership, organizations } = hooksOver({
        user: userRow({ email: "new@acme.com" }),
        migrationDecision: {
          kind: "allow_connection",
          arrivalConnectionId: "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m",
          keepAccounts: [legacyAccount],
        },
        arrivalConnection: {
          organizationId: "org_1",
          state: "ACTIVE",
          verifiedDomains: ["acme.com"],
          domainVerifications: [
            {
              domain: "acme.com",
              method: "dns-txt",
              actorId: "user_admin",
              verifiedAtMs: 1_725_000_000_000,
              proofState: "VERIFIED",
              firstAbsentAtMs: null,
              graceEndsAtMs: null,
              tokenHash: "sha256:proof",
              evidenceRef: "sha256:proof",
              verifier: null,
              note: null,
            },
          ],
          lapsedDomains: [],
          arrivalPolicy: "admit",
          createdBy: null,
          source: "legacy-grandfathered",
          providerId: "waad|acme-connection",
        },
        arrivalOrganization: { id: "org_1", name: "Acme" },
      });

      await hooks.afterAccountCreate({
        account: { userId: "user_1", ...legacyAccount },
      });

      expect(createMembership).toHaveBeenCalledWith({
        userId: "user_1",
        organizationId: "org_1",
      });
      expect(organizations.findByDomain).not.toHaveBeenCalled();
    });
  });

  describe("during a grandfathered Auth0 migration grace period", () => {
    it("keeps exactly one legacy and one direct account across legacy -> direct -> legacy callbacks", async () => {
      const legacy = {
        providerId: "auth0",
        accountId: "auth0|legacy-subject",
      };
      const direct = {
        providerId: "local_ssoc_replacement",
        accountId: "direct-subject",
      };
      const otherOrganization = {
        providerId: "auth0",
        accountId: "waad|other-organization|same-user",
      };
      const rows = [{ ...legacy }, { ...otherOrganization }];
      const { hooks, accounts } = hooksOver({
        user: userRow({ email: "existing@acme.com" }),
        migrationDecision: {
          kind: "allow_replacement_pair",
          arrivalConnectionId: "local_ssoc_replacement",
          keepAccounts: [legacy, direct],
        },
      });
      accounts.reconcileOAuthAccounts.mockImplementation(
        async ({
          keepAccounts,
        }: {
          keepAccounts: readonly {
            providerId: string;
            accountId: string;
          }[];
        }) => {
          // Reconciliation may recognize the exact migration pair but cannot
          // infer that another subject from the shared Auth0 broker is stale.
          void keepAccounts;
        },
      );

      // Returning through the grandfathered connection first.
      await hooks.afterAccountUpdate({
        account: { userId: "user_1", ...legacy },
      });

      // Better Auth inserts the newly linked direct account between its
      // before/after account-create hooks.
      await hooks.beforeAccountCreate({
        account: { userId: "user_1", ...direct },
      });
      rows.push({ ...direct });
      await hooks.afterAccountCreate({
        account: { userId: "user_1", ...direct },
      });

      // A rollback routes the next callback through legacy again.
      await hooks.afterAccountUpdate({
        account: { userId: "user_1", ...legacy },
      });

      expect(rows).toEqual([legacy, otherOrganization, direct]);
      expect(accounts.reconcileOAuthAccounts).toHaveBeenCalledTimes(3);
      expect(accounts.reconcileOAuthAccounts).toHaveBeenLastCalledWith({
        userId: "user_1",
        keepAccounts: [legacy, direct],
      });
    });
  });
});

describe("beforeSessionCreate", () => {
  describe("when sign-up confirmation is pending", () => {
    /** @scenario Client session flags cannot bypass address confirmation */
    it("blocks every session mint", async () => {
      const { hooks } = hooksOver({
        user: userRow({ signupConfirmationPending: true }),
      });

      const result = await hooks.beforeSessionCreate({
        session: { userId: "user_1" },
      });

      expect(result).toBe(false);
    });
  });

  describe("when the user is deactivated", () => {
    /** @scenario Deactivated user is blocked from signing in */
    it("blocks the session", async () => {
      const { hooks } = hooksOver({
        user: userRow({ deactivatedAt: new Date("2020-01-01") }),
      });
      const result = await hooks.beforeSessionCreate({
        session: { userId: "user_1" },
      });
      expect(result).toBe(false);
    });
  });

  describe("when the user is active", () => {
    /** @scenario Active user is not blocked from signing in */
    it("allows the session", async () => {
      const { hooks } = hooksOver({ user: userRow() });
      const result = await hooks.beforeSessionCreate({
        session: { userId: "user_1" },
      });
      expect(result).toBeUndefined();
    });

    it("records callback authentication through the migration policy using the callback path", async () => {
      const { hooks, ssoMigration } = hooksOver({ user: userRow() });

      await hooks.beforeSessionCreate({
        session: { userId: "user_1" },
        path: "/sso/callback/local_ssoc_replacement",
      });

      expect(
        ssoMigration.authorizeAndRecordAuthentication,
      ).toHaveBeenCalledWith({
        userId: "user_1",
        path: "/sso/callback/local_ssoc_replacement",
        authenticatedAt: expect.any(Date),
      });
    });
  });

  describe("when a legacy connection is finalizing or finalized", () => {
    it("blocks a fresh legacy callback before a session can be minted", async () => {
      const { hooks } = hooksOver({
        user: userRow(),
        authenticationDecision: {
          action: "reject",
          code: "SSO_LEGACY_AUTH_RETIRED",
        },
      });

      await expect(
        hooks.beforeSessionCreate({
          session: { userId: "user_1" },
          path: "/callback/auth0",
        }),
      ).rejects.toThrow("SSO_LEGACY_AUTH_RETIRED");
    });
  });
});

describe("afterSessionCreate", () => {
  describe("when the user has an organization", () => {
    it("fires nurturing hooks with hasOrganization=true", async () => {
      const { hooks, trackActivity, syncProfile } = hooksOver({
        memberships: 1,
      });

      await hooks.afterSessionCreate({ userId: "user_1" });

      // Fire-and-forget — give the chained .then() a microtask to run
      await new Promise((r) => setImmediate(r));

      expect(trackActivity).toHaveBeenCalledWith({
        userId: "user_1",
        hasOrganization: true,
      });
      expect(syncProfile).toHaveBeenCalledWith({
        userId: "user_1",
        hasOrganization: true,
      });
    });
  });

  describe("when the user has no organization", () => {
    it("fires nurturing hooks with hasOrganization=false", async () => {
      const { hooks, trackActivity } = hooksOver({ memberships: 0 });

      await hooks.afterSessionCreate({ userId: "user_1" });
      await new Promise((r) => setImmediate(r));

      expect(trackActivity).toHaveBeenCalledWith({
        userId: "user_1",
        hasOrganization: false,
      });
    });
  });

  describe("when the session is NOT an impersonation session", () => {
    it("updates User.lastLoginAt to now", async () => {
      const { hooks, users } = hooksOver();

      await hooks.afterSessionCreate({ userId: "user_1" });

      expect(users.updateLastLoginAt).toHaveBeenCalledTimes(1);
      const call = users.updateLastLoginAt.mock.calls[0]?.[0] as {
        userId: string;
        lastLoginAt: Date;
      };
      expect(call.userId).toBe("user_1");
      expect(call.lastLoginAt).toBeInstanceOf(Date);
      // Should be very recent
      expect(Date.now() - call.lastLoginAt.getTime()).toBeLessThan(5000);
    });
  });

  describe("when the session IS an impersonation session", () => {
    it("does NOT update lastLoginAt (an admin must not ghost-write the target user)", async () => {
      const { hooks, users } = hooksOver({ memberships: 1 });

      await hooks.afterSessionCreate({
        userId: "user_target",
        isImpersonationSession: true,
      });

      expect(users.updateLastLoginAt).not.toHaveBeenCalled();
    });
  });

  describe("when the lastLoginAt update fails", () => {
    it("does not throw (logged and swallowed)", async () => {
      const { hooks, users } = hooksOver();
      users.updateLastLoginAt.mockRejectedValue(new Error("db down"));

      await expect(
        hooks.afterSessionCreate({ userId: "user_1" }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("afterAccountUpdate", () => {
  const auth0Account = {
    userId: "user_1",
    providerId: "auth0",
    accountId: "auth0|sub-1",
  };

  describe("when the user has pendingSsoSetup=true and the updated account matches the org's SSO provider", () => {
    it("clears pendingSsoSetup and deletes stale non-credential accounts", async () => {
      const { hooks, accounts } = hooksOver({
        user: userRow({ email: "existing@acme.com", pendingSsoSetup: true }),
        organization: legacyOrganization({ ssoProvider: "auth0" }),
      });

      await hooks.afterAccountUpdate({ account: auth0Account });

      expect(accounts.reconcileOAuthAccounts).toHaveBeenCalledWith({
        userId: "user_1",
        keepAccounts: [{ providerId: "auth0", accountId: "auth0|sub-1" }],
      });
    });
  });

  describe("when the user does not have pendingSsoSetup set", () => {
    it("is a no-op (does not touch accounts or user)", async () => {
      const { hooks, accounts, users } = hooksOver({
        user: userRow({ email: "existing@acme.com", pendingSsoSetup: false }),
      });

      await hooks.afterAccountUpdate({ account: auth0Account });

      expect(accounts.reconcileOAuthAccounts).not.toHaveBeenCalled();
      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
    });
  });

  describe("when the updated account does NOT match the org's SSO provider", () => {
    it("is a no-op (we do not clear the flag on wrong-provider sign-in)", async () => {
      const { hooks, accounts } = hooksOver({
        user: userRow({ email: "existing@acme.com", pendingSsoSetup: true }),
        organization: legacyOrganization({ ssoProvider: "auth0" }),
      });

      await hooks.afterAccountUpdate({
        account: {
          userId: "user_1",
          providerId: "google",
          accountId: "google-sub-1",
        },
      });

      expect(accounts.reconcileOAuthAccounts).not.toHaveBeenCalled();
    });
  });

  describe("when the user's email domain does not match any SSO org", () => {
    it("is a no-op", async () => {
      const { hooks, accounts } = hooksOver({
        user: userRow({ email: "user@personal.com", pendingSsoSetup: true }),
      });

      await hooks.afterAccountUpdate({ account: auth0Account });

      expect(accounts.reconcileOAuthAccounts).not.toHaveBeenCalled();
    });
  });

  describe("when reconciliation throws", () => {
    it("does not throw (logged and swallowed)", async () => {
      const { hooks, users } = hooksOver();
      users.findById.mockRejectedValue(new Error("db down"));

      await expect(
        hooks.afterAccountUpdate({ account: auth0Account }),
      ).resolves.toBeUndefined();
    });
  });
});
