import { createLogger } from "@langwatch/observability";
import type { OrganizationInvite } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
/**
 * @vitest-environment node
 * @see specs/members/developer-seat.feature
 * An invitation lands on the seat it names, never the joiner seat, and a Developer one
 * audits its own admission (ADR-171).
 */
import { nanoid } from "nanoid";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationInviteRepository } from "../../repositories/prisma/prisma.organization-invite.repository.ts";
import { inviteFromRecord } from "../../repositories/prisma/prisma.organization.mapper.ts";
import { InviteAcceptanceService } from "../invite-acceptance.service.ts";
import { FakeAuthzGrantsService, makeInviteDeps } from "./support/invite-fakes.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("accepting an invitation on a seat (Postgres)", () => {
  const ns = `inv-seat-${nanoid(8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:invite-developer-seat"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const invites = PrismaOrganizationInviteRepository.create({ database: prisma });
  let organizationId: string;
  let adminUserId: string;
  const userIds: string[] = [];

  async function pendingInvite({
    email,
    role,
  }: {
    email: string;
    role: "MEMBER" | "DEVELOPER";
  }): Promise<OrganizationInvite> {
    return inviteFromRecord(
      await prisma.organizationInvite.create({
        data: {
          email,
          inviteCode: `code-${nanoid(10)}`,
          organizationId,
          teamIds: "",
          role,
          requestedBy: adminUserId,
          expiration: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      }),
    );
  }

  async function invitee(label: string): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `${label}-${ns}@acme.test`, name: label },
    });
    userIds.push(user.id);
    return user.id;
  }

  function seatOf(userId: string) {
    return prisma.organizationUser
      .findUnique({ where: { userId_organizationId: { userId, organizationId } } })
      .then((row) => row?.role);
  }

  function admissionAudits(userId: string) {
    return prisma.auditLog.findMany({
      where: { organizationId, userId, action: "organization.member.admitted" },
    });
  }

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { email: `admin-${ns}@acme.test`, name: "Admin" },
    });
    adminUserId = admin.id;
    userIds.push(admin.id);
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${ns}` },
    });
    organizationId = organization.id;
  });

  afterEach(async () => {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { joinerRole: "MEMBER" },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    await prisma.organizationInvite.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe("given the organisation's joiner seat is Developer", () => {
    describe("when a Full member invitation is accepted", () => {
      /** @scenario The joiner seat setting never applies to invitations */
      it("lands the invited person on the seat the invitation names", async () => {
        await prisma.organization.update({
          where: { id: organizationId },
          data: { joinerRole: "DEVELOPER" },
        });
        const grants = new FakeAuthzGrantsService();
        const acceptance = InviteAcceptanceService.create(makeInviteDeps({ invites, grants }));
        const userId = await invitee("invited-full");
        const invite = await pendingInvite({
          email: `invited-full-${ns}@acme.test`,
          role: "MEMBER",
        });

        await acceptance.applyInvite({ userId, invite });

        expect(await seatOf(userId)).toBe("MEMBER");
        expect(grants.bindingsFor(userId)).toEqual([
          expect.objectContaining({ scopeType: "ORGANIZATION", scopeId: organizationId }),
        ]);
      });
    });
  });

  describe("given a Developer invitation", () => {
    describe("when the invitee accepts it", () => {
      /** @scenario An administrator invites a Developer while the plan is at its seat cap */
      it("admits them on the seat with no organisation binding and an audit row", async () => {
        const grants = new FakeAuthzGrantsService();
        const acceptance = InviteAcceptanceService.create(makeInviteDeps({ invites, grants }));
        const userId = await invitee("invited-developer");
        const invite = await pendingInvite({
          email: `invited-developer-${ns}@acme.test`,
          role: "DEVELOPER",
        });

        await acceptance.applyInvite({ userId, invite });

        expect(await seatOf(userId)).toBe("DEVELOPER");
        expect(grants.bindingsFor(userId)).toEqual([]);
        const audits = await admissionAudits(userId);
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          actorUserId: adminUserId,
          metadata: { seat: "DEVELOPER", via: "invite", inviteId: invite.id },
        });
      });
    });

    describe("when the acceptance is retried after it landed", () => {
      it("records the admission once", async () => {
        const acceptance = InviteAcceptanceService.create(
          makeInviteDeps({ invites, grants: new FakeAuthzGrantsService() }),
        );
        const userId = await invitee("invited-developer-retry");
        const invite = await pendingInvite({
          email: `invited-developer-retry-${ns}@acme.test`,
          role: "DEVELOPER",
        });

        await acceptance.applyInvite({ userId, invite });
        const landed = inviteFromRecord(
          await prisma.organizationInvite.findFirstOrThrow({
            where: { id: invite.id, organizationId },
          }),
        );
        await acceptance.applyInvite({ userId, invite: landed });

        expect(await admissionAudits(userId)).toHaveLength(1);
      });
    });
  });
});
