/**
 * What signing in through an identity provider does to a domain-matched
 * organization: who joins it, whose account links, and who is flagged for
 * arriving through the wrong provider.
 * @see specs/auth/phase-1-better-auth-config.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { BetterAuthHooksRepository } from "../../../repositories/better-auth-hooks.repository.ts";
import type {
  BetterAuthAnnouncementsPort,
  BetterAuthFederationPort,
  BetterAuthPendingInvitePort,
} from "../../../ports/better-auth.port.ts";
import { afterUserCreate, tryBeforeAccountCreate } from "../better-auth-hooks.api.ts";

class LicensedFederationPort implements BetterAuthFederationPort {
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

class NoInvitesPort implements BetterAuthPendingInvitePort {
  tryFindPendingByOrganizationAndEmail(): Promise<null> {
    return Promise.resolve(null);
  }
  applyInvite(): Promise<void> {
    return Promise.reject(new Error("unused"));
  }
}

class RecordingAnnouncementsPort implements BetterAuthAnnouncementsPort {
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
        user: { id: "user_new", email: "new@acme.com", name: "New User" },
        collaborators: {
          federation: new LicensedFederationPort(),
          invites: new NoInvitesPort(),
          announcements: new RecordingAnnouncementsPort(),
          authzGrants: { attachBindings } as never,
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

  describe("given an existing user signs in through the organization's own provider", () => {
    /** @scenario Existing user with correct SSO provider auto-links */
    it("lets the account row be created and leaves the pending flag alone", async () => {
      const repo = accountRepo({ organization: ACME, accountCount: 1 });

      await tryBeforeAccountCreate({
        repo,
        account: { userId: "user_1", providerId: "google", accountId: "google|123" },
        federation: new LicensedFederationPort(),
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
        federation: new LicensedFederationPort(),
      });

      expect(repo.flagPendingSsoSetup).toHaveBeenCalledWith({ userId: "user_1" });
    });
  });
});
