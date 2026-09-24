import { createApiFixture } from "@langwatch/api-fixture";
/**
 * The `signed_up` PostHog milestone fires for every new user, unconditionally, before the
 * SSO domain auto-join even looks at the email — the two user-creation choke points
 * (BetterAuth's adapter hook and the email register route) each own the event for the
 */
import {
  type AuthzAttachBindingsInput,
  type AuthzAttachBindingsOutput,
  AuthzGrantsService,
  type AuthzAttachResourceGrantInput,
  type AuthzApplyMemberBindingsInput,
  type AuthzChangeBindingRoleInput,
  type AuthzCreateBindingInput,
  type AuthzDefineRoleInput,
  type AuthzDeleteBindingInput,
  type AuthzDeleteRoleInput,
  type AuthzOffboardInput,
  type AuthzOffboardMemberInput,
  type AuthzOffboardOutput,
  type AuthzReplaceGrantInput,
  type AuthzRevokeBindingsInput,
  type AuthzRevokeBindingsWhereInput,
  type AuthzRevokeGrantInput,
  type AuthzRevokeResourceGrantsInput,
  type AuthzUpdateBindingInput,
  type AuthzUpdateGrantInput,
} from "@langwatch/authz-contract";
import type {
  SsoArrivalApi,
  SsoAuthenticationActivityApi,
  SsoMigrationCallbackApi,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

/** Minimal grants ledger double: nothing in these scenarios reads its output. */
class StubAuthzGrantsService extends AuthzGrantsService {
  attach = vi.fn();
  update = vi.fn((_args: AuthzUpdateGrantInput) => Promise.resolve());
  revoke = vi.fn((_args: AuthzRevokeGrantInput) => Promise.resolve());
  replace = vi.fn((_args: AuthzReplaceGrantInput) => Promise.reject(new Error("unused")));
  offboard = vi.fn((_args: AuthzOffboardInput): Promise<AuthzOffboardOutput> =>
    Promise.reject(new Error("unused")),
  );
  invalidateOrganization = vi.fn(() => Promise.resolve());
  attachBindings = vi.fn((_args: AuthzAttachBindingsInput): Promise<AuthzAttachBindingsOutput> =>
    Promise.resolve({ attached: [], duplicates: [] }),
  );
  attachResourceGrant = vi.fn((_args: AuthzAttachResourceGrantInput) =>
    Promise.reject(new Error("unused")),
  );
  revokeResourceGrants = vi.fn((_args: AuthzRevokeResourceGrantsInput) =>
    Promise.reject(new Error("unused")),
  );
  changeBindingRole = vi.fn((_args: AuthzChangeBindingRoleInput) =>
    Promise.reject(new Error("unused")),
  );
  revokeBindings = vi.fn((_args: AuthzRevokeBindingsInput) => Promise.resolve());
  retireDirectoryGrants = vi.fn(() => Promise.resolve(0));
  findDirectoryCausedChanges = vi.fn(() => Promise.resolve([]));
  revokeBindingsWhere = vi.fn((_args: AuthzRevokeBindingsWhereInput) =>
    Promise.reject(new Error("unused")),
  );
  offboardMember = vi.fn((_args: AuthzOffboardMemberInput) => Promise.reject(new Error("unused")));
  defineRole = vi.fn((_args: AuthzDefineRoleInput) => Promise.reject(new Error("unused")));
  deleteRole = vi.fn((_args: AuthzDeleteRoleInput) => Promise.reject(new Error("unused")));
  createBinding = vi.fn((_args: AuthzCreateBindingInput) => Promise.reject(new Error("unused")));
  updateBinding = vi.fn((_args: AuthzUpdateBindingInput) => Promise.reject(new Error("unused")));
  deleteBinding = vi.fn((_args: AuthzDeleteBindingInput) => Promise.reject(new Error("unused")));
  applyMemberBindings = vi.fn((_args: AuthzApplyMemberBindingsInput) =>
    Promise.reject(new Error("unused")),
  );
}

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
    throw new Error("StubAnnouncements.announceSignup is not used by this test");
  }
  ssoAutoAddNurturing(): never {
    throw new Error("StubAnnouncements.ssoAutoAddNurturing is not used by this test");
  }
  sessionNurturing(): never {
    throw new Error("StubAnnouncements.sessionNurturing is not used by this test");
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

function organizationRepo(
  organization: BetterAuthHookOrganization | null,
): BetterAuthHooksRepository {
  return hooksRepo({
    tryFindOrganizationBySsoDomain: vi
      .fn<BetterAuthHooksRepository["tryFindOrganizationBySsoDomain"]>()
      .mockResolvedValue(organization),
    createOrganizationMembership: vi
      .fn<BetterAuthHooksRepository["createOrganizationMembership"]>()
      .mockResolvedValue("created"),
  });
}

describe("afterUserCreate", () => {
  let announcements: StubAnnouncements;

  beforeEach(() => {
    announcements = new StubAnnouncements();
  });

  function collaborators(options: { ssoAllowed?: boolean } = {}) {
    return {
      federation: new StubFederation(options.ssoAllowed ?? true),
      invites: new StubInvites(),
      announcements,
      authzGrants: new StubAuthzGrantsService(),
      arrivals: createApiFixture<SsoArrivalApi>({ admit: async () => undefined }),
      ssoActivity: createApiFixture<SsoAuthenticationActivityApi>({
        record: async () => undefined,
      }),
      ssoMigration: createApiFixture<SsoMigrationCallbackApi>({
        decideAccountLink: async () => ({ kind: "not_migrating" }),
      }),
    };
  }

  describe("given any new user", () => {
    /** @scenario BetterAuth signup tracks the PostHog signed_up milestone */
    it("tracks the signed_up analytics event with the user id", async () => {
      await afterUserCreate({
        repo: organizationRepo(null),
        user: { id: "user_1", email: "u@other.com", name: "User", emailVerified: true },
        collaborators: collaborators(),
      });

      expect(announcements.trackServerEvent).toHaveBeenCalledTimes(1);
      expect(announcements.trackServerEvent).toHaveBeenCalledWith({
        userId: "user_1",
        event: "signed_up",
      });
    });

    /** @scenario PostHog signed_up still fires when the SSO auto-add path runs */
    it("tracks signed_up even when the SSO auto-add path runs", async () => {
      await afterUserCreate({
        repo: organizationRepo({ id: "org_1", name: "Acme", ssoProvider: null }),
        user: { id: "user_2", email: "new@acme.com", name: "New User", emailVerified: true },
        collaborators: collaborators(),
      });

      expect(announcements.trackServerEvent).toHaveBeenCalledTimes(1);
      expect(announcements.trackServerEvent).toHaveBeenCalledWith({
        userId: "user_2",
        event: "signed_up",
      });
    });

    /** @scenario PostHog signed_up still fires when the email has no parsable domain */
    it("tracks signed_up even when the user has no parsable email domain", async () => {
      await afterUserCreate({
        repo: organizationRepo(null),
        user: { id: "user_3", email: "", name: "User", emailVerified: true },
        collaborators: collaborators(),
      });

      expect(announcements.trackServerEvent).toHaveBeenCalledWith({
        userId: "user_3",
        event: "signed_up",
      });
    });

    /** @scenario PostHog signed_up still fires when the signup is unverified */
    it("tracks signed_up even when the verified-email gate skips org admission", async () => {
      await afterUserCreate({
        repo: organizationRepo({ id: "org_1", name: "Acme", ssoProvider: null }),
        user: { id: "user_4", email: "new@acme.com", name: "New User", emailVerified: false },
        collaborators: collaborators(),
      });

      expect(announcements.trackServerEvent).toHaveBeenCalledTimes(1);
      expect(announcements.trackServerEvent).toHaveBeenCalledWith({
        userId: "user_4",
        event: "signed_up",
      });
    });
  });
});
