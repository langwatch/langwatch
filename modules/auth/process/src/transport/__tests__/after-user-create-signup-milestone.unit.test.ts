import { SIGNED_UP_EVENT_TYPE } from "@langwatch/auth-contract";
/**
 * Every new person is recorded once as auth's lw.auth.signed_up fact, before the SSO domain
 * auto-join looks at the email; nurturing derives PostHog signed_up from it (its pipeline test).
 * The account Better Auth wrote also has user's created fact asked for, verified or not.
 * @see specs/analytics/posthog-product-milestones.feature
 * @see modules/auth/specs/sign-up.feature
 */
import { createTenantId } from "@langwatch/eventing";
import type {
  SsoArrivalApi,
  SsoAuthenticationActivityApi,
  SsoMigrationCallbackApi,
} from "@langwatch/identity-contract";
import type * as observabilityModule from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createTestLogger, type TestLogLines } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

const hooksLog = vi.hoisted((): { lines?: TestLogLines } => ({}));

// Only the hooks' own logger is replaced, so a failure it logs can be read; the name is spelled
// inline because a `vi.mock` factory is hoisted above any const it might reference.
vi.mock("@langwatch/observability", async () => {
  const actual = await vi.importActual<typeof observabilityModule>("@langwatch/observability");
  const { createTestLogger: createHooksLogger } = await import("@langwatch/test-harness");
  const { logger: hooksLogger, lines } = createHooksLogger();
  hooksLog.lines = lines;
  return {
    ...actual,
    createLogger: (name: string) =>
      name === "langwatch:better-auth:hooks" ? hooksLogger : actual.createLogger(name),
  };
});

import { LoggedBetterAuthAnnouncements } from "../../app/auth.app.ts";
import type { BetterAuthFederation } from "../../channels/better-auth.channel.ts";
import {
  afterAccountCreate,
  afterUserCreate,
  type LinkProposals,
  type SsoDomainOrganizations,
} from "../../channels/http/http.better-auth-hooks.channel.ts";
import { MemorySignupAnnouncementChannel } from "../../channels/memory/memory.auth.channels.ts";
import { RecordSignedUpCommand } from "../../eventing/auth-lifecycle.commands.ts";
import type { SignedUpEvent } from "../../eventing/auth-lifecycle.events.ts";
import type { BetterAuthHooksRepository } from "../../repositories/better-auth-hooks.repository.ts";
import { AuthLifecycleNoticeService } from "../../services/auth-lifecycle-notice.service.ts";
import { SignupAnnouncementService } from "../../services/signup-announcement.service.ts";
import { recordingUsers } from "./better-auth-transport.test-helpers.ts";

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
    recordAppPageOpened: { send: async () => undefined },
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
    countAccountsForUser: unused,
    countPasskeysForUser: unused,
    findFederatedAccountsForUser: unused,
    findFederatedAccountsForUsers: unused,
    deleteAccounts: unused,
    flagPendingSsoSetup: unused,
    reconcileSsoAccounts: unused,
    recordLastLogin: unused,
    clearPasswordResetRequirement: unused,
    ...members,
  };
}

type SsoDomainOrganization = { id: string; name: string; ssoProvider: string | null };

function organizationsOver(mocks: Partial<SsoDomainOrganizations>): SsoDomainOrganizations {
  return createApiFixture<SsoDomainOrganizations>(mocks);
}

function domainOrganizations(organization: SsoDomainOrganization | null): SsoDomainOrganizations {
  return organizationsOver({
    findBySsoDomain: vi
      .fn<SsoDomainOrganizations["findBySsoDomain"]>()
      .mockResolvedValue(organization),
    createMembership: vi
      .fn<SsoDomainOrganizations["createMembership"]>()
      .mockResolvedValue({ outcome: "created", seat: "MEMBER", pending: false }),
  });
}

describe("afterUserCreate", () => {
  function collaborators({
    announcements,
    admit = async () => undefined,
    organizations = domainOrganizations(null),
    users = recordingUsers().users,
  }: {
    announcements: LoggedBetterAuthAnnouncements;
    admit?: SsoArrivalApi["admit"];
    organizations?: SsoDomainOrganizations;
    users?: Pick<UserApi, "recordCreated">;
  }) {
    return {
      users,
      organizations,
      federation: new StubFederation(true),
      invites: new StubInvites(),
      announcements,
      arrivals: createApiFixture<SsoArrivalApi>({ admit }),
      ssoActivity: createApiFixture<SsoAuthenticationActivityApi>({
        record: async () => undefined,
      }),
      linkProposals: createApiFixture<LinkProposals>(),
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
        getUserForHooks: async () => ({
          ...user,
          deactivatedAt: null,
          pendingSsoSetup: false,
          signupConfirmationPending: false,
          passwordResetRequiredAt: null,
          lastLoginAt: null,
          emailVerified: true,
        }),
        findFederatedAccountsForUser: async () => [],
      });

      await afterUserCreate({
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
        user: { id: "user_3", email: "", name: "User", emailVerified: true },
        collaborators: collaborators({ announcements }),
      });

      expectSignUpOf(await onlySignUpFact(facts), "user_3");
    });

    /** @scenario PostHog signed_up still fires when the signup is unverified */
    it("records the sign-up fact even when the verified-email gate skips org admission", async () => {
      const { announcements, facts } = composedAnnouncements();
      const createMembership = vi
        .fn<SsoDomainOrganizations["createMembership"]>()
        .mockResolvedValue({ outcome: "created", seat: "MEMBER", pending: false });
      const organizations = organizationsOver({
        findBySsoDomain: async () => ({ id: "org_1", name: "Acme", ssoProvider: null }),
        createMembership,
      });

      await afterUserCreate({
        user: { id: "user_4", email: "new@acme.com", name: "New User", emailVerified: false },
        collaborators: collaborators({ announcements, organizations }),
      });

      expectSignUpOf(await onlySignUpFact(facts), "user_4");
      expect(createMembership).not.toHaveBeenCalled();
    });
  });

  describe("given the account was created by a social sign-in", () => {
    /** @scenario "A social sign-up records the new account's created fact" */
    it("asks user to record the account's created fact once, under its id", async () => {
      const { announcements } = composedAnnouncements();
      const { users, recorded } = recordingUsers();

      await afterUserCreate({
        user: { id: "user_google", email: "u@gmail.com", name: "User", emailVerified: true },
        collaborators: collaborators({ announcements, users }),
      });

      expect(recorded).toEqual(["user_google"]);
    });

    /** @scenario "An unverified social sign-up still records the new account's created fact" */
    it("records it even when the address is not yet verified", async () => {
      const { announcements } = composedAnnouncements();
      const { users, recorded } = recordingUsers();

      await afterUserCreate({
        user: { id: "user_github", email: "u@users.dev", name: "User", emailVerified: false },
        collaborators: collaborators({ announcements, users }),
      });

      expect(recorded).toEqual(["user_github"]);
    });
  });

  describe("given recording the created fact fails", () => {
    /** @scenario "A failure to record the new account does not block sign-in" */
    it("lets the sign-in through and logs an error naming the account id", async () => {
      const { announcements, facts } = composedAnnouncements();
      const failing = createApiFixture<Pick<UserApi, "recordCreated">>({
        recordCreated: async () => {
          throw new Error("outbox unavailable");
        },
      });
      hooksLog.lines?.splice(0);

      await expect(
        afterUserCreate({
          user: { id: "user_5", email: "u@gmail.com", name: "User", emailVerified: true },
          collaborators: collaborators({ announcements, users: failing }),
        }),
      ).resolves.toBeUndefined();

      expect(hooksLog.lines?.findLine("error", "created fact")).toMatchObject({ userId: "user_5" });
      expectSignUpOf(await onlySignUpFact(facts), "user_5");
    });
  });
});
