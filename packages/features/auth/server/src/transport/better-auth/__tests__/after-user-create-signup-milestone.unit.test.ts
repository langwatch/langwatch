/**
 * The `signed_up` PostHog milestone fires for every new user, unconditionally,
 * before the SSO domain auto-join even looks at the email — the two
 * user-creation choke points (BetterAuth's adapter hook and the email
 * register route) each own the event for the users they create, and neither
 * a domain match, a missing domain, nor a downstream join failure may
 * suppress it.
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
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterUserCreate } from "../better-auth-hooks";
import type {
  BetterAuthAnnouncementsPort,
  BetterAuthFederationPort,
  BetterAuthPendingInvitePort,
} from "../../../ports/better-auth.port";

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

class StubFederationPort implements BetterAuthFederationPort {
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

class StubInvitesPort implements BetterAuthPendingInvitePort {
  findPendingByOrganizationAndEmail(): Promise<null> {
    return Promise.resolve(null);
  }
  applyInvite(): Promise<void> {
    return Promise.reject(new Error("unused"));
  }
}

class StubAnnouncementsPort implements BetterAuthAnnouncementsPort {
  readonly trackServerEvent = vi.fn();
  readonly reportError = vi.fn();
}

function organizationPrisma(organization: { id: string; ssoDomain: string } | null): PrismaClient {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue(organization) },
    organizationUser: { create: vi.fn().mockResolvedValue(undefined) },
  } as unknown as PrismaClient;
}

describe("afterUserCreate", () => {
  let announcements: StubAnnouncementsPort;

  beforeEach(() => {
    announcements = new StubAnnouncementsPort();
  });

  function collaborators(options: { ssoAllowed?: boolean } = {}) {
    return {
      federation: new StubFederationPort(options.ssoAllowed ?? true),
      invites: new StubInvitesPort(),
      announcements,
      authzGrants: new StubAuthzGrantsService(),
    };
  }

  describe("for every new user", () => {
    /** @scenario BetterAuth signup tracks the PostHog signed_up milestone */
    it("tracks the signed_up analytics event with the user id", async () => {
      await afterUserCreate({
        prisma: organizationPrisma(null),
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
        prisma: organizationPrisma({ id: "org_1", ssoDomain: "acme.com" }),
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
        prisma: organizationPrisma(null),
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
