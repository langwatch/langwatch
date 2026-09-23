/**
 * The group sizes a per-member budget shows come from one grouped count over
 * the groups read, not a per-row `_count`; a group with no members is sized
 * zero, never left out.
 * @vitest-environment node
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaGatewayBudgetScopeTargetRepository } from "../prisma.gateway-budget-scope-target.repository.ts";
import { PrismaGatewayOrganizationDirectoryRepository } from "../prisma.gateway-organization-directory.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("gateway group member counts", () => {
  const namespace = `gateway-group-counts-${nanoid(8)}`;
  const organizationId = `${namespace}-organization`;
  const userIds = [`${namespace}-first`, `${namespace}-second`];
  const busyGroupId = `${namespace}-busy`;
  const emptyGroupId = `${namespace}-empty`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:gateway:test:group-member-counts"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    for (const id of userIds) {
      await prisma.user.create({ data: { id, email: `${id}@example.com`, name: id } });
    }
    for (const [id, name] of [
      [busyGroupId, "A busy group"],
      [emptyGroupId, "B empty group"],
    ] as const) {
      await prisma.group.create({ data: { id, organizationId, name, slug: id } });
    }
    for (const userId of userIds) {
      await prisma.groupMembership.create({ data: { userId, groupId: busyGroupId } });
    }
  });

  afterAll(async () => {
    await prisma.groupMembership.deleteMany({
      where: { groupId: { in: [busyGroupId, emptyGroupId] } },
    });
    await prisma.group.deleteMany({ where: { organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await connection.closeOnce();
  });

  describe("when the directory lists the groups a budget can target", () => {
    it("sizes each group by its members", async () => {
      const targets =
        await PrismaGatewayOrganizationDirectoryRepository.create(prisma).findGroupTargets(
          organizationId,
        );

      expect(targets.map(({ id, memberCount }) => ({ id, memberCount }))).toEqual([
        { id: busyGroupId, memberCount: 2 },
        { id: emptyGroupId, memberCount: 0 },
      ]);
    });
  });

  describe("when the directory sizes the groups named by budgets", () => {
    it("keeps an empty group at zero and leaves out a group that does not exist", async () => {
      const counts = await PrismaGatewayOrganizationDirectoryRepository.create(
        prisma,
      ).groupMemberCounts([
        { scopeType: "GROUP", scopeId: busyGroupId },
        { scopeType: "GROUP", scopeId: emptyGroupId },
        { scopeType: "GROUP", scopeId: `${namespace}-missing` },
        { scopeType: "TEAM", scopeId: busyGroupId },
      ]);

      expect(Object.fromEntries(counts)).toEqual({ [busyGroupId]: 2, [emptyGroupId]: 0 });
    });
  });

  describe("when budget scope targets are resolved for group budgets", () => {
    it("carries each group's member count", async () => {
      const targets =
        await PrismaGatewayBudgetScopeTargetRepository.create().resolveScopeTargetsBatch(
          prisma,
          [
            { scopeType: "GROUP", scopeId: busyGroupId },
            { scopeType: "GROUP", scopeId: emptyGroupId },
          ],
          organizationId,
          [],
          [],
        );

      expect([...targets.values()].map(({ id, memberCount }) => ({ id, memberCount }))).toEqual(
        expect.arrayContaining([
          { id: busyGroupId, memberCount: 2 },
          { id: emptyGroupId, memberCount: 0 },
        ]),
      );
      expect(targets.size).toBe(2);
    });
  });
});
