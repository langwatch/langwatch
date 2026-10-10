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
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type {
  BetterAuthAnnouncements,
  BetterAuthFederation,
} from "../../channels/better-auth.channel.ts";
import {
  afterUserCreate,
  type LinkProposals,
  type SsoDomainOrganizations,
} from "../../channels/http/http.better-auth-hooks.channel.ts";
import type { BetterAuthHooksRepository } from "../../repositories/better-auth-hooks.repository.ts";

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

class StubInvites implements Pick<OrganizationApi, "applyPendingInvite"> {
  applyPendingInvite(): Promise<{ applied: false }> {
    return Promise.resolve({ applied: false });
  }
}

class StubAnnouncements implements BetterAuthAnnouncements {
  readonly signUpNurturing = vi.fn();
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
    getUserForHooks: unused,
    countAccountsForUser: unused,
    countPasskeysForUser: unused,
    findFederatedAccountsForUser: unused,
    findFederatedAccountsForUsers: unused,
    deleteAccounts: unused,
    flagPendingSsoSetup: unused,
    reconcileSsoAccounts: unused,
    recordLastLogin: unused,
    ...members,
  };
}

type SsoDomainOrganization = { id: string; name: string; ssoProvider: string | null };

function organizationRepo(organization: SsoDomainOrganization | null) {
  const mocks = {
    findBySsoDomain: vi
      .fn<SsoDomainOrganizations["findBySsoDomain"]>()
      .mockResolvedValue(organization),
    createSsoDomainMembership: vi.fn<SsoDomainOrganizations["createSsoDomainMembership"]>(),
  };
  return {
    double: hooksRepo({}),
    mocks,
    organizations: createApiFixture<SsoDomainOrganizations>(mocks),
  };
}

describe("the ssoDomain auto-join on an unlicensed deployment", () => {
  /** @scenario "Unlicensed-mode signup does not auto-join a domain-matched organization" */
  it("creates the account and skips the domain-matched organization entirely", async () => {
    const federation = new StubFederation(false);
    const { mocks, organizations } = organizationRepo({
      id: "org_1",
      name: "Acme",
      ssoProvider: null,
    });

    await afterUserCreate({
      user: {
        id: "user_1",
        email: "new@acme.com",
        name: "New User",
        emailVerified: true,
      },
      collaborators: {
        linkProposals: createApiFixture<LinkProposals>(),
        organizations,
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

    expect(mocks.findBySsoDomain).not.toHaveBeenCalled();
    expect(mocks.createSsoDomainMembership).not.toHaveBeenCalled();
  });
});
