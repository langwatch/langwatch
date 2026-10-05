/**
 * A Developer seat gets nothing through a group (ADR-171), so a team-admin group never makes
 * one an effective admin of that team.
 * @vitest-environment node
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, type PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaEffectiveTeamAdminsRepository } from "../prisma.effective-team-admins.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("effective team admins through a group", () => {
  const namespace = `team-admins-developer-${nanoid(8)}`;
  const organizationId = `${namespace}-organization`;
  const memberUserId = `${namespace}-member`;
  const developerUserId = `${namespace}-developer`;
  const groupId = `${namespace}-group`;
  const teamId = `${namespace}-team`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:team-admins-developer"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaEffectiveTeamAdminsRepository.create();

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    for (const [userId, role] of [
      [memberUserId, OrganizationUserRole.MEMBER],
      [developerUserId, OrganizationUserRole.DEVELOPER],
    ] as const) {
      await prisma.user.create({
        data: { id: userId, email: `${userId}@example.com`, name: userId },
      });
      await prisma.organizationUser.create({ data: { userId, organizationId, role } });
    }
    await prisma.group.create({
      data: { id: groupId, organizationId, name: "Team admins", slug: groupId },
    });
    for (const userId of [memberUserId, developerUserId]) {
      await prisma.groupMembership.create({ data: { userId, groupId } });
    }
    await prisma.roleBinding.create({
      data: { organizationId, groupId, role: "ADMIN", scopeType: "TEAM", scopeId: teamId },
    });
  });

  afterAll(async () => {
    await prisma.roleBinding.deleteMany({ where: { organizationId } });
    await prisma.groupMembership.deleteMany({ where: { groupId } });
    await prisma.group.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [memberUserId, developerUserId] } } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  describe("when a Member and a Developer sit in the same admin group", () => {
    /** @scenario A Developer never sees a shared project */
    it("counts the Member as an admin and not the Developer", async () => {
      const admins = await repository.computeEffectiveAdminUserIds({
        tx: prisma,
        organizationId,
        teamId,
      });

      expect(admins.has(memberUserId)).toBe(true);
      expect(admins.has(developerUserId)).toBe(false);
    });

    it("answers the same for one person asked directly", async () => {
      const ask = (userId: string) =>
        repository.isUserAdminViaGroup({ tx: prisma, organizationId, teamId, userId });

      await expect(ask(memberUserId)).resolves.toBe(true);
      await expect(ask(developerUserId)).resolves.toBe(false);
    });
  });
});
