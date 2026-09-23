import { createApiFixture } from "@langwatch/api-fixture";
/**
 * `InviteServiceOrganizationInvitations` maps `InviteService`'s method names onto
 * the port the door reads; the app still refuses a role it composed none for.
 * @see specs/organizations/organization-members-rest-api.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationInvite } from "@langwatch/organization-contract";
import { describe, expect, it } from "vitest";

import type {
  OrganizationInviteRepository,
  WriteInviteInput,
} from "../../repositories/organization-invite.repository.ts";
import { PrismaOrganizationUserDirectoryRepository } from "../../repositories/prisma/prisma.organization-user-directory.repository.ts";
import {
  FakeInviteRateLimit,
  makeInviteDeps,
  makeOrganization,
} from "../../services/__tests__/support/invite-fakes.ts";
import { InviteSendThrottleService } from "../../services/invite-send-throttle.service.ts";
import { InviteService } from "../../services/invite.service.ts";
import { InviteServiceOrganizationInvitations } from "../organization-composition.build.ts";
import {
  ServerOrganizationApp,
  type ServerOrganizationAppDependencies,
} from "../organization.app.ts";

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

  const repository: OrganizationInviteRepository = {
    tryFindOrganizationWithMembers: async () => ({
      ...makeOrganization({ id: ORGANIZATION_ID }),
      members: [],
    }),
    tryFindMemberEmail: async () => null,
    tryFindOpenInviteForEmail: async () => null,
    findCustomRolePermissions: async () => [],
    tryFindPersonalTeamInScopes: async () => null,
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
        createdAt: new Date(),
        updatedAt: new Date(),
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
    tryFindInviteByCodeWithOrganization: async ({ inviteCode }: { inviteCode: string }) => {
      const invite = Array.from(invites.values()).find(
        (candidate) => candidate.inviteCode === inviteCode,
      );
      if (!invite) return null;

      return { ...invite, organization: makeOrganization({ id: invite.organizationId }) };
    },
    withTransaction: async (
      write: (transaction: OrganizationInviteRepository) => Promise<unknown>,
    ) => write(repository),
  } as unknown as OrganizationInviteRepository;

  return repository;
}

/** The invitation door as the composed process would hand it to
 *  `OrganizationInvitationDoorService`. */
function invitations(options: { teamsInOrganization?: readonly string[] } = {}) {
  const repository = fakeInviteRepository(options);
  const throttle = InviteSendThrottleService.create(new FakeInviteRateLimit());
  const service = InviteService.create(
    makeInviteDeps({ invites: repository, throttle, baseHost: BASE_HOST }),
  );

  return InviteServiceOrganizationInvitations.create({
    invites: service,
    repository,
    throttle,
    baseHost: BASE_HOST,
    identity: { verifiedEmailsOf: async () => null },
    userDirectory: PrismaOrganizationUserDirectoryRepository.create({
      user: { findUnique: async () => null },
    } as never),
    logger: { warn: () => {} },
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
      const app = ServerOrganizationApp.createForTesting({
        dependencies: {
          organizations: {} as unknown as ServerOrganizationAppDependencies["organizations"],
          membership: {} as unknown as ServerOrganizationAppDependencies["membership"],
          projects: {} as unknown as ServerOrganizationAppDependencies["projects"],
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
