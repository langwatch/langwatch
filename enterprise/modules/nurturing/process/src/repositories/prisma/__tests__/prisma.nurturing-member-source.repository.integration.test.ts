// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The owners' active members, read through shares: disabled memberships and deactivated users
 * are left out.
 * Spec: enterprise/modules/nurturing/specs/organization-member-facts.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaNurturingMemberSourceRepository } from "../prisma.nurturing-member-source.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-nurturing-source-${randomUUID()}`;
const organizationId = `${namespace}-org`;
const activeUserId = `${namespace}-active`;
const disabledUserId = `${namespace}-disabled`;
const deactivatedUserId = `${namespace}-deactivated`;
const userIds = [activeUserId, disabledUserId, deactivatedUserId];

describe.skipIf(!databaseUrl)("given the owners' organization and membership rows", () => {
  let connection: PrismaConnection;
  let source: PrismaNurturingMemberSourceRepository;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:nurturing:test:member-source"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    source = PrismaNurturingMemberSourceRepository.create({ prisma: connection.client });

    const { client } = connection;
    await client.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    for (const id of userIds) {
      await client.user.create({
        data: {
          id,
          email: `${id}@acme.test`,
          ...(id === deactivatedUserId ? { deactivatedAt: new Date() } : {}),
        },
      });
      await client.organizationUser.create({
        data: {
          userId: id,
          organizationId,
          role: "MEMBER",
          ...(id === disabledUserId ? { disabledAt: new Date() } : {}),
        },
      });
    }
  });

  afterAll(async () => {
    if (!connection) return;
    const { client } = connection;
    await client.organizationUser.deleteMany({ where: { organizationId } });
    await client.organization.deleteMany({ where: { id: organizationId } });
    await client.user.deleteMany({ where: { id: { in: userIds } } });
    await connection.closeOnce();
  });

  /** @scenario "The member backfill skips disabled members and deactivated users" */
  it("lists only the member whose membership and user are both active", async () => {
    const members = await source.findActiveMembers({ organizationId });

    expect(members.map(({ userId }) => userId)).toEqual([activeUserId]);
  });
});
