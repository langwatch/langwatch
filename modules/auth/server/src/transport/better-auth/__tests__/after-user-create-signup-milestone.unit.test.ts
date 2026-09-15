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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterUserCreate } from "../better-auth-hooks.api.ts";
import type { BetterAuthHooksRepository } from "../../../repositories/better-auth-hooks.repository.ts";
import type {
  BetterAuthAnnouncements,
  BetterAuthFederation,
  BetterAuthPendingInvite,
} from "../better-auth.collaborators.ts";

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

function organizationRepo(
  organization: { id: string; ssoDomain: string } | null,
): BetterAuthHooksRepository {
  return {
    tryFindOrganizationBySsoDomain: vi.fn().mockResolvedValue(organization),
    createOrganizationMembership: vi.fn().mockResolvedValue("created"),
  } as unknown as BetterAuthHooksRepository;
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
    };
  }

  describe("for every new user", () => {
    /** @scenario BetterAuth signup tracks the PostHog signed_up milestone */
    it("tracks the signed_up analytics event with the user id", async () => {
      await afterUserCreate({
        repo: organizationRepo(null),
        user: { id: "user_1", email: "u@other.com", name: "User" },
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
        repo: organizationRepo({ id: "org_1", ssoDomain: "acme.com" }),
        user: { id: "user_2", email: "new@acme.com", name: "New User" },
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
        user: { id: "user_3", email: "", name: "User" },
        collaborators: collaborators(),
      });

      expect(announcements.trackServerEvent).toHaveBeenCalledWith({
        userId: "user_3",
        event: "signed_up",
      });
    });
  });
});
