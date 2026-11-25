/**
 * @vitest-environment node
 * @see specs/licensing/billing-only-invite.feature
 * A Billing-only invite takes no seat on a full Free plan, and neither does its acceptance:
 * the joiner holds the Billing role and no team (ADR-205).
 */
import { createLogger } from "@langwatch/observability";
import { MemberSeatLimitReachedError } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PrismaOrganizationInviteRepository } from "../../../../repositories/prisma/prisma.organization-invite.repository.ts";
import { PrismaOrganizationSeatRepository } from "../../../../repositories/prisma/prisma.organization-seat.repository.ts";
import { inviteFromRecord } from "../../../../repositories/prisma/prisma.organization.mapper.ts";
import { InviteSeatCensusService } from "../invite-seat-census.service.ts";
import { InviteService } from "../invite.service.ts";
import { OrganizationInvitationDoorService } from "../organization-invitation-door.service.ts";
import { OrganizationInvitationsService } from "../organization-invitations.service.ts";
import {
  FakeAuthzGrantsService,
  makeInviteDeps,
  makePlanProvider,
} from "./support/invite-fakes.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("a Billing-only invite on a full Free plan (Postgres)", () => {
  const ns = `inv-billing-${nanoid(8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:invite-billing-only"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const seats = PrismaOrganizationSeatRepository.create(prisma);
  const grants = new FakeAuthzGrantsService();
  const inviteRepository = PrismaOrganizationInviteRepository.create({ database: prisma });
  const service = InviteService.create(
    makeInviteDeps({
      invites: inviteRepository,
      seats: InviteSeatCensusService.create(seats, {
        findHeldEmails: async () => [],
        takeBackHeldSeat: async () => false,
      }),
      // Free: two member seats, no Lite seat, no Developer seat.
      plans: makePlanProvider({ maxMembers: 2, maxMembersLite: 0, maxMembersDeveloper: 0 }),
      grants,
    }),
  );
  const ensurePersonalWorkspace = vi.fn(async () => undefined);
  // The invitation door as the accept page calls it, over the real invite service.
  const door = OrganizationInvitationDoorService.create({
    billing: { createSeatCheckout: vi.fn() },
    getOldestTeamId: vi.fn(),
    invitations: OrganizationInvitationsService.create({
      invites: service,
      repository: inviteRepository,
      throttle: {} as never,
      baseHost: "https://app.acme.test",
      identity: { verifiedEmailsOf: async () => ({ kind: "unresolved" }) } as never,
      userDirectory: {} as never,
      notices: { record: async () => {} },
    }),
    directory: { findProvenAddresses: async () => [] },
    signals: { announceJoin: async () => {}, reportError: () => {} },
    lifecycle: { membersInvited: () => {}, inviteAccepted: () => {} },
    creationThrottle: { assertCreationAllowed: async () => {} },
    ceiling: { assertWithinCaller: async () => {} },
    ensurePersonalWorkspace,
  } as never);
  let organizationId: string;
  let adminUserId: string;
  const userIds: string[] = [];

  async function person(label: string): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `${label}-${ns}@acme.test`, name: label },
    });
    userIds.push(user.id);
    return user.id;
  }

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${ns}` },
    });
    organizationId = organization.id;
    adminUserId = await person("admin");
    const colleague = await person("colleague");
    await prisma.organizationUser.createMany({
      data: [
        { userId: adminUserId, organizationId, role: "ADMIN" },
        { userId: colleague, organizationId, role: "MEMBER" },
      ],
    });
  });

  afterAll(async () => {
    await prisma.processManagerOutbox.deleteMany({ where: { projectId: organizationId } });
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.organizationInvite.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.organizationSeatLease.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe("given both member seats are used and the plan has no Lite seat", () => {
    it("refuses a plain Lite invite, so the plan is truly full", async () => {
      await expect(
        service.createInvites({
          organizationId,
          invites: [{ email: `lite-${ns}@acme.test`, role: "EXTERNAL" }],
          requestedBy: adminUserId,
          validation: "strict",
        }),
      ).rejects.toThrow(MemberSeatLimitReachedError);
    });

    /** @scenario "An admin invites a Billing-only member on a full Free plan" */
    it("creates a Billing-only invite and leaves every seat count unchanged", async () => {
      const before = await seats.countMemberSeats(organizationId);

      const created = await service.createInvites({
        organizationId,
        invites: [{ email: `finance-${ns}@acme.test`, role: "EXTERNAL", billingOnly: true }],
        requestedBy: adminUserId,
        validation: "strict",
      });

      expect(created.invites).toHaveLength(1);
      expect(created.invites[0]?.invite).toMatchObject({
        role: "EXTERNAL",
        billingOnly: true,
        teamIds: "",
        status: "PENDING",
      });
      expect(await seats.countMemberSeats(organizationId)).toEqual(before);
    });

    /** @scenario "A Billing-only invite that names a team is refused" */
    it("refuses a Billing-only invite that names a team", async () => {
      await expect(
        service.createInvites({
          organizationId,
          invites: [
            {
              email: `finance-team-${ns}@acme.test`,
              role: "EXTERNAL",
              billingOnly: true,
              teamIds: "team-1",
            },
          ],
          requestedBy: adminUserId,
          validation: "strict",
        }),
      ).rejects.toMatchObject({ code: "billing_only_no_team_access" });
    });
  });

  describe("when the Billing-only invite is accepted", () => {
    /** @scenario "Accepting a Billing-only invite takes no seat" */
    /** @scenario "A Billing-only member is given no team, project or personal workspace" */
    it("admits them through the invitation door, grants Billing, and takes no seat", async () => {
      const email = `payer-${ns}@acme.test`;
      await service.createInvites({
        organizationId,
        invites: [{ email, role: "EXTERNAL", billingOnly: true }],
        requestedBy: adminUserId,
        validation: "strict",
      });
      const invite = inviteFromRecord(
        await prisma.organizationInvite.findFirstOrThrow({ where: { organizationId, email } }),
      );
      const before = await seats.countMemberSeats(organizationId);
      const userId = await person("payer");

      await expect(
        door.accept({ inviteCode: invite.inviteCode }, {
          id: userId,
          name: "payer",
          email,
        } as never),
      ).resolves.toMatchObject({ success: true });

      const membership = await prisma.organizationUser.findUniqueOrThrow({
        where: { userId_organizationId: { userId, organizationId } },
      });
      expect(membership).toMatchObject({ role: "EXTERNAL", billingOnly: true });
      const after = await seats.countMemberSeats(organizationId);
      expect(after.fullMembers).toBe(before.fullMembers);
      expect(after.liteMembers).toBe(before.liteMembers);
      expect(after.developers).toBe(before.developers);
      expect(grants.billingRoleOf({ organizationId, userId })).toMatchObject({
        holds: true,
        source: "invite",
        commandId: `billing-only-invite:${invite.id}`,
      });
      expect(grants.bindingsFor(userId).filter((b) => b.scopeType === "TEAM")).toEqual([]);
      expect(ensurePersonalWorkspace).not.toHaveBeenCalled();
    });

    /** @scenario "Using a spent invitation link again writes nothing" */
    it("leaves Billing off when the grant is gone and the old link is used again", async () => {
      const email = `payer-again-${ns}@acme.test`;
      await service.createInvites({
        organizationId,
        invites: [{ email, role: "EXTERNAL", billingOnly: true }],
        requestedBy: adminUserId,
        validation: "strict",
      });
      const { inviteCode } = await prisma.organizationInvite.findFirstOrThrow({
        where: { organizationId, email },
      });
      const userId = await person("payer-again");
      const caller = { id: userId, name: "payer", email } as never;
      await door.accept({ inviteCode }, caller);
      grants.dropBillingGrant({ organizationId, userId });

      await expect(door.accept({ inviteCode }, caller)).rejects.toMatchObject({
        code: "invite_already_accepted",
      });

      expect(grants.billingRoleOf({ organizationId, userId })).toBeUndefined();
    });
  });
});
