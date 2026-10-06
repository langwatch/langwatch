import { SIGNED_UP_EVENT_TYPE } from "@langwatch/auth-contract";
/**
 * Every new person is recorded once as auth's lw.auth.signed_up fact, before the SSO domain
 * auto-join looks at the email; nurturing derives PostHog signed_up from it (its pipeline test).
 * @see specs/analytics/posthog-product-milestones.feature
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
import { createTenantId } from "@langwatch/eventing";
import type {
  SsoArrivalApi,
  SsoAuthenticationActivityApi,
  SsoMigrationCallbackApi,
} from "@langwatch/identity-contract";
import { OrganizationNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { LoggedBetterAuthAnnouncements } from "../../app/auth-composition.build.ts";
import type { BetterAuthFederation } from "../../channels/better-auth.channel.ts";
import {
  afterAccountCreate,
  afterUserCreate,
} from "../../channels/http/http.better-auth-hooks.channel.ts";
import { MemorySignupAnnouncementChannel } from "../../channels/memory/memory.signup-announcement.channel.ts";
import { RecordSignedUpCommand } from "../../eventing/auth-lifecycle.commands.ts";
import type { SignedUpEvent } from "../../eventing/auth-lifecycle.events.ts";
import type {
  BetterAuthHookOrganization,
  BetterAuthHooksRepository,
} from "../../repositories/better-auth-hooks.repository.ts";
import { AuthLifecycleNoticeService } from "../../services/auth-lifecycle-notice.service.ts";
import { SignupAnnouncementService } from "../../services/signup-announcement.service.ts";

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
  listGrants = vi.fn(() => Promise.reject(new Error("unused")));
  getGrant = vi.fn(() => Promise.reject(new Error("unused")));
  createGrant = vi.fn(() => Promise.reject(new Error("unused")));
  changeGrantRole = vi.fn(() => Promise.reject(new Error("unused")));
  revokeGrant = vi.fn(() => Promise.reject(new Error("unused")));
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

class StubInvites implements Pick<OrganizationApi, "applyPendingInvite"> {
  applyPendingInvite(): Promise<{ applied: false }> {
    return Promise.resolve({ applied: false });
  }
}

/**
 * The announcements as auth composes them, over the real notice service: its sign-up sender runs
 * auth's own record command, so `facts` holds the events the auth_lifecycle pipeline would store.
 */
function composedAnnouncements() {
  const facts: SignedUpEvent[] = [];
  const reportError = vi.fn();
  const lifecycle = AuthLifecycleNoticeService.create({ reportError });
  lifecycle.connect({
    recordSignedUp: {
      send: async (data) => {
        const command = { tenantId: createTenantId(data.tenantId), aggregateId: data.userId };
        facts.push(...new RecordSignedUpCommand().handle({ ...command, type: "record", data }));
      },
    },
    recordSessionStarted: { send: async () => undefined },
    recordSsoAutoAdded: { send: async () => undefined },
  });
  const { logger } = createTestLogger();
  const signups = SignupAnnouncementService.create({
    channel: MemorySignupAnnouncementChannel.create(),
    publicBaseUrl: "https://app.langwatch.ai",
    logger,
  });
  const announcements = LoggedBetterAuthAnnouncements.create({ logger, signups, lifecycle });
  return { announcements, facts, reportError };
}

/** The one sign-up fact auth recorded, once the fire-and-forget send settled. */
async function onlySignUpFact(facts: SignedUpEvent[]): Promise<SignedUpEvent> {
  await vi.waitFor(() => expect(facts).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const [fact, ...more] = facts;
  if (!fact || more.length > 0) throw new Error(`expected one sign-up fact, got ${facts.length}`);
  return fact;
}

/** Ids only: the person as tenant and subject, keyed once per person. */
function expectSignUpOf(fact: SignedUpEvent, userId: string): void {
  expect(fact.type).toBe(SIGNED_UP_EVENT_TYPE);
  expect(fact.aggregateId).toBe(userId);
  expect(fact.idempotencyKey).toBe(`${userId}:signed_up`);
  expect(fact.data).toEqual({ tenantId: userId, userId, occurredAt: expect.any(Number) });
}

function hooksRepo(members: Partial<BetterAuthHooksRepository>): BetterAuthHooksRepository {
  const unused = (): never => {
    throw new Error("this repository member is not used by this test");
  };
  return {
    getUserForHooks: unused,
    getOrganizationBySsoDomain: unused,
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
    getOrganizationBySsoDomain: vi
      .fn<BetterAuthHooksRepository["getOrganizationBySsoDomain"]>()
      .mockImplementation(async () => {
        if (organization === null) throw new OrganizationNotFoundError();
        return organization;
      }),
    createOrganizationMembership: vi
      .fn<BetterAuthHooksRepository["createOrganizationMembership"]>()
      .mockResolvedValue("created"),
  });
}

describe("afterUserCreate", () => {
  function collaborators({
    announcements,
    admit = async () => undefined,
  }: {
    announcements: LoggedBetterAuthAnnouncements;
    admit?: SsoArrivalApi["admit"];
  }) {
    return {
      federation: new StubFederation(true),
      invites: new StubInvites(),
      announcements,
      authzGrants: new StubAuthzGrantsService(),
      arrivals: createApiFixture<SsoArrivalApi>({ admit }),
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
    it("records exactly one sign-up fact for the user id, ids only", async () => {
      const { announcements, facts, reportError } = composedAnnouncements();

      await afterUserCreate({
        repo: organizationRepo(null),
        user: { id: "user_1", email: "u@other.com", name: "User", emailVerified: true },
        collaborators: collaborators({ announcements }),
      });

      expectSignUpOf(await onlySignUpFact(facts), "user_1");
      expect(reportError).not.toHaveBeenCalled();
    });

    /** @scenario PostHog signed_up still fires when the SSO auto-add path runs */
    it("records one sign-up fact when the SSO callback admits the person to its connection", async () => {
      const { announcements, facts } = composedAnnouncements();
      const admit = vi.fn<SsoArrivalApi["admit"]>().mockResolvedValue(undefined);
      const user = { id: "user_2", email: "new@acme.com", name: "New User" };
      const repo = hooksRepo({
        getOrganizationBySsoDomain: async () => {
          throw new OrganizationNotFoundError();
        },
        getUserForHooks: async () => ({
          ...user,
          deactivatedAt: null,
          pendingSsoSetup: false,
          signupConfirmationPending: false,
        }),
        findFederatedAccountsForUser: async () => [],
      });

      await afterUserCreate({
        repo,
        user: { ...user, emailVerified: true },
        collaborators: collaborators({ announcements, admit }),
      });
      await afterAccountCreate({
        repo,
        account: { userId: "user_2", providerId: "conn_okta", accountId: "okta|new" },
        collaborators: collaborators({ announcements, admit }),
      });

      expectSignUpOf(await onlySignUpFact(facts), "user_2");
      expect(admit).toHaveBeenCalledWith({ user, connectionId: "conn_okta", domain: "acme.com" });
    });

    /** @scenario PostHog signed_up still fires when the email has no parsable domain */
    it("records the sign-up fact even when the user has no parsable email domain", async () => {
      const { announcements, facts } = composedAnnouncements();

      await afterUserCreate({
        repo: organizationRepo(null),
        user: { id: "user_3", email: "", name: "User", emailVerified: true },
        collaborators: collaborators({ announcements }),
      });

      expectSignUpOf(await onlySignUpFact(facts), "user_3");
    });

    /** @scenario PostHog signed_up still fires when the signup is unverified */
    it("records the sign-up fact even when the verified-email gate skips org admission", async () => {
      const { announcements, facts } = composedAnnouncements();
      const createOrganizationMembership = vi
        .fn<BetterAuthHooksRepository["createOrganizationMembership"]>()
        .mockResolvedValue("created");
      const repo = hooksRepo({
        getOrganizationBySsoDomain: async () => ({ id: "org_1", name: "Acme", ssoProvider: null }),
        createOrganizationMembership,
      });

      await afterUserCreate({
        repo,
        user: { id: "user_4", email: "new@acme.com", name: "New User", emailVerified: false },
        collaborators: collaborators({ announcements }),
      });

      expectSignUpOf(await onlySignUpFact(facts), "user_4");
      expect(createOrganizationMembership).not.toHaveBeenCalled();
    });
  });
});
