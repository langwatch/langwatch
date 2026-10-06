import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
/**
 * @vitest-environment node
 * @see specs/identity/resilient-invitations.feature
 * An invitation records who sent it, across the list and a resend (Postgres).
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationInviteRepository } from "../../repositories/prisma/prisma.organization-invite.repository.ts";
import { InviteService } from "../invite.service.ts";
import { makeInviteDeps } from "./support/invite-fakes.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("who sent an invitation (Postgres)", () => {
  const ns = `inv-sender-${nanoid(8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:invite-sender"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const service = InviteService.create(
    makeInviteDeps({ invites: PrismaOrganizationInviteRepository.create({ database: prisma }) }),
  );
  let organizationId: string;
  let adminUserId: string;

  beforeAll(async () => {
    const admin = await prisma.user.create({
      data: { email: `admin-${ns}@acme.test`, name: "Ana" },
    });
    adminUserId = admin.id;
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${ns}` },
    });
    organizationId = organization.id;
  });

  afterAll(async () => {
    await prisma.organizationInvite.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.user.delete({ where: { id: adminUserId } });
    await prisma.$disconnect();
  });

  describe("given an administrator invites a person", () => {
    /** @scenario "Admin invitations retain the authenticated sender across resend" */
    it("stores the administrator as the sender, keeps them across a resend, and leaves a service-created invitation without one", async () => {
      const { invites: sent } = await service.createInvites({
        organizationId,
        requestedBy: adminUserId,
        validation: "strict",
        invites: [{ email: `sam-${ns}@acme.test`, role: "DEVELOPER" }],
      });
      const [created] = sent;
      expect(created?.invite.requestedBy).toBe(adminUserId);

      const listed = await service.listInvites({ organizationId });
      expect(listed.find((invite) => invite.id === created?.invite.id)?.requestedByUser).toEqual({
        id: adminUserId,
        name: "Ana",
        email: `admin-${ns}@acme.test`,
      });

      const { invite: resent } = await service.resendInvite({
        organizationId,
        inviteId: created?.invite.id ?? "",
      });
      expect(resent.inviteCode).not.toBe(created?.invite.inviteCode);
      const stored = await prisma.organizationInvite.findUniqueOrThrow({
        where: { id: created?.invite.id },
      });
      expect(stored.requestedBy).toBe(adminUserId);
      expect(stored.inviteCode).toBe(resent.inviteCode);

      const { invites: unattributed } = await service.createInvites({
        organizationId,
        validation: "strict",
        invites: [{ email: `svc-${ns}@acme.test`, role: "DEVELOPER" }],
      });
      expect(unattributed[0]?.invite.requestedBy).toBeNull();
      const [serviceRow] = await prisma.organizationInvite.findMany({
        where: { organizationId, email: `svc-${ns}@acme.test` },
      });
      expect(serviceRow?.requestedBy).toBeNull();
    });
  });
});
