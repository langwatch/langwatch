import { createApiFixture } from "@langwatch/api-fixture";
import type { SsoArrivalApi, SsoAuthenticationActivityApi } from "@langwatch/identity-contract";
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

function organizationRepo(
  organization: { id: string; ssoDomain: string } | null,
): BetterAuthHooksRepository {
  return {
    tryFindOrganizationBySsoDomain: vi.fn().mockResolvedValue(organization),
    createOrganizationMembership: vi.fn(),
  } as unknown as BetterAuthHooksRepository;
}

describe("the ssoDomain auto-join on an unlicensed deployment", () => {
  /** @scenario "Unlicensed-mode signup does not auto-join a domain-matched organization" */
  it("creates the account and skips the domain-matched organization entirely", async () => {
    const federation = new StubFederation(false);
    const repo = organizationRepo({ id: "org_1", ssoDomain: "acme.com" });

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
      },
    });

    expect(repo.tryFindOrganizationBySsoDomain).not.toHaveBeenCalled();
    expect(repo.createOrganizationMembership).not.toHaveBeenCalled();
  });
});
