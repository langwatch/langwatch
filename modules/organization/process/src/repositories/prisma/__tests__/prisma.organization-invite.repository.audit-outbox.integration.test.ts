/**
 * @vitest-environment node
 * @see modules/audit-log/specs/audit-log.feature
 * A Developer admission appends its audit intent in its own transaction (Alex, 2026-10-06):
 * a commit leaves one intent in organization's outbox, a rollback leaves none.
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationInviteRepository } from "../prisma.organization-invite.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

class RolledBack extends Error {}

describe.skipIf(!DB_URL)("organization's audit outbox (Postgres)", () => {
  const ns = `org-audit-${nanoid(8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:audit-outbox"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  const invites = PrismaOrganizationInviteRepository.create({ database: prisma });
  const organizationIds: string[] = [];
  const userIds: string[] = [];
  let adminUserId: string;

  async function organization(label: string): Promise<string> {
    const created = await prisma.organization.create({
      data: { name: label, slug: `--${ns}-${label}` },
    });
    organizationIds.push(created.id);
    return created.id;
  }

  async function person(label: string): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `${label}-${ns}@acme.test`, name: label },
    });
    userIds.push(user.id);
    return user.id;
  }

  function auditIntents(organizationId: string) {
    return prisma.processManagerOutbox.findMany({
      where: { processName: "organizationAudit", projectId: organizationId },
    });
  }

  function admit({ userId, organizationId }: { userId: string; organizationId: string }) {
    return {
      userId,
      organizationId,
      role: OrganizationUserRole.DEVELOPER,
      admission: { inviteId: `invite-${ns}`, actorUserId: adminUserId },
    };
  }

  beforeAll(async () => {
    adminUserId = await person("admin");
  });

  afterAll(async () => {
    await prisma.processManagerOutbox.deleteMany({ where: { projectId: { in: organizationIds } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe("given a Developer admitted through an invitation", () => {
    describe("when the admission commits", () => {
      /** @scenario A committed organization change leaves one audit intent in its outbox */
      it("leaves one audit intent naming the admission and writes no audit row itself", async () => {
        const organizationId = await organization("committed");
        const userId = await person("committed");

        await invites.addMembership(admit({ userId, organizationId }));

        const intents = await auditIntents(organizationId);
        expect(intents).toHaveLength(1);
        expect(intents[0]).toMatchObject({
          intentType: "recordAudit",
          status: "pending",
          payload: {
            tenantId: organizationId,
            action: "organization.member.admitted",
            userId,
            actorUserId: adminUserId,
            organizationId,
            metadata: { seat: "DEVELOPER", inviteId: `invite-${ns}`, via: "invite" },
          },
        });
        const [intent] = intents;
        const payload = intent?.payload as { idempotencyKey?: string } | undefined;
        expect(payload?.idempotencyKey).toEqual(expect.any(String));
        expect(intent?.messageKey).toBe(payload?.idempotencyKey);
        expect(await prisma.auditLog.count({ where: { organizationId } })).toBe(0);
      });
    });

    describe("when the transaction the admission joined rolls back", () => {
      /** @scenario A rolled-back change records no audit */
      it("leaves no seat, no audit intent and no audit row", async () => {
        const organizationId = await organization("rolled-back");
        const userId = await person("rolled-back");

        await expect(
          invites.withTransaction(async (transaction) => {
            await transaction.addMembership(admit({ userId, organizationId }));
            throw new RolledBack("the change after the admission failed");
          }),
        ).rejects.toBeInstanceOf(RolledBack);

        expect(await prisma.organizationUser.count({ where: { organizationId } })).toBe(0);
        expect(await auditIntents(organizationId)).toEqual([]);
        expect(await prisma.auditLog.count({ where: { organizationId } })).toBe(0);
      });
    });
  });
});
