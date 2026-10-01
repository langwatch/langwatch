import { createApiFixture } from "@langwatch/api-fixture";
/**
 * `InviteServiceOrganizationInvitations` maps `InviteService`'s method names onto
 * the port the door reads; the app still refuses a role it composed none for.
 * @see specs/organizations/organization-members-rest-api.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { InviteNotFoundError, type OrganizationInvite } from "@langwatch/organization-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { RecordSeatLimitReachedCommandData } from "../../eventing/seat-limit.events.ts";
import type {
  OrganizationInviteRepository,
  WriteInviteInput,
} from "../../repositories/organization-invite.repository.ts";
import { PrismaOrganizationUserDirectoryRepository } from "../../repositories/prisma/prisma.organization-user-directory.repository.ts";
import {
  FakeInviteRateLimit,
  FakeSeatCensus,
  makeInviteDeps,
  makeOrganization,
  makePlanProvider,
} from "../../services/__tests__/support/invite-fakes.ts";
import type { InviteCreationThrottleService } from "../../services/invite-creation-throttle.service.ts";
import { InviteSendThrottleService } from "../../services/invite-send-throttle.service.ts";
import { InviteService } from "../../services/invite.service.ts";
import { OrganizationInvitationDoorService } from "../../services/organization-invitation-door.service.ts";
import type { OrganizationLifecycleNoticeService } from "../../services/organization-lifecycle-notice.service.ts";
import { SeatLimitNoticeService } from "../../services/seat-limit-notice.service.ts";
import { InviteServiceOrganizationInvitations } from "../organization-composition.build.ts";
import { type ServerOrganizationAppDependencies } from "../organization.app.ts";
import type { OrganizationPlanGate, OrganizationSignals } from "../organization.members.ts";
import { organizationAppForTesting } from "./support/organization-app-for-testing.ts";

const ORGANIZATION_ID = "org-1";
const BASE_HOST = "https://app.langwatch.test";

/**
 * The invitation rows and the one organization the fake repository answers
 * for. `teamsInOrganization`, left unset, resolves every team asked for.
 */
function fakeInviteRepository(options: { teamsInOrganization?: readonly string[] } = {}) {
  const invites = new Map<string, OrganizationInvite>();
  let nextId = 1;
  const teamsInOrganization = options.teamsInOrganization;

  const repository: OrganizationInviteRepository = createApiFixture<OrganizationInviteRepository>({
    getOrganizationWithMembers: async () => ({
      ...makeOrganization({ id: ORGANIZATION_ID }),
      members: [],
    }),
    findMemberEmails: async () => [],
    hasOpenInviteForEmail: async () => false,
    findCustomRolePermissions: async () => [],
    findPersonalTeamsInScopes: async () => [],
    findTeamIdsInOrganization: async ({
      teamIds,
    }: {
      teamIds: string[];
      organizationId: string;
    }) =>
      teamsInOrganization === undefined
        ? teamIds
        : teamIds.filter((teamId: string) => teamsInOrganization.includes(teamId)),
    createPendingInvite: async (input: WriteInviteInput) => {
      const invite: OrganizationInvite = {
        id: `invite-${nextId++}`,
        email: input.email,
        inviteCode: input.inviteCode,
        expiration: input.expiration,
        status: "PENDING",
        organizationId: input.organizationId,
        teamIds: input.teamIds,
        teamAssignments: (input.teamAssignments as OrganizationInvite["teamAssignments"]) ?? null,
        role: input.role,
        requestedBy: null,
        subscriptionId: null,
        acceptedByUserId: null,
        acceptedViaIdentifierId: null,
        createdAt: nowInstant(),
        updatedAt: nowInstant(),
      };
      invites.set(invite.id, invite);

      return invite;
    },
    findListableInvites: async ({ organizationId }: { organizationId: string }) =>
      Array.from(invites.values())
        .filter((invite) => invite.organizationId === organizationId)
        .map((invite) => ({ ...invite, requestedByUser: null })),
    revokeOpenInvite: async ({
      inviteId,
      organizationId,
    }: {
      inviteId: string;
      organizationId: string;
    }) => {
      const invite = invites.get(inviteId);
      if (!invite || invite.organizationId !== organizationId || invite.status !== "PENDING")
        return 0;
      invites.set(inviteId, { ...invite, status: "REVOKED" });

      return 1;
    },
    getInviteWithOrganization: async ({
      inviteId,
      organizationId,
    }: {
      inviteId: string;
      organizationId: string;
    }) => {
      const invite = invites.get(inviteId);
      if (!invite || invite.organizationId !== organizationId) {
        throw new InviteNotFoundError("Invitation not found");
      }

      return { ...invite, organization: makeOrganization({ id: organizationId }) };
    },
    extendInviteExpiration: async ({
      inviteId,
      expiration,
    }: {
      inviteId: string;
      organizationId: string;
      expiration: NonNullable<OrganizationInvite["expiration"]>;
    }) => {
      const invite = invites.get(inviteId);
      if (!invite || invite.status !== "PENDING") return 0;
      invites.set(inviteId, { ...invite, expiration });

      return 1;
    },
    getInviteByCodeWithOrganization: async ({ inviteCode }: { inviteCode: string }) => {
      const invite = Array.from(invites.values()).find(
        (candidate) => candidate.inviteCode === inviteCode,
      );
      if (!invite) throw new InviteNotFoundError("Invitation not found");

      return { ...invite, organization: makeOrganization({ id: invite.organizationId }) };
    },
    withTransaction: async <T>(write: (transaction: OrganizationInviteRepository) => Promise<T>) =>
      write(repository),
  });

  return repository;
}

/** The invitation door as the composed process would hand it to
 *  `OrganizationInvitationDoorService`. */
function invitations(
  options: {
    teamsInOrganization?: readonly string[];
    /** Seats already taken, full and lite, against a plan allowing exactly that many. */
    seatsFull?: Readonly<{ members: number; membersLite: number }>;
    notices?: Pick<SeatLimitNoticeService, "record">;
  } = {},
) {
  const repository = fakeInviteRepository(options);
  const throttle = InviteSendThrottleService.create(new FakeInviteRateLimit());
  const seatsFull = options.seatsFull;
  const service = InviteService.create(
    makeInviteDeps({
      invites: repository,
      throttle,
      baseHost: BASE_HOST,
      ...(seatsFull
        ? {
            seats: new FakeSeatCensus(seatsFull.members, seatsFull.membersLite),
            plans: makePlanProvider({
              maxMembers: seatsFull.members,
              maxMembersLite: seatsFull.membersLite,
            }),
          }
        : {}),
    }),
  );

  return InviteServiceOrganizationInvitations.create({
    invites: service,
    repository,
    throttle,
    baseHost: BASE_HOST,
    identity: { verifiedEmailsOf: async () => ({ kind: "keep_legacy" }) },
    userDirectory: PrismaOrganizationUserDirectoryRepository.create({
      user: { findUnique: async () => null },
    } as never),
    notices: options.notices ?? { record: async () => {} },
  });
}

describe("given the invitation member the process composes", () => {
  describe("when a batch of one invite is created", () => {
    /** @scenario "Listing invites includes the invite link" */
    it("answers the created invite and lists it back with its email, role, code and link", async () => {
      const door = invitations();

      const created = await door.create({
        organizationId: ORGANIZATION_ID,
        validation: "lenient",
        invites: [{ email: "new@acme.test", role: "MEMBER", teamIds: "team-1" }],
      });

      expect(created.invites).toHaveLength(1);
      expect(created.invites[0]!.emailNotSent).toBe(true);

      const listed = await door.list({ organizationId: ORGANIZATION_ID });

      expect(listed).toHaveLength(1);
      expect(listed[0]!.email).toBe("new@acme.test");
      expect(listed[0]!.role).toBe("MEMBER");
      expect(listed[0]!.inviteCode).toEqual(created.invites[0]!.invite.inviteCode);
      expect(listed[0]!.displayStatus).toBe("PENDING");
      expect(listed[0]!.inviteUrl).toBe(
        `${BASE_HOST}/invite/accept?inviteCode=${listed[0]!.inviteCode}`,
      );
    });
  });

  describe("when a created invite is revoked", () => {
    /** @scenario "Revoking a pending invite marks it REVOKED" */
    it("still appears in the invite list with status REVOKED, and revoking it again is refused", async () => {
      const door = invitations();
      const created = await door.create({
        organizationId: ORGANIZATION_ID,
        validation: "lenient",
        invites: [{ email: "revoke-me@acme.test", role: "MEMBER", teamIds: "team-1" }],
      });
      const inviteId = created.invites[0]!.invite.id;

      await door.revoke({ organizationId: ORGANIZATION_ID, inviteId });
      const listed = await door.list({ organizationId: ORGANIZATION_ID });

      expect(listed[0]!.displayStatus).toBe("REVOKED");
      await expect(
        door.revoke({ organizationId: ORGANIZATION_ID, inviteId }),
      ).rejects.toMatchObject({ code: "invite_not_found" });
    });
  });

  describe("when a pending invite is extended", () => {
    it("keeps its code, moves its expiry later, and refuses once it is revoked", async () => {
      const door = invitations();
      const created = await door.create({
        organizationId: ORGANIZATION_ID,
        validation: "lenient",
        invites: [{ email: "extend-me@acme.test", role: "MEMBER", teamIds: "team-1" }],
      });
      const original = created.invites[0]!.invite;

      const { invite } = await door.extend({
        organizationId: ORGANIZATION_ID,
        inviteId: original.id,
      });

      expect(invite.inviteCode).toBe(original.inviteCode);
      expect(invite.expiration!.epochMilliseconds).toBeGreaterThanOrEqual(
        original.expiration!.epochMilliseconds,
      );
      await door.revoke({ organizationId: ORGANIZATION_ID, inviteId: original.id });
      await expect(
        door.extend({ organizationId: ORGANIZATION_ID, inviteId: original.id }),
      ).rejects.toMatchObject({ code: "invite_not_found" });
    });
  });

  describe("when an invite code names no invitation", () => {
    /** @scenario "Looking up an unknown invite code answers absent, not a crash" */
    it("answers null rather than throwing", async () => {
      const door = invitations();

      await expect(door.findByCode({ inviteCode: "does-not-exist" })).resolves.toBeNull();
    });
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
      const door = invitations({ teamsInOrganization: ["team-1"] });

      await expect(
        door.create({
          organizationId: ORGANIZATION_ID,
          validation: "strict",
          invites: [
            { email: "good@acme.test", role: "MEMBER", teamIds: "team-1" },
            { email: "elsewhere@acme.test", role: "MEMBER", teamIds: "team-elsewhere" },
          ],
        }),
      ).rejects.toMatchObject({ code: "team_not_in_organization" });

      await expect(door.list({ organizationId: ORGANIZATION_ID })).resolves.toHaveLength(0);
    });
  });

  describe("when the asking transport chose lenient validation", () => {
    /**
     * The mode still works: the form drops what it cannot grant rather than
     * losing a batch an admin typed by hand.
     * @scenario "The invite form drops a team assignment it cannot grant"
     */
    it("drops that invitation and answers an empty batch", async () => {
      const door = invitations({ teamsInOrganization: ["team-1"] });

      const created = await door.create({
        organizationId: ORGANIZATION_ID,
        validation: "lenient",
        invites: [{ email: "elsewhere@acme.test", role: "MEMBER", teamIds: "team-elsewhere" }],
      });

      expect(created.invites).toHaveLength(0);
      await expect(door.list({ organizationId: ORGANIZATION_ID })).resolves.toHaveLength(0);
    });
  });
});

describe("given a batch naming only teams the organization has", () => {
  describe("when the asking transport chose strict validation", () => {
    it("creates the invitations", async () => {
      const door = invitations({ teamsInOrganization: ["team-1"] });

      const created = await door.create({
        organizationId: ORGANIZATION_ID,
        validation: "strict",
        invites: [{ email: "good@acme.test", role: "MEMBER", teamIds: "team-1" }],
      });

      expect(created.invites).toHaveLength(1);
      expect(created.invites[0]!.invite.email).toBe("good@acme.test");
    });
  });
});

describe("given a deployment that composed no invitation service", () => {
  describe("when an admin asks to create invitations", () => {
    /** @scenario "A deployment with no invitation service refuses by name" */
    it("refuses with the named capability error rather than crashing", async () => {
      const app = organizationAppForTesting({
        dependencies: {
          organizations: createApiFixture<ServerOrganizationAppDependencies["organizations"]>(),
          membership: createApiFixture<ServerOrganizationAppDependencies["membership"]>(),
          projects: createApiFixture<ServerOrganizationAppDependencies["projects"]>(),
          permissions: createApiFixture<AuthzApi>({}),
        },
      });

      await expect(
        app.createInvitations(
          { organizationId: ORGANIZATION_ID, validation: "strict", invites: [] },
          { id: "user-1" },
        ),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    });
  });
});

/** The door over the composed invitations, recording seat-limit events into `recorded`. */
function doorWithFullSeats(seatsFull: Readonly<{ members: number; membersLite: number }>) {
  const recorded: RecordSeatLimitReachedCommandData[] = [];
  const signals = createApiFixture<OrganizationSignals>({ reportError: () => {} });
  const notices = SeatLimitNoticeService.create({ signals });
  notices.connect({
    send: async (data: RecordSeatLimitReachedCommandData) => {
      recorded.push(data);
    },
  });
  const door = OrganizationInvitationDoorService.create({
    invitations: invitations({ seatsFull, notices }),
    joinRequests: null,
    plans: createApiFixture<OrganizationPlanGate>(),
    signals,
    lifecycle: createApiFixture<OrganizationLifecycleNoticeService>({
      membersInvited: () => {},
      inviteAccepted: () => {},
    }),
    creationThrottle: createApiFixture<InviteCreationThrottleService>({
      assertCreationAllowed: async () => {},
    }),
    ceiling: { assertWithinCaller: async () => {} },
    ensurePersonalWorkspace: async () => undefined,
  });
  return { door, recorded };
}

describe("given an organization whose seats are all taken", () => {
  /** @scenario "Member invite triggers notification when limit reached" */
  it("refuses a full-member invite and records organization's seat-limit event", async () => {
    const { door, recorded } = doorWithFullSeats({ members: 3, membersLite: 1 });

    await expect(
      door.create(
        {
          organizationId: ORGANIZATION_ID,
          validation: "lenient",
          invites: [{ email: "one-more@acme.test", role: "MEMBER", teamIds: "team-1" }],
        },
        { id: "user-1" },
      ),
    ).rejects.toMatchObject({ code: "member_seat_limit_reached" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(recorded).toEqual([
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        limitType: "members",
        current: 3,
        max: 3,
      }),
    ]);
  });

  /** @scenario "Lite member invite triggers notification when limit reached" */
  it("refuses a lite-member invite and records organization's seat-limit event", async () => {
    const { door, recorded } = doorWithFullSeats({ members: 3, membersLite: 1 });

    await expect(
      door.create(
        {
          organizationId: ORGANIZATION_ID,
          validation: "lenient",
          invites: [{ email: "lite@acme.test", role: "EXTERNAL", teamIds: "team-1" }],
        },
        { id: "user-1" },
      ),
    ).rejects.toMatchObject({ code: "member_seat_limit_reached" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(recorded).toEqual([
      expect.objectContaining({ limitType: "membersLite", current: 1, max: 1 }),
    ]);
  });
});
