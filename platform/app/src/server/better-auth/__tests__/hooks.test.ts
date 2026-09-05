import { describe, expect, it, vi } from "vitest";
import { SsoArrivalService } from "~/server/app-layer/identity/sso-arrival.service";
import { BetterAuthDatabaseHooks, type DatabaseHookUser } from "../hooks";

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
}: {
  user?: DatabaseHookUser | null;
  organization?: LegacyOrganization | null;
  accountCount?: number;
  federationAllowed?: boolean;
  memberships?: number;
  pendingInvite?: { inviteId: string } | null;
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
    deleteOtherOAuthAccounts: vi.fn().mockResolvedValue(undefined),
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
    connections: { findConnectionForSignIn: vi.fn().mockResolvedValue(null) },
    memberships: {
      findMembership: vi.fn().mockResolvedValue(false),
      createMembership,
      findOrganizationForMembership: vi.fn().mockResolvedValue(null),
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
      federationAllowed: vi.fn().mockResolvedValue(federationAllowed),
      analytics: { trackSignUp },
      nurturing: { trackActivity, syncProfile },
    }),
    users,
    organizations,
    accounts,
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

    /** @scenario PostHog signed_up still fires when the SSO auto-add path runs */
    it("tracks signed_up even when the SSO auto-add path runs", async () => {
      const { hooks, trackSignUp } = hooksOver({
        organization: legacyOrganization(),
      });

      await hooks.afterUserCreate({
        user: { id: "user_2", email: "new@acme.com", name: "New User" },
      });

      expect(trackSignUp).toHaveBeenCalledTimes(1);
      expect(trackSignUp).toHaveBeenCalledWith({ userId: "user_2" });
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

  describe("when the email domain matches an organization with ssoDomain", () => {
    /** @scenario New user with matching SSO domain joins the SSO org */
    it("adds the user to the organization as a MEMBER", async () => {
      const { hooks, organizations, createMembership, attachBindings } =
        hooksOver({ organization: legacyOrganization() });

      await hooks.afterUserCreate({
        user: { id: "user_1", email: "new@acme.com", name: "New User" },
      });

      expect(organizations.findByDomain).toHaveBeenCalledWith({
        domain: "acme.com",
      });
      expect(createMembership).toHaveBeenCalledWith({
        userId: "user_1",
        organizationId: "org_1",
      });

      // The organization-scoped grant lands beside the membership row.
      expect(attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          onDuplicate: "skip",
          bindings: [
            expect.objectContaining({
              principal: { userId: "user_1" },
              role: "MEMBER",
              scopeType: "ORGANIZATION",
              scopeId: "org_1",
            }),
          ],
        }),
      );
    });
  });

  describe("when the platform SSO gate denies (unlicensed deployment)", () => {
    /** @scenario Unlicensed-mode signup does not auto-join a domain-matched organization */
    it("skips the domain-matched organization auto-join", async () => {
      const { hooks, organizations, createMembership } = hooksOver({
        organization: legacyOrganization(),
        federationAllowed: false,
      });

      await hooks.afterUserCreate({
        user: { id: "user_1", email: "new@acme.com", name: "New User" },
      });

      expect(organizations.findByDomain).not.toHaveBeenCalled();
      expect(createMembership).not.toHaveBeenCalled();
    });
  });

  describe("when a PENDING invite exists for the signing-up user", () => {
    it("applies the invite instead of the default membership", async () => {
      const { hooks, applyPendingInvite, createMembership, attachBindings } =
        hooksOver({
          organization: legacyOrganization(),
          pendingInvite: { inviteId: "inv_1" },
        });

      await hooks.afterUserCreate({
        user: { id: "user_1", email: "alice@acme.com", name: "Alice" },
      });

      expect(applyPendingInvite).toHaveBeenCalledWith({
        userId: "user_1",
        organizationId: "org_1",
        email: "alice@acme.com",
      });
      // The invite's role and team assignments carry their own grants, so
      // the default-MEMBER pair must not run beside them.
      expect(createMembership).not.toHaveBeenCalled();
      expect(attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("when the email domain does not match any SSO organization", () => {
    it("does nothing", async () => {
      const { hooks, createMembership } = hooksOver();
      await hooks.afterUserCreate({
        user: { id: "user_1", email: "u@other.com", name: "User" },
      });
      expect(createMembership).not.toHaveBeenCalled();
    });
  });

  describe("when the user has no email", () => {
    it("does nothing and does not throw", async () => {
      const { hooks, organizations } = hooksOver();
      await hooks.afterUserCreate({
        user: { id: "user_1", email: "", name: "User" },
      });
      expect(organizations.findByDomain).not.toHaveBeenCalled();
    });
  });

  describe("when the org auto-add fails (concurrent signup race / db error)", () => {
    it("swallows the error so the signup itself still succeeds", async () => {
      // Regression for iter-23: throwing here would propagate up through
      // BetterAuth's pendingHooks loop and bubble out of handleOAuthUserInfo
      // as `unable to create user`. The User row is already committed at this
      // point — failing the signup would orphan the user.
      const { hooks, organizations } = hooksOver();
      organizations.findByDomain.mockRejectedValue(new Error("db down"));

      await expect(
        hooks.afterUserCreate({
          user: { id: "user_1", email: "u@acme.com", name: "User" },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a concurrent callback already created the membership row", () => {
    it("re-asserts the organization grant instead of assuming it landed", async () => {
      // The membership row and the grant beside it no longer share a
      // transaction, so the other callback may have died between them.
      const { hooks, createMembership, attachBindings } = hooksOver({
        organization: legacyOrganization(),
      });
      createMembership.mockResolvedValue("already-present");

      await hooks.afterUserCreate({
        user: { id: "user_1", email: "u@acme.com", name: "User" },
      });

      expect(attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          onDuplicate: "skip",
          bindings: [
            expect.objectContaining({
              principal: { userId: "user_1" },
              role: "MEMBER",
              scopeType: "ORGANIZATION",
              scopeId: "org_1",
            }),
          ],
        }),
      );
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

      expect(accounts.deleteOtherOAuthAccounts).not.toHaveBeenCalled();
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
      expect(accounts.deleteOtherOAuthAccounts).not.toHaveBeenCalled();
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

      expect(accounts.deleteOtherOAuthAccounts).toHaveBeenCalledWith({
        userId: "user_1",
        providerId: "auth0",
        accountId: "auth0|sub-1",
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

      expect(accounts.deleteOtherOAuthAccounts).not.toHaveBeenCalled();
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

      expect(accounts.deleteOtherOAuthAccounts).not.toHaveBeenCalled();
    });
  });
});

describe("beforeSessionCreate", () => {
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

      expect(accounts.deleteOtherOAuthAccounts).toHaveBeenCalledWith({
        userId: "user_1",
        providerId: "auth0",
        accountId: "auth0|sub-1",
      });
    });
  });

  describe("when the user does not have pendingSsoSetup set", () => {
    it("is a no-op (does not touch accounts or user)", async () => {
      const { hooks, accounts, users } = hooksOver({
        user: userRow({ email: "existing@acme.com", pendingSsoSetup: false }),
      });

      await hooks.afterAccountUpdate({ account: auth0Account });

      expect(accounts.deleteOtherOAuthAccounts).not.toHaveBeenCalled();
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

      expect(accounts.deleteOtherOAuthAccounts).not.toHaveBeenCalled();
    });
  });

  describe("when the user's email domain does not match any SSO org", () => {
    it("is a no-op", async () => {
      const { hooks, accounts } = hooksOver({
        user: userRow({ email: "user@personal.com", pendingSsoSetup: true }),
      });

      await hooks.afterAccountUpdate({ account: auth0Account });

      expect(accounts.deleteOtherOAuthAccounts).not.toHaveBeenCalled();
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
