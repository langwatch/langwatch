import { createApiFixture } from "@langwatch/api-fixture";
import type {
  SsoArrivalApi,
  SsoAuthenticationActivityApi,
  SsoMigrationCallbackApi,
} from "@langwatch/identity-contract";
/**
 * What signing in through an identity provider does to a domain-matched
 * organization: who joins it, whose account links, and who is flagged for
 * arriving through the wrong provider.
 * @see specs/auth/phase-1-better-auth-config.feature
 */
import { describe, expect, it, vi } from "vitest";

import type {
  BetterAuthAnnouncements,
  BetterAuthFederation,
  BetterAuthPendingInvite,
} from "../../channels/better-auth.channel.ts";
import {
  afterUserCreate,
  tryBeforeAccountCreate,
} from "../../channels/http/http.better-auth-hooks.channel.ts";
import type { BetterAuthHooksRepository } from "../../repositories/better-auth-hooks.repository.ts";

class LicensedFederation implements BetterAuthFederation {
  federationCapable(): boolean {
    return true;
  }
  resolveSignInMethodPolicy(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  platformSsoAllowed(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

class NoInvites implements BetterAuthPendingInvite {
  tryFindPendingByOrganizationAndEmail(): Promise<null> {
    return Promise.resolve(null);
  }
  applyInvite(): Promise<void> {
    return Promise.reject(new Error("unused"));
  }
}

class StubPendingInvites implements BetterAuthPendingInvite {
  readonly applyInvite = vi.fn().mockResolvedValue(undefined);
  constructor(private readonly pending: { id: string } | null) {}
  tryFindPendingByOrganizationAndEmail(): Promise<{ id: string } | null> {
    return Promise.resolve(this.pending);
  }
}

class RecordingAnnouncements implements BetterAuthAnnouncements {
  readonly trackServerEvent = vi.fn();
  readonly reportError = vi.fn();
  readonly announceSignup = vi.fn();
  readonly ssoAutoAddNurturing = vi.fn();
  readonly sessionNurturing = vi.fn();
}

const ACME = { id: "org_acme", name: "Acme", ssoDomain: "acme.com", ssoProvider: "google" };

function signupRepo(organization: typeof ACME | null): BetterAuthHooksRepository {
  return {
    tryFindOrganizationBySsoDomain: vi.fn().mockResolvedValue(organization),
    createOrganizationMembership: vi.fn().mockResolvedValue("created"),
  } as unknown as BetterAuthHooksRepository;
}

function accountRepo({
  organization,
  accountCount,
  user = { id: "user_1", email: "existing@acme.com", deactivatedAt: null },
}: {
  organization: typeof ACME | null;
  accountCount: number;
  user?: { id: string; email: string; deactivatedAt: Date | null };
}): BetterAuthHooksRepository {
  return {
    tryFindUserForHooks: vi.fn().mockResolvedValue({ ...user, pendingSsoSetup: false }),
    tryFindOrganizationBySsoDomain: vi.fn().mockResolvedValue(organization),
    countAccountsForUser: vi.fn().mockResolvedValue(accountCount),
    flagPendingSsoSetup: vi.fn().mockResolvedValue(undefined),
  } as unknown as BetterAuthHooksRepository;
}

describe("signing in through a domain-matched organization's identity provider", () => {
  describe("given nobody with that email has an account yet", () => {
    /** @scenario New user with matching SSO domain joins the SSO org */
    it("joins the new user to the organization as a member", async () => {
      const repo = signupRepo(ACME);
      const attachBindings = vi.fn().mockResolvedValue(undefined);

      await afterUserCreate({
        repo,
        user: { id: "user_new", email: "new@acme.com", name: "New User", emailVerified: true },
        collaborators: {
          federation: new LicensedFederation(),
          invites: new NoInvites(),
          announcements: new RecordingAnnouncements(),
          authzGrants: { attachBindings } as never,
          arrivals: createApiFixture<SsoArrivalApi>({ admit: async () => undefined }),
          ssoActivity: createApiFixture<SsoAuthenticationActivityApi>({
            record: async () => undefined,
          }),
          ssoMigration: createApiFixture<SsoMigrationCallbackApi>({
            decideAccountLink: async () => ({ kind: "not_migrating" }),
          }),
        },
      });

      expect(repo.createOrganizationMembership).toHaveBeenCalledWith({
        userId: "user_new",
        organizationId: "org_acme",
      });
      expect(attachBindings).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: "org_acme" }),
      );
    });
  });

  describe("given a credential signup whose email nobody has verified", () => {
    /** @scenario Unverified signup with a matching ssoDomain does not auto-join the SSO org */
    it("creates no membership and no grant at the domain-matched organization", async () => {
      const repo = signupRepo(ACME);
      const attachBindings = vi.fn().mockResolvedValue(undefined);

      await afterUserCreate({
        repo,
        user: {
          id: "user_new",
          email: "new@acme.com",
          name: "New User",
          emailVerified: false,
        },
        collaborators: {
          federation: new LicensedFederation(),
          invites: new NoInvites(),
          announcements: new RecordingAnnouncements(),
          authzGrants: { attachBindings } as never,
          arrivals: createApiFixture<SsoArrivalApi>({ admit: async () => undefined }),
          ssoActivity: createApiFixture<SsoAuthenticationActivityApi>({
            record: async () => undefined,
          }),
          ssoMigration: createApiFixture<SsoMigrationCallbackApi>({
            decideAccountLink: async () => ({ kind: "not_migrating" }),
          }),
        },
      });

      expect(repo.tryFindOrganizationBySsoDomain).not.toHaveBeenCalled();
      expect(repo.createOrganizationMembership).not.toHaveBeenCalled();
      expect(attachBindings).not.toHaveBeenCalled();
    });

    /** @scenario Unverified signup does not claim a pending invite addressed to its email */
    it("leaves the pending invite unapplied and grants nothing", async () => {
      const repo = signupRepo(ACME);
      const invites = new StubPendingInvites({ id: "invite_1" });
      const attachBindings = vi.fn().mockResolvedValue(undefined);

      await afterUserCreate({
        repo,
        user: {
          id: "user_new",
          email: "invited@acme.com",
          name: "New User",
          emailVerified: false,
        },
        collaborators: {
          federation: new LicensedFederation(),
          invites,
          announcements: new RecordingAnnouncements(),
          authzGrants: { attachBindings } as never,
          arrivals: createApiFixture<SsoArrivalApi>({ admit: async () => undefined }),
          ssoActivity: createApiFixture<SsoAuthenticationActivityApi>({
            record: async () => undefined,
          }),
          ssoMigration: createApiFixture<SsoMigrationCallbackApi>({
            decideAccountLink: async () => ({ kind: "not_migrating" }),
          }),
        },
      });

      expect(invites.applyInvite).not.toHaveBeenCalled();
      expect(repo.createOrganizationMembership).not.toHaveBeenCalled();
      expect(attachBindings).not.toHaveBeenCalled();
    });
  });

  describe("given an existing user signs in through the organization's own provider", () => {
    /** @scenario Existing user with correct SSO provider auto-links */
    it("lets the account row be created and leaves the pending flag alone", async () => {
      const repo = accountRepo({ organization: ACME, accountCount: 1 });

      await tryBeforeAccountCreate({
        repo,
        account: { userId: "user_1", providerId: "google", accountId: "google|123" },
        federation: new LicensedFederation(),
      });

      expect(repo.flagPendingSsoSetup).not.toHaveBeenCalled();
    });
  });

  describe("given an existing user signs in through a provider the organization does not use", () => {
    /** @scenario Existing user with wrong SSO provider gets pending flag */
    it("lets them in, and flags the account for setup", async () => {
      const repo = accountRepo({
        organization: { ...ACME, ssoProvider: "okta" },
        accountCount: 1,
      });

      await tryBeforeAccountCreate({
        repo,
        account: { userId: "user_1", providerId: "google", accountId: "google|123" },
        federation: new LicensedFederation(),
      });

      expect(repo.flagPendingSsoSetup).toHaveBeenCalledWith({ userId: "user_1" });
    });
  });
});
