import { describe, expect, it, vi } from "vitest";
import { databaseHooks } from "../config/database-hooks";
import { CredentialSessionGuard } from "../credential-session-guard";
import {
  hooksOver,
  legacyOrganization,
  userRow,
} from "./support/hooks.fixture";

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

  describe("when an authenticated callback resolves to a proved admitting connection", () => {
    /** @scenario PostHog signed_up still fires when the SSO auto-add path runs */
    it("tracks signup once and admits the user with an organization grant", async () => {
      const account = {
        userId: "user_1",
        providerId: "ssoc_acme",
        accountId: "subject_1",
      };
      const { hooks, trackSignUp, createMembership, attachBindings } =
        hooksOver({
          user: userRow({ email: "new@acme.com", name: "New User" }),
          migrationDecision: {
            kind: "allow_connection",
            arrivalConnectionId: "ssoc_acme",
            keepAccounts: [account],
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
            createdBy: "user_admin",
            source: "self-serve",
            providerId: "ssoc_acme",
          },
          arrivalOrganization: { id: "org_1", name: "Acme" },
        });

      hooks.afterUserCreate({
        user: { id: "user_1", email: "new@acme.com", name: "New User" },
      });
      await hooks.afterAccountCreate({ account });

      expect(trackSignUp).toHaveBeenCalledTimes(1);
      expect(trackSignUp).toHaveBeenCalledWith({ userId: "user_1" });
      expect(createMembership).toHaveBeenCalledWith({
        userId: "user_1",
        organizationId: "org_1",
      });
      expect(attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
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
    it("defers flag clearing to afterAccountCreate (no writes in before)", async () => {
      const { hooks, users } = hooksOver({
        user: userRow({ email: "existing@acme.com" }),
        organization: legacyOrganization({ ssoProvider: "google" }),
      });

      await hooks.beforeAccountCreate({ account: account() });

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

  describe("when an EXISTING user's email domain matches an org with a WRONG BROKERED provider", () => {
    /** @scenario Existing user with wrong brokered SSO provider gets pending flag */
    it("soft-blocks by setting pendingSsoSetup=true without throwing", async () => {
      const { hooks, users } = hooksOver({
        user: userRow({ email: "existing@acme.com" }),
        organization: legacyOrganization({ ssoProvider: "waad|acme-conn" }),
        // Existing user — already has a linked account from a prior login.
        accountCount: 1,
      });

      // Through the broker, on one of its other connections: the
      // mid-migration member this soft flag exists for.
      await hooks.beforeAccountCreate({
        account: account({
          providerId: "auth0",
          accountId: "google-oauth2|123",
        }),
      });

      expect(users.updatePendingSsoSetup).toHaveBeenCalledWith({
        userId: "user_1",
        pendingSsoSetup: true,
      });
    });
  });

  describe("when a NATIVE social provider is used at a domain a CONNECTION proved", () => {
    // The self-serve population, which the legacy guard below never covered:
    // a connection writes no `ssoDomain`, so `findByDomain` answers null and
    // every rule the router enforces was skipped by the button that skips the
    // router. `organization: null` here is the point, not an omission.
    const governedBy = (connectionId: string | null) =>
      hooksOver({
        user: userRow({ email: "sam@acme.com" }),
        organization: null,
        governingConnectionId: connectionId,
        accountCount: 1,
      });

    /** @scenario "A native social sign-up on a proved domain is refused" */
    it("refuses before any Google identity is attached to them", async () => {
      const { hooks, users } = governedBy("ssoc_acme");

      await expect(
        hooks.beforeAccountCreate({ account: account() }),
      ).rejects.toMatchObject({
        body: { code: "SSO_REQUIRED_BY_ORGANIZATION" },
      });

      // Not the soft flag either: this person is being sent somewhere, not
      // stranded behind a banner about a migration they are not in.
      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
    });

    /** @scenario "The refusal names the connection, so it can be walked into" */
    it("carries the connection as where they should go instead", async () => {
      const { hooks } = governedBy("ssoc_acme");

      // The message is the bounce TARGET: better-auth puts it in
      // `error_description` on the callback redirect, and the error route
      // dials it. A refusal that named nothing would be a dead end.
      await expect(
        hooks.beforeAccountCreate({ account: account() }),
      ).rejects.toMatchObject({ body: { message: "ssoc_acme" } });
    });

    /** @scenario "The connection dialling itself is not a native button" */
    it("does not refuse the connection's own sign-in", async () => {
      const { hooks } = governedBy("ssoc_acme");

      await expect(
        hooks.beforeAccountCreate({
          account: account({ providerId: "ssoc_acme", accountId: "subject_1" }),
        }),
      ).resolves.toBeUndefined();
    });

    /** @scenario "A brokered sign-in mid-migration is left alone" */
    it("does not refuse a brokered sign-in on another connection", async () => {
      const { hooks } = governedBy("ssoc_acme");

      await expect(
        hooks.beforeAccountCreate({
          account: account({
            providerId: "auth0",
            accountId: "google-oauth2|123",
          }),
        }),
      ).resolves.toBeUndefined();
    });

    /** @scenario "An already-linked native account is refused on the sign-in path too" */
    it("refuses on the update seam, where no account row is created", async () => {
      const { hooks } = governedBy("ssoc_acme");

      await expect(
        hooks.afterAccountUpdate({
          account: {
            userId: "user_1",
            providerId: "google",
            accountId: "sub-1",
          },
        }),
      ).rejects.toMatchObject({
        body: { code: "SSO_REQUIRED_BY_ORGANIZATION" },
      });
    });
  });

  describe("when a NATIVE social provider is used at an SSO-enforced domain", () => {
    const enforcedByBroker = (accountCount: number) =>
      hooksOver({
        user: userRow({ email: "existing@acme.com" }),
        organization: legacyOrganization({ ssoProvider: "waad|acme-conn" }),
        accountCount,
      });

    /** @scenario A native social sign-in at an SSO-enforced domain is refused */
    it("refuses an existing member with SSO_PROVIDER_NOT_ALLOWED", async () => {
      const { hooks, users } = enforcedByBroker(1);

      await expect(
        hooks.beforeAccountCreate({ account: account() }),
      ).rejects.toThrow("SSO_PROVIDER_NOT_ALLOWED");

      // The soft flag is for the broker's migration population, not this one:
      // a refused sign-in must not also strand them behind a banner.
      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
    });

    /** @scenario An organization pinned to Google still signs in with Google */
    it("still admits a provider the organization itself pinned", async () => {
      const { hooks, users } = hooksOver({
        user: userRow({ email: "existing@acme.com" }),
        // This organization's configured provider IS Google.
        organization: legacyOrganization({ ssoProvider: "google" }),
        accountCount: 1,
      });

      await expect(
        hooks.beforeAccountCreate({ account: account() }),
      ).resolves.toBeUndefined();

      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
    });

    it("reaches that answer without counting the user's accounts", async () => {
      const { hooks, accounts } = enforcedByBroker(1);

      await expect(
        hooks.beforeAccountCreate({
          account: account({ providerId: "microsoft", accountId: "sub-2" }),
        }),
      ).rejects.toThrow("SSO_PROVIDER_NOT_ALLOWED");

      expect(accounts.countForUser).not.toHaveBeenCalled();
    });
  });

  describe("when the platform SSO gate DENIES (unlicensed deployment)", () => {
    /** @scenario Unlicensed-mode signup does not auto-join a domain-matched organization */
    it("accepts credential hooks without any federation side effects", async () => {
      const {
        hooks,
        trackSignUp,
        organizations,
        createMembership,
        attachBindings,
        applyPendingInvite,
        requestFromSsoArrival,
      } = hooksOver({
        user: userRow({ email: "new@acme.com", name: "New User" }),
        organization: legacyOrganization({ ssoProvider: "auth0" }),
        federationAllowed: false,
      });
      const account = {
        userId: "user_1",
        providerId: "credential",
        accountId: "new@acme.com",
      };

      hooks.afterUserCreate({
        user: { id: "user_1", email: "new@acme.com", name: "New User" },
      });
      await expect(
        hooks.beforeAccountCreate({ account }),
      ).resolves.toBeUndefined();
      await expect(
        hooks.afterAccountCreate({ account }),
      ).resolves.toBeUndefined();

      expect(trackSignUp).toHaveBeenCalledTimes(1);
      expect(trackSignUp).toHaveBeenCalledWith({ userId: "user_1" });
      expect(organizations.findByDomain).not.toHaveBeenCalled();
      expect(createMembership).not.toHaveBeenCalled();
      expect(attachBindings).not.toHaveBeenCalled();
      expect(applyPendingInvite).not.toHaveBeenCalled();
      expect(requestFromSsoArrival).not.toHaveBeenCalled();
    });

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
    /** @scenario "SSO-domain guard still blocks the wrong provider" */
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
      const { hooks, users } = hooksOver();

      await hooks.afterAccountCreate({
        account: {
          userId: "user_1",
          providerId: "credential",
          accountId: "u@acme.com",
        },
      });

      expect(users.findById).not.toHaveBeenCalled();
      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
    });
  });

  describe("when the user's email domain matches an org with the correct SSO provider", () => {
    it("clears pendingSsoSetup while preserving every native account", async () => {
      const { hooks, users } = hooksOver({
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

      expect(users.updatePendingSsoSetup).toHaveBeenCalledWith({
        userId: "user_1",
        pendingSsoSetup: false,
      });
    });
  });

  describe("when the provider does not match the org's configured SSO", () => {
    it("does not clear the flag (leaves state for beforeAccountCreate)", async () => {
      const { hooks, users } = hooksOver({
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

      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
    });
  });

  describe("when the email domain does not match any SSO org", () => {
    it("does nothing", async () => {
      const { hooks, users } = hooksOver({
        user: userRow({ email: "u@unrelated.com" }),
      });

      await hooks.afterAccountCreate({
        account: {
          userId: "user_1",
          providerId: "google",
          accountId: "sub-1",
        },
      });

      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
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
      const { hooks, users } = hooksOver({
        user: userRow({ email: "existing@acme.com" }),
        migrationDecision: {
          kind: "allow_replacement_pair",
          arrivalConnectionId: "local_ssoc_replacement",
          keepAccounts: [legacy, direct],
        },
      });
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
      expect(users.updatePendingSsoSetup).toHaveBeenCalledTimes(3);
      expect(users.updatePendingSsoSetup).toHaveBeenLastCalledWith({
        userId: "user_1",
        pendingSsoSetup: false,
      });
    });
  });
});

describe("beforeSessionCreate", () => {
  it.each([
    {
      title: "concrete callback",
      context: { path: "/callback/auth0" },
      expected: "/callback/auth0",
    },
    {
      title: "social callback template",
      context: { path: "/callback/:id", params: { id: "auth0" } },
      expected: "/callback/auth0",
    },
    {
      title: "OAuth callback template",
      context: {
        path: "/oauth2/callback/:providerId",
        params: { providerId: "okta" },
      },
      expected: "/oauth2/callback/okta",
    },
    {
      title: "OIDC callback template",
      context: {
        path: "/sso/callback/:providerId",
        params: { providerId: "ssoc_oidc" },
      },
      expected: "/sso/callback/ssoc_oidc",
    },
    {
      title: "SAML callback template",
      context: {
        path: "/sso/saml2/sp/acs/:providerId",
        params: { providerId: "ssoc_saml" },
      },
      expected: "/sso/saml2/sp/acs/ssoc_saml",
    },
    {
      title: "unmatched query provider",
      context: {
        path: "/sso/callback/:providerId",
        query: { providerId: "ssoc_other" },
      },
      expected: void 0,
    },
    {
      title: "invalid matched parameter",
      context: {
        path: "/sso/callback/:providerId",
        params: { providerId: "ssoc_other/path" },
      },
      expected: void 0,
    },
  ])("forwards $title", async ({ context, expected }) => {
    const { hooks, ssoMigration } = hooksOver({
      user: userRow(),
      authenticationDecision: {
        action: "reject",
        code: "SSO_LEGACY_AUTH_RETIRED",
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
        claimsForMint: vi
          .fn()
          .mockResolvedValue({ identifierId: null, amr: [] }),
      }),
      providerAssertions: () => ({
        recordVerifiedCallbackToken: vi.fn(),
        recordAuthenticatedCallbackAccount: vi.fn(),
      }),
    });
    const before = configured?.session?.create?.before;
    if (before === undefined) {
      throw new Error("session create hook is not configured");
    }

    await expect(
      Reflect.apply(before, null, [{ userId: "user_1" }, context]),
    ).rejects.toThrow("SSO_LEGACY_AUTH_RETIRED");
    expect(ssoMigration.authorizeAndRecordAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({ path: expected }),
    );
  });

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

  describe("when an ALREADY-LINKED native social account signs in at an SSO-enforced org", () => {
    const linkedNative = (ssoProvider: string) =>
      hooksOver({
        // The soft block wrote this row before the refusal existed; the flag
        // is irrelevant to the guard, and set here to prove it.
        user: userRow({ email: "existing@acme.com", pendingSsoSetup: true }),
        organization: legacyOrganization({ ssoProvider }),
      });

    /** @scenario A native social sign-in on an already-linked account is refused too */
    it("refuses, because no Account row is created on this path", async () => {
      const { hooks } = linkedNative("waad|acme-conn");

      await expect(
        hooks.afterAccountUpdate({
          account: {
            userId: "user_1",
            providerId: "google",
            accountId: "sub-1",
          },
        }),
      ).rejects.toThrow("SSO_PROVIDER_NOT_ALLOWED");
    });

    it("lets a brokered sign-in on the wrong connection through", async () => {
      // The mid-migration member the soft flag is for: refused here, they
      // would be sent to a connection they may hold no account in.
      const { hooks } = linkedNative("waad|acme-conn");

      await expect(
        hooks.afterAccountUpdate({
          account: {
            userId: "user_1",
            providerId: "auth0",
            accountId: "google-oauth2|123",
          },
        }),
      ).resolves.toBeUndefined();
    });

    it("lets the organization's own pinned provider through", async () => {
      const { hooks } = linkedNative("google");

      await expect(
        hooks.afterAccountUpdate({
          account: {
            userId: "user_1",
            providerId: "google",
            accountId: "sub-1",
          },
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the user has pendingSsoSetup=true and the updated account matches the org's SSO provider", () => {
    it("clears pendingSsoSetup while preserving every native account", async () => {
      const { hooks, users } = hooksOver({
        user: userRow({ email: "existing@acme.com", pendingSsoSetup: true }),
        organization: legacyOrganization({ ssoProvider: "auth0" }),
      });

      await hooks.afterAccountUpdate({ account: auth0Account });

      expect(users.updatePendingSsoSetup).toHaveBeenCalledWith({
        userId: "user_1",
        pendingSsoSetup: false,
      });
    });
  });

  describe("when the user does not have pendingSsoSetup set", () => {
    it("is a no-op (does not touch accounts or user)", async () => {
      const { hooks, users } = hooksOver({
        user: userRow({ email: "existing@acme.com", pendingSsoSetup: false }),
      });

      await hooks.afterAccountUpdate({ account: auth0Account });

      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
    });
  });

  describe("when the updated account does NOT match the org's SSO provider", () => {
    // A BROKERED mismatch: the native case is refused outright now, and is
    // covered by its own describe above.
    it("is a no-op (we do not clear the flag on wrong-provider sign-in)", async () => {
      const { hooks, users } = hooksOver({
        user: userRow({ email: "existing@acme.com", pendingSsoSetup: true }),
        organization: legacyOrganization({ ssoProvider: "waad|acme-conn" }),
      });

      await hooks.afterAccountUpdate({
        account: {
          userId: "user_1",
          providerId: "auth0",
          accountId: "google-oauth2|123",
        },
      });

      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
    });
  });

  describe("when the user's email domain does not match any SSO org", () => {
    it("is a no-op", async () => {
      const { hooks, users } = hooksOver({
        user: userRow({ email: "user@personal.com", pendingSsoSetup: true }),
      });

      await hooks.afterAccountUpdate({ account: auth0Account });

      expect(users.updatePendingSsoSetup).not.toHaveBeenCalled();
    });
  });

  describe("when account update handling throws", () => {
    it("does not throw (logged and swallowed)", async () => {
      const { hooks, users } = hooksOver();
      users.findById.mockRejectedValue(new Error("db down"));

      await expect(
        hooks.afterAccountUpdate({ account: auth0Account }),
      ).resolves.toBeUndefined();
    });
  });
});
