/**
 * The invitation ceremony as `OrganizationModule.create` composes it over the memory registry.
 * @see specs/organizations/organization-members-rest-api.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationCaller } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { RecordSeatLimitReachedCommandData } from "../../eventing/seat-limit.events.ts";
import { MemoryOrganizationRepositories } from "../../repositories/memory/memory.organization.repositories.ts";
import { InviteSendThrottleService } from "../../services/invite-send-throttle.service.ts";
import type { InviteService } from "../../services/invite.service.ts";
import { OrganizationInvitationsService } from "../../services/organization-invitations.service.ts";
import type { SeatLimitNoticeService } from "../../services/seat-limit-notice.service.ts";
import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup } from "./support/organization-module-setup.ts";

const ORGANIZATION_ID = "org-1";
const TEAM_ID = "team-1";
const BASE_HOST = "https://app.langwatch.test";
const CALLER: OrganizationCaller = { id: "user-1", email: "sam@acme.test" };

const roomyPlan: Plan = {
  planSource: "free",
  type: "free",
  name: "Free",
  free: true,
  maxMembers: 1_000_000,
  maxMembersLite: 1_000_000,
  maxMessagesPerMonth: 1_000_000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
};

/**
 * The application over memory repositories holding one organization, its one team and its
 * administrator, on `plan`. Seat-limit events land in `recorded`.
 */
async function application(options: { plan?: Partial<Plan> } = {}) {
  const plan: Plan = { ...roomyPlan, ...options.plan };
  const setup = organizationModuleSetup({
    permissions: createApiFixture<AuthzApi>(
      { findPermissionsBeyondCaller: async () => [] },
      "AuthzApi",
    ),
    entitlement: createApiFixture<EntitlementApi>(
      { getActivePlan: async () => plan, requestBound: async () => 1_000 },
      "EntitlementApi",
    ),
    identity: createApiFixture<IdentityApi>(
      { verifiedEmailsOf: async () => ({ kind: "keep_legacy" }) },
      "IdentityApi",
    ),
    notifications: createApiFixture<NotificationService>({}, "NotificationService"),
  });
  await setup.repositories.membership(setup.dependencies.permissions).createAndAssign({
    userId: CALLER.id,
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: TEAM_ID,
    teamSlug: "engineering",
    pricingModel: "SEAT_EVENT",
  });
  const app = await OrganizationModule.create(setup);
  const recorded: RecordSeatLimitReachedCommandData[] = [];
  app.connectSeatLimit({
    recordSeatLimitReached: {
      send: async (data: RecordSeatLimitReachedCommandData) => {
        recorded.push(data);
      },
    } as never,
  });
  return { app, recorded };
}

describe("given the invitation member the process composes", () => {
  describe("when a batch of one invite is created", () => {
    /** @scenario "Listing invites includes the invite link" */
    it("answers the created invite and lists it back with its email, role, code and link", async () => {
      const { app } = await application();

      const created = await app.createInvitations(
        {
          organizationId: ORGANIZATION_ID,
          validation: "lenient",
          invites: [{ email: "new@acme.test", role: "MEMBER", teamIds: TEAM_ID }],
        },
        CALLER,
      );

      expect(created).toHaveLength(1);
      expect(created[0]!.emailNotSent).toBe(true);

      const listed = await app.listPendingInvitations({ organizationId: ORGANIZATION_ID });

      expect(listed).toHaveLength(1);
      expect(listed[0]!.email).toBe("new@acme.test");
      expect(listed[0]!.role).toBe("MEMBER");
      expect(listed[0]!.inviteCode).toEqual(created[0]!.invite.inviteCode);
      expect(listed[0]!.displayStatus).toBe("PENDING");
      expect(listed[0]!.inviteUrl).toBe(
        `${BASE_HOST}/invite/accept?inviteCode=${listed[0]!.inviteCode}`,
      );
    });
  });

  describe("when a created invite is revoked", () => {
    /** @scenario "Revoking a pending invite marks it REVOKED" */
    it("still appears in the invite list with status REVOKED, and revoking it again is refused", async () => {
      const { app } = await application();
      const created = await app.createInvitations(
        {
          organizationId: ORGANIZATION_ID,
          validation: "lenient",
          invites: [{ email: "revoke-me@acme.test", role: "MEMBER", teamIds: TEAM_ID }],
        },
        CALLER,
      );
      const inviteId = created[0]!.invite.id;

      await app.revokeInvitation({ organizationId: ORGANIZATION_ID, inviteId });
      const listed = await app.listPendingInvitations({ organizationId: ORGANIZATION_ID });

      expect(listed[0]!.displayStatus).toBe("REVOKED");
      await expect(
        app.revokeInvitation({ organizationId: ORGANIZATION_ID, inviteId }),
      ).rejects.toMatchObject({ code: "invite_not_found" });
    });
  });

  describe("when a pending invite is extended", () => {
    it("keeps its code, moves its expiry later, and refuses once it is revoked", async () => {
      const { app } = await application();
      const created = await app.createInvitations(
        {
          organizationId: ORGANIZATION_ID,
          validation: "lenient",
          invites: [{ email: "extend-me@acme.test", role: "MEMBER", teamIds: TEAM_ID }],
        },
        CALLER,
      );
      const original = created[0]!.invite;

      const { invite } = await app.extendInvitation({
        organizationId: ORGANIZATION_ID,
        inviteId: original.id,
      });

      expect(invite.inviteCode).toBe(original.inviteCode);
      expect(invite.expiration!.getTime()).toBeGreaterThanOrEqual(original.expiration!.getTime());
      await app.revokeInvitation({ organizationId: ORGANIZATION_ID, inviteId: original.id });
      await expect(
        app.extendInvitation({ organizationId: ORGANIZATION_ID, inviteId: original.id }),
      ).rejects.toMatchObject({ code: "invite_not_found" });
    });
  });

  describe("when a Developer seat is invited", () => {
    it("creates the invitation even though no full or lite seat is left", async () => {
      const { app } = await application({ plan: { maxMembers: 1, maxMembersLite: 0 } });

      const created = await app.createInvitations(
        {
          organizationId: ORGANIZATION_ID,
          validation: "lenient",
          invites: [{ email: "dev@acme.test", role: "DEVELOPER" }],
        },
        CALLER,
      );

      expect(created.map((record) => record.invite.role)).toEqual(["DEVELOPER"]);
    });
  });
});

describe("given an invite code that names no invitation", () => {
  /**
   * The port the door reads, over the memory invite registry: only the acceptance ceremony
   * looks a code up, and it turns the absent answer into its own refusal.
   * @scenario "Looking up an unknown invite code answers absent, not a crash"
   */
  it("answers null rather than throwing", async () => {
    const repositories = MemoryOrganizationRepositories.create();
    const invitations = OrganizationInvitationsService.create({
      invites: createApiFixture<InviteService>({}, "InviteService"),
      repository: repositories.invite,
      throttle: InviteSendThrottleService.create(repositories.inviteRateLimit),
      baseHost: BASE_HOST,
      identity: createApiFixture<IdentityApi>({}, "IdentityApi"),
      userDirectory: repositories.userDirectory,
      notices: createApiFixture<SeatLimitNoticeService>({}, "SeatLimitNoticeService"),
    });

    await expect(invitations.findByCode({ inviteCode: "does-not-exist" })).resolves.toBeNull();
  });
});

describe("given a batch naming a team that is not in the organization", () => {
  describe("when the asking transport chose strict validation", () => {
    /**
     * Whole batch or nothing: the team check runs before the transaction opens,
     * so the good invitation beside the bad one is not written either.
     * @scenario "Creating invites naming a team outside the organization is refused"
     */
    it("refuses by name and writes none of the batch", async () => {
      const { app } = await application();

      await expect(
        app.createInvitations(
          {
            organizationId: ORGANIZATION_ID,
            validation: "strict",
            invites: [
              { email: "good@acme.test", role: "MEMBER", teamIds: TEAM_ID },
              { email: "elsewhere@acme.test", role: "MEMBER", teamIds: "team-elsewhere" },
            ],
          },
          CALLER,
        ),
      ).rejects.toMatchObject({ code: "team_not_in_organization" });

      await expect(
        app.listPendingInvitations({ organizationId: ORGANIZATION_ID }),
      ).resolves.toHaveLength(0);
    });
  });

  describe("when the asking transport chose lenient validation", () => {
    /**
     * The mode still works: the form drops what it cannot grant rather than
     * losing a batch an admin typed by hand.
     * @scenario "The invite form drops a team assignment it cannot grant"
     */
    it("drops that invitation and answers an empty batch", async () => {
      const { app } = await application();

      const created = await app.createInvitations(
        {
          organizationId: ORGANIZATION_ID,
          validation: "lenient",
          invites: [{ email: "elsewhere@acme.test", role: "MEMBER", teamIds: "team-elsewhere" }],
        },
        CALLER,
      );

      expect(created).toHaveLength(0);
      await expect(
        app.listPendingInvitations({ organizationId: ORGANIZATION_ID }),
      ).resolves.toHaveLength(0);
    });
  });
});

describe("given a batch naming only teams the organization has", () => {
  describe("when the asking transport chose strict validation", () => {
    it("creates the invitations", async () => {
      const { app } = await application();

      const created = await app.createInvitations(
        {
          organizationId: ORGANIZATION_ID,
          validation: "strict",
          invites: [{ email: "good@acme.test", role: "MEMBER", teamIds: TEAM_ID }],
        },
        CALLER,
      );

      expect(created).toHaveLength(1);
      expect(created[0]!.invite.email).toBe("good@acme.test");
    });
  });
});

describe("given an organization whose seats are all taken", () => {
  /** @scenario "Member invite triggers notification when limit reached" */
  it("refuses a full-member invite and records organization's seat-limit event", async () => {
    const { app, recorded } = await application({ plan: { maxMembers: 1 } });

    await expect(
      app.createInvitations(
        {
          organizationId: ORGANIZATION_ID,
          validation: "lenient",
          invites: [{ email: "one-more@acme.test", role: "MEMBER", teamIds: TEAM_ID }],
        },
        CALLER,
      ),
    ).rejects.toMatchObject({ code: "member_seat_limit_reached" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(recorded).toEqual([
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        limitType: "members",
        current: 1,
        max: 1,
      }),
    ]);
  });

  /** @scenario "Lite member invite triggers notification when limit reached" */
  it("refuses a lite-member invite and records organization's seat-limit event", async () => {
    const { app, recorded } = await application({ plan: { maxMembersLite: 1 } });
    await app.createInvitations(
      {
        organizationId: ORGANIZATION_ID,
        validation: "lenient",
        invites: [{ email: "first-lite@acme.test", role: "EXTERNAL", teamIds: TEAM_ID }],
      },
      CALLER,
    );

    await expect(
      app.createInvitations(
        {
          organizationId: ORGANIZATION_ID,
          validation: "lenient",
          invites: [{ email: "lite@acme.test", role: "EXTERNAL", teamIds: TEAM_ID }],
        },
        CALLER,
      ),
    ).rejects.toMatchObject({ code: "member_seat_limit_reached" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(recorded).toEqual([
      expect.objectContaining({ limitType: "membersLite", current: 1, max: 1 }),
    ]);
  });
});
