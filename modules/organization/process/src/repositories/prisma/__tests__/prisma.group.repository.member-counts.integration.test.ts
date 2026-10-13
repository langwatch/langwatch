/**
 * Group member counts come from one grouped count over the listed groups, not a
 * per-row `_count`: the org listing counts only members still in the
 * organization, the member's own listing counts every membership.
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

import { PrismaGroupRepository } from "../prisma.group.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaGroupRepository member counts", () => {
  const namespace = `group-member-counts-${nanoid(8)}`;
  const organizationId = `${namespace}-organization`;
  const memberId = `${namespace}-member`;
  const colleagueId = `${namespace}-colleague`;
  const departedId = `${namespace}-departed`;
  const busyGroupId = `${namespace}-busy`;
  const emptyGroupId = `${namespace}-empty`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:group-member-counts"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaGroupRepository.create(prisma);

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    for (const id of [memberId, colleagueId, departedId]) {
      await prisma.user.create({ data: { id, email: `${id}@example.com`, name: id } });
    }
    for (const userId of [memberId, colleagueId]) {
      await prisma.organizationUser.create({
        data: { userId, organizationId, role: OrganizationUserRole.MEMBER },
      });
    }
    for (const [id, name] of [
      [busyGroupId, "A busy group"],
      [emptyGroupId, "B empty group"],
    ] as const) {
      await prisma.group.create({ data: { id, organizationId, name, slug: id } });
    }
    for (const userId of [memberId, colleagueId, departedId]) {
      await prisma.groupMembership.create({ data: { userId, groupId: busyGroupId } });
    }
  });

  afterAll(async () => {
    await prisma.groupMembership.deleteMany({
      where: { groupId: { in: [busyGroupId, emptyGroupId] } },
    });
    await prisma.group.deleteMany({ where: { organizationId } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [memberId, colleagueId, departedId] } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("when the organization's groups are listed", () => {
    it("counts only members who still belong to the organization, and zero for an empty group", async () => {
      const listed = await repository.listAll({ organizationId, page: 1, limit: 10 });

      expect(listed.data.map(({ id, memberCount }) => ({ id, memberCount }))).toEqual([
        { id: busyGroupId, memberCount: 2 },
        { id: emptyGroupId, memberCount: 0 },
      ]);
      expect(listed.pagination.total).toBe(2);
    });
  });

  describe("when a member's own groups are listed", () => {
    it("counts every membership of each group the member is in", async () => {
      const listed = await repository.findForMember({ organizationId, userId: memberId });

      expect(listed.map(({ id, memberCount }) => ({ id, memberCount }))).toEqual([
        { id: busyGroupId, memberCount: 3 },
      ]);
    });
  });
});
