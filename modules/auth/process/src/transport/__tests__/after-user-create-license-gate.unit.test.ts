import { createApiFixture } from "@langwatch/api-fixture";
import type {
  SsoArrivalApi,
  SsoAuthenticationActivityApi,
  SsoMigrationCallbackApi,
} from "@langwatch/identity-contract";
/**
 * ADR-027 site #4: the ssoDomain auto-join `afterUserCreate` runs is
 * federation, and it rides the same platform SSO license gate as every other provider — a
 * domain-matched organization must not gain a member off a licensing store answer of "no
 */
import { describe, expect, it, vi } from "vitest";

import type {
  BetterAuthAnnouncements,
  BetterAuthFederation,
  BetterAuthPendingInvite,
} from "../../channels/better-auth.channel.ts";
import { afterUserCreate } from "../../channels/http/http.better-auth-hooks.channel.ts";
import type {
  BetterAuthHookOrganization,
  BetterAuthHooksRepository,
} from "../../repositories/better-auth-hooks.repository.ts";

class StubFederation implements BetterAuthFederation {
  constructor(private readonly ssoAllowed: boolean) {}
  federationCapable(): boolean {
    return true;
  }
  resolveSignInMethodPolicy(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  platformSsoAllowed(): Promise<boolean> {
    return Promise.resolve(this.ssoAllowed);
  }
}

class StubInvites implements BetterAuthPendingInvite {
  tryFindPendingByOrganizationAndEmail(): Promise<null> {
    return Promise.resolve(null);
  }
  applyInvite(): Promise<void> {
    return Promise.reject(new Error("unused"));
  }
}

class StubAnnouncements implements BetterAuthAnnouncements {
  readonly trackServerEvent = vi.fn();
  readonly reportError = vi.fn();
  announceSignup(): never {
    throw new Error("unused");
  }
  ssoAutoAddNurturing(): never {
    throw new Error("unused");
  }
  sessionNurturing(): never {
    throw new Error("unused");
  }
}

function hooksRepo(members: Partial<BetterAuthHooksRepository>): BetterAuthHooksRepository {
  const unused = (): never => {
    throw new Error("this repository member is not used by this test");
  };
  return {
    tryFindUserForHooks: unused,
    tryFindOrganizationBySsoDomain: unused,
    countAccountsForUser: unused,
    findFederatedAccountsForUser: unused,
    findFederatedAccountsForUsers: unused,
    deleteAccounts: unused,
    flagPendingSsoSetup: unused,
    createOrganizationMembership: unused,
    reconcileSsoAccounts: unused,
    recordLastLogin: unused,
    countOrgMembershipsForUser: unused,
    ...members,
  };
}

function organizationRepo(organization: BetterAuthHookOrganization | null) {
  const mocks = {
    tryFindOrganizationBySsoDomain: vi
      .fn<BetterAuthHooksRepository["tryFindOrganizationBySsoDomain"]>()
      .mockResolvedValue(organization),
    createOrganizationMembership:
      vi.fn<BetterAuthHooksRepository["createOrganizationMembership"]>(),
  };
  return { double: hooksRepo(mocks), mocks };
}

describe("the ssoDomain auto-join on an unlicensed deployment", () => {
  /** @scenario "Unlicensed-mode signup does not auto-join a domain-matched organization" */
  it("creates the account and skips the domain-matched organization entirely", async () => {
    const federation = new StubFederation(false);
    const { double: repo, mocks } = organizationRepo({
      id: "org_1",
      name: "Acme",
      ssoProvider: null,
    });

    await afterUserCreate({
      repo,
      user: {
        id: "user_1",
        email: "new@acme.com",
        name: "New User",
        emailVerified: true,
      },
      collaborators: {
        federation,
        invites: new StubInvites(),
        announcements: new StubAnnouncements(),
        authzGrants: {} as never,
        arrivals: createApiFixture<SsoArrivalApi>({ admit: async () => undefined }),
        ssoActivity: createApiFixture<SsoAuthenticationActivityApi>({
          record: async () => undefined,
        }),
        ssoMigration: createApiFixture<SsoMigrationCallbackApi>({
          decideAccountLink: async () => ({ kind: "not_migrating" }),
        }),
      },
    });

    expect(mocks.tryFindOrganizationBySsoDomain).not.toHaveBeenCalled();
    expect(mocks.createOrganizationMembership).not.toHaveBeenCalled();
  });
});
